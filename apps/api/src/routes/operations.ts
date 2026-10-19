import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperationOrder, MerchantOperations, PaymentException, OperationActionResult, MerchantAsset, MerchantFiat, MerchantOrderStatus } from '@nimble/shared';
import * as s from '../db/schema';
import type { Db } from '../db/client';
import type { MerchantTaskHelpers } from './tasks';
import { loyaltyFail as fail } from '../services/loyalty';
import { reconcileMerchantPayment, reconcileMerchantRefund } from '../services/merchantSettlement';
import { unavailableMerchantPayments } from '../services/merchantGateway';
import { releaseOrderStock } from '../services/stockReservations';
const uuid = z.string().uuid(), params = (r: FastifyRequest) => r.params as Record<string, string>;
const openSql = sql `status in ('AWAITING_PAYMENT','PAYMENT_PENDING','AWAITING_ACCEPTANCE','PREPARING','READY')`;
const delayedSql = sql `(status='AWAITING_ACCEPTANCE' and acceptance_deadline<now()) or (status='PREPARING' and coalesce(decision_at,(payment->>'confirmedAt')::timestamptz,created_at) + coalesce(preparation_minutes,15)*interval '1 minute'<now())`;
function orderView(o: typeof s.merchantOrder.$inferSelect): OperationOrder { const deadline = o.status === 'AWAITING_ACCEPTANCE' ? o.acceptanceDeadline : o.status === 'PREPARING' ? new Date((o.decisionAt ?? (o.payment ? new Date(o.payment.confirmedAt) : o.createdAt)).getTime() + (o.preparationMinutes ?? 15) * 60000) : null; return { id: o.id, number: o.number, status: o.status as MerchantOrderStatus, source: o.source as 'COUNTER' | 'REMOTE', totalMinor: o.paymentSnapshot?.totalMinor ?? o.totalMinor, createdAt: o.createdAt.toISOString(), decisionAt: o.decisionAt?.toISOString() ?? null, delayMinutes: deadline ? Math.max(0, Math.floor((Date.now() - deadline.getTime()) / 60000)) : 0, fulfillmentRejectedAt: o.cancelledAt?.toISOString() ?? null, requiresRefund: o.paymentRequiresRefund || o.status === 'REFUND_PENDING' }; }
export async function operationRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, base = '/v1/merchant/venues/:venueId';
    async function context(req: FastifyRequest, owner = false) { const a = await h.actor(req), venueId = uuid.parse(params(req).venueId), venue = await h.venueFor(a, venueId); if (a.kind !== 'owner' && (owner || !a.permissions?.includes('reports.view')))
        fail(403, 'FORBIDDEN'); return { a, venueId, venue }; }
    app.get(base + '/operations', async (req) => {
        const { venueId, venue } = await context(req), now = new Date(), from = new Date(now.getTime() - 86400000);
        const [counts] = await db.select({ open: sql<number> `count(*) filter(where ${openSql})::int`, delayed: sql<number> `count(*) filter(where ${delayedSql})::int`, refunds: sql<number> `count(*) filter(where status='REFUND_PENDING')::int` }).from(s.merchantOrder).where(eq(s.merchantOrder.venueId, venueId));
        // Accepted sales are historical facts, not the current fulfillment state.
        // A later refund does not erase acceptance; cash/refunds remain separate.
        const [sales] = await db.select({ total: sql<string>`coalesce(sum((${s.merchantFinancialSale.data}->>'totalMinor')::bigint),0)::text` })
            .from(s.merchantFinancialSale).where(and(eq(s.merchantFinancialSale.venueId,venueId),sql`${s.merchantFinancialSale.data}->>'status'='RECORDED'`,gte(s.merchantFinancialSale.occurredAt,from),lte(s.merchantFinancialSale.occurredAt,now)));
        const received = await db.select({ asset: sql<MerchantAsset> `receipt->>'asset'`, network: s.merchantVerifiedTransaction.network, amountAtomic: sql<string> `sum((receipt->>'amountAtomic')::numeric)::text`, count: sql<number> `count(*)::int` }).from(s.merchantVerifiedTransaction).innerJoin(s.merchantOrder, eq(s.merchantOrder.id, s.merchantVerifiedTransaction.orderId)).where(and(eq(s.merchantOrder.venueId, venueId), eq(s.merchantVerifiedTransaction.purpose, 'PAYMENT'), sql `(receipt->>'confirmedAt')::timestamptz between ${from.toISOString()} and ${now.toISOString()}`)).groupBy(sql `receipt->>'asset'`, s.merchantVerifiedTransaction.network);
        const orders = await db.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.venueId, venueId), sql `(${openSql} or status='REFUND_PENDING')`)).orderBy(desc(s.merchantOrder.createdAt)).limit(51);
        const shifts = await db.select({ id: s.merchantShift.id, employeeId: s.merchantShift.employeeId, employeeName: s.merchantEmployee.name, openedAt: s.merchantShift.openedAt }).from(s.merchantShift).innerJoin(s.merchantEmployee, eq(s.merchantEmployee.id, s.merchantShift.employeeId)).where(and(eq(s.merchantShift.venueId, venueId), isNull(s.merchantShift.closedAt))).orderBy(desc(s.merchantShift.openedAt)).limit(51);
        const [terminal] = await db.select({ revokedAt: s.merchantTerminal.revokedAt, lastSeenAt: s.merchantTerminal.lastSeenAt }).from(s.merchantTerminal).where(eq(s.merchantTerminal.venueId, venueId)).orderBy(sql `${s.merchantTerminal.revokedAt} asc nulls first`, desc(s.merchantTerminal.createdAt)).limit(1);
        const result: MerchantOperations = { updatedAt: now.toISOString(), window: { from: from.toISOString(), to: now.toISOString() }, fiatCurrency: venue.fiatCurrency as MerchantFiat, acceptedSalesMinor: sales.total, receivedPayments: received, openOrderCount: counts.open, delayedOrderCount: counts.delayed, refundCount: counts.refunds, orders: orders.slice(0, 50).map(orderView), shifts: shifts.slice(0, 50).map(x => ({ ...x, openedAt: x.openedAt.toISOString() })), terminal: { state: !terminal ? 'UNKNOWN' : terminal.revokedAt ? 'REVOKED' : !terminal.lastSeenAt ? 'UNKNOWN' : now.getTime() - terminal.lastSeenAt.getTime() > 60000 ? 'STALE' : 'ACTIVE', lastSeenAt: terminal?.lastSeenAt?.toISOString() ?? null }, truncated: orders.length > 50 || shifts.length > 50 };
        return result;
    });
    app.get(base + '/payment-exceptions', async (req) => {
        const { venueId } = await context(req, true);
        const q = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), limit: z.coerce.number().int().min(1).max(50).default(25), asset: z.enum(['NIM', 'USDT']).optional(), kind: z.enum(['UNVERIFIED', 'REFUND_REQUIRED']).optional(), minAgeMinutes: z.coerce.number().int().min(0).max(525600).default(0) }).parse(req.query);
        const rows = await db.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.venueId, venueId), q.kind === 'UNVERIFIED' ? eq(s.merchantOrder.status, 'PAYMENT_PENDING') : q.kind === 'REFUND_REQUIRED' ? eq(s.merchantOrder.status, 'REFUND_PENDING') : inArray(s.merchantOrder.status, ['PAYMENT_PENDING', 'REFUND_PENDING']), sql `${s.merchantOrder.createdAt}<=${new Date(Date.now() - q.minAgeMinutes * 60000).toISOString()}`, q.asset ? sql `(exists(select 1 from merchant_transfer_attempt a where a.order_id=${s.merchantOrder.id} and a.quote->>'asset'=${q.asset}) or ${s.merchantOrder.payment}->>'asset'=${q.asset})` : undefined)).orderBy(s.merchantOrder.createdAt, s.merchantOrder.id).offset(q.page * q.limit).limit(q.limit + 1);
        const items: PaymentException[] = [];
        for (const o of rows.slice(0, q.limit)) {
            const attempts = await db.select().from(s.merchantTransferAttempt).where(eq(s.merchantTransferAttempt.orderId, o.id)).orderBy(desc(s.merchantTransferAttempt.createdAt)).limit(26);
            const holds = await db.select().from(s.merchantStockReservation).where(and(eq(s.merchantStockReservation.orderId, o.id), eq(s.merchantStockReservation.status, 'HELD'), sql `(${s.merchantStockReservation.expiresAt} is null or ${s.merchantStockReservation.expiresAt}>now())`)).limit(26);
            const [last] = await db.select({ at: s.merchantOperation.createdAt }).from(s.merchantOperation).where(and(eq(s.merchantOperation.orderId, o.id), eq(s.merchantOperation.action, 'recheck'))).orderBy(desc(s.merchantOperation.createdAt)).limit(1);
            items.push({ order: orderView(o), kind: o.status === 'REFUND_PENDING' ? 'REFUND_REQUIRED' : 'UNVERIFIED', contextTruncated: attempts.length > 25 || holds.length > 25, attempts: attempts.slice(0, 25).map(a => ({ id: a.id, purpose: a.purpose, hash: a.hash, asset: a.quote.asset, amountAtomic: a.quote.amountAtomic, createdAt: a.createdAt.toISOString(), checks: a.checks, lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null, verificationCode: a.verificationCode, nextCheckAt: a.nextCheckAt.toISOString(), verification: (a.purpose === 'PAYMENT' ? o.payment?.hash === a.hash : false) ? 'VERIFIED' : 'UNVERIFIED' })), holds: Array.from(holds.slice(0, 25).flatMap(h => h.requirements).reduce((m, r) => m.set(r.itemId, (m.get(r.itemId) ?? 0) + r.quantity), new Map<string, number>()), ([itemId, quantity]) => ({ itemId, quantity })), quoteExpiresAt: o.quote?.expiresAt ?? null, lastRecheckAt: last?.at.toISOString() ?? null });
        }
        return { updatedAt: new Date().toISOString(), items, hasMore: rows.length > q.limit };
    });
    async function action(req: FastifyRequest, action: 'recheck' | 'reject-fulfillment') {
        const { a, venueId } = await context(req, true);
        if (a.kind !== 'owner')
            return fail(403, 'FORBIDDEN');
        const orderId = uuid.parse(params(req).orderId), input = z.object({ reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid() }).parse(req.body), hash = createHash('sha256').update(JSON.stringify({ action, orderId, reason: input.reason })).digest('hex');
        const intent = await db.transaction(async (tx) => {
            await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venueId)).for('update');
            const [existing] = await tx.select().from(s.merchantOperation).where(and(eq(s.merchantOperation.venueId, venueId), eq(s.merchantOperation.key, input.idempotencyKey)));
            if (existing) {
                if (existing.inputHash !== hash)
                    fail(409, 'IDEMPOTENCY_CONFLICT');
                if (existing.result || existing.action !== 'recheck' || (existing.leaseUntil && existing.leaseUntil.getTime() > Date.now()))
                    return { row: existing, replay: true };
                const [claimed] = await tx.update(s.merchantOperation).set({ leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60000) }).where(eq(s.merchantOperation.id, existing.id)).returning();
                return { row: claimed, replay: false };
            }
            const [o] = await tx.select().from(s.merchantOrder).where(and(eq(s.merchantOrder.id, orderId), eq(s.merchantOrder.venueId, venueId))).for('update');
            if (!o)
                return fail(404, 'NOT_FOUND');
            if (action === 'recheck') {
                const recent = await tx.select({ id: s.merchantOperation.id }).from(s.merchantOperation).where(and(eq(s.merchantOperation.venueId, venueId), eq(s.merchantOperation.action, 'recheck'), sql `${s.merchantOperation.createdAt}>${new Date(Date.now() - 60000).toISOString()}`)).limit(11);
                const [same] = await tx.select({ id: s.merchantOperation.id }).from(s.merchantOperation).where(and(eq(s.merchantOperation.orderId, orderId), eq(s.merchantOperation.action, 'recheck'), sql `${s.merchantOperation.createdAt}>${new Date(Date.now() - 30000).toISOString()}`)).limit(1);
                if (recent.length >= 10 || same)
                    fail(429, 'RECHECK_RATE_LIMITED');
            }
            if (action === 'reject-fulfillment') {
                if (o.status !== 'PAYMENT_PENDING' || o.payment || o.cancelledAt)
                    fail(409, 'PAYMENT_ALREADY_RESOLVED');
                await releaseOrderStock(tx as unknown as Db, orderId);
                await tx.update(s.merchantOrder).set({ cancelledAt: new Date(), paymentRequiresRefund: true }).where(eq(s.merchantOrder.id, orderId));
            }
            const [row] = await tx.insert(s.merchantOperation).values({ venueId, orderId, actorId: a.userId, key: input.idempotencyKey, action, inputHash: hash, reason: input.reason, leaseToken: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 60000) }).returning();
            await h.audit(tx as unknown as Db, a, venueId, 'payment.' + action, input.reason, { orderId, status: o.status }, { operationId: row.id, stockReleased: action === 'reject-fulfillment' });
            if (action === 'reject-fulfillment') {
                const result: OperationActionResult = { operationId: row.id, state: 'COMPLETE', orderId, orderStatus: o.status as MerchantOrderStatus, requiresRefund: true, outcome: 'REJECTED' };
                await tx.update(s.merchantOperation).set({ result }).where(eq(s.merchantOperation.id, row.id));
                return { row: { ...row, result }, replay: true };
            }
            return { row, replay: false };
        });
        if (intent.replay) {
            if (intent.row.result)
                return intent.row.result;
            const [current] = await db.select().from(s.merchantOrder).where(eq(s.merchantOrder.id, orderId));
            return { operationId: intent.row.id, state: 'PENDING', orderId, orderStatus: current.status as MerchantOrderStatus, requiresRefund: current.paymentRequiresRefund, outcome: current.payment ? 'VERIFIED' : 'UNVERIFIED' } satisfies OperationActionResult;
        }
        let unavailable = false;
        if (action === 'recheck') {
            await db.update(s.merchantTransferAttempt).set({ nextCheckAt: new Date() }).where(eq(s.merchantTransferAttempt.orderId, orderId));
            try {
                const gateway = app.deps.merchantPayments ?? unavailableMerchantPayments;
                await reconcileMerchantPayment(db, gateway, orderId);
                await reconcileMerchantRefund(db, gateway, orderId);
            }
            catch {
                unavailable = true;
            }
        }
        const [o] = await db.select().from(s.merchantOrder).where(eq(s.merchantOrder.id, orderId));
        const result: OperationActionResult = { operationId: intent.row.id, state: 'COMPLETE', orderId, orderStatus: o.status as MerchantOrderStatus, requiresRefund: o.paymentRequiresRefund, outcome: action === 'reject-fulfillment' ? 'REJECTED' : unavailable ? 'VERIFICATION_UNAVAILABLE' : o.payment ? 'VERIFIED' : 'UNVERIFIED' };
        const [completed] = await db.update(s.merchantOperation).set({ result }).where(and(eq(s.merchantOperation.id, intent.row.id), eq(s.merchantOperation.leaseToken, intent.row.leaseToken!))).returning();
        if (completed)
            return result;
        const [latest] = await db.select().from(s.merchantOperation).where(eq(s.merchantOperation.id, intent.row.id));
        return latest.result ?? { ...result, state: 'PENDING' as const };
    }
    app.post(base + '/orders/:orderId/recheck', req => action(req, 'recheck'));
    app.post(base + '/orders/:orderId/reject-fulfillment', req => action(req, 'reject-fulfillment'));
}
