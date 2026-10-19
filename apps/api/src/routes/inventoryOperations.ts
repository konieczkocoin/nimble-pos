import {itemLots,proposeLots} from '../services/inventoryLots';
import { stockAvailability, stockAvailabilityBatch } from '../services/stockReservations';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import { loyaltyFail as fail } from '../services/loyalty';
import type {UnitCost} from '../services/inventoryCost';
import { inventoryItem, inventoryRetry, inventoryMove } from '../services/inventory';
import { taskActorKey, type MerchantActor, type MerchantTaskHelpers } from './tasks';
import { foodOperationalDate, InventorySupplierInput, InventoryDeliveryInput, InventoryReceiptInput, InventoryReceiptReverseInput, InventoryStocktakeInput, InventoryStocktakeFinalizeInput, InventoryLossInput, InventoryLossDecisionInput, InventoryLossPolicyInput, type InventorySupplier, type InventoryDelivery, type InventoryStocktake, type InventoryLoss, type TaskTemplateInput } from '@nimble/shared';
type Operation = InventorySupplier | InventoryDelivery | InventoryStocktake | InventoryLoss;
type Kind = typeof s.merchantStockOperation.$inferInsert.kind;
const params = (r: FastifyRequest) => r.params as Record<string, string>, uuid = z.string().uuid();
const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length)
    fail(400, 'DUPLICATE_ITEM'); };
