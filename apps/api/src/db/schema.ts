import {
  type AnyPgColumn,
  bigint,
  check,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userProfile = pgTable('user_profile', {
  id: uuid('id').primaryKey().defaultRandom(),
  walletAddress: text('wallet_address').notNull().unique(),
  displayName: text('display_name'),
  verificationStatus: text('verification_status')
    .notNull()
    .default('unverified'),
  preferredFiat: text('preferred_fiat'),
  locale: text('locale'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // HMAC-SHA256 of the cashier PIN with env.codePepper, same construction as
  // payment_session.code_hash — never the PIN itself. NULL means the owner
  // has never set a lock PIN, which is also why the lock cannot be enabled.
  cashierPinHash: text('cashier_pin_hash'),
  // Lives on the profile, not the session: re-authenticating with the wallet
  // signature must not lift the lock, only the PIN does.
  cashierLocked: boolean('cashier_locked').notNull().default(false),
})

export const authSession = pgTable('auth_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => userProfile.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const paymentSession = pgTable(
  'payment_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantCheckoutToken: text('merchant_checkout_token'),
    payerUserId: uuid('payer_user_id')
      .notNull()
      .references(() => userProfile.id),
    receiverUserId: uuid('receiver_user_id').references(() => userProfile.id),
    codeHash: text('code_hash').notNull(),
    status: text('status').notNull().default('AVAILABLE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    chargeDeadlineAt: timestamp('charge_deadline_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('one_available_code_per_payer')
      .on(t.payerUserId)
      .where(sql`status = 'AVAILABLE'`),
    index('session_code_hash_idx').on(t.codeHash),
    index('session_status_idx').on(t.status),
  ],
)

// A vendor's working period. The daily report is bounded by it, so exactly one
// may be open per user — enforced here rather than in application code, the
// same way one_available_code_per_payer is.
export const shift = pgTable(
  'shift',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfile.id),
    operatorLabel: text('operator_label').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('one_open_shift_per_user')
      .on(t.userId)
      .where(sql`closed_at is null`),
    index('shift_user_idx').on(t.userId),
  ],
)

export const charge = pgTable('charge', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .unique()
    .references(() => paymentSession.id),
  version: integer('version').notNull().default(1),
  amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
  pricingCurrency: text('pricing_currency').notNull().default('NIM'),
  acceptedAssets: text('accepted_assets')
    .array()
    .notNull()
    .default(sql`ARRAY['NIM']`),
  selectedAsset: text('selected_asset').notNull().default('NIM'),
  recipientAddress: text('recipient_address').notNull(),
  reference: text('reference'),
  reconciliationToken: text('reconciliation_token').unique(),
  status: text('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Stamped at creation, never derived from timestamps later: a closed shift
  // has to report the same rows forever.
  shiftId: uuid('shift_id').references(() => shift.id),
  // The price the cashier typed, and the quote it was converted with.
  fiatAmountMinor: integer('fiat_amount_minor'),
  fiatCurrency: text('fiat_currency'),
  fxRate: text('fx_rate'),
  fxRateAt: timestamp('fx_rate_at', { withTimezone: true }),
  fxSource: text('fx_source'),
})

// A remote charge: the receiver bills a payer who isn't at the counter and
// shares the link. `id` is the public link token, so it MUST stay
// unguessable — defaultRandom() (uuid v4), never anything sequential.
//
// No shift_id here, deliberately: a request raised during one shift but paid
// after it closes would change a closed shift's contents, breaking "a closed
// shift reports the same rows forever". The shift stamp happens at payment
// time (when the resulting `charge` row is created), not at request time.
export const chargeRequest = pgTable(
  'charge_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiverUserId: uuid('receiver_user_id')
      .notNull()
      .references(() => userProfile.id),
    amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
    fiatAmountMinor: integer('fiat_amount_minor'),
    fiatCurrency: text('fiat_currency'),
    fxRate: text('fx_rate'),
    fxRateAt: timestamp('fx_rate_at', { withTimezone: true }),
    fxSource: text('fx_source'),
    reference: text('reference'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sessionId: uuid('session_id').references(() => paymentSession.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A request materializes at most one session: enforced by the database,
    // not application code, same pattern as one_open_shift_per_user.
    uniqueIndex('one_session_per_request')
      .on(t.sessionId)
      .where(sql`session_id is not null`),
  ],
)

export const chainTransaction = pgTable(
  'chain_transaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charge.id),
    network: text('network').notNull().default('nimiq'),
    asset: text('asset').notNull().default('NIM'),
    sender: text('sender').notNull(),
    recipient: text('recipient').notNull(),
    amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
    feeAtomic: bigint('fee_atomic', { mode: 'bigint' }),
    hash: text('hash').notNull(),
    status: text('status').notNull().default('SUBMITTED'),
    confirmations: integer('confirmations').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('tx_network_hash').on(t.network, t.hash)],
)

export const receipt = pgTable(
  'receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => chainTransaction.id),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => userProfile.id),
    role: text('role').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One receipt per (transaction, owner): overlapping monitor ticks race to
    // confirm the same transaction, and the loser's insert must fail cleanly
    // rather than leave a duplicate.
    uniqueIndex('receipt_tx_owner_idx').on(t.transactionId, t.ownerUserId),
  ],
)

