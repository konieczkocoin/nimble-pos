import {createHash} from 'node:crypto';
import {and,eq,isNull} from 'drizzle-orm';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {CashRefundRequestInput,CashRefundConfirmInput,type CashRefund} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from '../services/loyalty';
import {taskActorKey,type MerchantActor,type MerchantTaskHelpers} from './tasks';
type Helpers=Pick<MerchantTaskHelpers,'venueFor'|'audit'>&{freshActor:(req:FastifyRequest,store?:Db)=>Promise<MerchantActor>};
export const cashRefundView=(r:typeof s.merchantCashRefund.$inferSelect):CashRefund=>({id:r.id,orderId:r.orderId,status:r.status,reason:r.reason,amountMinor:r.amountMinor,currency:r.currency,requestedAt:r.requestedAt.toISOString(),confirmedAt:r.confirmedAt?.toISOString()??null,payoutShiftId:null});
export async function cashRefundRoutes(app:FastifyInstance,h:Helpers){
 const db=app.deps.db,base='/v1/merchant/orders/:orderId/cash/refund';
 async function orderFor(req:FastifyRequest,a:MerchantActor,store:Db,lock=false){
  const orderId=z.string().uuid().parse((req.params as {orderId:string}).orderId);
  const query=store.select().from(s.merchantOrder).where(eq(s.merchantOrder.id,orderId));
  const [o]=await (lock?query.for('update'):query);if(!o)return fail(404,'NOT_FOUND');
  await h.venueFor(a,o.venueId,false,store);return o;
 }
 app.get(base,async req=>{const a=await h.freshActor(req),o=await orderFor(req,a,db);const [r]=await db.select().from(s.merchantCashRefund).where(and(eq(s.merchantCashRefund.orderId,o.id),eq(s.merchantCashRefund.venueId,o.venueId)));if(!r)return fail(404,'NOT_FOUND');return cashRefundView(r)});
 for(const operation of ['request','confirm'] as const)app.post(base+'/'+operation,async req=>{
  const input=operation==='request'?CashRefundRequestInput.parse(req.body):CashRefundConfirmInput.parse(req.body);
  const requestKey=req.headers['idempotency-key'];if(typeof requestKey!=='string'||requestKey.length<1||requestKey.length>128)return fail(400,'IDEMPOTENCY_KEY_REQUIRED');
  const initial=await h.freshActor(req),before=await orderFor(req,initial,db);
  if(operation==='confirm'&&initial.kind!=='owner')return fail(403,'OWNER_REQUIRED');
  return db.transaction(async raw=>{
   const store=raw as unknown as Db;
   // Cashier requests share shift→order ordering with close/status/cash sale.
   const [shift]=initial.kind==='cashier'?await store.select().from(s.merchantShift).where(and(eq(s.merchantShift.venueId,initial.venueId),eq(s.merchantShift.employeeId,initial.employeeId),isNull(s.merchantShift.closedAt))).for('update'):[];
   const o=await orderFor(req,initial,store,true),a=await h.freshActor(req,store);
   if(taskActorKey(a)!==taskActorKey(initial))return fail(403,'FORBIDDEN');
   await h.venueFor(a,o.venueId,false,store);
   if(operation==='confirm'&&a.kind!=='owner')return fail(403,'OWNER_REQUIRED');
   const [receipt]=o.cashReceiptId?await store.select().from(s.merchantCashReceipt).where(and(eq(s.merchantCashReceipt.id,o.cashReceiptId),eq(s.merchantCashReceipt.orderId,o.id),eq(s.merchantCashReceipt.venueId,o.venueId))):[];
   if(!receipt||o.paymentMethod!=='CASH'||o.payment||o.source!=='COUNTER')return fail(409,'CASH_RECEIPT_REQUIRED');
   const [sale]=await store.select().from(s.merchantFinancialSale).where(and(eq(s.merchantFinancialSale.orderId,o.id),eq(s.merchantFinancialSale.venueId,o.venueId)));
   if(!sale||sale.data.status!=='RECORDED'||sale.data.paymentMethod!=='CASH'||sale.data.cashReceiptId!==receipt.id||sale.data.totalMinor!==String(receipt.dueMinor)||sale.data.fiatCurrency!==receipt.currency)return fail(409,'CASH_SALE_REQUIRED');
   const [existing]=await store.select().from(s.merchantCashRefund).where(eq(s.merchantCashRefund.orderId,o.id)).for('update');
   const actor=`cash-refund:${operation}:${before.id}:${taskActorKey(a)}`,requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const [old]=await store.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor,actor),eq(s.merchantTaskRequest.key,requestKey)));
   if(old&&old.requestHash!==requestHash)return fail(409,'IDEMPOTENCY_CONFLICT');
   if(existing&&(existing.receiptId!==receipt.id||existing.venueId!==o.venueId||existing.amountMinor!==receipt.dueMinor||existing.currency!==receipt.currency))return fail(409,'CASH_REFUND_CONFLICT');
   let result=existing;
   if(operation==='request'){
    if(!result){
     if(a.kind==='cashier'&&!shift)return fail(409,'SHIFT_REQUIRED');
     if(!['PREPARING','READY','COLLECTED'].includes(o.status))return fail(409,'INVALID_STATE');
     [result]=await store.insert(s.merchantCashRefund).values({orderId:o.id,receiptId:receipt.id,venueId:o.venueId,reason:(input as {reason:string}).reason,originalStatus:o.status,requestedByKind:a.kind,requestedById:a.kind==='owner'?a.userId:a.employeeId,requestedByName:a.kind==='owner'?'Owner':a.name??'Employee',amountMinor:receipt.dueMinor,currency:receipt.currency}).returning();
     await store.update(s.merchantOrder).set({status:'REFUND_PENDING'}).where(eq(s.merchantOrder.id,o.id));
     await h.audit(store,a,o.venueId,'order.cash.refund.requested',result.reason,null,cashRefundView(result));
    }
   }else{
    if(!result||result.id!==(input as {refundId:string}).refundId)return fail(409,'CASH_REFUND_NOT_FOUND');
    if(result.status==='REQUESTED'){
     if(o.status!=='REFUND_PENDING'||a.kind!=='owner')return fail(409,'INVALID_STATE');
     [result]=await store.update(s.merchantCashRefund).set({status:'CONFIRMED',confirmedAt:new Date(),confirmedByOwnerId:a.userId}).where(eq(s.merchantCashRefund.id,result.id)).returning();
     await store.update(s.merchantOrder).set({status:'REFUNDED'}).where(eq(s.merchantOrder.id,o.id));
     await h.audit(store,a,o.venueId,'order.cash.refund.confirmed','Owner confirms cash physically handed back',null,cashRefundView(result));
    }
   }
   if(!old)await store.insert(s.merchantTaskRequest).values({actor,key:requestKey,requestHash,response:{refundId:result.id}});
   return cashRefundView(result);
  });
 });
}