export async function inventoryOperationRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, base = '/v1/merchant/venues/:venueId/inventory';
    async function context(req: FastifyRequest, manage = false, owner = false) {
        const a = await h.actor(req), venueId = uuid.parse(params(req).venueId);
        await h.venueFor(a, venueId);
        if (owner && a.kind !== 'owner')
            fail(403, 'FORBIDDEN');
        if (manage && a.kind !== 'owner' && !a.permissions?.includes('inventory.manage'))
            fail(403, 'FORBIDDEN');
        return { a, venueId };
    }
    const costs = (a: MerchantActor) => a.kind === 'owner' || !!a.permissions?.includes('inventory.costs');
    function view<T extends Operation>(data: T, a: MerchantActor): T {
        if (costs(a) || !('receipts' in data))
            return data;
        return { ...data, lines: data.lines.map(({ unitCostMinor, totalCostMinor, ...line }) => line) } as T;
    }
    async function get<T extends Operation>(store: Db, venueId: string, id: string, kind: Kind, lock = false): Promise<T> {
        const q = store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id, uuid.parse(id)), eq(s.merchantStockOperation.venueId, venueId), eq(s.merchantStockOperation.kind, kind)));
        const [row] = lock ? await q.for('update') : await q;
        if (!row)
            return fail(404, 'NOT_FOUND');
        return row.data as T;
    }
    async function save(store: Db, value: Operation) { await store.update(s.merchantStockOperation).set({ data: value }).where(eq(s.merchantStockOperation.id, value.id)); return value; }
    async function insert<T extends Operation>(store: Db, kind: Kind, value: T) { await store.insert(s.merchantStockOperation).values({ id: value.id, venueId: value.venueId, kind, data: value }); return value; }
    async function list<T extends Operation>(req: FastifyRequest, kind: Kind) {
        const { a, venueId } = await context(req);
        const query = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
        const rows = await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId, venueId), eq(s.merchantStockOperation.kind, kind))).orderBy(asc(s.merchantStockOperation.createdAt), asc(s.merchantStockOperation.id)).limit(query.limit + 1).offset(query.page * query.limit);
        return { values: rows.slice(0, query.limit).map(row => view(row.data as T, a)), hasMore: rows.length > query.limit };
    }
    async function transaction<T extends Operation>(a: MerchantActor, venueId: string, key: string, payload: unknown, run: (store: Db) => Promise<T>) {
        const data = await db.transaction(async (tx) => { await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${'stock-operations:' + venueId}))`); return inventoryRetry(tx as unknown as Db, a, venueId, key, payload, () => run(tx as unknown as Db)); });
        return view(data, a);
    }
    // Cost fields are excluded from the audit by construction; costs are available only on delivery DTOs.
    async function audit(store: Db, a: MerchantActor, venueId: string, action: string, reason: string, value: Operation) {
        const redacted = 'receipts' in value ? { ...value, lines: value.lines.map(({ unitCostMinor, totalCostMinor, ...line }) => line) } : value;
        await h.audit(store, a, venueId, action, reason, null, redacted);
    }
    app.get(`${base}/lookup`, async (req) => { const { venueId } = await context(req); const { barcode } = z.object({ barcode: z.string().trim().min(1).max(100) }).parse(req.query); const items = await db.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId, venueId), eq(s.merchantInventoryItem.barcode, barcode))); const availability=await stockAvailabilityBatch(db,items); return { items: items.map(i => ({ ...i, ...availability.get(i.id)!, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })) }; });
    app.get(`${base}/suppliers`, async (req) => { const r = await list<InventorySupplier>(req, 'SUPPLIER'); return { suppliers: r.values, hasMore: r.hasMore }; });
    async function supplier(req: FastifyRequest, patch = false) {
        const { a, venueId } = await context(req, true), input = InventorySupplierInput.parse(req.body);
        return transaction(a, venueId, input.idempotencyKey, { action: patch ? 'supplier.patch' : 'supplier.create', id: patch ? params(req).supplierId : null, input }, async (store) => {
            const old = patch ? await get<InventorySupplier>(store, venueId, params(req).supplierId, 'SUPPLIER', true) : null;
            const value: InventorySupplier = { id: old?.id ?? randomUUID(), venueId, name: input.name, active: input.active };
            await (old ? save(store, value) : insert(store, 'SUPPLIER', value));
            await audit(store, a, venueId, 'inventory.supplier.updated', 'Supplier details', value);
            return value;
        });
    }
    app.post(`${base}/suppliers`, req => supplier(req));
    app.patch(`${base}/suppliers/:supplierId`, req => supplier(req, true));
    app.get(`${base}/deliveries`, async (req) => { const r = await list<InventoryDelivery>(req, 'DELIVERY'); return { deliveries: r.values, hasMore: r.hasMore }; });
    app.get(`${base}/deliveries/:deliveryId`,async req=>{const {a,venueId}=await context(req);return view(await get<InventoryDelivery>(db,venueId,params(req).deliveryId,'DELIVERY'),a)});
    app.post(`${base}/deliveries`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryDeliveryInput.parse(req.body);
        unique(input.lines.map(l => l.itemId));
        if (input.lines.some(l => (l.unitCostMinor != null || l.totalCostMinor != null)) && !costs(a))
            fail(403, 'COSTS_FORBIDDEN');
        return transaction(a, venueId, input.idempotencyKey, { action: 'delivery.create', input }, async (store) => {
            const supplier = await get<InventorySupplier>(store, venueId, input.supplierId, 'SUPPLIER');
            if (!supplier.active)
                fail(409, 'SUPPLIER_INACTIVE');
            for (const line of input.lines)
                await inventoryItem(store, venueId, line.itemId);
            const [venue] = await store.select().from(s.merchantVenue).where(eq(s.merchantVenue.id, venueId));
            const value: InventoryDelivery = { id: randomUUID(), venueId, supplierId: supplier.id, reference: input.reference, fiatCurrency: z.enum(['EUR', 'USD', 'PLN']).parse(venue.fiatCurrency), status: 'OPEN', lines: input.lines.map(line => ({ ...line, receivedQuantity: 0 })), receipts: [], createdAt: new Date().toISOString() };
            await insert(store, 'DELIVERY', value);
            await audit(store, a, venueId, 'inventory.delivery.created', 'Delivery created', value);
            return value;
        });
    });
    async function deliveryUnitCosts(store:Db,d:InventoryDelivery){
        const [venue]=await store.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,d.venueId));
        return new Map<string,UnitCost>(d.lines.map(line=>[line.itemId,d.fiatCurrency!==venue.currency?null:line.totalCostMinor!=null?{numerator:String(line.totalCostMinor),denominator:String(line.expectedQuantity)}:line.unitCostMinor??null]));
    }
    function deliveryStatus(d: InventoryDelivery) { d.status = d.lines.every(l => l.receivedQuantity === l.expectedQuantity) ? 'RECEIVED' : d.lines.some(l => l.receivedQuantity > 0) ? 'PARTIAL' : 'OPEN'; }
    app.post(`${base}/deliveries/:deliveryId/receipts`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryReceiptInput.parse(req.body);
        unique(input.lines.map(l => l.itemId));
        return transaction(a, venueId, input.idempotencyKey, { action: 'receipt', id: params(req).deliveryId, input }, async (store) => {
            const d = await get<InventoryDelivery>(store, venueId, params(req).deliveryId, 'DELIVERY', true), lines = [];
            const unitCosts=await deliveryUnitCosts(store,d);
            for (const line of [...input.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
                const dl = d.lines.find(l => l.itemId === line.itemId);
                if (!dl)
                    fail(400, 'DELIVERY_ITEM_MISMATCH');
                if (dl!.receivedQuantity + line.quantity > dl!.expectedQuantity)
                    fail(409, 'OVER_RECEIPT');
                const moved = await inventoryMove(store, a, venueId, line.itemId, line.quantity, 'RECEIPT', input.reason, null, 0, unitCosts.get(line.itemId)??null,{incoming:{...line.lot,source:'RECEIPT',sourceId:d.id}});
                dl!.receivedQuantity += line.quantity;
                lines.push({ ...line, movementId: moved.movement.id, lotAllocations:moved.movement.lotAllocations });
            }
            d.receipts.push({ id: randomUUID(), lines, reason: input.reason, createdAt: new Date().toISOString(), reversed: false });
            deliveryStatus(d);
            await save(store, d);
            await audit(store, a, venueId, 'inventory.received', input.reason, d);
            return d;
        });
    });
    app.post(`${base}/deliveries/:deliveryId/receipts/:receiptId/reverse`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryReceiptReverseInput.parse(req.body);
        return transaction(a, venueId, input.idempotencyKey, { action: 'receipt.reverse', id: params(req).deliveryId, receiptId: params(req).receiptId, input }, async (store) => {
            const d = await get<InventoryDelivery>(store, venueId, params(req).deliveryId, 'DELIVERY', true), receipt = d.receipts.find(r => r.id === uuid.parse(params(req).receiptId));
            if (!receipt)
                return fail(404, 'NOT_FOUND');
            if (receipt.reversed)
                fail(409, 'ALREADY_REVERSED');
            if (a.kind !== 'owner') {
                const [policy] = await store.select().from(s.merchantInventoryPolicy).where(eq(s.merchantInventoryPolicy.venueId, venueId));
                if (receipt.lines.reduce((n, l) => n + l.quantity, 0) > (policy?.approvalThreshold ?? 0))
                    fail(409, 'LOSS_APPROVAL_REQUIRED');
            }
            const unitCosts=await deliveryUnitCosts(store,d);
            for (const line of [...receipt.lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
                const { movement } = await inventoryMove(store, a, venueId, line.itemId, -line.quantity, 'RECEIPT_CORRECTION', input.reason, null, 0, unitCosts.get(line.itemId)??null,{deltas:line.lotAllocations?.map(l=>({lotId:l.lotId,delta:-l.delta}))});
                await store.update(s.merchantInventoryMovement).set({ reversesMovementId: line.movementId }).where(eq(s.merchantInventoryMovement.id, movement.id));
                d.lines.find(l => l.itemId === line.itemId)!.receivedQuantity -= line.quantity;
            }
            receipt.reversed = true;
            deliveryStatus(d);
            await save(store, d);
            await audit(store, a, venueId, 'inventory.receipt.corrected', input.reason, d);
            return d;
        });
    });
    async function checkPendingLosses(store: Db, venueId: string, itemIds: string[]) {
        const rows = await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId, venueId), eq(s.merchantStockOperation.kind, 'LOSS')));
        if (rows.some(row => { const loss = row.data as InventoryLoss; return loss.status === 'PENDING' && itemIds.includes(loss.itemId); }))
            fail(409, 'STOCKTAKE_PENDING_LOSSES');
    }
    async function stocktakeView(store: Db, value: InventoryStocktake) {
        const lines = [];
        for (const line of value.lines) {
            const item = await inventoryItem(store, value.venueId, line.itemId);
            lines.push({ ...line, currentQuantity: item.quantity, currentRevision: item.revision, interveningDelta: item.quantity - line.expectedQuantity });
        }
        return { ...value, lines };
    }
    app.get(`${base}/stocktakes`, async (req) => { const r = await list<InventoryStocktake>(req, 'STOCKTAKE'); return { stocktakes: await Promise.all(r.values.map(value => stocktakeView(db, value))), hasMore: r.hasMore }; });
    app.get(`${base}/stocktakes/:stocktakeId`, async (req) => { const { venueId } = await context(req); return stocktakeView(db, await get<InventoryStocktake>(db, venueId, params(req).stocktakeId, 'STOCKTAKE')); });
    app.post(`${base}/stocktakes`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryStocktakeInput.parse(req.body);
        unique(input.itemIds);
        return transaction(a, venueId, input.idempotencyKey, { action: 'stocktake.open', input }, async (store) => {
            await checkPendingLosses(store, venueId, input.itemIds);
            // All stock operations take the venue transaction lock before this check.
            // A second snapshot of an unfinished count could apply its discrepancy twice.
            const snapshots = await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId, venueId), eq(s.merchantStockOperation.kind, 'STOCKTAKE')));
            if (snapshots.some(row => {
                const snapshot = row.data as InventoryStocktake;
                return snapshot.status === 'OPEN' && snapshot.lines.some(line => input.itemIds.includes(line.itemId));
            })) fail(409, 'STOCKTAKE_ALREADY_OPEN');
            const lines = [];
            for (const id of [...input.itemIds].sort()) {
                const i = await inventoryItem(store, venueId, id, true);
                lines.push({ itemId: id, expectedQuantity: i.quantity, baselineRevision: i.revision, reservedQuantity: (await stockAvailability(store,i)).reservedQuantity, lots:(await itemLots(store,i.id)).filter(l=>l.quantity>0).map(l=>({lotId:l.id,label:l.label,quantity:l.quantity,expiresAt:l.expiresAt?.toISOString()??null})), countedQuantity: null, difference: null });
            }
            const value: InventoryStocktake = { id: randomUUID(), venueId, status: 'OPEN', lines, ...(input.foodDay ? {foodDay:{...input.foodDay,date:foodOperationalDate(new Date(),input.foodDay.timeZone,input.foodDay.boundaryHour)}} : {}), createdAt: new Date().toISOString(), finalizedAt: null };
            await insert(store, 'STOCKTAKE', value);
            await audit(store, a, venueId, 'inventory.stocktake.opened', 'Opening stock snapshot', value);
            return value;
        });
    });
    app.post(`${base}/stocktakes/:stocktakeId/finalize`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryStocktakeFinalizeInput.parse(req.body);
        unique(input.counts.map(l => l.itemId));
        return transaction(a, venueId, input.idempotencyKey, { action: 'stocktake.finalize', id: params(req).stocktakeId, input }, async (store) => {
            const value = await get<InventoryStocktake>(store, venueId, params(req).stocktakeId, 'STOCKTAKE', true);
            if (value.status !== 'OPEN')
                fail(409, 'ALREADY_FINALIZED');
            if (input.counts.length !== value.lines.length || input.counts.some(c => !value.lines.some(l => l.itemId === c.itemId)))
                fail(400, 'COUNT_ITEMS_MISMATCH');
            await checkPendingLosses(store, venueId, value.lines.map(l => l.itemId));
            if(value.foodDay && input.counts.some(c=>!c.allocation || Object.values(c.allocation).reduce((a,b)=>a+b,0)!==c.countedQuantity)) fail(400,'FOOD_ALLOCATION_MISMATCH');
            if(!value.foodDay && input.counts.some(c=>c.allocation)) fail(400,'NOT_FOOD_STOCKTAKE');
            const shortage = input.counts.reduce((total, c) => total + Math.max(0, value.lines.find(l => l.itemId === c.itemId)!.expectedQuantity - c.countedQuantity) + (c.allocation ? c.allocation.donation+c.allocation.staffMeal : 0), 0);
            if (shortage > 0 && a.kind !== 'owner') {
                const [policy] = await store.select().from(s.merchantInventoryPolicy).where(eq(s.merchantInventoryPolicy.venueId, venueId));
                if (shortage > (policy?.approvalThreshold ?? 0))
                    fail(409, 'LOSS_APPROVAL_REQUIRED');
            }
            for (const count of [...input.counts].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
                const line = value.lines.find(l => l.itemId === count.itemId)!;
                const delta = count.countedQuantity - line.expectedQuantity;
                const current = await inventoryItem(store, venueId, count.itemId, true);
                if ((count.expectedRevision !== undefined && count.expectedRevision !== current.revision) || (current.revision !== line.baselineRevision && (count.expectedRevision !== current.revision || count.acknowledgeIntervening !== true)))
                    fail(409, 'STOCKTAKE_MOVEMENTS_CHANGED');
                if(count.lotCounts){
                    const lots=line.lots??[];
                    if(new Set(count.lotCounts.map(l=>l.lotId)).size!==count.lotCounts.length||count.lotCounts.length!==lots.length||count.lotCounts.some(l=>!lots.some(s=>s.lotId===l.lotId))||count.lotCounts.reduce((n,l)=>n+l.countedQuantity,0)!==count.countedQuantity)fail(400,'COUNT_LOTS_MISMATCH');
                    const changes=count.lotCounts.map(c=>({lotId:c.lotId,delta:c.countedQuantity-lots.find(l=>l.lotId===c.lotId)!.quantity})).filter(l=>l.delta!==0);
                    if(changes.length)await inventoryMove(store,a,venueId,count.itemId,delta,'STOCKTAKE',input.reason,null,0,null,{deltas:changes,reconcile:true});
                    line.countedLots=count.lotCounts;
                }else if (delta !== 0)await inventoryMove(store, a, venueId, count.itemId, delta, 'STOCKTAKE', input.reason);
                line.countedQuantity = count.countedQuantity;
                line.difference = delta;
                if(count.allocation) {
                    line.allocation = count.allocation;
                    const outgoing=count.allocation.donation+count.allocation.staffMeal;
                    if(outgoing) await inventoryMove(store,a,venueId,count.itemId,-outgoing,'LOSS',input.reason+' (food donation/staff meal)');
                    if(count.allocation.disposal) {
                        const item=await inventoryItem(store,venueId,count.itemId,true);
                        if((await stockAvailability(store,item)).availableQuantity<count.allocation.disposal) fail(409,'STOCK_RESERVED');
                        const loss:InventoryLoss={id:randomUUID(),venueId,itemId:count.itemId,quantity:count.allocation.disposal,reason:'EXPIRED',comment:input.reason,status:'PENDING',foodStocktakeId:value.id,requestedBy:taskActorKey(a),decidedBy:null,movementId:null,createdAt:new Date().toISOString()};
                        loss.lotAllocations=await proposeLots(store,venueId,count.itemId,loss.quantity);
                        const now=new Date();
                        const config:TaskTemplateInput={title:`Food disposal: ${item.name}`.slice(0,120),instructions:`Dispose ${loss.quantity} ${item.unit}; ${input.reason}. Food count ${value.id}. Photograph before and after.`,category:'CLOSING',schedule:'ONCE',timeZone:value.foodDay!.timeZone,dueTime:'23:59',scheduledFor:now.toISOString(),assigneeEmployeeId:a.kind==='cashier'?a.employeeId:null,reviewerEmployeeId:null,requiredPhotos:'BOTH',active:false};
                        const [template]=await store.insert(s.merchantTaskTemplate).values({venueId,config}).returning();
                        const [task]=await store.insert(s.merchantTask).values({venueId,templateId:template.id,templateVersion:1,occurrence:loss.id,snapshot:config,dueAt:now,status:'IN_PROGRESS',assigneeEmployeeId:config.assigneeEmployeeId,completedBy:taskActorKey(a)}).returning();
                        loss.evidenceTaskId=task.id;
                        await insert(store,'LOSS',loss);
                    }
                }
            }
            value.status = 'FINALIZED';
            value.finalizedAt = new Date().toISOString();
            await save(store, value);
            await audit(store, a, venueId, 'inventory.stocktake.finalized', input.reason, value);
            return value;
        });
    });
    app.get(`${base}/loss-policy`, async (req) => { const { venueId } = await context(req); const [policy] = await db.select().from(s.merchantInventoryPolicy).where(eq(s.merchantInventoryPolicy.venueId, venueId)); return { approvalThreshold: policy?.approvalThreshold ?? 0 }; });
    app.patch(`${base}/loss-policy`, async (req) => { const { a, venueId } = await context(req, false, true), input = InventoryLossPolicyInput.parse(req.body); return db.transaction(async (tx) => { await tx.insert(s.merchantInventoryPolicy).values({ venueId, approvalThreshold: input.approvalThreshold }).onConflictDoUpdate({ target: s.merchantInventoryPolicy.venueId, set: { approvalThreshold: input.approvalThreshold } }); await h.audit(tx as unknown as Db, a, venueId, 'inventory.loss.policy', input.reason, null, { approvalThreshold: input.approvalThreshold }); return { approvalThreshold: input.approvalThreshold }; }); });
    app.get(`${base}/losses`, async (req) => { const r = await list<InventoryLoss>(req, 'LOSS'); return { losses: r.values, hasMore: r.hasMore }; });
    app.post(`${base}/losses`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryLossInput.parse(req.body);
        return transaction(a, venueId, input.idempotencyKey, { action: 'loss', input }, async (store) => {
            const lossItem=await inventoryItem(store, venueId, input.itemId,true);
            if((await stockAvailability(store,lossItem)).availableQuantity<input.quantity) fail(409,'STOCK_RESERVED');
            const [policy] = await store.select().from(s.merchantInventoryPolicy).where(eq(s.merchantInventoryPolicy.venueId, venueId));
            const immediate = a.kind === 'owner' || input.quantity <= (policy?.approvalThreshold ?? 0);
            const lotAllocations=await proposeLots(store,venueId,input.itemId,input.quantity,undefined,input.lotId);
            const value: InventoryLoss = { lotAllocations, id: randomUUID(), venueId, itemId: input.itemId, quantity: input.quantity, reason: input.reason, comment: input.comment, status: immediate ? 'APPLIED' : 'PENDING', requestedBy: taskActorKey(a), decidedBy: immediate ? taskActorKey(a) : null, movementId: null, createdAt: new Date().toISOString() };
            if (immediate)
                value.movementId = (await inventoryMove(store, a, venueId, input.itemId, -input.quantity, 'LOSS', `${input.reason}: ${input.comment}`,null,0,null,{deltas:lotAllocations.map(l=>({lotId:l.lotId,delta:-l.quantity}))})).movement.id;
            await insert(store, 'LOSS', value);
            await audit(store, a, venueId, immediate ? 'inventory.loss.applied' : 'inventory.loss.requested', input.comment, value);
            return value;
        });
    });
    app.post(`${base}/losses/:lossId/decision`, async (req) => {
        const { a, venueId } = await context(req, false, true), input = InventoryLossDecisionInput.parse(req.body);
        return transaction(a, venueId, input.idempotencyKey, { action: 'loss.decision', id: params(req).lossId, input }, async (store) => {
            const value = await get<InventoryLoss>(store, venueId, params(req).lossId, 'LOSS', true);

            if (value.status !== 'PENDING')
                fail(409, 'ALREADY_DECIDED');
            if(value.foodStocktakeId) {
                const [task]=await store.select().from(s.merchantTask).where(and(eq(s.merchantTask.id,value.evidenceTaskId!),eq(s.merchantTask.venueId,venueId))).for('update');
                if(input.decision==='APPROVE' && (!task || task.status!=='APPROVED')) fail(409,'FOOD_DISPOSAL_EVIDENCE_REQUIRED');
                if(input.witnessEmployeeId) {
                    const [witness]=await store.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id,input.witnessEmployeeId),eq(s.merchantEmployee.venueId,venueId),eq(s.merchantEmployee.active,true)));
                    if(!witness || value.requestedBy===`employee:${witness.id}`) fail(400,'INVALID_WITNESS');
                }
                value.disposalReview={decision:input.decision,reason:input.reason,at:new Date().toISOString(),witnessEmployeeId:input.witnessEmployeeId??null};
                if(input.decision==='REJECT') {
                    if(task && task.status==='APPROVED') fail(409,'FOOD_EVIDENCE_ALREADY_APPROVED');
                    await save(store,value);
                    await audit(store,a,venueId,'inventory.food.disposal.changes_requested',input.reason,value);
                    return value;
                }
            }
            if (input.decision === 'APPROVE') {
                value.movementId = (await inventoryMove(store, a, venueId, value.itemId, -value.quantity, 'LOSS', `${value.reason}: ${value.comment}; ${input.reason}`, null, value.quantity,null,{ignoreLossId:value.id,deltas:value.lotAllocations?.map(l=>({lotId:l.lotId,delta:-l.quantity}))})).movement.id;
                value.status = 'APPLIED';
            }
            else
                value.status = 'REJECTED';
            value.decidedBy = taskActorKey(a);
            await save(store, value);
            await audit(store, a, venueId, 'inventory.loss.decided', input.reason, value);
            return value;
        });
    });
}