export const sessionEvent = pgTable('session_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => paymentSession.id),
  eventType: text('event_type').notNull(),
  actorType: text('actor_type').notNull(),
  stateFrom: text('state_from'),
  stateTo: text('state_to'),
  safeMetadata: jsonb('safe_metadata'),
  occurredAt: timestamp('occurred_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  correlationId: text('correlation_id'),
})

export const idempotencyRecord = pgTable(
  'idempotency_record',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseCode: integer('response_code'),
    responseBody: jsonb('response_body'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('idem_scope_key').on(t.scope, t.key)],
)

export const authNonce = pgTable('auth_nonce', {
  nonce: text('nonce').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})

// A refund is a transfer from the vendor back to the customer, not a reversal
// of the original payment — the chain is append-only, so the original charge
// stays exactly as it was and a second, independent charge moves value the
// other way. That second charge rides the ordinary payment_session/charge
// machinery (vendor as payer, customer as receiver): the monitor, receipts,
// macro-block finality and on-chain reconciliation all already know how to
// carry a session to CONFIRMED, so a refund needs none of that duplicated.
// This table exists purely to record the link back to what it refunds —
// nothing here participates in settling the transfer itself.
export const refund = pgTable(
  'refund',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    originalChargeId: uuid('original_charge_id')
      .notNull()
      .references(() => charge.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => paymentSession.id),
    amountAtomic: bigint('amount_atomic', { mode: 'bigint' }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One refund per session: the session is the refund's own payment, so this
    // is really "a refund session settles at most one refund" — enforced here
    // rather than trusted to application code, same pattern as the other
    // one-per-X partial/unique indexes in this file.
    uniqueIndex('one_refund_per_session').on(t.sessionId),
  ],
)

export const claimAttempt = pgTable(
  'claim_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: text('subject_type').notNull(), // 'ip' | 'wallet'
    subjectHash: text('subject_hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('claim_attempt_subject_idx').on(
      t.subjectType,
      t.subjectHash,
      t.occurredAt,
    ),
  ],
)

// Merchant identities and receipts are independent of P2P sessions.
export const merchantVenue = pgTable('merchant_venue', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => userProfile.id),
  name: text('name').notNull(),
  fiatCurrency: text('fiat_currency').notNull(),
  nimAddress: text('nim_address').notNull(),
  usdtAddress: text('usdt_address'),
  remotePublished: boolean('remote_published').notNull().default(false),
  remoteAccepting: boolean('remote_accepting').notNull().default(false),
  remoteDescription: text('remote_description').notNull().default(''),
  remoteAddress: text('remote_address').notNull().default(''),
  remoteCity: text('remote_city').notNull().default(''),
  remotePickupInstructions: text('remote_pickup_instructions').notNull().default(''),
  remotePreparationMinutes: integer('remote_preparation_minutes').notNull().default(15),
  remoteQueueLimit: integer('remote_queue_limit').notNull().default(10),
  remotePausedUntil: timestamp('remote_paused_until', { withTimezone: true }),
  remoteHeartbeatAt: timestamp('remote_heartbeat_at', { withTimezone: true }),
  nextOrderNumber: integer('next_order_number').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const merchantProduct = pgTable('merchant_product', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => merchantVenue.id),
  catalog: jsonb('catalog')
    .$type<import('@nimble/shared').MerchantProduct>()
    .notNull(),
})
export const merchantEmployee = pgTable('merchant_employee', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id')
    .notNull()
    .references(() => merchantVenue.id),
  name: text('name').notNull(),
  pinHash: text('pin_hash').notNull(),
  role: text('role', { enum: ['CASHIER', 'MANAGER'] }).notNull().default('CASHIER'),
  permissions: jsonb('permissions').$type<import('@nimble/shared').MerchantPermission[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
})
export const merchantSchedule = pgTable('merchant_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  weekStart: date('week_start', { mode: 'string' }).notNull(),
  timeZone: text('time_zone').notNull(),
  version: integer('version').notNull(),
  requestKey: text('request_key').notNull(),
  status: text('status', { enum: ['DRAFT', 'PUBLISHED'] }).notNull().default('DRAFT'),
  coverageHours: jsonb('coverage_hours').$type<{ startsAt: string; endsAt: string; minimumWorkers?: number }[]>().notNull().default([]),
  createdByEmployeeId: uuid('created_by_employee_id').references(() => merchantEmployee.id),
  createdByOwnerId: uuid('created_by_owner_id').references(() => userProfile.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('merchant_schedule_version').on(t.venueId, t.weekStart, t.version),
  uniqueIndex('merchant_schedule_request').on(t.venueId, t.requestKey),
  index('merchant_schedule_current').on(t.venueId, t.weekStart, t.status),
])
export const merchantScheduleShift = pgTable('merchant_schedule_shift', {
  id: uuid('id').primaryKey().defaultRandom(),
  scheduleId: uuid('schedule_id').notNull().references(() => merchantSchedule.id, { onDelete: 'cascade' }),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  employeeId: uuid('employee_id').notNull().references(() => merchantEmployee.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  role: text('role').notNull(),
}, (t) => [index('merchant_schedule_shift_employee').on(t.venueId, t.employeeId, t.startsAt)])
export const merchantSubstitution = pgTable('merchant_substitution', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  scheduleId: uuid('schedule_id').notNull().references(() => merchantSchedule.id),
  scheduleShiftId: uuid('schedule_shift_id').notNull().references(() => merchantScheduleShift.id),
  requestedByEmployeeId: uuid('requested_by_employee_id').notNull().references(() => merchantEmployee.id),
  substituteEmployeeId: uuid('substitute_employee_id').notNull().references(() => merchantEmployee.id),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['PENDING', 'APPROVED', 'REJECTED'] }).notNull().default('PENDING'),
  reviewedByEmployeeId: uuid('reviewed_by_employee_id').references(() => merchantEmployee.id),
  reviewedByOwnerId: uuid('reviewed_by_owner_id').references(() => userProfile.id),
  newScheduleId: uuid('new_schedule_id').references(() => merchantSchedule.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
}, (t) => [
  index('merchant_substitution_inbox').on(t.venueId, t.status, t.createdAt),
])
export const merchantTerminal = pgTable(
  'merchant_terminal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => merchantVenue.id),
    tokenHash: text('token_hash').notNull().unique(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('merchant_one_terminal')
      .on(t.venueId)
      .where(sql`revoked_at is null`),
  ],
)
export const merchantCashierSession = pgTable('merchant_cashier_session', {
  id: uuid('id').primaryKey().defaultRandom(),
  terminalId: uuid('terminal_id')
    .notNull()
    .references(() => merchantTerminal.id),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => merchantEmployee.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})
