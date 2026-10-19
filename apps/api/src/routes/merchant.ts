import {cashRefundRoutes,cashRefundView} from './cashRefunds'
import {cashReceiptTotals,ownerCashPayoutTotals,salePaymentMethodTotals} from '@nimble/shared'
import {financeRoutes} from './finance'
import {depositResolutionRoutes} from './depositResolutions'
import {submitAttempt,submitMerchantPaymentIntent} from '../services/merchantPaymentIntent'
import {stockMenuRoutes} from './stockMenu'
import {productionRoutes} from './production'
import { recipeRoutes } from './recipes'
import { dayCloseRoutes } from './dayClose'
import { walletDiscoveryRoutes } from './walletDiscovery'
import { workTimeRoutes } from './worktime'
import { menuScheduleRoutes } from './menuSchedule'
import { effectiveCatalog } from '../services/menuSchedule'
import { discountRoutes } from './discounts'
import { handoverRoutes } from './handovers'
import { menuImageRoutes, validateMenuImages } from './menuImages'
import {readinessRoutes} from './readiness'
import {orderReadiness,changeOrderReadiness} from '../services/orderReadiness'
import { orderContextRoutes } from './orderContext'
import { operationRoutes } from './operations'
import { consumeCashOrderStock, reserveOrderStock, pinOrderStock, releaseOrderStock, stockReservationView } from '../services/stockReservations'
import { validateMenuStock } from './menuStock'
import { menuRoutes, bumpMenuRevision } from './menu'
import { inventoryRoutes } from './inventory'
import { taskPhotoRoutes } from './taskPhotos'
import { scheduleRoutes } from './schedules'
import { ensureTaskEvidence } from '../services/taskPhotos'
import { remoteQueueCount } from '../services/remoteQueue'
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z, ZodError } from 'zod'
import {
  CashSaleInput,
  type CashReceipt,
  MerchantPermissionSchema,
  type MerchantPermission,
  MerchantVenueInput,
  MerchantProductInput,
  validateMerchantCatalog,
  merchantRewardProduct,
  type MerchantProduct,
  MerchantEmployeeInput,
  MerchantOrderInput,
  priceMerchantCart,
  canMerchantTransition,
  type MerchantOrder,
  type MerchantReport,
  type MerchantQuote,
} from '@nimble/shared'
import * as schema from '../db/schema'
import type { Db } from '../db/client'
import { env } from '../env'
import { hashCode } from '../services/codeService'
import {
  MerchantSettlementError,
  reconcileMerchantPayment,
  reconcileMerchantRefund,
} from '../services/merchantSettlement'
import { unavailableMerchantPayments } from '../services/merchantGateway'
import { remoteRoutes } from './remote'
import { taskRoutes } from './tasks'
import { loyaltyRoutes } from './loyalty'
import {
  LoyaltyError,
  validateLoyaltySender,
  loyaltyRefundRequested,
  cardView,
  lockCard,
} from '../services/loyalty'
class MerchantError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message)
  }
}
const fail = (status: number, code: string): never => {
  throw new MerchantError(status, code)
}
const token = () => randomBytes(32).toString('base64url')
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const pinHash = (pin: string) => {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pin + env.codePepper, salt, 32).toString('hex')}`
}
const pinMatches = (pin: string, stored: string) => {
  const [salt, hash] = stored.split(':')
  return (
    !!hash &&
    timingSafeEqual(
      scryptSync(pin + env.codePepper, salt, 32),
      Buffer.from(hash, 'hex'),
    )
  )
}
const id = z.string().uuid()
const revision = z.number().int().positive()
const pin = z.string().regex(/^\d{4,8}$/)
const address = z.string().trim().min(10).max(100)
type Actor =
  | {
      kind: 'owner'
      userId: string
    }
  | {
      kind: 'cashier'
      employeeId: string
      venueId: string
      sessionId: string
      name?: string
      permissions?: MerchantPermission[]
    }
type OrderRow = typeof schema.merchantOrder.$inferSelect
const cleanVenue = (v: typeof schema.merchantVenue.$inferSelect) => ({
  id: v.id,
  name: v.name,
  fiatCurrency: v.fiatCurrency,
  nimAddress: v.nimAddress,
  usdtAddress: v.usdtAddress,
})
const cleanEmployee = (e: typeof schema.merchantEmployee.$inferSelect) => ({
  id: e.id,
  name: e.name,
  active: e.active,
  role: e.role,
  permissions: e.permissions,
})
const cleanShift = (s: typeof schema.merchantShift.$inferSelect) => ({
  id: s.id,
  employeeId: s.employeeId,
  openedAt: s.openedAt.toISOString(),
  closedAt: s.closedAt?.toISOString() ?? null,
})
const activeQuote = (order: OrderRow) =>
  !!order.quote && new Date(order.quote.expiresAt).getTime() > Date.now()
const equalAddress = (a: string, b: string) =>
  a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase()
export async function merchantRoutes(app: FastifyInstance) {
  const { db, events } = app.deps
  const gateway = () => app.deps.merchantPayments ?? unavailableMerchantPayments
  app.setErrorHandler((err, _req, reply) => {
    if ((err as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return reply.code(413).send({ error: { code: 'PHOTO_TOO_LARGE', message: 'request body is too large' } })
    if (
      err instanceof MerchantError ||
      err instanceof MerchantSettlementError ||
      err instanceof LoyaltyError
    )
      return reply
        .code(err.status)
        .send({ error: { code: err.code, message: err.message } })
    if (Number.isInteger((err as any).status) && typeof (err as any).code === 'string')
      return reply.code((err as any).status).send({ error: { code: (err as any).code, message: (err as any).message ?? (err as any).code, ...((err as any).conflicts ? { conflicts: (err as any).conflicts } : {}) } })
    if (err instanceof ZodError || (err as any).code === '22P02')
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: 'invalid request' } })
    if ((err as any).code === '23505' || (err as any).cause?.code === '23505')
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message: 'request conflicts with existing state',
        },
      })
    app.log.error({ err })
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL', message: 'internal error' } })
  })
  const actorCache = new WeakMap<FastifyRequest, Actor>()
  async function actor(req: FastifyRequest): Promise<Actor> {
    const cached = actorCache.get(req)
    if (cached) return cached
    const value = await uncachedActor(req)
    actorCache.set(req, value)
    return value
  }
  app.addHook('preHandler', async (req) => {
    if (req.headers.authorization) await actor(req)
  })
  async function uncachedActor(req: FastifyRequest, store:Db=db): Promise<Actor> {
    const raw = req.headers.authorization?.replace(/^Bearer /, '')
    if (!raw || !req.headers.authorization?.startsWith('Bearer '))
      return fail(401, 'UNAUTHENTICATED')
    const query = store
      .select({
        session: schema.merchantCashierSession,
        terminal: schema.merchantTerminal,
        employee: schema.merchantEmployee,
      })
      .from(schema.merchantCashierSession)
      .innerJoin(
        schema.merchantTerminal,
        eq(
          schema.merchantTerminal.id,
          schema.merchantCashierSession.terminalId,
        ),
      )
      .innerJoin(
        schema.merchantEmployee,
        eq(
          schema.merchantEmployee.id,
          schema.merchantCashierSession.employeeId,
        ),
      )
      .where(
        and(
          eq(schema.merchantCashierSession.tokenHash, digest(raw)),
          isNull(schema.merchantCashierSession.revokedAt),
          isNull(schema.merchantTerminal.revokedAt),
          gt(schema.merchantCashierSession.expiresAt, new Date()),
          eq(schema.merchantEmployee.active, true),
        ),
      )
    const [s] = await (store===db?query:query.for('share'));
    if (s)
      return {
        kind: 'cashier',
        employeeId: s.employee.id,
        venueId: s.terminal.venueId,
        sessionId: s.session.id,
        name: s.employee.name,
        permissions: s.employee.role === 'MANAGER' ? s.employee.permissions : [],
      }
    // Wallet JWTs are accepted only on owner operations. Opaque cashier tokens
    // never pass the existing P2P authentication plugin.
    const { jwtVerify } = await import('jose')
    try {
      const { payload } = await jwtVerify(
        raw,
        new TextEncoder().encode(env.jwtSecret),
        {
          algorithms: ['HS256'],
        },
      )
      if (!payload.sub || !id.safeParse(payload.sub).success)
        return fail(401, 'UNAUTHENTICATED')
      return { kind: 'owner', userId: payload.sub }
    } catch {
      return fail(401, 'UNAUTHENTICATED')
    }
  }
  async function venueFor(
    a: Actor,
    venueId: string,
    ownerOnly = false,
    store: Db = db,
  ) {
    id.parse(venueId)
    if (ownerOnly && a.kind !== 'owner') return fail(403, 'FORBIDDEN')
    const [v] = await store
      .select()
      .from(schema.merchantVenue)
      .where(eq(schema.merchantVenue.id, venueId))
    if (
      !v ||
      (a.kind === 'owner' ? v.ownerUserId !== a.userId : a.venueId !== v.id)
    )
      return fail(404, 'NOT_FOUND')
    return v
  }
  async function permittedVenue(
    req: FastifyRequest,
    permission: MerchantPermission,
  ) {
    const a = await actor(req)
    const v = await venueFor(a, params(req).venueId)
    if (a.kind === 'cashier' && !a.permissions?.includes(permission))
      return fail(403, 'FORBIDDEN')
    return v
  }
  async function audit(
    store: Db,
    a: Actor,
    venueId: string,
    action: string,
    reason: string,
    before: unknown,
    after: unknown,
  ) {
    await store.insert(schema.merchantAudit).values({
      venueId,
      actorKind: a.kind,
      actorId: a.kind === 'owner' ? a.userId : a.employeeId,
      actorName: a.kind === 'owner' ? 'Owner' : a.name ?? 'Employee',
      action,
      reason,
      before,
      after,
    })
  }
  async function cashier(req: FastifyRequest) {
    const a = await actor(req)
    if (a.kind !== 'cashier') return fail(403, 'CASHIER_REQUIRED')
    return a
  }
  async function terminal(req: FastifyRequest, store: Db = db) {
    const raw = req.headers['x-terminal-token']
    if (typeof raw !== 'string') return fail(401, 'UNAUTHENTICATED')
    const [t] = await store
      .select()
      .from(schema.merchantTerminal)
      .where(
        and(
          eq(schema.merchantTerminal.tokenHash, digest(raw)),
          isNull(schema.merchantTerminal.revokedAt),
        ),
      )
    if (!t) return fail(401, 'UNAUTHENTICATED')
    return t
  }
  // Cost history remains internal; a checkout URL and operational token do not grant cost access.
  const publicRecipeLines=(lines:OrderRow['lines'])=>lines.map(line=>({...line,...(line.recipeSnapshots?{recipeSnapshots:line.recipeSnapshots.map(({unitCosts,...r})=>({...r,costMinor:null}))}:{})}));
  function cashView(r:typeof schema.merchantCashReceipt.$inferSelect):CashReceipt{return {id:r.id,orderId:r.orderId,currency:r.currency,dueMinor:r.dueMinor,tenderedMinor:r.tenderedMinor,changeMinor:r.changeMinor,recordedAt:r.recordedAt.toISOString()}}
  async function view(order: OrderRow, store: Db = db): Promise<MerchantOrder> {
    const [refund] = await store
      .select()
      .from(schema.merchantRefund)
      .where(eq(schema.merchantRefund.orderId, order.id))
    const [cashReceipt]=order.cashReceiptId?await store.select().from(schema.merchantCashReceipt).where(eq(schema.merchantCashReceipt.id,order.cashReceiptId)):[]
    const [cashRefund]=order.cashReceiptId?await store.select().from(schema.merchantCashRefund).where(eq(schema.merchantCashRefund.orderId,order.id)):[]
    const [discount] = await store.select().from(schema.merchantDiscount).where(and(eq(schema.merchantDiscount.orderId,order.id),eq(schema.merchantDiscount.status,'APPLIED')))
    let cashPaymentAvailable=order.source==='COUNTER'&&order.status==='AWAITING_PAYMENT'&&!order.payment&&!order.paymentSnapshot&&!order.cashReceiptId&&!order.quote&&!order.quoteHistory.length&&!order.pendingPaymentHash&&!order.payerUserId&&!order.claimSessionId&&!order.notificationAddress;
    if(cashPaymentAvailable){
      const [attempt]=await store.select({id:schema.merchantTransferAttempt.id}).from(schema.merchantTransferAttempt).where(and(eq(schema.merchantTransferAttempt.orderId,order.id),eq(schema.merchantTransferAttempt.purpose,'PAYMENT'))).limit(1);
      const [pendingDiscount]=await store.select({id:schema.merchantDiscount.orderId}).from(schema.merchantDiscount).where(and(eq(schema.merchantDiscount.orderId,order.id),eq(schema.merchantDiscount.status,'PENDING'))).limit(1);
      cashPaymentAvailable=!attempt&&!pendingDiscount;
    }
    return {
      ...(cashRefund?{cashRefund:((r)=>{const {reason,...summary}=cashRefundView(r);return summary})(cashRefund)}:{}),
      cashPaymentAvailable,
      ...(cashReceipt?{paymentMethod:'CASH' as const,cashReceipt:{id:cashReceipt.id,orderId:cashReceipt.orderId,currency:cashReceipt.currency,dueMinor:cashReceipt.dueMinor,recordedAt:cashReceipt.recordedAt.toISOString()}}:{}),
      discountMinor: discount?.amountMinor ?? 0,
      stockReservation: await stockReservationView(store, order),
      id: order.id,
      venueId: order.venueId,
      number: order.number,
      revision: order.revision,
      status: order.status as MerchantOrder['status'],
      fiatCurrency: order.fiatCurrency as MerchantOrder['fiatCurrency'],
      totalMinor: order.totalMinor,
      lines: publicRecipeLines(order.lines),
      shiftId: order.shiftId,
      employeeId: order.employeeId,
      checkoutToken: order.checkoutToken,
      source: order.source as 'COUNTER' | 'REMOTE',
      acceptanceDeadline: order.acceptanceDeadline?.toISOString() ?? null,
      decision: order.decision as MerchantOrder['decision'],
      decisionAt: order.decisionAt?.toISOString() ?? null,
      decisionReason: order.decisionReason,
      preparationMinutes: order.preparationMinutes,
      pendingPaymentHash: order.pendingPaymentHash,
      pendingPaymentRevision: order.paymentSnapshot?.revision ?? order.revision,
      quote: order.quote,
      payment: order.payment,
      paidSnapshot: (order.payment || cashReceipt) && order.paymentSnapshot ? {...order.paymentSnapshot,lines:publicRecipeLines(order.paymentSnapshot.lines)} : null,
      refund: refund
        ? {
            id: refund.id,
            status: refund.status as 'REQUESTED' | 'APPROVED' | 'CONFIRMED',
            reason: refund.reason,
            pendingHash: refund.pendingHash,
            quote: refund.quote,
          }
        : null,
      createdAt: order.createdAt.toISOString(),
    }
  }
  async function orderFor(
    a: Actor,
    orderId: string,
    store: Db = db,
    lock = false,
  ) {
    id.parse(orderId)
    const query = store
      .select()
      .from(schema.merchantOrder)
      .where(eq(schema.merchantOrder.id, orderId))
    const [o] = await (lock ? query.for('update') : query)
    if (!o) return fail(404, 'NOT_FOUND')
    await venueFor(a, o.venueId, false, store)
    return o
  }
  async function publicOrder(
    checkoutToken: string,
    store: Db = db,
    lock = false,
    req?: FastifyRequest,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(checkoutToken))
      return fail(404, 'NOT_FOUND')
    const query = store
      .select()
      .from(schema.merchantOrder)
      .where(eq(schema.merchantOrder.checkoutToken, checkoutToken))
    const [o] = await (lock ? query.for('update') : query)
    if (!o) return fail(404, 'NOT_FOUND')
    if (o.source === 'REMOTE') {
      if (!req) return fail(401, 'UNAUTHENTICATED')
      const a = await actor(req)
      if (a.kind !== 'owner' || a.userId !== o.payerUserId)
        return fail(404, 'NOT_FOUND')
    }
    return o
  }
  async function priced(
    venueId: string,
    lines: z.infer<typeof MerchantOrderInput>['lines'],
    store: Db,
  ) {
    const products = await store
      .select()
      .from(schema.merchantProduct)
      .where(eq(schema.merchantProduct.venueId, venueId))
    try {
      return priceMerchantCart(
        await effectiveCatalog(store, venueId, products.map((p) => p.catalog),new Date(),true),
        lines,
      )
    } catch (err) {
      return fail(409, (err as Error).message)
    }
  }
  async function report(
    venueId: string,
    shiftId?: string,
    store: Db = db,
  ): Promise<MerchantReport> {
    const [v] = await store
      .select()
      .from(schema.merchantVenue)
      .where(eq(schema.merchantVenue.id, venueId))
    const rows = await store
      .select()
      .from(schema.merchantOrder)
      .where(
        shiftId
          ? and(eq(schema.merchantOrder.venueId,venueId),eq(schema.merchantOrder.shiftId, shiftId))
          : eq(schema.merchantOrder.venueId, venueId),
      )
      .orderBy(schema.merchantOrder.number)
    const orders = await Promise.all(rows.map((o) => view(o, store)))
    const paid = orders.filter((o) => o.payment || o.cashReceipt)
    const saleRows=await store.select().from(schema.merchantFinancialSale).where(and(eq(schema.merchantFinancialSale.venueId,venueId),sql`${schema.merchantFinancialSale.data}->>'status'='RECORDED'`,shiftId?sql`${schema.merchantFinancialSale.data}->>'shiftId'=${shiftId}`:undefined))
    const saleByOrder=new Map(saleRows.map(r=>[r.orderId,r.data])),acceptedIds = new Set(saleByOrder.keys())
    const refunded = paid.filter((o) => o.refund?.status === 'CONFIRMED'||!shiftId&&o.cashRefund?.status==='CONFIRMED')
    const sales = paid.filter(
      (o) => acceptedIds.has(o.id),
    )
    const grossExact=saleRows.reduce((n,r)=>n+BigInt(r.data.totalMinor),0n),refundedExact=refunded.reduce((n,o)=>n+BigInt(saleByOrder.get(o.id)?.totalMinor??'0'),0n)
    if(grossExact>BigInt(Number.MAX_SAFE_INTEGER)||refundedExact>BigInt(Number.MAX_SAFE_INTEGER))return fail(413,'USE_EXACT_FINANCIAL_REPORT')
    const grossMinor=Number(grossExact),refundedMinor=Number(refundedExact)
    const assets = { NIM: 0n, USDT: 0n }
    for (const o of paid.filter(o=>o.payment))
      assets[o.payment!.asset] += BigInt(o.payment!.amountAtomic)
    for (const o of refunded.filter(o=>o.payment))
      assets[o.payment!.asset] -= BigInt(o.payment!.amountAtomic)
    return {
      orders,
      totals: {
        ownerCashPayouts:ownerCashPayoutTotals(shiftId?[]:orders.flatMap(o=>o.cashRefund?[o.cashRefund]:[])),
        cash:cashReceiptTotals(orders.flatMap(o=>o.cashReceipt?[o.cashReceipt]:[]),shiftId?[]:orders.flatMap(o=>o.cashRefund?[o.cashRefund]:[])),
        salesByPaymentMethod:salePaymentMethodTotals(saleRows.map(r=>r.data)),
        count: orders.length,
        paid: paid.length,
        refunded: refunded.length,
        grossMinor,
        refundedMinor,
        netMinor:
          grossMinor -
          refunded
            .filter((o) => acceptedIds.has(o.id))
            .reduce(
              (n, o) => n + (o.paidSnapshot?.totalMinor ?? o.totalMinor),
              0,
            ),
        receivedMinor: paid.reduce(
          (n, o) => n + (o.paidSnapshot?.totalMinor ?? o.totalMinor),
          0,
        ),
        pendingAcceptanceMinor: paid
          .filter((o) => o.status === 'AWAITING_ACCEPTANCE')
          .reduce(
            (n, o) => n + (o.paidSnapshot?.totalMinor ?? o.totalMinor),
            0,
          ),
        refundPendingMinor: paid
          .filter((o) => o.status === 'REFUND_PENDING')
          .reduce(
            (n, o) => n + (o.paidSnapshot?.totalMinor ?? o.totalMinor),
            0,
          ),
        fiatCurrency:
          v.fiatCurrency as MerchantReport['totals']['fiatCurrency'],
        assets: { NIM: assets.NIM.toString(), USDT: assets.USDT.toString() },
      },
    }
  }
  const params = (req: FastifyRequest) => req.params as Record<string, string>
  const base = '/v1/merchant'
  app.get(`${base}/venues`, async (req) => {
    const a = await actor(req)
    if (a.kind !== 'owner') return fail(403, 'FORBIDDEN')
    return (
      await db
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.ownerUserId, a.userId))
    ).map(cleanVenue)
  })
  app.get(`${base}/venues/:venueId/rates`, async (req) => {
    const venue = await venueFor(await actor(req), params(req).venueId)
    try {
      return (
        (await gateway().displayRates?.(
          venue.fiatCurrency as MerchantReport['totals']['fiatCurrency'],
        )) ?? { NIM: null, USDT: null }
      )
    } catch {
      return { NIM: null, USDT: null }
    }
  })
  app.post(`${base}/venues`, async (req, reply) => {
    const a = await actor(req)
    if (a.kind !== 'owner') return fail(403, 'FORBIDDEN')
    const input = MerchantVenueInput.parse(req.body)
    const [v] = await db
      .insert(schema.merchantVenue)
      .values({ ...input, ownerUserId: a.userId })
      .returning()
    return reply.code(201).send(cleanVenue(v))
  })
  app.patch(`${base}/venues/:venueId`, async (req) => {
    const a = await actor(req)
    const v = await venueFor(a, params(req).venueId, true)
    const input = MerchantVenueInput.parse(req.body)
    return db.transaction(async raw => {
    const db = raw as unknown as Db
    const [current] = await db.select().from(schema.merchantVenue).where(eq(schema.merchantVenue.id,v.id)).for('update')
    const [order] = await db
      .select()
      .from(schema.merchantOrder)
      .where(eq(schema.merchantOrder.venueId, v.id))
      .limit(1)
    const [loyalty] = await db
      .select()
      .from(schema.loyaltyProgram)
      .where(eq(schema.loyaltyProgram.venueId, v.id))
      .limit(1)
    const [catalogProduct] = await db.select({id:schema.merchantProduct.id}).from(schema.merchantProduct).where(eq(schema.merchantProduct.venueId,v.id)).limit(1)
    const [menu] = await db.select().from(schema.merchantMenuState).where(eq(schema.merchantMenuState.venueId,v.id))
    const [stockItem]=await db.select({id:schema.merchantInventoryItem.id}).from(schema.merchantInventoryItem).where(eq(schema.merchantInventoryItem.venueId,v.id)).limit(1)
    if ((order || loyalty || catalogProduct || stockItem || (menu && (menu.publishedRevision > 0 || menu.draftProducts !== null))) && input.fiatCurrency !== current.fiatCurrency)
      return fail(409, 'CURRENCY_LOCKED')
    const [updated] = await db
      .update(schema.merchantVenue)
      .set(input)
      .where(eq(schema.merchantVenue.id, v.id))
      .returning()
    return cleanVenue(updated)
    })
  })
  app.get(`${base}/session`, async (req) => {
    const a = await cashier(req)
    const [employee] = await db.select().from(schema.merchantEmployee)
      .where(eq(schema.merchantEmployee.id, a.employeeId))
    const venue = await venueFor(a, a.venueId)
    const [session] = await db.select().from(schema.merchantCashierSession).where(eq(schema.merchantCashierSession.id,a.sessionId))
    await db.update(schema.merchantTerminal).set({lastSeenAt:new Date()}).where(eq(schema.merchantTerminal.id,session.terminalId))
    return { employee: cleanEmployee(employee), venue: cleanVenue(venue) }
  })
  app.get(`${base}/venues/:venueId/audit`, async (req) => {
    const v = await permittedVenue(req, 'audit.view')
    const query = z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query)
    return (await db.select().from(schema.merchantAudit).where(eq(schema.merchantAudit.venueId, v.id))
      .orderBy(desc(schema.merchantAudit.createdAt), desc(schema.merchantAudit.id))
      .limit(query.limit).offset((query.page - 1) * query.limit))
      .map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))
  })
  async function protectLoyaltyProduct(
    db: Db, productId: string,
    input: { variants: { id: string }[] } & Partial<Pick<MerchantProduct, 'components' | 'extras' | 'choiceGroups'>>,
  ) {
    const compatible = merchantRewardProduct({ ...input, extras: input.extras ?? [] })
    const promises = await db
        .select({
          cardId: schema.loyaltyCard.id,
          program: schema.loyaltyProgram,
        })
        .from(schema.loyaltyCard)
        .innerJoin(
          schema.loyaltyProgram,
          eq(schema.loyaltyProgram.id, schema.loyaltyCard.programId),
        )
        .where(eq(schema.loyaltyProgram.productId, productId))
        .orderBy(asc(schema.loyaltyCard.userId))
      for (const promise of promises) {
        if (compatible && input.variants.some((x) => x.id === promise.program.variantId))
          continue
        await lockCard(db, promise.cardId)
        const card = await cardView(db, promise.cardId)
        const [pending] = await db
          .select({ id: schema.merchantOrder.id })
          .from(schema.loyaltyCheckout)
          .innerJoin(
            schema.merchantOrder,
            eq(schema.merchantOrder.id, schema.loyaltyCheckout.orderId),
          )
          .where(
            and(
              eq(schema.loyaltyCheckout.cardId, promise.cardId),
              inArray(schema.merchantOrder.status, [
                'AWAITING_PAYMENT',
                'PAYMENT_PENDING',
                'AWAITING_ACCEPTANCE',
              ]),
            ),
          )
          .limit(1)
        if (
          !!pending ||
          card.balance !== 0 ||
          card.refundHolds ||
          card.rewards.some((r) =>
            ['RESERVED', 'PREPARING', 'READY'].includes(r.status),
          )
        )
          return fail(409, 'LOYALTY_REWARD_PRODUCT_LOCKED')
      }
      const activePromises = await db
        .select()
        .from(schema.loyaltyProgram)
        .where(
          and(
            eq(schema.loyaltyProgram.productId, productId),
            eq(schema.loyaltyProgram.active, true),
          ),
        )
      if (
        activePromises.some(
          (p) => !compatible || !input.variants.some((v) => v.id === p.variantId),
        )
      )
        return fail(409, 'LOYALTY_REWARD_PRODUCT_LOCKED')
  }
  app.get(`${base}/venues/:venueId/catalog`, async (req) => {
    const v = await venueFor(await actor(req), params(req).venueId)
    const products = await db.select().from(schema.merchantProduct).where(eq(schema.merchantProduct.venueId, v.id))
    return effectiveCatalog(db, v.id, products.map(p => p.catalog))
  })
  app.post(`${base}/venues/:venueId/catalog`, async (req, reply) => {
    const v = await permittedVenue(req, 'menu.manage')
    const { reason, ...input } = MerchantProductInput.extend({
      reason: z.string().trim().min(1).max(500).optional(),
    }).parse(req.body)
    const result = await db.transaction(async (raw) => {
      const db = raw as unknown as Db
      await db
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.id, v.id))
        .for('update')
      if (
        new Set(input.variants.map((x) => x.id)).size !==
          input.variants.length ||
        new Set(input.extras.map((x) => x.id)).size !== input.extras.length
      )
        return fail(400, 'VALIDATION')
      const productId = input.id ?? crypto.randomUUID()
      const [existing] = await db
        .select()
        .from(schema.merchantProduct)
        .where(eq(schema.merchantProduct.id, productId))
      if (existing && existing.venueId !== v.id) return fail(404, 'NOT_FOUND')
      await protectLoyaltyProduct(db, productId, input)
      const catalog = { ...input, id: productId }
      const catalogs = (await db.select().from(schema.merchantProduct)
        .where(eq(schema.merchantProduct.venueId, v.id)))
        .map(p => p.catalog).filter(p => p.id !== productId)
      try {
        validateMerchantCatalog([...catalogs, catalog])
      } catch (error) {
        return fail(400, (error as Error).message)
      }
      await validateMenuStock(db, v.id, [...catalogs, catalog])
      await validateMenuImages(db, v.id, [catalog])
      const savedProduct = await db
        .insert(schema.merchantProduct)
        .values({ id: productId, venueId: v.id, catalog })
        .onConflictDoUpdate({
          target: schema.merchantProduct.id,
          set: { catalog },
          setWhere: eq(schema.merchantProduct.venueId, v.id),
        }).returning({id:schema.merchantProduct.id})
      if (!savedProduct.length) return fail(404, 'NOT_FOUND')
      if (JSON.stringify(existing?.catalog) !== JSON.stringify(catalog))
        await audit(db, await actor(req), v.id, existing ? 'catalog.updated' : 'catalog.created',
          reason ?? (existing ? 'Menu updated' : 'Product created'), existing?.catalog ?? null, catalog)
      await bumpMenuRevision(db, v.id)
      return { catalog, existing: !!existing }
    })
    return reply.code(result.existing ? 200 : 201).send(result.catalog)
  })
  app.patch(
    `${base}/venues/:venueId/catalog/:productId/availability`,
    async (req) => {
      const v = await venueFor(await actor(req), params(req).venueId)
      const input = z
        .object({ available: z.boolean(), extraId: id.optional(), reason: z.string().trim().min(1).max(500).optional() })
        .strict()
        .parse(req.body)
      return db.transaction(async (tx) => {
        await tx.select().from(schema.merchantVenue).where(eq(schema.merchantVenue.id,v.id)).for('update')
        const [p] = await tx
          .select()
          .from(schema.merchantProduct)
          .where(
            and(
              eq(schema.merchantProduct.id, id.parse(params(req).productId)),
              eq(schema.merchantProduct.venueId, v.id),
            ),
          )
          .for('update')
        if (!p) return fail(404, 'NOT_FOUND')
        if (
          input.extraId &&
          !p.catalog.extras.some((e) => e.id === input.extraId)
        )
          return fail(404, 'NOT_FOUND')
        const catalog = input.extraId
          ? {
              ...p.catalog,
              extras: p.catalog.extras.map((e) =>
                e.id === input.extraId
                  ? { ...e, available: input.available }
                  : e,
              ),
            }
          : { ...p.catalog, available: input.available }
        await tx
          .update(schema.merchantProduct)
          .set({ catalog })
          .where(eq(schema.merchantProduct.id, p.id))
        if (JSON.stringify(p.catalog) !== JSON.stringify(catalog))
          await audit(tx as unknown as Db, await actor(req), v.id, 'catalog.availability.changed',
            input.reason ?? 'Availability updated', p.catalog, catalog)
        await bumpMenuRevision(tx as unknown as Db, v.id)
        return catalog
      })
    },
  )
  app.get(`${base}/venues/:venueId/employees`, async (req) => {
    const v = await venueFor(await actor(req), params(req).venueId, true)
    return (
      await db
        .select()
        .from(schema.merchantEmployee)
        .where(eq(schema.merchantEmployee.venueId, v.id))
    ).map(cleanEmployee)
  })
  app.post(`${base}/venues/:venueId/employees`, async (req, reply) => {
    const v = await venueFor(await actor(req), params(req).venueId, true)
    const input = MerchantEmployeeInput.parse(req.body)
    const e = await db.transaction(async (raw) => {
      const tx = raw as unknown as Db
      const [e] = await tx.insert(schema.merchantEmployee)
        .values({ venueId: v.id, name: input.name, pinHash: pinHash(input.pin) }).returning()
      await audit(tx, await actor(req), v.id, 'employee.created', 'Employee created', null, cleanEmployee(e))
      return e
    })
    return reply.code(201).send(cleanEmployee(e))
  })
  app.patch(`${base}/employees/:employeeId`, async (req) => {
    const a = await actor(req)
    const [e] = await db
      .select()
      .from(schema.merchantEmployee)
      .where(eq(schema.merchantEmployee.id, id.parse(params(req).employeeId)))
    if (!e) return fail(404, 'NOT_FOUND')
    await venueFor(a, e.venueId, true)
    const input = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        pin: pin.optional(),
        active: z.boolean().optional(),
        role: z.enum(['CASHIER', 'MANAGER']).optional(),
        permissions: z.array(MerchantPermissionSchema).max(8).optional(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .parse(req.body)
    if (
      (input.role !== undefined || input.permissions !== undefined) &&
      !input.reason
    )
      return fail(400, 'REASON_REQUIRED')
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.merchantEmployee)
        .where(eq(schema.merchantEmployee.id, e.id)).for('update')
      const nextRole = input.role ?? before.role
      const nextPermissions = input.permissions ?? (nextRole === 'CASHIER' ? [] : before.permissions)
      if (nextRole === 'CASHIER' && nextPermissions.length) return fail(400, 'MANAGER_REQUIRED')
      const [updated] = await tx
        .update(schema.merchantEmployee)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          permissions: [...new Set(nextPermissions)],
          ...(input.pin ? { pinHash: pinHash(input.pin) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(schema.merchantEmployee.id, e.id))
        .returning()
      if (input.pin || input.active === false)
        await tx
          .update(schema.merchantCashierSession)
          .set({ revokedAt: new Date() })
          .where(eq(schema.merchantCashierSession.employeeId, e.id))
      if (JSON.stringify(cleanEmployee(before)) !== JSON.stringify(cleanEmployee(updated)) || input.pin)
        await audit(tx as unknown as Db, a, e.venueId,
          input.role !== undefined || input.permissions !== undefined ? 'employee.permissions.changed' : 'employee.updated',
          input.reason ?? (input.pin ? 'PIN reset' : 'Employee updated'),
          cleanEmployee(before), { ...cleanEmployee(updated), ...(input.pin ? { pinReset: true } : {}) })
      return cleanEmployee(updated)
    })
  })
  async function revoke(v: string, store: Db) {
    await store
      .update(schema.merchantVenue)
      .set({ remoteAccepting: false, remoteHeartbeatAt: null })
      .where(eq(schema.merchantVenue.id, v))
    const ts = await store
      .update(schema.merchantTerminal)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.merchantTerminal.venueId, v),
          isNull(schema.merchantTerminal.revokedAt),
        ),
      )
      .returning()
    for (const t of ts)
      await store
        .update(schema.merchantCashierSession)
        .set({ revokedAt: new Date() })
        .where(eq(schema.merchantCashierSession.terminalId, t.id))
  }
  app.post(`${base}/venues/:venueId/terminal`, async (req, reply) => {
    const v = await venueFor(await actor(req), params(req).venueId, true)
    const raw = token()
    const t = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.id, v.id))
        .for('update')
      await revoke(v.id, tx as unknown as Db)
      const [t] = await tx
        .insert(schema.merchantTerminal)
        .values({ venueId: v.id, tokenHash: digest(raw) })
        .returning()
      return t
    })
    return reply.code(201).send({ terminalToken: raw, terminalId: t.id })
  })
  app.post(`${base}/venues/:venueId/terminal/revoke`, async (req) => {
    const v = await venueFor(await actor(req), params(req).venueId, true)
    await db.transaction((tx) => revoke(v.id, tx as unknown as Db))
    return { ok: true }
  })
  app.get(`${base}/terminal/profiles`, async (req) => {
    const t = await terminal(req)
    const [v] = await db
      .select()
      .from(schema.merchantVenue)
      .where(eq(schema.merchantVenue.id, t.venueId))
    const employees = await db
      .select()
      .from(schema.merchantEmployee)
      .where(
        and(
          eq(schema.merchantEmployee.venueId, t.venueId),
          eq(schema.merchantEmployee.active, true),
        ),
      )
    return { venue: cleanVenue(v), employees: employees.map((e) => ({ id: e.id, name: e.name, active: e.active })) }
  })
  app.post(`${base}/terminal/login`, async (req) => {
    const t = await terminal(req)
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.merchantTerminal)
        .where(eq(schema.merchantTerminal.id, t.id))
        .for('update')
      if (locked.revokedAt) return { error: 'UNAUTHENTICATED' }
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.merchantPinAttempt)
        .where(
          and(
            eq(schema.merchantPinAttempt.terminalId, t.id),
            gt(
              schema.merchantPinAttempt.occurredAt,
              new Date(Date.now() - 60000),
            ),
          ),
        )
      if (count >= 5) return { error: 'RATE_LIMITED' }
      const parsed = z
        .object({ employeeId: id, pin })
        .strict()
        .safeParse(req.body)
      const [e] = parsed.success
        ? await tx
            .select()
            .from(schema.merchantEmployee)
            .where(
              and(
                eq(schema.merchantEmployee.id, parsed.data.employeeId),
                eq(schema.merchantEmployee.venueId, t.venueId),
                eq(schema.merchantEmployee.active, true),
              ),
            )
            .for('update')
        : []
      if (!parsed.success || !e || !pinMatches(parsed.data.pin, e.pinHash)) {
        await tx.insert(schema.merchantPinAttempt).values({ terminalId: t.id })
        return { error: 'INVALID_PIN' }
      }
      await tx
        .update(schema.merchantCashierSession)
        .set({ revokedAt: new Date() })
        .where(eq(schema.merchantCashierSession.terminalId, t.id))
      const raw = token()
      await tx.insert(schema.merchantCashierSession).values({
        terminalId: t.id,
        employeeId: e.id,
        tokenHash: digest(raw),
        expiresAt: new Date(Date.now() + 12 * 60 * 60000),
      })
      const [v] = await tx
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.id, t.venueId))
      return { token: raw, employee: cleanEmployee(e), venue: cleanVenue(v) }
    })
    if ('error' in result)
      return fail(result.error === 'RATE_LIMITED' ? 429 : 401, result.error!)
    return result
  })
  app.post(`${base}/logout`, async (req) => {
    const a = await cashier(req)
    await db
      .update(schema.merchantCashierSession)
      .set({ revokedAt: new Date() })
      .where(eq(schema.merchantCashierSession.id, a.sessionId))
    return { ok: true }
  })
  app.get(`${base}/shifts/current`, async (req) => {
    const a = await cashier(req)
    const [s] = await db
      .select()
      .from(schema.merchantShift)
      .where(
        and(
          eq(schema.merchantShift.employeeId, a.employeeId),
          isNull(schema.merchantShift.closedAt),
        ),
      )
    return s ? cleanShift(s) : null
  })
  app.post(`${base}/shifts`, async (req, reply) => {
    const a = await cashier(req)
    const s = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.merchantEmployee)
        .where(eq(schema.merchantEmployee.id, a.employeeId))
        .for('update')
      const [open] = await tx
        .select()
        .from(schema.merchantShift)
        .where(
          and(
            eq(schema.merchantShift.employeeId, a.employeeId),
            isNull(schema.merchantShift.closedAt),
          ),
        )
      if (open) return open
      const [created] = await tx
        .insert(schema.merchantShift)
        .values({ venueId: a.venueId, employeeId: a.employeeId })
        .returning()
      return created
    })
    return reply.code(201).send(cleanShift(s))
  })
  async function shiftFor(req: FastifyRequest, store: Db = db) {
    const a = await actor(req)
    const [s] = await store
      .select()
      .from(schema.merchantShift)
      .where(eq(schema.merchantShift.id, id.parse(params(req).shiftId)))
    if (!s) return fail(404, 'NOT_FOUND')
    await venueFor(a, s.venueId, false, store)
    if (a.kind === 'cashier' && a.employeeId !== s.employeeId)
      return fail(404, 'NOT_FOUND')
    return { a, s }
  }
  app.get(`${base}/shifts/:shiftId/report`, async (req) => {
    const { s } = await shiftFor(req)
    return s.reportSnapshot ?? report(s.venueId, s.id)
  })
  app.post(`${base}/shifts/:shiftId/close`, async (req) => {
    const { a, s } = await shiftFor(req)
    if (a.kind !== 'cashier') return fail(403, 'CASHIER_REQUIRED')
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.merchantShift)
        .where(eq(schema.merchantShift.id, s.id))
        .for('update')
      if (locked.reportSnapshot) return locked.reportSnapshot
      const [pending] = await tx
        .select()
        .from(schema.merchantOrder)
        .where(
          and(
            eq(schema.merchantOrder.shiftId, s.id),
            sql`${schema.merchantOrder.status} in ('AWAITING_PAYMENT','PAYMENT_PENDING','REFUND_PENDING') and not (${schema.merchantOrder.source} = 'REMOTE' and ${schema.merchantOrder.status} = 'REFUND_PENDING')`,
          ),
        )
        .limit(1)
      if (pending) return fail(409, 'UNSETTLED_ORDERS')
      await tx
        .update(schema.merchantVenue)
        .set({ remoteAccepting: false, remoteHeartbeatAt: null })
        .where(eq(schema.merchantVenue.id, s.venueId))
      const r = await report(s.venueId, s.id, tx as unknown as Db)
      await tx
        .update(schema.merchantShift)
        .set({ closedAt: new Date(), reportSnapshot: r })
        .where(eq(schema.merchantShift.id, s.id))
      return r
    })
  })
  app.get(`${base}/venues/:venueId/report`, async (req) => {
    const v = await permittedVenue(req, 'reports.view')
    return report(v.id)
  })
  app.get(`${base}/venues/:venueId/orders`, async (req) => {
    const a = await actor(req)
    const v = await venueFor(a, params(req).venueId)
    const rows = await db
      .select()
      .from(schema.merchantOrder)
      .where(
        and(
          eq(schema.merchantOrder.venueId, v.id),
          a.kind === 'cashier'
            ? or(
                eq(schema.merchantOrder.employeeId, a.employeeId),
                inArray(schema.merchantOrder.status, [
                  'AWAITING_ACCEPTANCE',
                  'PREPARING',
                  'READY',
                  'REFUND_PENDING',
                ]),
              )
            : undefined,
        ),
      )
      .orderBy(schema.merchantOrder.number)
    return Promise.all(rows.map((o) => view(o)))
  })
  app.post(`${base}/orders`, async (req, reply) => {
    const a = await cashier(req)
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || key.length < 1 || key.length > 128)
      return fail(400, 'IDEMPOTENCY_KEY_REQUIRED')
    const input = MerchantOrderInput.parse(req.body)
    const requestHash = digest(JSON.stringify(input))
    const o = await db.transaction(async (tx) => {
      await tx
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.id, a.venueId))
        .for('update')
      const [existing] = await tx
        .select()
        .from(schema.merchantOrder)
        .where(
          and(
            eq(schema.merchantOrder.employeeId, a.employeeId),
            eq(schema.merchantOrder.requestKey, key),
          ),
        )
      if (existing) {
        if (existing.requestHash !== requestHash)
          return fail(409, 'IDEMPOTENCY_CONFLICT')
        return existing
      }
      const [s] = await tx
        .select()
        .from(schema.merchantShift)
        .where(
          and(
            eq(schema.merchantShift.employeeId, a.employeeId),
            isNull(schema.merchantShift.closedAt),
          ),
        )
        .for('update')
      if (!s) return fail(409, 'SHIFT_REQUIRED')
      const pricedCart = await priced(
        a.venueId,
        input.lines,
        tx as unknown as Db,
      )
      const [v] = await tx
        .update(schema.merchantVenue)
        .set({
          nextOrderNumber: sql`${schema.merchantVenue.nextOrderNumber}+1`,
        })
        .where(eq(schema.merchantVenue.id, a.venueId))
        .returning()
      const [o] = await tx
        .insert(schema.merchantOrder)
        .values({
          venueId: v.id,
          employeeId: a.employeeId,
          shiftId: s.id,
          number: v.nextOrderNumber - 1,
          fiatCurrency: v.fiatCurrency,
          ...pricedCart,
          checkoutToken: token(),
          requestKey: key,
          requestHash,
        })
        .returning()
      await tx
        .insert(schema.merchantOrderRevision)
        .values({ orderId: o.id, revision: 1, snapshot: pricedCart })
      return o
    })
    return reply.code(201).send(await view(o))
  })
  app.patch(`${base}/orders/:orderId`, async (req) => {
    const a = await cashier(req)
    const input = MerchantOrderInput.extend({ revision }).parse(req.body)
    return db.transaction(async (tx) => {
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      if (o.source === 'REMOTE') return fail(409, 'ORDER_LOCKED')
      const [discount] = await tx.select().from(schema.merchantDiscount).where(eq(schema.merchantDiscount.orderId,o.id))
      if (discount) return fail(409, 'DISCOUNT_EXISTS')
      if (o.revision !== input.revision) return fail(409, 'STALE_REVISION')
      if (
        o.status !== 'AWAITING_PAYMENT' ||
        activeQuote(o) ||
        !!o.pendingPaymentHash
      )
        return fail(409, 'ORDER_LOCKED')
      // Expiry releases an unsubmitted basket. Keep its quotes and revision
      // so a transfer signed against that basket can be credited and refunded.
      await releaseOrderStock(tx as unknown as Db,o.id)
      const pricedCart = await priced(
        o.venueId,
        input.lines,
        tx as unknown as Db,
      )
      const [updated] = await tx
        .update(schema.merchantOrder)
        .set({
          ...pricedCart,
          revision: o.revision + 1,
          quote: null,
          quoteHistory: o.quote ? [...o.quoteHistory, o.quote] : o.quoteHistory,
        })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      await tx.insert(schema.merchantOrderRevision).values({
        orderId: o.id,
        revision: updated.revision,
        snapshot: pricedCart,
      })
      return view(updated, tx as unknown as Db)
    })
  })
  app.get(`${base}/orders/:orderId/cash/receipt`,async req=>{
    const a=await actor(req),o=await orderFor(a,params(req).orderId);
    if(!o.cashReceiptId)return fail(404,'NOT_FOUND');
    const [receipt]=await db.select().from(schema.merchantCashReceipt).where(and(eq(schema.merchantCashReceipt.id,o.cashReceiptId),eq(schema.merchantCashReceipt.orderId,o.id)));
    if(!receipt)return fail(404,'NOT_FOUND');return cashView(receipt);
  })
  app.post(`${base}/orders/:orderId/cash/confirm`,async req=>{
    const fresh=await uncachedActor(req);if(fresh.kind!=='cashier')return fail(403,'CASHIER_REQUIRED');const a=fresh;
    const input=CashSaleInput.parse(req.body),key=req.headers['idempotency-key'];
    if(typeof key!=='string'||key.length<1||key.length>128)return fail(400,'IDEMPOTENCY_KEY_REQUIRED');
    const initial=await orderFor(a,params(req).orderId);
    if(initial.employeeId!==a.employeeId)return fail(404,'NOT_FOUND');
    const requestHash=digest(JSON.stringify(input));
    return db.transaction(async raw=>{
      const tx=raw as unknown as Db;
      // Status/readiness and shift closing lock the shift before touching an order.
      const [shift]=await tx.select().from(schema.merchantShift).where(and(eq(schema.merchantShift.id,initial.shiftId!),eq(schema.merchantShift.venueId,a.venueId),eq(schema.merchantShift.employeeId,a.employeeId))).for('update');
      const o=await orderFor(a,initial.id,tx,true);
      const authority=await uncachedActor(req,tx);
      if(authority.kind!=='cashier'||authority.employeeId!==a.employeeId||authority.venueId!==a.venueId)return fail(403,'CASHIER_REQUIRED');
      const [previous]=await tx.select().from(schema.merchantCashReceipt).where(eq(schema.merchantCashReceipt.orderId,o.id));
      if(previous){if(previous.employeeId===a.employeeId&&previous.requestKey===key){if(previous.requestHash!==requestHash)return fail(409,'IDEMPOTENCY_CONFLICT');return {order:await view(o,tx),cashReceipt:cashView(previous)}}return fail(409,'INVALID_STATE')}
      if(!shift||shift.closedAt)return fail(409,'SHIFT_REQUIRED');
      if(o.source!=='COUNTER')return fail(409,'CASH_METHOD_UNAVAILABLE');
      if(o.revision!==input.revision)return fail(409,'STALE_REVISION');
      if(o.status!=='AWAITING_PAYMENT'||o.payment||o.paymentSnapshot||o.cashReceiptId)return fail(409,'INVALID_STATE');
      if(o.payerUserId||o.claimSessionId||o.notificationAddress)return fail(409,'CASH_CUSTOMER_LINK_UNSUPPORTED');
      const [loyalty]=await tx.select({orderId:schema.loyaltyCheckout.orderId}).from(schema.loyaltyCheckout).where(eq(schema.loyaltyCheckout.orderId,o.id)).limit(1);
      if(loyalty)return fail(409,'CASH_CUSTOMER_LINK_UNSUPPORTED');
      const [attempt]=await tx.select({id:schema.merchantTransferAttempt.id}).from(schema.merchantTransferAttempt).where(and(eq(schema.merchantTransferAttempt.orderId,o.id),eq(schema.merchantTransferAttempt.purpose,'PAYMENT'))).limit(1);
      if(o.quote||o.quoteHistory.length||o.pendingPaymentHash||attempt)return fail(409,'CRYPTO_PAYMENT_IN_PROGRESS');
      const [pendingDiscount]=await tx.select({id:schema.merchantDiscount.orderId}).from(schema.merchantDiscount).where(and(eq(schema.merchantDiscount.orderId,o.id),eq(schema.merchantDiscount.status,'PENDING')));
      if(pendingDiscount)return fail(409,'DISCOUNT_APPROVAL_PENDING');
      const [venue]=await tx.select({currency:schema.merchantVenue.fiatCurrency}).from(schema.merchantVenue).where(eq(schema.merchantVenue.id,o.venueId));
      if(venue.currency!==o.fiatCurrency)return fail(409,'CASH_CURRENCY_CHANGED');
      if(input.tenderedMinor<o.totalMinor)return fail(409,'INSUFFICIENT_CASH');
      await priced(o.venueId,o.lines,tx);
      const snapshot={revision:o.revision,lines:o.lines,totalMinor:o.totalMinor};
      const [receipt]=await tx.insert(schema.merchantCashReceipt).values({orderId:o.id,venueId:o.venueId,employeeId:a.employeeId,shiftId:shift.id,currency:o.fiatCurrency as CashReceipt['currency'],dueMinor:o.totalMinor,tenderedMinor:input.tenderedMinor,changeMinor:input.tenderedMinor-o.totalMinor,orderRevision:o.revision,paidSnapshot:snapshot,requestKey:key,requestHash}).returning();
      const [updated]=await tx.update(schema.merchantOrder).set({paymentMethod:'CASH',cashReceiptId:receipt.id,paymentSnapshot:snapshot,status:'PREPARING',revision:o.revision+1}).where(eq(schema.merchantOrder.id,o.id)).returning();
      await consumeCashOrderStock(tx,updated);
      await audit(tx,a,o.venueId,'order.cash.confirmed','Cash physically received',null,{receiptId:receipt.id,amountMinor:receipt.dueMinor,currency:receipt.currency});
      return {order:await view(updated,tx),cashReceipt:cashView(receipt)};
    });
  })
  app.post(`${base}/orders/:orderId/status`, async (req) => {
    const a = await cashier(req)
    const input = z
      .object({ revision, status: z.enum(['READY', 'COLLECTED', 'CANCELLED']) })
      .strict()
      .parse(req.body)
    return db.transaction(async (tx) => {
      if(input.status!=='CANCELLED'){
        const [shift]=await tx.select().from(schema.merchantShift).where(and(eq(schema.merchantShift.employeeId,a.employeeId),eq(schema.merchantShift.venueId,a.venueId),isNull(schema.merchantShift.closedAt))).for('update')
        if(!shift)return fail(409,'SHIFT_REQUIRED')
      }
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      if (o.revision !== input.revision) return fail(409, 'STALE_REVISION')
      if (o.source === 'REMOTE') {
        const [open] = await tx
          .select()
          .from(schema.merchantShift)
          .where(
            and(
              eq(schema.merchantShift.employeeId, a.employeeId),
              isNull(schema.merchantShift.closedAt),
            ),
          )
          .limit(1)
        if (!open) return fail(409, 'SHIFT_REQUIRED')
      }
      if (o.source === 'REMOTE' && input.status !== 'READY')
        return fail(409, 'PICKUP_PROOF_REQUIRED')
      if (o.status === input.status) return view(o, tx as unknown as Db)
      if (
        !canMerchantTransition(
          o.status as MerchantOrder['status'],
          input.status,
        ) ||
        (input.status === 'CANCELLED' &&
          (activeQuote(o) || !!o.pendingPaymentHash))
      )
        return fail(409, 'INVALID_STATE')
      if(input.status==='READY'){const before=await orderReadiness(tx as unknown as Db,o);const result=await changeOrderReadiness(tx as unknown as Db,o,before.lines.map(l=>l.quantity));await audit(tx as unknown as Db,a,o.venueId,'order.readiness.updated','Marked all items ready',before,result);return view({...o,status:'READY'},tx as unknown as Db)}
      if(input.status==='COLLECTED'&&!(await orderReadiness(tx as unknown as Db,o)).allReady)return fail(409,'NOT_READY')
      const [updated] = await tx
        .update(schema.merchantOrder)
        .set({
          status: input.status,
          ...(input.status === 'CANCELLED'
            ? {
                cancelledAt: new Date(),
                quote: null,
                quoteHistory: o.quote
                  ? [...o.quoteHistory, o.quote]
                  : o.quoteHistory,
              }
            : {}),
        })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      if(input.status==='CANCELLED') await releaseOrderStock(tx as unknown as Db,o.id)
      return view(updated, tx as unknown as Db)
    })
  })
  app.post(`${base}/orders/:orderId/claim`, async (req) => {
    const a = await cashier(req)
    const parsed = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .safeParse(req.body)
    const result = await db.transaction(async (tx) => {
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      if (o.source === 'REMOTE') return fail(409, 'ORDER_LOCKED')
      if (o.status !== 'AWAITING_PAYMENT') return fail(409, 'INVALID_STATE')
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.claimAttempt)
        .where(
          and(
            eq(schema.claimAttempt.subjectType, 'merchant'),
            eq(schema.claimAttempt.subjectHash, digest(a.employeeId)),
            gt(schema.claimAttempt.occurredAt, new Date(Date.now() - 60000)),
          ),
        )
      if (count >= 10) return { error: 'RATE_LIMITED' }
      const [session] = parsed.success
        ? await tx
            .update(schema.paymentSession)
            .set({
              status: 'CLAIMED',
              merchantCheckoutToken: o.checkoutToken,
              claimedAt: new Date(),
              chargeDeadlineAt: null,
            })
            .where(
              and(
                eq(
                  schema.paymentSession.codeHash,
                  hashCode(parsed.data.code, env.codePepper),
                ),
                eq(schema.paymentSession.status, 'AVAILABLE'),
                gt(schema.paymentSession.expiresAt, new Date()),
                isNull(schema.paymentSession.receiverUserId),
              ),
            )
            .returning()
        : []
      if (!session) {
        await tx.insert(schema.claimAttempt).values({
          subjectType: 'merchant',
          subjectHash: digest(a.employeeId),
        })
        return { error: 'CODE_UNAVAILABLE' }
      }
      if (o.claimSessionId) return fail(409, 'ALREADY_CLAIMED')
      const [payer] = await tx
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, session.payerUserId))
      const [updated] = await tx
        .update(schema.merchantOrder)
        .set({
          payerUserId: payer.id,
          claimSessionId: session.id,
          notificationAddress: payer.walletAddress,
        })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      return { updated, sessionId: session.id }
    })
    if ('error' in result)
      return fail(result.error === 'RATE_LIMITED' ? 429 : 404, result.error!)
    await events.publish(db, {
      sessionId: result.sessionId,
      eventType: 'MERCHANT_CHECKOUT',
      actorType: 'system',
      stateFrom: 'AVAILABLE',
      stateTo: 'CLAIMED',
    })
    return view(result.updated)
  })
  app.get(`${base}/checkout/:checkoutToken`, async (req) =>
    view(await publicOrder(params(req).checkoutToken, db, false, req)),
  )
  app.post(`${base}/checkout/:checkoutToken/quote`, async (req) => {
    const input = z
      .object({
        revision,
        asset: z.enum(['NIM', 'USDT']),
        sender: address,
        nimAddress: address.optional(),
      })
      .strict()
      .parse(req.body)
    return db.transaction(async (tx) => {
      const o = await publicOrder(
        params(req).checkoutToken,
        tx as unknown as Db,
        true,
        req,
      )
      if (o.revision !== input.revision) return fail(409, 'STALE_REVISION')
      if (o.status !== 'AWAITING_PAYMENT') return fail(409, 'ORDER_LOCKED')
      const [pendingDiscount] = await tx.select({id:schema.merchantDiscount.orderId}).from(schema.merchantDiscount).where(and(eq(schema.merchantDiscount.orderId,o.id),eq(schema.merchantDiscount.status,'PENDING')))
      if (pendingDiscount) return fail(409, 'DISCOUNT_APPROVAL_PENDING')
      if (o.quote) {
        if (
          o.quote.asset !== input.asset ||
          !equalAddress(o.quote.sender, input.sender)
        )
          return fail(409, 'QUOTE_LOCKED')
        if (activeQuote(o)) return view(o, tx as unknown as Db)
      }
      if (o.source === 'COUNTER') await priced(o.venueId, o.lines, tx as unknown as Db)
      if (o.source === 'REMOTE') {
        if (!env.remoteOrderingEnabled) return fail(409, 'VENUE_UNAVAILABLE')
        const [v] = await tx
          .select()
          .from(schema.merchantVenue)
          .where(eq(schema.merchantVenue.id, o.venueId))
          .for('update')
        const [open] = await tx
          .select()
          .from(schema.merchantShift)
          .where(
            and(
              eq(schema.merchantShift.venueId, o.venueId),
              isNull(schema.merchantShift.closedAt),
            ),
          )
          .limit(1)
        if (
          !v.remotePublished ||
          !v.remoteAccepting ||
          (v.remotePausedUntil && v.remotePausedUntil > new Date()) ||
          !open ||
          !v.remoteHeartbeatAt ||
          Date.now() - v.remoteHeartbeatAt.getTime() > 60000
        )
          return fail(409, 'VENUE_UNAVAILABLE')
        const activeOrders = await remoteQueueCount(tx as unknown as Db, o.venueId)
        if (activeOrders >= v.remoteQueueLimit)
          return fail(409, 'VENUE_BUSY')
        await priced(o.venueId, o.lines, tx as unknown as Db)
        const [u] = await tx
          .select()
          .from(schema.userProfile)
          .where(eq(schema.userProfile.id, o.payerUserId!))
        if (input.asset === 'NIM') {
          if (!equalAddress(u.walletAddress, input.sender))
            return fail(409, 'PAYER_MISMATCH')
        } else {
          const [identity] = await tx
            .select()
            .from(schema.loyaltyEvmIdentity)
            .where(
              and(
                eq(schema.loyaltyEvmIdentity.userId, u.id),
                eq(
                  schema.loyaltyEvmIdentity.address,
                  input.sender.toLowerCase(),
                ),
                eq(schema.loyaltyEvmIdentity.network, env.nimiqNetwork),
              ),
            )
          if (!identity) return fail(409, 'LOYALTY_EVM_PROOF_REQUIRED')
        }
      }
      await validateLoyaltySender(
        tx as unknown as Db,
        o,
        input.asset,
        input.sender,
      )
      if (o.quoteHistory.length >= 20) return fail(409, 'QUOTE_REFRESH_LIMIT')
      const [v] = await tx
        .select()
        .from(schema.merchantVenue)
        .where(eq(schema.merchantVenue.id, o.venueId))
      const recipient =
        o.quote?.recipient ??
        (input.asset === 'NIM' ? v.nimAddress : v.usdtAddress)
      if (!recipient) return fail(409, 'ASSET_UNAVAILABLE')
      if (input.asset === 'USDT' && !/^0x[0-9a-fA-F]{40}$/.test(input.sender))
        return fail(400, 'VALIDATION')
      const [customerProfile] =
        o.source === 'REMOTE'
          ? await tx
              .select()
              .from(schema.userProfile)
              .where(eq(schema.userProfile.id, o.payerUserId!))
          : []
      const reference = `nimble-order:${o.id}:${o.revision}`
      let quote: MerchantQuote
      try {
        quote = await gateway().quote({
          asset: input.asset,
          fiatCurrency: o.fiatCurrency as any,
          totalMinor: o.totalMinor,
          sender: input.sender,
          recipient,
          reference,
        })
      } catch {
        return fail(503, 'PAYMENTS_UNAVAILABLE')
      }
      if (
        quote.asset !== input.asset ||
        !equalAddress(quote.sender, input.sender) ||
        !equalAddress(quote.recipient, recipient) ||
        quote.reference !== reference ||
        !/^\d+$/.test(quote.amountAtomic) ||
        BigInt(quote.amountAtomic) <= 0n ||
        !Number.isFinite(Date.parse(quote.expiresAt)) ||
        Date.parse(quote.expiresAt) <= Date.now() ||
        !Number.isFinite(Date.parse(quote.rateAt))
      )
        return fail(503, 'INVALID_QUOTE')
      await reserveOrderStock(tx as unknown as Db,o,quote.id,new Date(quote.expiresAt))
      const [updated] = await tx
        .update(schema.merchantOrder)
        .set({
          quote,
          quoteHistory: o.quote ? [...o.quoteHistory, o.quote] : o.quoteHistory,
          notificationAddress: customerProfile
            ? customerProfile.walletAddress
            : input.asset === 'NIM'
              ? input.sender
              : (input.nimAddress ?? o.notificationAddress),
        })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      return view(updated, tx as unknown as Db)
    })
  })
  app.post(`${base}/checkout/:checkoutToken/payment`, async (req) => {
    const input = z
      .object({
        revision,
        quoteId: z.string().min(1).max(128),
        hash: z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/),
      })
      .strict()
      .parse(req.body)
    const pending = await db.transaction(async (tx) => {
      const o = await publicOrder(
        params(req).checkoutToken,
        tx as unknown as Db,
        true,
        req,
      )
      return submitMerchantPaymentIntent(tx as unknown as Db,o,input)
    })
    if (!pending.payment)
      await reconcileMerchantPayment(db, gateway(), pending.id)
    return view(await publicOrder(params(req).checkoutToken, db, false, req))
  })
  app.post(`${base}/orders/:orderId/refund`, async (req) => {
    const a = await cashier(req)
    const input = z
      .object({ reason: z.string().trim().max(200).optional() })
      .strict()
      .parse(req.body ?? {})
    return db.transaction(async (tx) => {
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      if (o.source === 'REMOTE' && o.status === 'AWAITING_ACCEPTANCE')
        return fail(409, 'REMOTE_DECISION_REQUIRED')
      if (o.cashReceiptId) return fail(409, 'CASH_REFUND_NOT_AVAILABLE')
      if (!o.payment) return fail(409, 'NOT_PAID')
      const [existing] = await tx
        .select()
        .from(schema.merchantRefund)
        .where(eq(schema.merchantRefund.orderId, o.id))
      if (existing) return view(o, tx as unknown as Db)
      await tx
        .insert(schema.merchantRefund)
        .values({ orderId: o.id, reason: input.reason ?? null })
      const [updated] = await tx
        .update(schema.merchantOrder)
        .set({ status: 'REFUND_PENDING' })
        .where(eq(schema.merchantOrder.id, o.id))
        .returning()
      await loyaltyRefundRequested(tx as unknown as Db, o.id)
      return view(updated, tx as unknown as Db)
    })
  })
  app.post(`${base}/orders/:orderId/refund/approve`, async (req) => {
    const a = await actor(req)
    if (a.kind !== 'owner') return fail(403, 'FORBIDDEN')
    return db.transaction(async (tx) => {
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      const [r] = await tx
        .select()
        .from(schema.merchantRefund)
        .where(eq(schema.merchantRefund.orderId, o.id))
      if (!r || !o.payment || !o.quote) return fail(409, 'INVALID_STATE')
      if (
        r.status === 'CONFIRMED' ||
        r.pendingHash ||
        (r.status === 'APPROVED' &&
          r.quote &&
          Date.parse(r.quote.expiresAt) > Date.now())
      )
        return view(o, tx as unknown as Db)
      let quote: MerchantQuote = {
        ...o.quote,
        id: crypto.randomUUID(),
        amountAtomic: o.payment.amountAtomic,
        sender: o.payment.recipient,
        recipient: o.payment.sender,
        reference: `nimble-refund:${r.id}`,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60000).toISOString(),
      }
      const payments = gateway()
      if (payments.refreshRefundQuote) {
        let refreshed: MerchantQuote
        try {
          refreshed = await payments.refreshRefundQuote(quote)
        } catch {
          return fail(503, 'PAYMENTS_UNAVAILABLE')
        }
        if (
          refreshed.asset !== quote.asset ||
          refreshed.network !== quote.network ||
          refreshed.amountAtomic !== quote.amountAtomic ||
          !equalAddress(refreshed.sender, quote.sender) ||
          !equalAddress(refreshed.recipient, quote.recipient) ||
          refreshed.reference !== quote.reference ||
          refreshed.tokenAddress !== quote.tokenAddress ||
          !Number.isFinite(Date.parse(refreshed.expiresAt)) ||
          Date.parse(refreshed.expiresAt) <= Date.now()
        )
          return fail(503, 'INVALID_QUOTE')
        quote = refreshed
      }
      await tx
        .update(schema.merchantRefund)
        .set({
          status: 'APPROVED',
          quote,
          quoteHistory: r.quote ? [...r.quoteHistory, r.quote] : r.quoteHistory,
        })
        .where(eq(schema.merchantRefund.id, r.id))
      return view(o, tx as unknown as Db)
    })
  })
  app.post(`${base}/orders/:orderId/refund/payment`, async (req) => {
    const a = await actor(req)
    if (a.kind !== 'owner') return fail(403, 'FORBIDDEN')
    const input = z
      .object({
        hash: z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/),
        quoteId: z.string().min(1).max(128).optional(),
      })
      .strict()
      .parse(req.body)
    const o = await db.transaction(async (tx) => {
      const o = await orderFor(
        a,
        params(req).orderId,
        tx as unknown as Db,
        true,
      )
      const [r] = await tx
        .select()
        .from(schema.merchantRefund)
        .where(eq(schema.merchantRefund.orderId, o.id))
      if (!r || !r.quote || !['APPROVED', 'CONFIRMED'].includes(r.status))
        return fail(409, 'INVALID_STATE')
      const selectedQuote = input.quoteId
        ? [r.quote, ...r.quoteHistory].find((q) => q?.id === input.quoteId)
        : r.quote
      if (!selectedQuote) return fail(409, 'STALE_QUOTE')
      if (r.status !== 'CONFIRMED') {
        await submitAttempt(tx as unknown as Db, {
          orderId: o.id,
          purpose: 'REFUND',
          hash: input.hash.toLowerCase(),
          quoteId: selectedQuote.id,
          quote: selectedQuote,
        })
      }
      if (r.status !== 'CONFIRMED' && !r.pendingHash)
        await tx
          .update(schema.merchantRefund)
          .set({ pendingHash: input.hash.toLowerCase(), quote: selectedQuote })
          .where(eq(schema.merchantRefund.id, r.id))
      return o
    })
    await reconcileMerchantRefund(db, gateway(), o.id)
    return view(await orderFor(a, o.id))
  })
  await menuScheduleRoutes(app, { actor, permittedVenue, audit, fail })
  await menuImageRoutes(app, { permittedVenue })
  await menuRoutes(app, { actor, permittedVenue, audit, protectLoyaltyProduct, fail })
  await readinessRoutes(app, { actor, venueFor, audit })
  await orderContextRoutes(app, { actor, venueFor, audit })
  await discountRoutes(app, { actor, venueFor, audit })
  await depositResolutionRoutes(app, { actor, venueFor, audit })
  await walletDiscoveryRoutes(app, { actor, venueFor, audit })
  await workTimeRoutes(app, { actor, venueFor, audit })
  await handoverRoutes(app, { actor, venueFor, audit })
  await dayCloseRoutes(app, { actor, venueFor, audit })
  await financeRoutes(app, { actor, venueFor, audit })
  await cashRefundRoutes(app, {freshActor:uncachedActor,venueFor,audit})
  await recipeRoutes(app, { actor, venueFor, audit })
  await productionRoutes(app, { actor, venueFor, audit })
  await stockMenuRoutes(app, { actor, venueFor, audit })
  await operationRoutes(app, { actor, venueFor, audit })
  await inventoryRoutes(app, { actor, venueFor, audit })
  await taskRoutes(app, { actor, venueFor, audit, evidenceCheck: ensureTaskEvidence })
  await scheduleRoutes(app, { actor, venueFor, audit })
  await taskPhotoRoutes(app, { actor, venueFor, audit })
  await remoteRoutes(app, { actor, venueFor, view })
  await loyaltyRoutes(app, { actor, venueFor, publicOrder })
}
