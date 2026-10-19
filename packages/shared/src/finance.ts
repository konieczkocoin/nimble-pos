import type {MerchantOrderLine,MerchantAsset,MerchantFiat} from './merchant';
import {csvCell} from './purchasing';
export type FinancialSaleSnapshot={orderNumber:number;source:'COUNTER'|'REMOTE';shiftId:string|null;employeeId:string|null;fiatCurrency:MerchantFiat;totalMinor:string;listMinor:string|null;discountMinor:string|null;lines:MerchantOrderLine[];paymentHash:string|null;paymentMethod?:'CASH'|'CRYPTO';cashReceiptId?:string;status:'RECORDED'|'UNRESOLVED';provenance:'LIVE_ACCEPTANCE'|'LEGACY_STATE'|'LEGACY_CONSUMPTION'|'LEGACY_UNKNOWN';timeBasis:'SERVER_ACCEPTANCE'|'REMOTE_DECISION'|'PAYMENT_CONFIRMATION'|'UNKNOWN'};
export type FinanceEntryKind='SALE'|'CASH_PAYMENT'|'CASH_REFUND_CONFIRMED'|'CASH_REFUND_LIABILITY'|'PAYMENT'|'REFUND_SUBMITTED'|'REFUND_CONFIRMED'|'REFUND_LIABILITY'|'AWAITING_ACCEPTANCE'|'UNALLOCATED_DEPOSIT'|'UNKNOWN_SALE'|'UNKNOWN_DEPOSIT';
export type CashReportTotal={currency:MerchantFiat;receivedMinor:string;confirmedRefundsMinor:string;netMinor:string;refundLiabilityMinor:string};
export type SalePaymentMethodTotal={currency:MerchantFiat;paymentMethod:'CASH'|'CRYPTO'|null;salesMinor:string;count:number};
export const salePaymentMethod=(sale:FinancialSaleSnapshot):'CASH'|'CRYPTO'|null=>sale.paymentMethod??(sale.paymentHash?'CRYPTO':null);
export function salePaymentMethodTotals(sales:FinancialSaleSnapshot[]):SalePaymentMethodTotal[]{
 const groups=new Map<string,SalePaymentMethodTotal>();
 for(const sale of sales){if(sale.status!=='RECORDED')continue;const paymentMethod=salePaymentMethod(sale),key=sale.fiatCurrency+':'+paymentMethod,group=groups.get(key)??{currency:sale.fiatCurrency,paymentMethod,salesMinor:'0',count:0};group.salesMinor=(BigInt(group.salesMinor)+BigInt(sale.totalMinor)).toString();group.count++;groups.set(key,group)}
 return [...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||(a.paymentMethod??'UNKNOWN').localeCompare(b.paymentMethod??'UNKNOWN'));
}
type CashRefundFact={currency:MerchantFiat;amountMinor:number;status:'REQUESTED'|'CONFIRMED'};
export type OwnerCashPayoutTotal={currency:MerchantFiat;amountMinor:string};
export function ownerCashPayoutTotals(refunds:CashRefundFact[]):OwnerCashPayoutTotal[]{
 const groups=new Map<MerchantFiat,bigint>();for(const r of refunds)if(r.status==='CONFIRMED')groups.set(r.currency,(groups.get(r.currency)??0n)+BigInt(r.amountMinor));
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,n])=>({currency,amountMinor:n.toString()}));
}
/** Callers supply receipts/payouts in their event range, plus current requested liabilities. */
export function cashReceiptTotals(receipts:{currency:MerchantFiat;dueMinor:number}[],refunds:CashRefundFact[]=[]):CashReportTotal[]{
 const groups=new Map<MerchantFiat,{received:bigint;refunded:bigint;liability:bigint}>();
 const group=(currency:MerchantFiat)=>{let g=groups.get(currency);if(!g){g={received:0n,refunded:0n,liability:0n};groups.set(currency,g)}return g};
 for(const r of receipts)group(r.currency).received+=BigInt(r.dueMinor);
 for(const r of refunds){const g=group(r.currency);if(r.status==='CONFIRMED')g.refunded+=BigInt(r.amountMinor);else g.liability+=BigInt(r.amountMinor)}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([currency,g])=>({currency,receivedMinor:g.received.toString(),confirmedRefundsMinor:g.refunded.toString(),netMinor:(g.received-g.refunded).toString(),refundLiabilityMinor:g.liability.toString()}));
}
export type FinanceEntry={payoutShiftId?:string|null;paymentMethod?:'CASH'|'CRYPTO'|null;cashReceiptId?:string|null;scope:'RANGE'|'CURRENT';kind:FinanceEntryKind;at:string|null;orderId:string|null;sourceId:string;liabilityId:string|null;asset:MerchantAsset|null;network:string|null;fiatCurrency:MerchantFiat|null;amountAtomic:string|null;amountMinor:string|null;listMinor:string|null;discountMinor:string|null;hash:string|null;label:string};
export type FinanceReport={from:string;until:string;generatedAt:string;liabilitiesAsOf:string;reconciled:boolean;warnings:string[];unverifiedOrders:number;ownerCashPayouts?:OwnerCashPayoutTotal[];cash:CashReportTotal[];salesByPaymentMethod:SalePaymentMethodTotal[];fiat:{currency:MerchantFiat;listMinor:string|null;discountMinor:string|null;salesMinor:string;refundedSalesMinor:string;netSalesMinor:string}[];assets:{asset:MerchantAsset;network:string;receivedAtomic:string;submittedRefundsAtomic:string;confirmedRefundsAtomic:string;netCashAtomic:string;refundLiabilityAtomic:string;awaitingAcceptanceAtomic:string;unallocatedAtomic:string}[];entries:FinanceEntry[];coverage:{asset:string;network:string;recipient:string;enabled:boolean;lastScannedAt:string|null;coveredThrough:number|null}[]};
export function financeCsv(report:FinanceReport){
 const columns=['range_from','range_until_exclusive','snapshot_at','scope','kind','occurred_at','order_id','source_id','liability_id','asset','network','fiat_currency','amount_atomic','amount_minor','list_minor','discount_minor','hash','label','payment_method','cash_receipt_id'];
 return [columns,...report.entries.map(e=>[report.from,report.until,report.generatedAt,e.scope,e.kind,e.at,e.orderId,e.sourceId,e.liabilityId,e.asset,e.network,e.fiatCurrency,e.amountAtomic,e.amountMinor,e.listMinor,e.discountMinor,e.hash,e.label,e.paymentMethod,e.cashReceiptId])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