export const merchantPinAttempt = pgTable(
  'merchant_pin_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => merchantTerminal.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('merchant_pin_attempt_terminal').on(t.terminalId, t.occurredAt),
  ],
)
export const merchantShift = pgTable(
  'merchant_shift',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => merchantVenue.id),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => merchantEmployee.id),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reportSnapshot:
      jsonb('report_snapshot').$type<import('@nimble/shared').MerchantReport>(),
  },
  (t) => [
    uniqueIndex('merchant_one_open_shift')
      .on(t.employeeId)
      .where(sql`closed_at is null`),
  ],
)
export const merchantOrder = pgTable(
  'merchant_order',
  {
    paymentMethod:text('payment_method').$type<'CASH'|'CRYPTO'>(),
    cashReceiptId:uuid('cash_receipt_id').references(():AnyPgColumn=>merchantCashReceipt.id),
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => merchantVenue.id),
    employeeId: uuid('employee_id')
      .references(() => merchantEmployee.id),
    shiftId: uuid('shift_id')
      .references(() => merchantShift.id),
    number: integer('number').notNull(),
    source: text('source').notNull().default('COUNTER'),
    acceptanceDeadline: timestamp('acceptance_deadline', { withTimezone: true }),
    decision: text('decision'),
    decisionAt: timestamp('decision_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    preparationMinutes: integer('preparation_minutes'),
    pickupNonce: text('pickup_nonce'),
    pickupCode: text('pickup_code'),
    revision: integer('revision').notNull().default(1),
    status: text('status').notNull().default('AWAITING_PAYMENT'),
    fiatCurrency: text('fiat_currency').notNull(),
    totalMinor: integer('total_minor').notNull(),
    lines: jsonb('lines')
      .$type<import('@nimble/shared').MerchantOrderLine[]>()
      .notNull(),
    checkoutToken: text('checkout_token').notNull().unique(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    pendingPaymentHash: text('pending_payment_hash'),
    paymentSnapshot:
      jsonb('payment_snapshot').$type<
        import('@nimble/shared').MerchantPaidSnapshot
      >(),
    paymentRequiresRefund: boolean('payment_requires_refund')
      .notNull()
      .default(false),
    quoteHistory: jsonb('quote_history')
      .$type<import('@nimble/shared').MerchantQuote[]>()
      .notNull()
      .default([]),
    quote: jsonb('quote').$type<import('@nimble/shared').MerchantQuote>(),
    payment: jsonb('payment').$type<import('@nimble/shared').MerchantPayment>(),
    claimSessionId: uuid('claim_session_id')
      .unique()
      .references(() => paymentSession.id),
    notificationAddress: text('notification_address'),
    payerUserId: uuid('payer_user_id').references(() => userProfile.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('merchant_counter_staff_required',sql`source = 'REMOTE' or (source = 'COUNTER' and employee_id is not null and shift_id is not null)`),
    uniqueIndex('merchant_order_number').on(t.venueId, t.number),
    uniqueIndex('merchant_order_request').on(t.employeeId, t.requestKey),
    uniqueIndex('merchant_remote_request').on(t.payerUserId, t.requestKey).where(sql`source = 'REMOTE'`),
    uniqueIndex('merchant_remote_pickup_code').on(t.venueId, t.pickupCode).where(sql`source = 'REMOTE' and status in ('PREPARING','READY')`),
  ],
)
export const merchantOrderRevision = pgTable(
  'merchant_order_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => merchantOrder.id),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot')
      .$type<{
        lines: import('@nimble/shared').MerchantOrderLine[]
        totalMinor: number
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('merchant_revision_unique').on(t.orderId, t.revision)],
)
export const merchantRefund = pgTable('merchant_refund', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => merchantOrder.id),
  status: text('status').notNull().default('REQUESTED'),
  reason: text('reason'),
  pendingHash: text('pending_hash'),
  quoteHistory: jsonb('quote_history')
    .$type<import('@nimble/shared').MerchantQuote[]>()
    .notNull()
    .default([]),
  quote: jsonb('quote').$type<import('@nimble/shared').MerchantQuote>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const merchantVerifiedTransaction = pgTable(
  'merchant_verified_transaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => merchantOrder.id),
    purpose: text('purpose').$type<'PAYMENT' | 'REFUND'>().notNull(),
    network: text('network').notNull(),
    hash: text('hash').notNull(),
    receipt: jsonb('receipt')
      .$type<import('@nimble/shared').MerchantPayment>()
      .notNull(),
  },
  (t) => [
    uniqueIndex('merchant_network_hash').on(t.network, t.hash),
    uniqueIndex('merchant_order_purpose').on(t.orderId, t.purpose),
  ],
)
export const merchantNotificationOutbox = pgTable(
  'merchant_notification_outbox',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => merchantOrder.id),
    recipient: text('recipient').notNull(),
    network: text('network').notNull(),
    status: text('status').notNull().default('PENDING'),
    rawTransaction: text('raw_transaction'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    transactionHash: text('transaction_hash'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
)

/** Submitted hashes are immutable evidence, never an exclusive claim on an order. */
export const merchantTransferAttempt = pgTable(
  'merchant_transfer_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => merchantOrder.id),
    purpose: text('purpose').$type<'PAYMENT' | 'REFUND'>().notNull(),
    hash: text('hash').notNull(),
    quoteId: text('quote_id').notNull(),
    quote: jsonb('quote')
      .$type<import('@nimble/shared').MerchantQuote>()
      .notNull(),
    snapshot:
      jsonb('snapshot').$type<import('@nimble/shared').MerchantPaidSnapshot>(),
    requiresRefund: boolean('requires_refund').notNull().default(false),
    lastCheckedAt: timestamp('last_checked_at',{withTimezone:true}),
    verificationCode: text('verification_code'),
    checks: integer('checks').notNull().default(0),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('merchant_attempt_unique').on(
      t.orderId,
      t.purpose,
      t.hash,
      t.quoteId,
    ),
    index('merchant_attempt_due').on(t.orderId, t.purpose, t.nextCheckAt),
  ],
)

