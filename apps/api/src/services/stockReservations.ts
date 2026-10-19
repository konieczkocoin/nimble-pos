import {movementValuation,recordMovementValuation} from './inventoryValuation';
import {recordFinancialSale} from './financialSale';
import {moveLots} from './inventoryLots';
import {updateInventoryCost} from './inventoryCost';
import { and, eq, ne, sql, or, isNull, gt } from 'drizzle-orm';
import { aggregateMerchantStockRequirements, type MerchantStockBinding, type MerchantOrderLine, type RecipeSnapshot } from '@nimble/shared';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import { loyaltyFail as fail } from './loyalty';
type Order = typeof s.merchantOrder.$inferSelect;
const active = (r: typeof s.merchantStockReservation.$inferSelect) => r.status === 'HELD' && (!r.expiresAt || r.expiresAt.getTime() > Date.now());
async function reservations(store: Db, venueId: string) { return store.select().from(s.merchantStockReservation).where(and(eq(s.merchantStockReservation.venueId, venueId), eq(s.merchantStockReservation.status, 'HELD'), or(isNull(s.merchantStockReservation.expiresAt), gt(s.merchantStockReservation.expiresAt, new Date(Date.now()))))); }
export async function stockAvailabilityBatch(store: Db, items: (typeof s.merchantInventoryItem.$inferSelect)[]) {
    const result = new Map<string, {
        reservedQuantity: number;
        pendingLossQuantity: number;
        availableQuantity: number;
    }>();
    if (!items.length)
        return result;
    const holds = await reservations(store, items[0].venueId);
    const losses = await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId, items[0].venueId), eq(s.merchantStockOperation.kind, 'LOSS'), sql `${s.merchantStockOperation.data}->>'status' = 'PENDING'`));
    for (const item of items)
        result.set(item.id, { reservedQuantity: 0, pendingLossQuantity: 0, availableQuantity: item.quantity });
    for (const hold of holds)
        for (const b of hold.requirements) {
            const value = result.get(b.itemId);
            if (value)
                value.reservedQuantity += b.quantity;
        }
    for (const row of losses) {
        const l = row.data as {
            itemId: string;
            quantity: number;
        };
        const value = result.get(l.itemId);
        if (value)
            value.pendingLossQuantity += l.quantity;
    }
    for (const item of items) {
        const value = result.get(item.id)!;
        value.availableQuantity = Math.max(0, item.quantity - value.reservedQuantity - value.pendingLossQuantity);
    }
    return result;
}
export async function stockAvailability(store: Db, item: typeof s.merchantInventoryItem.$inferSelect) { return (await stockAvailabilityBatch(store, [item])).get(item.id)!; }
async function lockItems(store: Db, venueId: string, requirements: MerchantStockBinding[]) {
    const items = [];
    for (const b of [...requirements].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
        const [item] = await store.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId, venueId), eq(s.merchantInventoryItem.id, b.itemId))).for('update');
        if (!item)
            return fail(409, 'INSUFFICIENT_STOCK');
        items.push({ item, quantity: b.quantity });
    }
    return items;
}
export async function reserveOrderStock(store: Db, o: Order, quoteId: string, expiresAt: Date) {
    const requirements = aggregateMerchantStockRequirements(o.lines);
    if (!requirements.length)
        return;
    const actor = o.payerUserId ?? o.employeeId ?? o.id;
    // Serialize actor budget in addition to item locks; no product or card locks are acquired here.
    await store.execute(sql `select pg_advisory_xact_lock(hashtext(${`stock-budget-venue:${o.venueId}`}))`);
    await store.execute(sql `select pg_advisory_xact_lock(hashtext(${`stock-budget:${o.venueId}:${actor}`}))`);
    const rows = await reservations(store, o.venueId);
    const existing = rows.find(r => r.orderId === o.id && r.quoteId === quoteId);
    if (existing && active(existing))
        return;
    if (rows.filter(r => r.orderId !== o.id && r.requirements.length > 0 && active(r)).length >= 100)
        fail(409, 'STOCK_RESERVATION_LIMIT');
    if (rows.filter(r => r.actor === actor && r.orderId !== o.id && r.requirements.length > 0 && active(r)).length >= 10)
        fail(409, 'STOCK_RESERVATION_LIMIT');
    const locked = await lockItems(store, o.venueId, requirements);
    // Expired/replaced holds are retired while retaining their original immutable decision.
    await releaseOrderStock(store, o.id);
    const tracked = [];
    const availability = await stockAvailabilityBatch(store, locked.map(l => l.item));
    for (const { item, quantity } of locked) {
        if(!item.available)fail(409,'INSUFFICIENT_STOCK');
        if (!item.tracked)
            continue;
        if (availability.get(item.id)!.availableQuantity < quantity)
            fail(409, 'INSUFFICIENT_STOCK');
        tracked.push({ itemId: item.id, quantity });
    }
    await store.insert(s.merchantStockReservation).values({ orderId: o.id, venueId: o.venueId, actor, quoteId, revision: o.revision, requirements: tracked, expiresAt });
}
export async function releaseOrderStock(store: Db, orderId: string) {
    await store.update(s.merchantStockReservation).set({ status: 'RELEASED' }).where(and(eq(s.merchantStockReservation.orderId, orderId), eq(s.merchantStockReservation.status, 'HELD')));
}
export async function pinOrderStock(store: Db, o: Order, quoteId: string, revision: number) {
    const [r] = await store.select().from(s.merchantStockReservation).where(and(eq(s.merchantStockReservation.orderId, o.id), eq(s.merchantStockReservation.quoteId, quoteId)));
    if (r)
        await lockItems(store, o.venueId, r.requirements);
    if (r && r.revision === revision && active(r))
        await store.update(s.merchantStockReservation).set({ expiresAt: null }).where(eq(s.merchantStockReservation.id, r.id));
}
export async function orderStockValid(store: Db, o: Order, quoteId: string, revision: number, lines: MerchantOrderLine[]) {
    if (!aggregateMerchantStockRequirements(lines).length)
        return true;
    const [r] = await store.select().from(s.merchantStockReservation).where(and(eq(s.merchantStockReservation.orderId, o.id), eq(s.merchantStockReservation.quoteId, quoteId)));
    return !!r && r.revision === revision && (!r.requirements.length || active(r));
}
export async function stockReservationView(store: Db, o: Order) {
    const rows = await store.select().from(s.merchantStockReservation).where(eq(s.merchantStockReservation.orderId, o.id));
    const r = rows.find(r => r.quoteId === o.quote?.id);
    return { status: !r || !r.requirements.length ? 'NONE' : r.status === 'HELD' && !active(r) ? 'EXPIRED' : r.status, expiresAt: r?.expiresAt?.toISOString() ?? null } as {
        status: 'NONE' | 'HELD' | 'EXPIRED' | 'RELEASED' | 'CONSUMED';
        expiresAt: string | null;
    };
}
async function sale(store: Db, venueId: string, item: typeof s.merchantInventoryItem.$inferSelect, quantity: number, actorId: string, actorName: string, reference: string, orderId:string|null=null) {
    const availability = await stockAvailability(store, item);
    if (availability.availableQuantity < quantity)
        fail(409, 'INSUFFICIENT_STOCK');
    const lotAllocations=await moveLots(store,item,-quantity,'SALE');
    const valuation=await movementValuation(store,item,-quantity,null,'SALE');
    await updateInventoryCost(store,item,-quantity);
    await store.update(s.merchantInventoryItem).set({ quantity: item.quantity - quantity, revision: item.revision + 1, updatedAt: new Date() }).where(eq(s.merchantInventoryItem.id, item.id));
    const [movement]=await store.insert(s.merchantInventoryMovement).values({ venueId, itemId: item.id, delta: -quantity, lotAllocations, kind: 'SALE', reason: reference, actorKind: 'cashier', actorId, actorName }).returning();
    await recordMovementValuation(store,movement,valuation,orderId);
}
export async function consumeOrderStock(store: Db, o: Order, quoteId: string) {
    await recordFinancialSale(store,o.id);
    const [r] = await store.select().from(s.merchantStockReservation).where(and(eq(s.merchantStockReservation.orderId, o.id), eq(s.merchantStockReservation.quoteId, quoteId)));
    if (!r) {
        if (aggregateMerchantStockRequirements((o.paymentSnapshot?.lines ?? o.lines)).length)
            fail(409, 'INSUFFICIENT_STOCK');
        return;
    }
    if (r.status === 'CONSUMED')
        return;
    if (!r.requirements.length) {
        await store.update(s.merchantStockReservation).set({ status: 'CONSUMED' }).where(eq(s.merchantStockReservation.id, r.id));
        return;
    }
    if (!active(r))
        fail(409, 'INSUFFICIENT_STOCK');
    const locked = await lockItems(store, o.venueId, r.requirements);
    if (!active(r))
        fail(409, 'INSUFFICIENT_STOCK');
    await store.update(s.merchantStockReservation).set({ status: 'CONSUMED' }).where(eq(s.merchantStockReservation.id, r.id));
    const [employee] = await store.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id, o.employeeId!), eq(s.merchantEmployee.venueId, o.venueId)));
    if (!employee)
        fail(409, 'INVALID_STATE');
    for (const { item, quantity } of locked)
        await sale(store, o.venueId, item, quantity, employee.id, employee.name, `${o.source === 'REMOTE' ? 'Remote' : 'POS'} order ${o.id}`,o.id);
}
/** Cash has no quote/hold: caller locked its shift/order and stored an authentic receipt. */
export async function consumeCashOrderStock(store:Db,o:Order){
 if(!o.cashReceiptId||o.paymentMethod!=='CASH')return fail(409,'INVALID_STATE');
 const requirements=aggregateMerchantStockRequirements(o.paymentSnapshot?.lines??o.lines);
 const locked=await lockItems(store,o.venueId,requirements);
 const [employee]=await store.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id,o.employeeId!),eq(s.merchantEmployee.venueId,o.venueId)));
 if(!employee)return fail(409,'INVALID_STATE');
 for(const {item,quantity} of locked){
  if(!item.available)return fail(409,'INSUFFICIENT_STOCK');
  if(item.tracked)await sale(store,o.venueId,item,quantity,employee.id,employee.name,`Cash order ${o.id}`,o.id);
 }
 await recordFinancialSale(store,o.id);
}
export async function consumeRewardStock(store: Db, args: {
    venueId: string;
    rewardId: string;
    actorId: string;
    actorName: string;
    requirements: MerchantStockBinding[];
    recipeSnapshot?: RecipeSnapshot;
}) {
    const [reward] = await store.select().from(s.loyaltyReward).where(eq(s.loyaltyReward.id, args.rewardId));
    if (!reward)
        fail(404, 'NOT_FOUND');
    if (reward.stockRequirements !== null)
        return;
    const requirements = aggregateMerchantStockRequirements([{ quantity: 1, stockRequirements: args.requirements } as MerchantOrderLine]);
    const locked = await lockItems(store, args.venueId, requirements);
    if(locked.some(l=>!l.item.available))fail(409,'INSUFFICIENT_STOCK');
    const tracked = locked.filter(l => l.item.tracked);
    for (const { item, quantity } of tracked)
        await sale(store, args.venueId, item, quantity, args.actorId, args.actorName, `Loyalty reward ${args.rewardId}`);
    if(args.recipeSnapshot)await store.insert(s.merchantStockOperation).values({venueId:args.venueId,kind:'SALE',data:{rewardId:args.rewardId,recipeSnapshot:args.recipeSnapshot,requirements:args.requirements}});
    await store.update(s.loyaltyReward).set({ stockRequirements: tracked.map(({ item, quantity }) => ({ itemId: item.id, quantity })) }).where(eq(s.loyaltyReward.id, args.rewardId));
}
/** A verified attempt resolves the order; sibling quote intents cannot retain capacity. */
export async function releaseSiblingOrderStock(store: Db, orderId: string, quoteId: string) {
    await store.update(s.merchantStockReservation).set({ status: 'RELEASED' }).where(and(eq(s.merchantStockReservation.orderId, orderId), ne(s.merchantStockReservation.quoteId, quoteId), eq(s.merchantStockReservation.status, 'HELD')));
}
