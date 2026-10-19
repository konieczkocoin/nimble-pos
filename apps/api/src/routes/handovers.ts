import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HandoverActor, ShiftHandover } from '@nimble/shared';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import { type MerchantTaskHelpers, type MerchantActor, taskActorKey } from './tasks';
import { loyaltyFail as fail } from '../services/loyalty';
const uuid=z.string().uuid();
const who=(a:MerchantActor):HandoverActor=>({kind:a.kind,id:a.kind==='owner'?a.userId:a.employeeId,name:a.kind==='owner'?'Owner':a.name??'Employee'});
const view=(r:typeof s.merchantHandover.$inferSelect):ShiftHandover=>({...r,status:r.status as ShiftHandover['status'],createdAt:r.createdAt.toISOString(),acknowledgedAt:r.acknowledgedAt?.toISOString()??null});
export async function handoverRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/handovers';
 async function context(req:FastifyRequest){const a=await h.actor(req),p=req.params as Record<string,string>,venueId=uuid.parse(p.venueId);await h.venueFor(a,venueId);return {a,venueId,id:p.id?uuid.parse(p.id):null};}
 async function mutation(req:FastifyRequest,action:'create'|'ack'){
  const {a,venueId,id}=await context(req);
  const input=action==='create'?z.object({idempotencyKey:uuid,note:z.string().trim().min(3).max(2000),successorEmployeeId:uuid.nullable()}).strict().parse(req.body):z.object({idempotencyKey:uuid}).strict().parse(req.body);
  const actor=taskActorKey(a),hash=createHash('sha256').update(JSON.stringify({action,venueId,id,input})).digest('hex');
  return db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor+input.idempotencyKey}))`);
   const [retry]=await tx.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor,actor),eq(s.merchantTaskRequest.key,input.idempotencyKey)));
   if(retry){if(retry.requestHash!==hash)fail(409,'IDEMPOTENCY_CONFLICT');return retry.response;}
   let shiftId:string|null=null;
   if(a.kind==='cashier'){
    const [shift]=await tx.select().from(s.merchantShift).where(and(eq(s.merchantShift.venueId,venueId),eq(s.merchantShift.employeeId,a.employeeId),isNull(s.merchantShift.closedAt))).for('update');
    if(!shift)fail(409,'SHIFT_REQUIRED');shiftId=shift.id;
   }
   let result:ShiftHandover;
   if(action==='create'){
    const input=z.object({idempotencyKey:uuid,note:z.string().trim().min(3).max(2000),successorEmployeeId:uuid.nullable()}).strict().parse(req.body);
    if(input.successorEmployeeId){
     if(a.kind==='cashier'&&input.successorEmployeeId===a.employeeId)fail(400,'SELF_HANDOVER');
     const [employee]=await tx.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id,input.successorEmployeeId),eq(s.merchantEmployee.venueId,venueId),eq(s.merchantEmployee.active,true)));
     if(!employee)fail(400,'INVALID_EMPLOYEE');
    }
    if(shiftId){const [existing]=await tx.select().from(s.merchantHandover).where(eq(s.merchantHandover.shiftId,shiftId));if(existing)fail(409,'HANDOVER_EXISTS');}
    const orders=await tx.select({id:s.merchantOrder.id,number:s.merchantOrder.number,status:s.merchantOrder.status}).from(s.merchantOrder).where(and(eq(s.merchantOrder.venueId,venueId),inArray(s.merchantOrder.status,['AWAITING_PAYMENT','PAYMENT_PENDING','AWAITING_ACCEPTANCE','PREPARING','READY'])));
    const refunds=await tx.select({id:s.merchantRefund.id,orderId:s.merchantRefund.orderId,status:s.merchantRefund.status}).from(s.merchantRefund).innerJoin(s.merchantOrder,eq(s.merchantOrder.id,s.merchantRefund.orderId)).where(and(eq(s.merchantOrder.venueId,venueId),sql`${s.merchantRefund.status} <> 'CONFIRMED'`));
    refunds.push(...await tx.select({id:s.merchantCashRefund.id,orderId:s.merchantCashRefund.orderId,status:s.merchantCashRefund.status}).from(s.merchantCashRefund).where(and(eq(s.merchantCashRefund.venueId,venueId),eq(s.merchantCashRefund.status,'REQUESTED'))));
    const shortages=await tx.select({id:s.merchantInventoryItem.id,name:s.merchantInventoryItem.name,quantity:s.merchantInventoryItem.quantity,threshold:s.merchantInventoryItem.threshold}).from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId,venueId),eq(s.merchantInventoryItem.tracked,true),sql`${s.merchantInventoryItem.quantity} <= ${s.merchantInventoryItem.threshold}`));
    const tasks=(await tx.select().from(s.merchantTask).where(and(eq(s.merchantTask.venueId,venueId),sql`${s.merchantTask.status} NOT IN ('APPROVED','SKIPPED')`))).map(t=>({id:t.id,title:t.snapshot.title,status:t.status,assigneeEmployeeId:t.assigneeEmployeeId}));
    const now=new Date();
    const [r]=await tx.insert(s.merchantHandover).values({venueId,shiftId,status:'PENDING',createdBy:who(a),successorEmployeeId:input.successorEmployeeId,note:input.note,snapshot:{capturedAt:now.toISOString(),orders,refunds,shortages,tasks},createdAt:now}).returning();
    result=view(r);
   }else{
    const [r]=await tx.select().from(s.merchantHandover).where(and(eq(s.merchantHandover.id,id!),eq(s.merchantHandover.venueId,venueId))).for('update');
    if(!r)fail(404,'NOT_FOUND');
    if(r.status!=='PENDING')fail(409,'HANDOVER_ACKNOWLEDGED');
    if(r.createdBy.kind===a.kind&&r.createdBy.id===who(a).id)fail(409,'SELF_HANDOVER');
    if(r.successorEmployeeId&&(a.kind!=='cashier'||r.successorEmployeeId!==a.employeeId))fail(403,'HANDOVER_RECIPIENT_REQUIRED');
    const [updated]=await tx.update(s.merchantHandover).set({status:'ACKNOWLEDGED',acknowledgedBy:who(a),acknowledgedAt:new Date()}).where(eq(s.merchantHandover.id,r.id)).returning();
    result=view(updated);
   }
   await h.audit(tx as unknown as Db,a,venueId,'shift.handover.'+action,action==='create'?z.object({note:z.string()}).parse(req.body).note:'Explicit successor acknowledgement',null,result);
   await tx.insert(s.merchantTaskRequest).values({actor,key:input.idempotencyKey,requestHash:hash,response:result});
   return result;
  });
 }
 app.get(base,async req=>{const {venueId}=await context(req);const query=z.object({before:z.string().datetime().optional()}).strict().parse(req.query);const rows=await db.select().from(s.merchantHandover).where(and(eq(s.merchantHandover.venueId,venueId),query.before?sql`${s.merchantHandover.createdAt}<${new Date(query.before).toISOString()}`:undefined)).orderBy(desc(s.merchantHandover.createdAt),desc(s.merchantHandover.id)).limit(100);return {items:rows.map(view)};});
 app.post(base,req=>mutation(req,'create'));
 app.post(base+'/:id/acknowledge',req=>mutation(req,'ack'));
}