export const loyaltyProgram = pgTable(
  'loyalty_program',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => merchantVenue.id),
    network: text('network').notNull(),
    version: integer('version').notNull(),
    active: boolean('active').notNull().default(true),
    minimumMinor: integer('minimum_minor').notNull(),
    fiatCurrency: text('fiat_currency').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => merchantProduct.id),
    variantId: text('variant_id').notNull(),
    productName: text('product_name').notNull(),
    variantName: text('variant_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('loyalty_program_version').on(t.venueId, t.network, t.version),
  ],
)
export const loyaltyCard = pgTable(
  'loyalty_card',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => loyaltyProgram.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfile.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('loyalty_card_identity').on(t.programId, t.userId)],
)
export const loyaltyReward = pgTable('loyalty_reward', {
  stockRequirements: jsonb('stock_requirements').$type<import('@nimble/shared').MerchantStockBinding[]>(),
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id')
    .notNull()
    .references(() => loyaltyCard.id),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('RESERVED'),
  number: integer('number'),
  acceptedBy: uuid('accepted_by').references(() => merchantEmployee.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const loyaltyLedger = pgTable('loyalty_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  cardId: uuid('card_id')
    .notNull()
    .references(() => loyaltyCard.id),
  kind: text('kind').notNull(),
  delta: integer('delta').notNull(),
  eventKey: text('event_key').notNull().unique(),
  orderId: uuid('order_id').references(() => merchantOrder.id),
  rewardId: uuid('reward_id').references(() => loyaltyReward.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
export const loyaltyCheckout = pgTable(
  'loyalty_checkout',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => merchantOrder.id),
    revision: integer('revision').notNull(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => loyaltyCard.id),
  },
  (t) => [uniqueIndex('loyalty_checkout_revision').on(t.orderId, t.revision)],
)
export const loyaltyEvmChallenge = pgTable('loyalty_evm_challenge', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => userProfile.id),
  address: text('address').notNull(),
  message: text('message').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
})
export const loyaltyEvmIdentity = pgTable(
  'loyalty_evm_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfile.id),
    network: text('network').notNull(),
    address: text('address').notNull(),
  },
  (t) => [uniqueIndex('loyalty_evm_identity_address').on(t.network, t.address)],
)
export const loyaltyRequest = pgTable(
  'loyalty_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: jsonb('response').notNull(),
  },
  (t) => [uniqueIndex('loyalty_request_actor_key').on(t.actor, t.key)],
)

