import {z} from 'zod';
import type {MerchantFiat,MerchantOrder} from './merchant';
export const CashSaleInput=z.object({revision:z.number().int().min(1).max(2147483646),tenderedMinor:z.number().int().min(0).max(2147483647)}).strict();
export type CashReceipt={id:string;orderId:string;currency:MerchantFiat;dueMinor:number;tenderedMinor:number;changeMinor:number;recordedAt:string};
export type CashReceiptSummary=Omit<CashReceipt,'tenderedMinor'|'changeMinor'>;
export type CashSaleResult={order:MerchantOrder;cashReceipt:CashReceipt};
/** Decimal input to integer minor units without rounding or floating point arithmetic. */
export function parseCashAmount(value:string):number|null{
 const s=value.trim();if(s.length>32||!/^\d+(?:[.,]\d{1,2})?$/.test(s))return null;
 const [whole,fraction='']=s.replace(',','.').split('.');const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 return n<=2147483647n?Number(n):null;
}

export const CashRefundRequestInput=z.object({reason:z.string().trim().min(1).max(500)}).strict();
export const CashRefundConfirmInput=z.object({refundId:z.string().uuid(),cashHandedBack:z.literal(true)}).strict();
export type CashRefund={id:string;orderId:string;status:'REQUESTED'|'CONFIRMED';reason:string;amountMinor:number;currency:MerchantFiat;requestedAt:string;confirmedAt:string|null;payoutShiftId:null};
export type CashRefundSummary=Omit<CashRefund,'reason'>;
