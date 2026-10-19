import type {RecipeSnapshot} from './recipes'
import { MenuInformationInput, type MenuInformation } from './menuInformation'
import { z } from 'zod'
export type MerchantFiat = 'EUR' | 'PLN' | 'USD'
export type MerchantAsset = 'NIM' | 'USDT'
export type MerchantOrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_PENDING'
  | 'AWAITING_ACCEPTANCE'
  | 'PREPARING'
  | 'READY'
  | 'COLLECTED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
export interface MerchantStockBinding {
  itemId: string
  quantity: number
}
export interface MerchantVariant {
  requiresRecipeReplacement?: boolean
  recipeVersionId?: string
  recipeSnapshot?: RecipeSnapshot
  stockBindings?: MerchantStockBinding[]
  id: string
  name: string
  priceMinor: number
}
export interface MerchantComponent {
  productId: string
  variantId: string
  quantity: number
}
export interface MerchantChoiceGroup {
  id: string
  name: string
  min: number
  max: number
  extraIds: string[]
}
export interface MerchantExtra {
  recipeVersionId?: string
  recipeSnapshot?: RecipeSnapshot
  replacesBaseRecipe?: boolean
  stockBindings?: MerchantStockBinding[]
  component?: MerchantComponent
  id: string
  name: string
  priceMinor: number
  available: boolean
}
export interface MerchantProduct {
  imageId?: string
  information?: MenuInformation
  id: string
  name: string
  category: string
  available: boolean
  variants: MerchantVariant[]
  extras: MerchantExtra[]
  choiceGroups?: MerchantChoiceGroup[]
  components?: MerchantComponent[]
}
export interface MerchantVenue {
  id: string
  name: string
  fiatCurrency: MerchantFiat
  nimAddress: string
  usdtAddress: string | null
}
export const MerchantPermissionSchema = z.enum([
  'menu.manage', 'reports.view', 'inventory.manage', 'tasks.manage', 'schedule.manage',
  'photos.view', 'time.manage', 'discounts.apply', 'audit.view', 'inventory.costs',
])
export type MerchantPermission = z.infer<typeof MerchantPermissionSchema>
export const MERCHANT_PERMISSIONS = MerchantPermissionSchema.options
export interface MerchantAuditEntry {
  id: string
  venueId: string
  actorKind: 'owner' | 'cashier'
  actorId: string
  actorName: string
  action: string
  reason: string
  before: unknown
  after: unknown
  createdAt: string
}
export interface MerchantEmployee {
  id: string
  name: string
  active: boolean
  role?: 'CASHIER' | 'MANAGER'
  permissions?: MerchantPermission[]
}
export interface MerchantShift {
  id: string
  employeeId: string
  openedAt: string
  closedAt: string | null
}
export interface MerchantCartLine {
  productId: string
  variantId: string
  extraIds: string[]
  quantity: number
}
export interface MerchantOrderLine extends MerchantCartLine {
  /** Immutable requirements per one line unit; no live balances. */
  recipeSnapshots?: (RecipeSnapshot & {quantity:number})[]
  stockRequirements?: MerchantStockBinding[]
  /** Quantities are per one parent unit; apply the cart line quantity once. */
  components?: (MerchantComponent & { productName: string; variantName: string })[]
  choiceGroups?: { id: string; name: string; extraIds: string[] }[]
  productName: string
  category?: string
  variantName: string
  extras: {
    id: string
    name: string
    priceMinor: number
  }[]
  unitPriceMinor: number
  totalMinor: number
}
export interface MerchantQuote {
  id: string
  asset: MerchantAsset
  network: string
  amountAtomic: string
  recipient: string
  sender: string
  reference: string
  expiresAt: string
  issuedAt?: string
  rate: string
  rateAt: string
  rateSource: string
  tokenAddress?: string
  chainHeight?: number
}
export interface MerchantPayment {
  asset: MerchantAsset
  network: string
  amountAtomic: string
  sender: string
  recipient: string
  hash: string
  confirmedAt: string
}
export interface MerchantPaidSnapshot {
  revision: number
  lines: MerchantOrderLine[]
  totalMinor: number
}
export interface MerchantOrder {
  cashPaymentAvailable?:boolean
  paymentMethod?:'CASH'|'CRYPTO'
  cashReceipt?:import('./cash').CashReceiptSummary|null
  cashRefund?:import('./cash').CashRefundSummary|null
  discountMinor?: number
  stockReservation?: { status: 'NONE' | 'HELD' | 'EXPIRED' | 'RELEASED' | 'CONSUMED'; expiresAt: string | null }
  id: string
  venueId: string
  number: number
  revision: number
  status: MerchantOrderStatus
  fiatCurrency: MerchantFiat
  totalMinor: number
  lines: MerchantOrderLine[]
  shiftId: string | null
  employeeId: string | null
  source?: 'COUNTER' | 'REMOTE'
  acceptanceDeadline?: string | null
  decision?: 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT' | null
  decisionAt?: string | null
  decisionReason?: string | null
  preparationMinutes?: number | null
  venue?: import('./remote').RemoteVenue
  pickup?: { token: string; code: string } | null
  checkoutToken?: string
  pendingPaymentRevision?: number
  pendingPaymentHash?: string | null
  quote: MerchantQuote | null
  payment: MerchantPayment | null
  paidSnapshot?: MerchantPaidSnapshot | null
  refund: {
    id: string
    status: 'REQUESTED' | 'APPROVED' | 'CONFIRMED'
    reason: string | null
    pendingHash?: string | null
    quote: MerchantQuote | null
  } | null
  createdAt: string
}
export interface MerchantReport {
  orders: MerchantOrder[]
  totals: {
    ownerCashPayouts?:import('./finance').OwnerCashPayoutTotal[]
    cash?:import('./finance').CashReportTotal[]
    salesByPaymentMethod?:import('./finance').SalePaymentMethodTotal[]
    count: number
    paid: number
    refunded: number
    receivedMinor?: number
    pendingAcceptanceMinor?: number
    refundPendingMinor?: number
    grossMinor: number
    refundedMinor: number
    netMinor: number
    fiatCurrency: MerchantFiat
    assets: {
      NIM: string
      USDT: string
    }
  }
}
const minor = z.number().int().min(0).max(100000000)
const name = z.string().trim().min(1).max(80)
export const MerchantVenueInput = z
  .object({
    name,
    fiatCurrency: z.enum(['EUR', 'PLN', 'USD']),
    nimAddress: z.string().trim().min(10).max(100),
    usdtAddress: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .nullable()
      .optional(),
  })
  .strict()