export const merchantAudit = pgTable('merchant_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  actorKind: text('actor_kind', { enum: ['owner', 'cashier'] }).notNull(),
  actorId: uuid('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('merchant_audit_venue_time').on(t.venueId, t.createdAt)])

export const merchantTaskTemplate = pgTable('merchant_task_template', {
  // NULL retains the first activation's same-day behavior. Re-enabling starts a new scheduling window.
  scheduleFrom: timestamp('schedule_from', { withTimezone: true }),
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  version: integer('version').notNull().default(1),
  revision: integer('revision').notNull().default(1),
  config: jsonb('config').$type<import('@nimble/shared').TaskTemplateInput>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const merchantTask = pgTable('merchant_task', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  templateId: uuid('template_id').notNull().references(() => merchantTaskTemplate.id),
  templateVersion: integer('template_version').notNull(),
  occurrence: text('occurrence').notNull(),
  snapshot: jsonb('snapshot').$type<import('@nimble/shared').TaskTemplateInput>().notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  status: text('status').$type<import('@nimble/shared').TaskStatus>().notNull().default('TODO'),
  revision: integer('revision').notNull().default(1),
  assigneeEmployeeId: uuid('assignee_employee_id').references(() => merchantEmployee.id),
  reviewerEmployeeId: uuid('reviewer_employee_id').references(() => merchantEmployee.id),
  submissionNumber: integer('submission_number').notNull().default(0),
  submissionComment: text('submission_comment'),
  reviewComment: text('review_comment'),
  completedBy: text('completed_by'),
  ownerDeclared: boolean('owner_declared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('merchant_task_occurrence').on(t.templateId, t.occurrence), index('merchant_task_venue').on(t.venueId, t.dueAt)])
export const merchantTaskRequest = pgTable('merchant_task_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(), key: uuid('key').notNull(),
  requestHash: text('request_hash').notNull(), response: jsonb('response').notNull(),
}, t => [uniqueIndex('merchant_task_request_identity').on(t.actor, t.key)])

export const merchantTaskPhoto = pgTable('merchant_task_photo', {
 id: uuid('id').primaryKey().defaultRandom(),
 venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
 taskId: uuid('task_id').notNull().references(() => merchantTask.id),
 author: text('author').notNull(),
 submissionNumber: integer('submission_number').notNull(),
 phase: text('phase').$type<'BEFORE'|'AFTER'>().notNull(),
 source: text('source').$type<'CAMERA'|'IMPORT'>().notNull(),
 idempotencyKey: uuid('idempotency_key').notNull(),
 requestHash: text('request_hash').notNull(),
 storageKey: uuid('storage_key').notNull(),
 bytes: integer('bytes').notNull(),
 createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow(),
 expiresAt: timestamp('expires_at', {withTimezone:true}).notNull(),
},t=>[uniqueIndex('merchant_task_photo_retry').on(t.taskId,t.idempotencyKey),index('merchant_task_photo_task').on(t.taskId,t.submissionNumber)])

export const merchantInventoryItem = pgTable('merchant_inventory_item', {
 id: uuid('id').primaryKey().defaultRandom(), venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),
 barcode:text('barcode'), name:text('name').notNull(), unit:text('unit').$type<'PIECE'|'PORTION'|'MILLIGRAM'|'MILLILITRE'>().notNull(), available:boolean('available').notNull().default(true), tracked:boolean('tracked').notNull(),
 quantity:integer('quantity').notNull(),threshold:integer('threshold').notNull(),revision:integer('revision').notNull().default(1),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[check('merchant_inventory_nonnegative',sql`${t.quantity} >= 0 AND ${t.threshold} >= 0`),check('merchant_inventory_unit',sql`${t.unit} IN ('PIECE','PORTION','MILLIGRAM','MILLILITRE')`),check('merchant_inventory_revision',sql`${t.revision} > 0`)])
export const merchantInventoryLot=pgTable('merchant_inventory_lot',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),itemId:uuid('item_id').notNull().references(()=>merchantInventoryItem.id),
 quantity:integer('quantity').notNull(),label:text('label').notNull().default(''),expiresAt:timestamp('expires_at',{withTimezone:true}),receivedAt:timestamp('received_at',{withTimezone:true}),source:text('source').notNull(),sourceId:uuid('source_id'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[check('merchant_inventory_lot_nonnegative',sql`${t.quantity} >= 0`),index('merchant_inventory_lot_item').on(t.itemId,t.expiresAt)])
export const merchantInventoryMovement=pgTable('merchant_inventory_movement',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),itemId:uuid('item_id').notNull().references(()=>merchantInventoryItem.id),
 lotAllocations:jsonb('lot_allocations').$type<import('@nimble/shared').LotDelta[]>().notNull().default([]),delta:integer('delta').notNull(),kind:text('kind').$type<'OPENING'|'ADJUSTMENT'|'REVERSAL'|'RECEIPT'|'RECEIPT_CORRECTION'|'STOCKTAKE'|'LOSS'|'SALE'|'PRODUCTION'|'PRODUCTION_REVERSAL'>().notNull(),reason:text('reason').notNull(),
 actorKind:text('actor_kind').$type<'owner'|'cashier'>().notNull(),actorId:uuid('actor_id').notNull(),actorName:text('actor_name').notNull(),
 reversesMovementId:uuid('reverses_movement_id'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_inventory_reversal').on(t.reversesMovementId),index('merchant_inventory_history').on(t.itemId,t.createdAt),index('merchant_inventory_movement_range').on(t.venueId,t.createdAt)])
export const merchantInventoryRequest=pgTable('merchant_inventory_request',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),actor:text('actor').notNull(),key:uuid('key').notNull(),requestHash:text('request_hash').notNull(),response:jsonb('response').notNull(),
},t=>[uniqueIndex('merchant_inventory_retry').on(t.venueId,t.actor,t.key)])

// Operational documents retain snapshots and receipt history; COST stores mutable per-item valuation under the item lock.
export const merchantStockOperation=pgTable('merchant_stock_operation',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),
 kind:text('kind').$type<'SUPPLIER'|'DELIVERY'|'STOCKTAKE'|'LOSS'|'SALE'|'DAY_CLOSE'|'RECIPE'|'COST'|'PRODUCTION'|'PURCHASE_ORDER'|'PRODUCTION_DRAFT'>().notNull(),data:jsonb('data').notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('merchant_stock_operations_venue').on(t.venueId,t.kind,t.createdAt)])
export const merchantInventoryPolicy=pgTable('merchant_inventory_policy',{
 venueId:uuid('venue_id').primaryKey().references(()=>merchantVenue.id),approvalThreshold:integer('approval_threshold').notNull().default(0),
},t=>[check('merchant_inventory_policy_nonnegative',sql`${t.approvalThreshold} >= 0`)])

export const merchantMenuState = pgTable('merchant_menu_state', {
 venueId:uuid('venue_id').primaryKey().references(()=>merchantVenue.id), publishedRevision:integer('published_revision').notNull().default(0), draftRevision:integer('draft_revision').notNull().default(0), draftBaseRevision:integer('draft_base_revision'), draftProducts:jsonb('draft_products').$type<import('@nimble/shared').MerchantProduct[]>(), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
})
export const merchantMenuVersion = pgTable('merchant_menu_version', {
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),revision:integer('revision').notNull(),products:jsonb('products').$type<import('@nimble/shared').MerchantProduct[]>().notNull(),reason:text('reason').notNull(),actor:text('actor').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_menu_revision').on(t.venueId,t.revision)])
export const merchantMenuRequest = pgTable('merchant_menu_request', {
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),actor:text('actor').notNull(),key:uuid('key').notNull(),requestHash:text('request_hash').notNull(),response:jsonb('response').$type<import('@nimble/shared').MenuWorkspace>().notNull(),
},t=>[uniqueIndex('merchant_menu_request_key').on(t.venueId,t.actor,t.key)])

export const merchantStockReservation = pgTable('merchant_stock_reservation', {
 id:uuid('id').primaryKey().defaultRandom(), orderId:uuid('order_id').notNull().references(()=>merchantOrder.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),actor:text('actor').notNull(),quoteId:text('quote_id').notNull(),revision:integer('revision').notNull(),
 requirements:jsonb('requirements').$type<import('@nimble/shared').MerchantStockBinding[]>().notNull(),status:text('status').$type<'HELD'|'RELEASED'|'CONSUMED'>().notNull().default('HELD'),expiresAt:timestamp('expires_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_stock_reservation_quote').on(t.orderId,t.quoteId),index('merchant_stock_reservation_venue').on(t.venueId,t.status)])

export const merchantOperation = pgTable('merchant_operation', {
 id:uuid('id').primaryKey().defaultRandom(), venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id), orderId:uuid('order_id').notNull().references(()=>merchantOrder.id), actorId:uuid('actor_id').notNull(), key:text('key').notNull(), action:text('action').notNull(), inputHash:text('input_hash').notNull(), reason:text('reason').notNull(), leaseToken:uuid('lease_token'), leaseUntil:timestamp('lease_until',{withTimezone:true}), result:jsonb('result').$type<import('@nimble/shared').OperationActionResult>(), createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
}, t=>[uniqueIndex('merchant_operation_key').on(t.venueId,t.key),index('merchant_operation_order_time').on(t.orderId,t.createdAt)]);

export const merchantOrderContext=pgTable('merchant_order_context',{
 orderId:uuid('order_id').primaryKey().references(()=>merchantOrder.id),revision:integer('revision').notNull().default(0),priority:text('priority').$type<'NORMAL'|'HIGH'>().notNull().default('NORMAL'),delayReason:text('delay_reason'),
},t=>[check('merchant_order_context_revision',sql`${t.revision} >= 0`),check('merchant_order_context_priority',sql`${t.priority} in ('NORMAL','HIGH')`)])
export const merchantOrderContextEntry=pgTable('merchant_order_context_entry',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>merchantOrder.id),revision:integer('revision').notNull(),actor:text('actor').notNull(),key:uuid('key').notNull(),requestHash:text('request_hash').notNull(),response:jsonb('response').$type<import('@nimble/shared').OrderContextResult>().notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_order_context_retry').on(t.actor,t.key),uniqueIndex('merchant_order_context_sequence').on(t.orderId,t.revision),index('merchant_order_context_history').on(t.orderId,t.revision)])

export const merchantOrderReadiness = pgTable('merchant_order_readiness', {
 orderId:uuid('order_id').primaryKey().references(()=>merchantOrder.id), revision:integer('revision').notNull(), quantities:jsonb('quantities').$type<number[]>().notNull(),
})
export const merchantReadinessRequest = pgTable('merchant_readiness_request', {
 id:uuid('id').primaryKey().defaultRandom(),actor:text('actor').notNull(),key:text('key').notNull(),requestHash:text('request_hash').notNull(),orderId:uuid('order_id').notNull().references(()=>merchantOrder.id),response:jsonb('response').$type<import('@nimble/shared').OrderReadiness>().notNull(),
},t=>[uniqueIndex('merchant_readiness_request_actor_key').on(t.actor,t.key)])

export const merchantMenuSchedule = pgTable('merchant_menu_schedule', {
  venueId: uuid('venue_id').primaryKey().references(() => merchantVenue.id),
  revision: integer('revision').notNull().default(0),
  config: jsonb('config').$type<import('@nimble/shared').MenuSchedule>().notNull(),
})
export const merchantMenuScheduleRequest = pgTable('merchant_menu_schedule_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  actor: text('actor').notNull(),
  key: uuid('key').notNull(),
  requestHash: text('request_hash').notNull(),
  response: jsonb('response').$type<import('@nimble/shared').MenuScheduleView>().notNull(),
}, t => [uniqueIndex('menu_schedule_request_key').on(t.venueId,t.actor,t.key)])
export const merchantDiscountLimit = pgTable('merchant_discount_limit', {
 employeeId:uuid('employee_id').primaryKey().references(()=>merchantEmployee.id),
 venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),
 maxBasisPoints:integer('max_basis_points').notNull(), maxMinor:integer('max_minor').notNull(),
})
export const merchantDiscount = pgTable('merchant_discount', {
 orderId:uuid('order_id').primaryKey().references(()=>merchantOrder.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),orderRevision:integer('order_revision').notNull(),
 kind:text('kind').notNull(),value:integer('value').notNull(),amountMinor:integer('amount_minor').notNull(),reason:text('reason').notNull(),requestedBy:text('requested_by').notNull(),status:text('status').notNull(),approvedBy:text('approved_by'),approvedAt:timestamp('approved_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
})
export const merchantHandover = pgTable('merchant_handover', {
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),
 shiftId:uuid('shift_id').references(()=>merchantShift.id), status:text('status').notNull(),
 createdBy:jsonb('created_by').$type<import('@nimble/shared').HandoverActor>().notNull(),
 successorEmployeeId:uuid('successor_employee_id').references(()=>merchantEmployee.id),note:text('note').notNull(),
 snapshot:jsonb('snapshot').$type<import('@nimble/shared').ShiftHandover['snapshot']>().notNull(),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 acknowledgedBy:jsonb('acknowledged_by').$type<import('@nimble/shared').HandoverActor>(),acknowledgedAt:timestamp('acknowledged_at',{withTimezone:true}),
},t=>[index('merchant_handover_venue').on(t.venueId,t.createdAt),uniqueIndex('merchant_handover_shift').on(t.shiftId)])
/** Menu photographs use separate storage from private employee evidence. */
export const merchantMenuImage = pgTable('merchant_menu_image', {
  id: uuid('id').primaryKey().defaultRandom(),
  venueId: uuid('venue_id').notNull().references(() => merchantVenue.id),
  storageKey: text('storage_key').notNull(),
  bytes: integer('bytes').notNull(),
  requestKey: uuid('request_key').notNull(),
  requestHash: text('request_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('merchant_menu_image_request').on(t.venueId, t.requestKey)])

export const merchantWorkTime = pgTable('merchant_work_time', {
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),employeeId:uuid('employee_id').notNull().references(()=>merchantEmployee.id),startedAt:timestamp('started_at',{withTimezone:true}).notNull(),endedAt:timestamp('ended_at',{withTimezone:true}),status:text('status').$type<'WORKING'|'PAUSED'|'FINISHED'>().notNull(),breaks:jsonb('breaks').$type<import('@nimble/shared').WorkBreak[]>().notNull().default([]),revision:integer('revision').notNull().default(1),
}, t=>[index('merchant_work_time_history').on(t.venueId,t.employeeId,t.startedAt),uniqueIndex('merchant_work_time_active').on(t.employeeId).where(sql`${t.endedAt} IS NULL`)])
export const merchantWorkCorrection = pgTable('merchant_work_correction', {
 id:uuid('id').primaryKey().defaultRandom(),recordId:uuid('record_id').notNull().references(()=>merchantWorkTime.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),employeeId:uuid('employee_id').notNull().references(()=>merchantEmployee.id),status:text('status').$type<'PENDING'|'APPROVED'|'REJECTED'>().notNull().default('PENDING'),reason:text('reason').notNull(),previous:jsonb('previous').$type<import('@nimble/shared').WorkTimeRecord>().notNull(),proposed:jsonb('proposed').$type<import('@nimble/shared').WorkTimeCorrection['proposed']>().notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),reviewedAt:timestamp('reviewed_at',{withTimezone:true}),reviewReason:text('review_reason'),reviewer:text('reviewer'),
})

export const merchantWalletScan=pgTable('merchant_wallet_scan',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),asset:text('asset').$type<import('@nimble/shared').MerchantAsset>().notNull(),network:text('network').notNull(),recipient:text('recipient').notNull(),enabled:boolean('enabled').notNull().default(false),cursor:jsonb('cursor').$type<import('@nimble/shared').DiscoveryCursor>().notNull().default({}),coveredThrough:integer('covered_through'),leaseToken:uuid('lease_token'),leaseUntil:timestamp('lease_until',{withTimezone:true}),lastScannedAt:timestamp('last_scanned_at',{withTimezone:true}),lastError:text('last_error'),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_wallet_scan_asset').on(t.venueId,t.asset)])
export const merchantWalletObservation=pgTable('merchant_wallet_observation',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),eventKey:text('event_key').notNull(),event:jsonb('event').$type<import('@nimble/shared').WalletObservation>().notNull(),discoveredAt:timestamp('discovered_at',{withTimezone:true}).notNull().defaultNow(),checkedAt:timestamp('checked_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_wallet_event_key').on(t.venueId,t.eventKey),index('merchant_wallet_observed').on(t.venueId,t.discoveredAt)])

