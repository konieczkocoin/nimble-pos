import {purchasingRoutes} from './purchasing';
import {inventoryLotRoutes} from './inventoryLots';
import {moveLots} from '../services/inventoryLots';
import { stockAvailabilityBatch } from '../services/stockReservations';
import { inventoryItem as item, inventoryRetry as retry, inventoryActorFields as actorFields, inventoryMove } from "../services/inventory";
import { inventoryOperationRoutes } from "./inventoryOperations";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { InventoryCreateInput, InventoryPatchInput, InventoryMovementInput, InventoryReverseInput, type InventoryItem, type InventoryMovement } from "@nimble/shared";
import type { Db } from "../db/client";
import * as s from "../db/schema";
import { loyaltyFail as fail } from "../services/loyalty";
import { type MerchantTaskHelpers } from "./tasks";
const params = (r: FastifyRequest) => r.params as Record<string, string>, uuid = z.string().uuid();
const itemView = (i: typeof s.merchantInventoryItem.$inferSelect): InventoryItem => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() });
const movementView = (m: typeof s.merchantInventoryMovement.$inferSelect): InventoryMovement => ({ ...m, reversedByMovementId: null, createdAt: m.createdAt.toISOString() });
const paging = (r: FastifyRequest) => z.object({ page: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(r.query);
export async function inventoryRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, base = "/v1/merchant/venues/:venueId/inventory";
    async function context(req: FastifyRequest, manage = false) {
        const a = await h.actor(req), venueId = uuid.parse(params(req).venueId);
        await h.venueFor(a, venueId);
        if (manage && a.kind !== "owner" && !a.permissions?.includes("inventory.manage"))
            fail(403, "FORBIDDEN");
        return { a, venueId };
    }
    await inventoryOperationRoutes(app,h);
    await inventoryLotRoutes(app,h);
    await purchasingRoutes(app,h);
    app.get(base, async (req) => {
        const { venueId } = await context(req), { page, limit } = paging(req);
        const rows = await db.select().from(s.merchantInventoryItem).where(eq(s.merchantInventoryItem.venueId, venueId)).orderBy(asc(s.merchantInventoryItem.createdAt), asc(s.merchantInventoryItem.id)).offset(page * limit).limit(limit + 1);
        const availability=await stockAvailabilityBatch(db,rows.slice(0,limit));
        return { items: rows.slice(0,limit).map(i=>({...itemView(i),...availability.get(i.id)!})), hasMore: rows.length > limit };
    });
    app.post(base, async (req, reply) => {
        const { a, venueId } = await context(req, true), input = InventoryCreateInput.parse(req.body);
        const result = await db.transaction(async (tx) => retry(tx as unknown as Db, a, venueId, input.idempotencyKey, { action: "create", input }, async () => {
            // Serialize the first inventory item against a venue currency change.
            await tx.select({id:s.merchantVenue.id}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId)).for('update');
            const [i] = await tx.insert(s.merchantInventoryItem).values({ venueId, name: input.name, unit: input.unit, tracked: input.tracked, available: input.available??true, barcode: input.barcode ?? null, quantity: input.openingQuantity, threshold: input.threshold }).returning();
            const lotAllocations=await moveLots(tx as unknown as Db,{...i,quantity:0},input.openingQuantity,'OPENING');
            await tx.insert(s.merchantInventoryMovement).values({ venueId, itemId: i.id, lotAllocations, delta: input.openingQuantity, kind: "OPENING", reason: input.reason, ...actorFields(a) });
            await h.audit(tx as unknown as Db, a, venueId, "inventory.created", input.reason, null, itemView(i));
            return itemView(i);
        }));
        reply.code(201);
        return result;
    });
    app.patch(`${base}/:itemId`, async (req) => {
        const { a, venueId } = await context(req, true), input = InventoryPatchInput.parse(req.body);
        return db.transaction(async (tx) => {
            const store = tx as unknown as Db, old = await item(store, venueId, params(req).itemId, true);
            if (old.revision !== input.revision)
                fail(409, "REVISION_CONFLICT");
            const [i] = await tx.update(s.merchantInventoryItem).set({ name: input.name, tracked: input.tracked, available: input.available??old.available, barcode: input.barcode === undefined ? old.barcode : input.barcode, threshold: input.threshold, revision: old.revision + 1, updatedAt: new Date() }).where(eq(s.merchantInventoryItem.id, old.id)).returning();
            await h.audit(store, a, venueId, "inventory.updated", input.reason, itemView(old), itemView(i));
            return itemView(i);
        });
    });
    app.get(`${base}/:itemId/movements`, async (req) => {
        const { venueId } = await context(req), { page, limit } = paging(req);
        const i = await item(db, venueId, params(req).itemId);
        const rows = await db.select().from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.itemId, i.id), eq(s.merchantInventoryMovement.venueId, venueId))).orderBy(asc(s.merchantInventoryMovement.createdAt), asc(s.merchantInventoryMovement.id)).offset(page * limit).limit(limit + 1);
        const pageRows = rows.slice(0, limit);
        const reversals = pageRows.length ? await db.select({id:s.merchantInventoryMovement.id, originalId:s.merchantInventoryMovement.reversesMovementId}).from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.venueId,venueId),inArray(s.merchantInventoryMovement.reversesMovementId,pageRows.map(row=>row.id)))) : [];
        const reversedBy = new Map(reversals.map(row=>[row.originalId,row.id]));
        const movements = pageRows.map(row=>({...movementView(row),reversedByMovementId:reversedBy.get(row.id)??null}));
        return { movements, hasMore: rows.length > limit };
    });
    app.get(`${base}/:itemId/cost-history`, async (req) => {
        const {a,venueId}=await context(req);
        if(a.kind!=='owner'&&!a.permissions?.includes('inventory.costs'))fail(403,'FORBIDDEN');
        const {page,limit}=paging(req),i=await item(db,venueId,params(req).itemId);
        const rows=await db.select({movement:s.merchantInventoryMovement,valuation:s.merchantInventoryValuation.data})
            .from(s.merchantInventoryMovement).leftJoin(s.merchantInventoryValuation,and(eq(s.merchantInventoryValuation.movementId,s.merchantInventoryMovement.id),eq(s.merchantInventoryValuation.venueId,venueId)))
            .where(and(eq(s.merchantInventoryMovement.venueId,venueId),eq(s.merchantInventoryMovement.itemId,i.id)))
            .orderBy(asc(s.merchantInventoryMovement.createdAt),asc(s.merchantInventoryMovement.id)).offset(page*limit).limit(limit+1);
        return {items:rows.slice(0,limit).map(({movement:m,valuation})=>({movementId:m.id,kind:m.kind,delta:m.delta,createdAt:m.createdAt.toISOString(),valuation})),hasMore:rows.length>limit};
    });
    async function mutate(req: FastifyRequest, reverse: boolean) {
        const { a, venueId } = await context(req, true), input = reverse ? InventoryReverseInput.parse(req.body) : InventoryMovementInput.parse(req.body);
        const itemId = uuid.parse(params(req).itemId), movementId = reverse ? uuid.parse(params(req).movementId) : null;
        return db.transaction(async (tx) => {
            const store = tx as unknown as Db;
            return retry(store, a, venueId, input.idempotencyKey, { action: reverse ? "reverse" : "adjust", itemId, movementId, input }, async () => {
                const old = await item(store, venueId, itemId, true);
                if (old.revision !== input.revision)
                    fail(409, "REVISION_CONFLICT");
                let delta: number = "delta" in input ? Number(input.delta) : 0;
                let lotDeltas: import('@nimble/shared').LotDelta[]|undefined;
                if (reverse) {
                    const [original] = await tx.select().from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.id, movementId!), eq(s.merchantInventoryMovement.itemId, itemId), eq(s.merchantInventoryMovement.venueId, venueId)));
                    if (!original)
                        return fail(404, "NOT_FOUND");
                    if (original.kind === "REVERSAL")
                        fail(409, "INVALID_REVERSAL");
                    const [existing] = await tx.select().from(s.merchantInventoryMovement).where(eq(s.merchantInventoryMovement.reversesMovementId, movementId!));
                    if (existing)
                        fail(409, "ALREADY_REVERSED");
                    if (["RECEIPT","RECEIPT_CORRECTION","STOCKTAKE","LOSS","SALE","PRODUCTION","PRODUCTION_REVERSAL"].includes(original.kind)) fail(409,"SEMANTIC_CORRECTION_REQUIRED");
                    delta = -original.delta;
                    if(original.lotAllocations.length)lotDeltas=original.lotAllocations.map(l=>({lotId:l.lotId,delta:-l.delta}));
                }
                if (delta < 0 && a.kind !== 'owner') {
                    const [policy]=await tx.select().from(s.merchantInventoryPolicy).where(eq(s.merchantInventoryPolicy.venueId,venueId));
                    if (-delta > (policy?.approvalThreshold ?? 0)) fail(409,'LOSS_APPROVAL_REQUIRED');
                }
                const {item:i,movement:m}=await inventoryMove(store,a,venueId,itemId,delta,reverse?'REVERSAL':'ADJUSTMENT',input.reason,movementId,0,null,{deltas:lotDeltas});
                const result = { item: itemView(i), movement: movementView(m) };
                await h.audit(store, a, venueId, reverse ? "inventory.reversed" : "inventory.adjusted", input.reason, itemView(old), result);
                return result;
            });
        });
    }
    app.post(`${base}/:itemId/movements`, req => mutate(req, false));
    app.post(`${base}/:itemId/movements/:movementId/reverse`, req => mutate(req, true));
}
