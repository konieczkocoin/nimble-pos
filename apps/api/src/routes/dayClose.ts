import {createHash,randomUUID} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {foodOperationalDate,type DayClose,type DayCloseSnapshot} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {type MerchantTaskHelpers,taskActorKey} from './tasks';
import {inventoryRetry} from '../services/inventory';
import {loyaltyFail as fail} from '../services/loyalty';
const zone=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}});
const windowInput=z.object({timeZone:zone,boundaryHour:z.coerce.number().int().min(0).max(23),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
const reason=z.string().trim().min(3).max(2000);
export async function dayCloseRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/day-closes';
 async function context(req:FastifyRequest){
  const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);
  await h.venueFor(a,venueId);
  if(a.kind!=='owner'&&(!a.permissions?.includes('reports.view')||!a.permissions?.includes('tasks.manage')))fail(403,'FORBIDDEN');
  return {a,venueId};
 }
 function window(value:unknown){
  const v=windowInput.parse(value);
  const parsed=new Date(v.date+'T12:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v.date||v.date>foodOperationalDate(new Date(),v.timeZone,v.boundaryHour))fail(400,'INVALID_OPERATIONAL_DATE');
  return v;
 }
 // One SQL statement gives all components the same MVCC snapshot, including a concurrent payment.
 async function capture(store:Db,venueId:string,w:z.infer<typeof windowInput>){
  const rows=await store.execute(sql`with day_sales as (
    select f.data from merchant_financial_sale f where f.venue_id=${venueId} and f.data->>'status'='RECORDED'
    and ((f.occurred_at at time zone ${w.timeZone}) - ${w.boundaryHour}*interval '1 hour')::date=${w.date}::date
   ), method_sales as (
    select data->>'fiatCurrency' as currency,coalesce(data->>'paymentMethod',case when data->>'paymentHash' is not null then 'CRYPTO' end) as method,(data->>'totalMinor')::bigint as amount from day_sales
   ), cash_events as (
    select currency,due_minor::bigint as amount,'RECEIPT' as kind from merchant_cash_receipt where venue_id=${venueId} and ((recorded_at at time zone ${w.timeZone}) - ${w.boundaryHour}*interval '1 hour')::date=${w.date}::date
    union all select currency,amount_minor::bigint,'CONFIRMED' from merchant_cash_refund where venue_id=${venueId} and status='CONFIRMED' and ((confirmed_at at time zone ${w.timeZone}) - ${w.boundaryHour}*interval '1 hour')::date=${w.date}::date
    union all select currency,amount_minor::bigint,'REQUESTED' from merchant_cash_refund where venue_id=${venueId} and status='REQUESTED'
   ) select jsonb_build_object(
   'capturedAt',clock_timestamp(),
   'issues',coalesce((select jsonb_agg(issue order by issue->>'key') from (
    select jsonb_build_object('key','TASK:'||id,'kind','TASK','title',snapshot->>'title','status',status) as issue from merchant_task where venue_id=${venueId} and due_at<=now() and status not in ('APPROVED','SKIPPED')
    union all select jsonb_build_object('key','ORDER:'||id,'kind','ORDER','title','Order '||number,'status',status) from merchant_order where venue_id=${venueId} and status in ('AWAITING_PAYMENT','PAYMENT_PENDING','AWAITING_ACCEPTANCE','PREPARING','READY','REFUND_PENDING')
    union all select jsonb_build_object('key','REFUND:'||r.id,'kind','REFUND','title','Refund '||o.number,'status',r.status) from merchant_refund r join merchant_order o on o.id=r.order_id where o.venue_id=${venueId} and r.status<>'CONFIRMED'
    union all select jsonb_build_object('key','CASH_REFUND:'||r.id,'kind','REFUND','title','Cash refund '||o.number,'status',r.status) from merchant_cash_refund r join merchant_order o on o.id=r.order_id where r.venue_id=${venueId} and r.status='REQUESTED'
    union all select jsonb_build_object('key','STOCK:'||id,'kind','STOCK','title',kind,'status',data->>'status') from merchant_stock_operation where venue_id=${venueId} and ((kind='STOCKTAKE' and data->>'status'='OPEN') or (kind='LOSS' and data->>'status'='PENDING'))
    union all select jsonb_build_object('key','HANDOVER:'||id,'kind','HANDOVER','title','Shift handover','status',status) from merchant_handover where venue_id=${venueId} and status='PENDING'
   ) unresolved),'[]'::jsonb),
   'sales',coalesce((select jsonb_agg(totals order by totals->>'currency') from (
    select jsonb_build_object('currency',f.data->>'fiatCurrency','totalMinor',sum((f.data->>'totalMinor')::bigint)::text,'count',count(*)::int) as totals from day_sales f group by f.data->>'fiatCurrency'
   ) grouped),'[]'::jsonb),
   'salesByPaymentMethod',coalesce((select jsonb_agg(totals order by totals->>'currency',coalesce(totals->>'paymentMethod','UNKNOWN')) from (
    select jsonb_build_object('currency',currency,'paymentMethod',method,'salesMinor',sum(amount)::text,'count',count(*)::int) as totals from method_sales group by currency,method
   ) grouped),'[]'::jsonb),
   'cash',coalesce((select jsonb_agg(totals order by totals->>'currency') from (
    select jsonb_build_object('currency',currency,'receivedMinor',coalesce(sum(amount) filter(where kind='RECEIPT'),0)::text,'confirmedRefundsMinor',coalesce(sum(amount) filter(where kind='CONFIRMED'),0)::text,'netMinor',(coalesce(sum(amount) filter(where kind='RECEIPT'),0)-coalesce(sum(amount) filter(where kind='CONFIRMED'),0))::text,'refundLiabilityMinor',coalesce(sum(amount) filter(where kind='REQUESTED'),0)::text) as totals from cash_events group by currency
   ) grouped),'[]'::jsonb),
   'ownerCashPayouts',coalesce((select jsonb_agg(totals order by totals->>'currency') from (
    select jsonb_build_object('currency',currency,'amountMinor',sum(amount)::text) as totals from cash_events where kind='CONFIRMED' group by currency
   ) grouped),'[]'::jsonb)
  ) as snapshot`);
  const snapshot=rows[0].snapshot as DayCloseSnapshot;
  const fingerprint=createHash('sha256').update(JSON.stringify({issues:snapshot.issues,sales:snapshot.sales,cash:snapshot.cash,ownerCashPayouts:snapshot.ownerCashPayouts,salesByPaymentMethod:snapshot.salesByPaymentMethod})).digest('hex');
  return {...w,snapshot,fingerprint};
 }
 app.get(base+'/preview',async req=>{const {venueId}=await context(req);return capture(db,venueId,window(req.query))});
 app.get(base,async req=>{const {venueId}=await context(req);const {page}=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'DAY_CLOSE'))).orderBy(desc(s.merchantStockOperation.createdAt),desc(s.merchantStockOperation.id)).limit(51).offset(page*50);return {items:rows.slice(0,50).map(r=>r.data as DayClose),hasMore:rows.length>50}});
 app.post(base,async req=>{
  const {a,venueId}=await context(req);
  const input=windowInput.extend({note:reason,expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/),carry:z.array(z.object({key:z.string().max(100),reason})).max(10000),ownerExceptionReason:reason.optional(),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  const w=window({date:input.date,timeZone:input.timeZone,boundaryHour:input.boundaryHour});
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'day.close',input},async()=>{
    const previous=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'DAY_CLOSE'),sql`${s.merchantStockOperation.data}->>'date'=${w.date}`));
    if(previous.length)fail(409,'DAY_ALREADY_CLOSED');
    if(input.ownerExceptionReason&&a.kind!=='owner')fail(403,'FORBIDDEN');
    const preview=await capture(store,venueId,w);
    if(input.expectedFingerprint!==preview.fingerprint)fail(409,'DAY_PREVIEW_CHANGED');
    const keys=new Set(input.carry.map(c=>c.key));
    if(keys.size!==input.carry.length||input.carry.some(c=>!preview.snapshot.issues.some(i=>i.key===c.key)))fail(400,'INVALID_CARRY_FORWARD');
    if(!input.ownerExceptionReason&&preview.snapshot.issues.some(i=>!keys.has(i.key)))fail(409,'DAY_UNRESOLVED_ISSUES');
    const value:DayClose={...preview,id:randomUUID(),venueId,closedBy:taskActorKey(a),note:input.note,carry:input.carry,ownerExceptionReason:input.ownerExceptionReason??null};
    await tx.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'DAY_CLOSE',data:value});
    await h.audit(store,a,venueId,'day.closed',input.note,null,value);
    return value;
   });
  });
 });
}