// One namespace for merchant payments, deposit liabilities and legacy transaction registration.
export const merchantTransferClaim=pgTable('merchant_transfer_claim',{
 network:text('network').notNull(),hash:text('hash').notNull(),eventIndex:integer('event_index').notNull().default(-1),kind:text('kind').notNull(),referenceId:uuid('reference_id').notNull(),venueId:uuid('venue_id').references(()=>merchantVenue.id),legacyChargeId:uuid('legacy_charge_id').references(()=>charge.id),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_transfer_claim_event').on(t.network,t.hash,t.eventIndex)])
export const merchantDepositResolution=pgTable('merchant_deposit_resolution',{
 id:uuid('id').primaryKey().defaultRandom(),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),observationId:uuid('observation_id').notNull().references(()=>merchantWalletObservation.id),data:jsonb('data').$type<import('@nimble/shared').DepositResolution>().notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('merchant_deposit_resolution_observation').on(t.observationId),index('merchant_deposit_resolution_venue').on(t.venueId,t.createdAt)])

export const merchantFinancialSale=pgTable('merchant_financial_sale',{
 orderId:uuid('order_id').primaryKey().references(()=>merchantOrder.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),occurredAt:timestamp('occurred_at',{withTimezone:true}),data:jsonb('data').$type<import('@nimble/shared').FinancialSaleSnapshot>().notNull(),recordedAt:timestamp('recorded_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('merchant_financial_sale_range').on(t.venueId,t.occurredAt)])

export const merchantInventoryValuation=pgTable('merchant_inventory_valuation',{
 movementId:uuid('movement_id').primaryKey().references(()=>merchantInventoryMovement.id),
 orderId:uuid('order_id').references(()=>merchantOrder.id),
 venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),
 data:jsonb('data').$type<import('@nimble/shared').InventoryMovementValuation>().notNull(),
},t=>[index('merchant_inventory_valuation_order').on(t.orderId)]);

export const merchantCashReceipt=pgTable('merchant_cash_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().unique().references(()=>merchantOrder.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),shiftId:uuid('shift_id').notNull().references(()=>merchantShift.id),employeeId:uuid('employee_id').notNull().references(()=>merchantEmployee.id),currency:text('currency').$type<'EUR'|'PLN'|'USD'>().notNull(),dueMinor:integer('due_minor').notNull(),tenderedMinor:integer('tendered_minor').notNull(),changeMinor:integer('change_minor').notNull(),orderRevision:integer('order_revision').notNull(),paidSnapshot:jsonb('paid_snapshot').$type<import('@nimble/shared').MerchantPaidSnapshot>().notNull(),requestKey:text('request_key').notNull(),requestHash:text('request_hash').notNull(),recordedAt:timestamp('recorded_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[check('merchant_cash_receipt_amounts',sql`${t.dueMinor}>=0 AND ${t.tenderedMinor}>=${t.dueMinor} AND ${t.changeMinor}=${t.tenderedMinor}-${t.dueMinor}`),check('merchant_cash_receipt_currency',sql`${t.currency} IN ('EUR','PLN','USD')`),index('merchant_cash_receipt_range').on(t.venueId,t.recordedAt)]);

export const merchantCashRefund=pgTable('merchant_cash_refund',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().unique().references(()=>merchantOrder.id),receiptId:uuid('receipt_id').notNull().unique().references(()=>merchantCashReceipt.id),venueId:uuid('venue_id').notNull().references(()=>merchantVenue.id),status:text('status').$type<'REQUESTED'|'CONFIRMED'>().notNull().default('REQUESTED'),reason:text('reason').notNull(),originalStatus:text('original_status').notNull(),requestedByKind:text('requested_by_kind').$type<'owner'|'cashier'>().notNull(),requestedById:uuid('requested_by_id').notNull(),requestedByName:text('requested_by_name').notNull(),requestedAt:timestamp('requested_at',{withTimezone:true}).notNull().defaultNow(),confirmedByOwnerId:uuid('confirmed_by_owner_id').references(()=>userProfile.id),confirmedAt:timestamp('confirmed_at',{withTimezone:true}),amountMinor:integer('amount_minor').notNull(),currency:text('currency').$type<'EUR'|'PLN'|'USD'>().notNull(),payoutShiftId:uuid('payout_shift_id').references(()=>merchantShift.id),
},t=>[check('merchant_cash_refund_state',sql`(${t.status}='REQUESTED' AND ${t.confirmedAt} IS NULL AND ${t.confirmedByOwnerId} IS NULL) OR (${t.status}='CONFIRMED' AND ${t.confirmedAt} IS NOT NULL AND ${t.confirmedByOwnerId} IS NOT NULL)`),check('merchant_cash_refund_values',sql`${t.amountMinor}>=0 AND ${t.currency} IN ('EUR','PLN','USD') AND length(${t.reason}) BETWEEN 1 AND 500 AND ${t.originalStatus} IN ('PREPARING','READY','COLLECTED') AND ${t.requestedByKind} IN ('owner','cashier') AND ${t.payoutShiftId} IS NULL`),index('merchant_cash_refund_range').on(t.venueId,t.confirmedAt)]);