const componentInput = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
}).strict()
const stockBindingsInput = z.array(z.object({
  itemId: z.string().uuid(), quantity: z.number().int().min(1).max(100),
}).strict()).max(20)
export const MerchantProductInput = z
  .object({
    information: MenuInformationInput.optional(),
    id: z.string().uuid().optional(),
    name,
    category: name,
    imageId: z.string().uuid().optional(),
    components: z.array(componentInput).max(20).optional(),
    choiceGroups: z.array(z.object({
      id: z.string().uuid(), name,
      min: z.number().int().min(0).max(20),
      max: z.number().int().min(1).max(20),
      extraIds: z.array(z.string().uuid()).min(1).max(20),
    }).strict()).max(10).optional(),
    available: z.boolean().default(true),
    variants: z
      .array(
        z.object({ id: z.string().uuid(), name, priceMinor: minor, recipeVersionId: z.string().uuid().optional(), stockBindings: stockBindingsInput.optional() }).strict(),
      )
      .min(1)
      .max(20),
    extras: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name,
            priceMinor: minor,
            recipeVersionId: z.string().uuid().optional(),
            replacesBaseRecipe: z.boolean().optional(),
            component: componentInput.optional(),
            stockBindings: stockBindingsInput.optional(),
            available: z.boolean().default(true),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict()
export const MerchantEmployeeInput = z
  .object({ name, pin: z.string().regex(/^\d{4,8}$/) })
  .strict()
export const MerchantOrderInput = z
  .object({
    lines: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            variantId: z.string().uuid(),
            extraIds: z.array(z.string().uuid()).max(20).default([]),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
export function priceMerchantCart(
  products: MerchantProduct[],
  lines: MerchantCartLine[],
): {
  lines: MerchantOrderLine[]
  totalMinor: number
} {
  validateMerchantStockBindings(products,true)
  const snapshots = lines.map((line) => {
    const product = products.find((p) => p.id === line.productId)
    const variant = product?.variants.find((v) => v.id === line.variantId)
    if (!product?.available || !variant) throw new Error('UNAVAILABLE_ITEM')
    if (new Set(line.extraIds).size !== line.extraIds.length)
      throw new Error('DUPLICATE_EXTRA')
    validateMerchantChoices(product, line.extraIds)
    const refs = [
      ...(product.components ?? []),
      ...product.extras.filter(e => line.extraIds.includes(e.id) && e.component)
        .map(e => e.component!),
    ]
    const components: NonNullable<MerchantOrderLine['components']> = []
    for (const ref of refs) {
      const target = products.find(p => p.id === ref.productId)
      const variant = target?.variants.find(v => v.id === ref.variantId)
      if (!target?.available || !variant || !merchantComponentTarget(target) || target.id === product.id)
        throw new Error('UNAVAILABLE_ITEM')
      const prior = components.find(c => c.productId === ref.productId && c.variantId === ref.variantId)
      if (prior) prior.quantity += ref.quantity
      else components.push({ ...ref, productName: target.name, variantName: variant.name })
    }
    const replacements=product.extras.filter(e=>line.extraIds.includes(e.id)&&e.replacesBaseRecipe);
    if(variant.requiresRecipeReplacement&&!replacements.length)throw new Error('INSUFFICIENT_STOCK');
    if(replacements.length>1 || replacements.length && (!variant.recipeSnapshot || !replacements[0].recipeSnapshot || components.length))throw new Error('INVALID_RECIPE_REPLACEMENT');
    const recipes: (RecipeSnapshot & {quantity:number})[] = [];
    if(variant.recipeSnapshot && !replacements.length)recipes.push({...variant.recipeSnapshot,quantity:1});
    for(const c of components){const child=products.find(p=>p.id===c.productId)!.variants.find(v=>v.id===c.variantId)!;if(child.recipeSnapshot)recipes.push({...child.recipeSnapshot,quantity:c.quantity})}
    for(const extra of product.extras.filter(e=>line.extraIds.includes(e.id)))if(extra.recipeSnapshot)recipes.push({...extra.recipeSnapshot,quantity:1});
    const stockRequirements = sumStockBindings([
      ...(!replacements.length ? variant.stockBindings ?? [] : []),
      ...components.flatMap(c => {
        const child = products.find(p => p.id === c.productId)!.variants.find(v => v.id === c.variantId)!
        return (child.stockBindings ?? []).map(b => ({ itemId: b.itemId, quantity: b.quantity * c.quantity }))
      }),
      ...product.extras.filter(e => line.extraIds.includes(e.id)).flatMap(e => e.stockBindings ?? []),
    ])
    const extras = line.extraIds.map((id) => {
      const extra = product.extras.find((e) => e.id === id)
      if (!extra?.available) throw new Error('UNAVAILABLE_ITEM')
      return { id, name: extra.name, priceMinor: extra.priceMinor }
    })
    const unitPriceMinor =
      variant.priceMinor + extras.reduce((n, e) => n + e.priceMinor, 0)
    return {
      productId: line.productId,
      variantId: line.variantId,
      extraIds: [...line.extraIds],
      quantity: line.quantity,
      ...(components.length ? { components } : {}),
      ...(stockRequirements.length ? { stockRequirements } : {}),
      ...(recipes.length ? {recipeSnapshots:recipes} : {}),
      ...(product.choiceGroups?.length ? {
        choiceGroups: product.choiceGroups.map(g => ({
          id: g.id, name: g.name, extraIds: g.extraIds.filter(id => line.extraIds.includes(id)),
        })),
      } : {}),
      productName: product.name,
      category: product.category,
      variantName: variant.name,
      extras,
      unitPriceMinor,
      totalMinor: unitPriceMinor * line.quantity,
    }
  })
  const totalMinor = snapshots.reduce((n, s) => n + s.totalMinor, 0)
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor <= 0 ||
    totalMinor > 100000000
  )
    throw new Error('INVALID_TOTAL')
  aggregateMerchantStockRequirements(snapshots)
  return { lines: snapshots, totalMinor }
}
export function canMerchantTransition(
  from: MerchantOrderStatus,
  to: MerchantOrderStatus,
): boolean {
  return (
    (from === 'PREPARING' && to === 'READY') ||
    (from === 'READY' && to === 'COLLECTED') ||
    (from === 'AWAITING_PAYMENT' && to === 'CANCELLED')
  )
}

/** Targets represent one concrete variant, without nested bundles or required choices. */
export function merchantComponentTarget(product: MerchantProduct): boolean {
  return merchantRewardProduct(product)
}
export function merchantRewardProduct(
  product: Pick<MerchantProduct, 'components' | 'extras' | 'choiceGroups'>,
): boolean {
  return !(product.components?.length || product.extras.some(e => e.component) ||
    product.choiceGroups?.some(g => g.min > 0))
}
/** Selection-only public seam; availability and references are checked by pricing. */
export function validateMerchantChoices(product: MerchantProduct, extraIds: string[]): void {
  for (const group of product.choiceGroups ?? []) {
    const count = group.extraIds.filter(id => extraIds.includes(id)).length
    if (count < group.min) throw new Error('CHOICE_REQUIRED')
    if (count > group.max) throw new Error('CHOICE_LIMIT')
  }
}
/** Validate references against the complete replacement catalog, never a single draft item. */
export function validateMerchantCatalog(products: MerchantProduct[]): void {
  validateMerchantStockBindings(products)
  const ids = products.flatMap(p => [p.id, ...p.variants.map(v => v.id),
    ...p.extras.map(e => e.id), ...(p.choiceGroups ?? []).map(g => g.id)])
  if (new Set(ids).size !== ids.length) throw new Error('VALIDATION')
  for (const product of products) {
    const grouped = new Set<string>()
    for (const group of product.choiceGroups ?? []) {
      if (group.min > group.max || group.max > group.extraIds.length ||
        new Set(group.extraIds).size !== group.extraIds.length)
        throw new Error('INVALID_CHOICE_GROUP')
      for (const id of group.extraIds) {
        if (grouped.has(id) || !product.extras.some(e => e.id === id))
          throw new Error('INVALID_CHOICE_GROUP')
        grouped.add(id)
      }
    }
    const refs = [...(product.components ?? []),
      ...product.extras.filter(e => e.component).map(e => e.component!)]
    for (const ref of refs) {
      const target = products.find(p => p.id === ref.productId)
      if (!target || target.id === product.id ||
        !target.variants.some(v => v.id === ref.variantId) || !merchantComponentTarget(target))
        throw new Error('INVALID_COMPONENT')
    }
  }
}

function sumStockBindings(bindings: MerchantStockBinding[]): MerchantStockBinding[] {
  const totals = new Map<string, number>()
  for (const binding of bindings) {
    const quantity = (totals.get(binding.itemId) ?? 0) + binding.quantity
    if (!binding.itemId || !Number.isInteger(binding.quantity) || binding.quantity <= 0 ||
        !Number.isSafeInteger(quantity) || quantity > 2147483647)
      throw new Error('INVALID_STOCK_BINDING')
    totals.set(binding.itemId, quantity)
  }
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }))
}
/** Order totals apply line quantity once; use only server-derived frozen lines. */
export function aggregateMerchantStockRequirements(lines: MerchantOrderLine[]): MerchantStockBinding[] {
  return sumStockBindings(lines.flatMap(line => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_STOCK_BINDING')
    return (line.stockRequirements ?? []).map(b => ({ itemId: b.itemId, quantity: b.quantity * line.quantity }))
  }))
}
function validateMerchantStockBindings(products: MerchantProduct[], resolved=false): void {
  for (const product of products) {
    for (const variant of product.variants) {
      if (product.components?.length && (variant.stockBindings?.length || variant.recipeVersionId)) throw new Error('INVALID_STOCK_BINDING')
    }
    for (const extra of product.extras) {
      if(extra.replacesBaseRecipe && (!extra.recipeVersionId || product.components?.length || product.variants.some(v=>!v.recipeVersionId)))throw new Error('INVALID_RECIPE_REPLACEMENT')
      if (extra.component && (extra.stockBindings?.length || extra.recipeVersionId)) throw new Error('INVALID_STOCK_BINDING')
    }
    for (const option of [...product.variants, ...product.extras]) {
      if(resolved && option.recipeVersionId && !option.recipeSnapshot)throw new Error('RECIPE_NOT_RESOLVED')
      if(option.recipeVersionId && option.stockBindings?.length && !option.recipeSnapshot)throw new Error('INVALID_STOCK_BINDING')
      const bindings = option.stockBindings ?? []
      if (bindings.length > 20 || new Set(bindings.map(b => b.itemId)).size !== bindings.length ||
          bindings.some(b => !Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > (option.recipeSnapshot ? 2147483647 : 100) || !b.itemId))
        throw new Error('INVALID_STOCK_BINDING')
    }
  }
}
