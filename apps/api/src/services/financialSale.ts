import {isDeepStrictEqual} from 'node:util';
import {eq} from 'drizzle-orm';
import type {FinancialSaleSnapshot,MerchantFiat} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
/** Same transaction as acceptance and consumption; later refund decisions cannot erase the original sale. */
export async function recordFinancialSale(store:Db,orderId:string){
 const [order]=await store.select().from(s.merchantOrder).where(eq(s.merchantOrder.id,orderId));
 if(!order||(!order.payment&&!order.cashReceiptId)||!order.paymentSnapshot||order.paymentRequiresRefund||order.source==='REMOTE'&&order.decision!=='ACCEPTED')return fail(409,'SALE_ACCEPTANCE_REQUIRED');
 const [cash]=order.cashReceiptId?await store.select().from(s.merchantCashReceipt).where(eq(s.merchantCashReceipt.id,order.cashReceiptId)):[];
 if(order.cashReceiptId&&(!cash||order.paymentMethod!=='CASH'||!!order.payment||cash.orderId!==order.id||cash.venueId!==order.venueId||cash.employeeId!==order.employeeId||cash.shiftId!==order.shiftId||cash.currency!==order.fiatCurrency||cash.dueMinor!==order.paymentSnapshot.totalMinor||cash.orderRevision!==order.paymentSnapshot.revision||JSON.stringify(cash.paidSnapshot)!==JSON.stringify(order.paymentSnapshot)))return fail(409,'SALE_ACCEPTANCE_REQUIRED');
 const snapshot=order.paymentSnapshot,list=snapshot.lines.reduce((sum,l)=>sum+BigInt(l.totalMinor),0n),total=BigInt(snapshot.totalMinor);
 if(total<0n||list<total)return fail(409,'INVALID_SALE_SNAPSHOT');
 const data:FinancialSaleSnapshot={orderNumber:order.number,source:order.source as 'COUNTER'|'REMOTE',shiftId:order.shiftId,employeeId:order.employeeId,fiatCurrency:order.fiatCurrency as MerchantFiat,totalMinor:total.toString(),listMinor:list.toString(),discountMinor:(list-total).toString(),lines:snapshot.lines,paymentHash:order.payment?.hash??null,...(cash?{paymentMethod:'CASH' as const,cashReceiptId:cash.id}:{}),status:'RECORDED',provenance:'LIVE_ACCEPTANCE',timeBasis:order.source==='REMOTE'?'REMOTE_DECISION':'SERVER_ACCEPTANCE'};
 const [existing]=await store.select().from(s.merchantFinancialSale).where(eq(s.merchantFinancialSale.orderId,orderId));
 if(existing&&cash){if(existing.venueId!==order.venueId||!isDeepStrictEqual(existing.data,data))return fail(409,'SALE_SNAPSHOT_CONFLICT');return}
 await store.insert(s.merchantFinancialSale).values({orderId,venueId:order.venueId,occurredAt:cash?cash.recordedAt:order.source==='REMOTE'?order.decisionAt??new Date():new Date(),data}).onConflictDoNothing();
}
