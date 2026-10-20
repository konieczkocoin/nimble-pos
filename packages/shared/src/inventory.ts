import {InventoryLotMetadata,type LotDelta,type LotQuantity} from './inventoryLots';
import { z } from "zod";
const quantity = z.number().int().min(0).max(2147483647);
const reason = z.string().trim().min(1).max(500);
export const InventoryCreateInput = z.object({ name: z.string().trim().min(1).max(120), unit: z.enum(["PIECE", "PORTION", "MILLIGRAM", "MILLILITRE"]), tracked: z.boolean(), available: z.boolean().optional(), barcode: z.string().trim().min(1).max(100).nullable().optional(), openingQuantity: quantity, threshold: quantity, reason, idempotencyKey: z.string().uuid() });
export const InventoryPatchInput = z.object({ name: z.string().trim().min(1).max(120), tracked: z.boolean(), available: z.boolean().optional(), barcode: z.string().trim().min(1).max(100).nullable().optional(), threshold: quantity, revision: z.number().int().positive(), reason });
export const InventoryMovementInput = z.object({ delta: z.number().int().min(-2147483647).max(2147483647).refine(n => n !== 0), revision: z.number().int().positive(), reason, idempotencyKey: z.string().uuid() });
export const InventoryReverseInput = InventoryMovementInput.omit({ delta: true });
export type InventoryCreateInput = z.infer<typeof InventoryCreateInput>;
export type InventoryPatchInput = z.infer<typeof InventoryPatchInput>;
export type InventoryMovementInput = z.infer<typeof InventoryMovementInput>;
export type InventoryReverseInput = z.infer<typeof InventoryReverseInput>;
export interface InventoryItem {
    id: string;
    venueId: string;
    name: string;
    unit: "PIECE" | "PORTION" | "MILLIGRAM" | "MILLILITRE";
    tracked: boolean;
    available?: boolean;
    barcode: string | null;
    quantity: number;
    reservedQuantity?: number;
    pendingLossQuantity?: number;
    availableQuantity?: number;
    threshold: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
}
export interface InventoryMovement {
    lotAllocations?: LotDelta[];
    id: string;
    venueId: string;
    itemId: string;
    delta: number;
    kind: "OPENING" | "ADJUSTMENT" | "REVERSAL" | "RECEIPT" | "RECEIPT_CORRECTION" | "STOCKTAKE" | "LOSS" | "SALE" | "PRODUCTION" | "PRODUCTION_REVERSAL";
    reason: string;
    actorKind: "owner" | "cashier";
    actorId: string;
    actorName: string;
    reversesMovementId: string | null;
    reversedByMovementId: string | null;
    createdAt: string;
}
export interface InventoryMutation {
    item: InventoryItem;
    movement: InventoryMovement;
}
export interface InventorySupplier {
    id: string;
    venueId: string;
    name: string;
    active: boolean;
}
export interface InventoryDeliveryLine {
    itemId: string;
    expectedQuantity: number;
    receivedQuantity: number;
    unitCostMinor?: number | null;
    totalCostMinor?: number | null;
}
export interface InventoryReceiptLine {
    itemId: string;
    quantity: number;
    movementId: string;
    lotAllocations?: LotDelta[];
}
export interface InventoryReceipt {
    id: string;
    lines: InventoryReceiptLine[];
    reason: string;
    createdAt: string;
    reversed: boolean;
}
export interface InventoryDelivery {
    id: string;
    venueId: string;
    supplierId: string;
    reference: string;
    fiatCurrency: 'EUR' | 'USD' | 'PLN';
    status: 'OPEN' | 'PARTIAL' | 'RECEIVED';
    lines: InventoryDeliveryLine[];
    receipts: InventoryReceipt[];
    createdAt: string;
}
export interface InventoryStocktakeLine {
    itemId: string;
    expectedQuantity: number;
    baselineRevision: number;
    lots?: {lotId:string;label:string;quantity:number;expiresAt:string|null}[];
    countedLots?: {lotId:string;countedQuantity:number}[];
    reservedQuantity?: number;
    allocation?: { keep: number; disposal: number; donation: number; staffMeal: number };
    countedQuantity: number | null;
    difference: number | null;
    currentQuantity?: number;
    currentRevision?: number;
    interveningDelta?: number;
}
export interface InventoryStocktake {
    id: string;
    venueId: string;
    status: 'OPEN' | 'FINALIZED';
    lines: InventoryStocktakeLine[];
    createdAt: string;
    finalizedAt: string | null;
    foodDay?: { timeZone: string; boundaryHour: number; date: string };
}
export type InventoryLossReason = 'DAMAGED' | 'SPILLED' | 'EXPIRED' | 'STAFF_MEAL' | 'DONATION' | 'CORRECTION';
export interface InventoryLoss {
    id: string;
    venueId: string;
    itemId: string;
    quantity: number;
    reason: InventoryLossReason;
    comment: string;
    status: 'PENDING' | 'APPLIED' | 'REJECTED';
    lotAllocations?: LotQuantity[];
    foodStocktakeId?: string;
    evidenceTaskId?: string;
    disposalReview?: { decision: 'APPROVE' | 'REJECT'; reason: string; at: string; witnessEmployeeId: string | null };
    requestedBy: string;
    decidedBy: string | null;
    movementId: string | null;
    createdAt: string;
}
export interface InventoryLossPolicy {
    approvalThreshold: number;
}
const retryKey = z.string().uuid();
export const InventorySupplierInput = z.object({ name: z.string().trim().min(1).max(120), active: z.boolean().default(true), idempotencyKey: retryKey });
export const InventoryDeliveryInput = z.object({ supplierId: z.string().uuid(), reference: z.string().trim().max(120).default(''), lines: z.array(z.object({ itemId: z.string().uuid(), expectedQuantity: quantity.refine(n => n > 0), unitCostMinor: quantity.nullable().optional(), totalCostMinor: quantity.nullable().optional() }).refine(l=>l.unitCostMinor==null||l.totalCostMinor==null,{message:'Use unit cost or total cost, not both'})).min(1).max(100), idempotencyKey: retryKey });
export const InventoryReceiptInput = z.object({ lines: z.array(z.object({ itemId: z.string().uuid(), quantity: quantity.refine(n => n > 0), lot: InventoryLotMetadata.optional() })).min(1).max(100), reason, idempotencyKey: retryKey });
export const InventoryReceiptReverseInput = z.object({ reason, idempotencyKey: retryKey });
export const InventoryStocktakeInput = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(100), foodDay: z.object({ timeZone: z.string().refine(v => { try { new Intl.DateTimeFormat('en', {timeZone:v}); return true } catch { return false } }), boundaryHour: z.number().int().min(0).max(23) }).optional(), idempotencyKey: retryKey });
export const InventoryStocktakeFinalizeInput = z.object({ counts: z.array(z.object({ itemId: z.string().uuid(), countedQuantity: quantity, lotCounts:z.array(z.object({lotId:z.string().uuid(),countedQuantity:quantity})).max(1000).optional(), allocation: z.object({ keep: quantity, disposal: quantity, donation: quantity, staffMeal: quantity }).optional(), expectedRevision: z.number().int().positive().optional(), acknowledgeIntervening: z.boolean().optional() })).min(1).max(100), reason, idempotencyKey: retryKey });
export const InventoryLossInput = z.object({ lotId:z.string().uuid().optional(), itemId: z.string().uuid(), quantity: quantity.refine(n => n > 0), reason: z.enum(['DAMAGED', 'SPILLED', 'EXPIRED', 'STAFF_MEAL', 'DONATION', 'CORRECTION']), comment: reason, idempotencyKey: retryKey });
export const InventoryLossDecisionInput = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason, witnessEmployeeId: z.string().uuid().nullable().optional(), idempotencyKey: retryKey });
export const InventoryLossPolicyInput = z.object({ approvalThreshold: quantity, reason });

/** The operational date uses local calendar fields, so DST days need not be 24 hours. */
export function foodOperationalDate(now: Date, timeZone: string, boundaryHour: number): string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 return Number(part('hour'))<boundaryHour ? new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10) : date;
}

/** Exact signed value in fiat minor units, captured when stock physically moves. */
export interface InventoryMovementValuation {
    fiatCurrency: 'EUR' | 'USD' | 'PLN';
    unit: InventoryItem['unit'];
    method: 'WEIGHTED_AVERAGE' | 'SUPPLIED_COST' | 'REVERSAL';
    unitCost: {numerator:string;denominator:string} | null;
    totalCost: {numerator:string;denominator:string} | null;
}
export interface InventoryCostHistoryEntry {
    movementId:string;
    kind:InventoryMovement['kind'];
    delta:number;
    createdAt:string;
    valuation:InventoryMovementValuation | null;
}
