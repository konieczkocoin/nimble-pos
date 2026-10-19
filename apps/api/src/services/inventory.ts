import {movementValuation,recordMovementValuation} from './inventoryValuation';
import {moveLots,type LotMutation} from './inventoryLots';
import {updateInventoryCost,type UnitCost} from './inventoryCost';
import { stockAvailability } from './stockReservations';
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import * as s from "../db/schema";
import { loyaltyFail as fail } from "./loyalty";
import { taskActorKey, type MerchantActor } from "../routes/tasks";
const uuid = z.string().uuid();
export async function inventoryItem(store: Db, venueId: string, id: string, lock = false) {
    const query = store.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId, venueId), eq(s.merchantInventoryItem.id, uuid.parse(id))));
    const [value] = lock ? await query.for("update") : await query;
    if (!value)
        return fail(404, "NOT_FOUND");
    return value;
}
export async function inventoryRetry<T>(store: Db, a: MerchantActor, venueId: string, key: string, payload: unknown, run: () => Promise<T>): Promise<T> {
    const actor = taskActorKey(a), hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await store.execute(sql `select pg_advisory_xact_lock(hashtext(${venueId + actor + key}))`);
    const [old] = await store.select().from(s.merchantInventoryRequest).where(and(eq(s.merchantInventoryRequest.venueId, venueId), eq(s.merchantInventoryRequest.actor, actor), eq(s.merchantInventoryRequest.key, key)));
    if (old) {
        if (old.requestHash !== hash)
            fail(409, "IDEMPOTENCY_CONFLICT");
        return old.response as T;
    }
    const result = await run();
    await store.insert(s.merchantInventoryRequest).values({ venueId, actor, key, requestHash: hash, response: result });
    return result;
}
export const inventoryActorFields = (a: MerchantActor) => ({ actorKind: a.kind, actorId: a.kind === "owner" ? a.userId : a.employeeId, actorName: a.kind === "owner" ? "Owner" : a.name ?? "Employee" });
export async function inventoryMove(store: Db, a: MerchantActor, venueId: string, itemId: string, delta: number, kind: typeof s.merchantInventoryMovement.$inferInsert.kind, reason: string, reversesMovementId: string | null = null, pendingLossOffset = 0, unitCostMinor: UnitCost = null, lotMutation: LotMutation = {}) {
    const old = await inventoryItem(store, venueId, itemId, true), quantity = old.quantity + delta;
    if (quantity < 0)
        fail(409, 'INSUFFICIENT_STOCK');
    if(delta<0) {
        const availability=await stockAvailability(store,old);
        if(quantity < availability.reservedQuantity + Math.max(0,availability.pendingLossQuantity-pendingLossOffset)) fail(409,'STOCK_RESERVED');
    }
    if (quantity > 2147483647)
        fail(409, 'STOCK_LIMIT');
    const lotAllocations=await moveLots(store,old,delta,kind,lotMutation);
    const valuation=await movementValuation(store,old,delta,unitCostMinor,kind,reversesMovementId);
    await updateInventoryCost(store,old,delta,unitCostMinor,kind==='RECEIPT_CORRECTION'||kind==='PRODUCTION_REVERSAL');
    const [item] = await store.update(s.merchantInventoryItem).set({ quantity, revision: old.revision + 1, updatedAt: new Date() }).where(eq(s.merchantInventoryItem.id, itemId)).returning();
    const [movement] = await store.insert(s.merchantInventoryMovement).values({ venueId, itemId, delta, kind, reason, lotAllocations, reversesMovementId, ...inventoryActorFields(a) }).returning();
    await recordMovementValuation(store,movement,valuation);
    return { item, movement };
}
