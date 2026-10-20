import {historyPurchases} from '../services/historyPurchases';
import {randomUUID} from 'node:crypto';
import {and,asc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {HistoryPurchaseQuery,PurchaseDraftInput,type PurchaseOrder,type PurchaseSuggestion,type InventorySupplier,type InventoryDelivery} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {inventoryItem,inventoryRetry} from '../services/inventory';
import {stockAvailabilityBatch} from '../services/stockReservations';
import {loyaltyFail as fail} from '../services/loyalty';
import {taskActorKey,type MerchantTaskHelpers} from './tasks';
export async function purchasingRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/inventory/purchases';
 async function context(req:FastifyRequest){const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);if(a.kind!=='owner'&&!a.permissions?.includes('inventory.manage'))fail(403,'FORBIDDEN');return {a,venueId}}
 async function supplier(store:Db,venueId:string,id:string){const [row]=await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'SUPPLIER')));if(!row)return fail(404,'SUPPLIER_NOT_FOUND');const value=row.data as InventorySupplier;if(!value.active)fail(409,'SUPPLIER_INACTIVE');return value}
 async function get(store:Db,venueId:string,id:string){const [row]=await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PURCHASE_ORDER'))).for('update');if(!row)return fail(404,'NOT_FOUND');return row.data as PurchaseOrder}
 app.get(base+'/history',async req=>{const {venueId}=await context(req);return historyPurchases(db,venueId,HistoryPurchaseQuery.parse(req.query))});
 app.get(base+'/suggestions',async req=>{
  const {venueId}=await context(req);
  return db.transaction(async tx=>{const store=tx as unknown as Db,items=await tx.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId,venueId),eq(s.merchantInventoryItem.tracked,true))).orderBy(asc(s.merchantInventoryItem.name),asc(s.merchantInventoryItem.id)),availability=await stockAvailabilityBatch(store,items);
   const deliveries=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'DELIVERY'))),incoming=new Map<string,number>();
   for(const row of deliveries){const d=row.data as InventoryDelivery;for(const l of d.lines)incoming.set(l.itemId,(incoming.get(l.itemId)??0)+Math.max(0,l.expectedQuantity-l.receivedQuantity))}
   const result:PurchaseSuggestion[]=items.map(i=>{const a=availability.get(i.id)!,targetQuantity=Math.min(2147483647,i.threshold+1),incomingQuantity=incoming.get(i.id)??0;return {itemId:i.id,name:i.name,unit:i.unit,physicalQuantity:i.quantity,reservedQuantity:a.reservedQuantity,pendingLossQuantity:a.pendingLossQuantity,availableQuantity:a.availableQuantity,threshold:i.threshold,targetQuantity,incomingQuantity,suggestedQuantity:Math.max(0,targetQuantity-a.availableQuantity-incomingQuantity)}}).filter(i=>i.availableQuantity<=i.threshold);
   return {items:result,at:new Date().toISOString(),method:'max(0, threshold + 1 - available - outstanding deliveries); available = physical - reservations - pending losses'};
  });
 });
 app.get(base,async req=>{const {venueId}=await context(req),{page}=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PURCHASE_ORDER'))).orderBy(asc(s.merchantStockOperation.createdAt),asc(s.merchantStockOperation.id)).offset(page*50).limit(51);return {items:rows.slice(0,50).map(r=>r.data as PurchaseOrder),hasMore:rows.length>50}});
 async function draft(req:FastifyRequest,edit=false){
  const {a,venueId}=await context(req),input=PurchaseDraftInput.parse(req.body),id=edit?z.string().uuid().parse((req.params as any).purchaseId):null;if(new Set(input.lines.map(l=>l.itemId)).size!==input.lines.length)fail(400,'DUPLICATE_ITEM');
  return db.transaction(async tx=>{const store=tx as unknown as Db;await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'purchase.draft',id,input},async()=>{
   const old=id?await get(store,venueId,id):null;if(old&&old.status!=='DRAFT')fail(409,'PURCHASE_ALREADY_APPROVED');if(old&&input.revision!==old.revision)fail(409,'REVISION_CONFLICT');const vendor=await supplier(store,venueId,input.supplierId),lines=[];
   for(const l of input.lines){const item=await inventoryItem(store,venueId,l.itemId);lines.push({itemId:item.id,name:item.name,unit:item.unit,quantity:l.quantity})}
   const now=new Date().toISOString(),value:PurchaseOrder={id:old?.id??randomUUID(),venueId,supplierId:vendor.id,supplierName:vendor.name,reference:input.reference,status:'DRAFT',revision:(old?.revision??0)+1,lines,reason:input.reason,createdAt:old?.createdAt??now,createdBy:old?.createdBy??taskActorKey(a),updatedAt:now,approvedAt:null,approvedBy:null,deliveryId:null};
   if(old)await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,value.id));else await tx.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'PURCHASE_ORDER',data:value});await h.audit(store,a,venueId,'inventory.purchase.draft',input.reason,old,value);return value;
  })});
 }
 app.post(base,req=>draft(req));app.post(base+'/:purchaseId/draft',req=>draft(req,true));
 app.post(base+'/:purchaseId/approve',async req=>{
  const {a,venueId}=await context(req),id=z.string().uuid().parse((req.params as any).purchaseId),input=z.object({revision:z.number().int().positive(),reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  return db.transaction(async tx=>{const store=tx as unknown as Db;await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'purchase.approve',id,input},async()=>{
   const value=await get(store,venueId,id);if(value.status!=='DRAFT')fail(409,'PURCHASE_ALREADY_APPROVED');if(value.revision!==input.revision)fail(409,'REVISION_CONFLICT');await supplier(store,venueId,value.supplierId);for(const line of value.lines)await inventoryItem(store,venueId,line.itemId);
   const [venue]=await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId));
   const delivery:InventoryDelivery={id:randomUUID(),venueId,supplierId:value.supplierId,reference:value.reference||`Purchase ${value.id}`,fiatCurrency:z.enum(['EUR','USD','PLN']).parse(venue.fiatCurrency),status:'OPEN',lines:value.lines.map(l=>({itemId:l.itemId,expectedQuantity:l.quantity,receivedQuantity:0})),receipts:[],createdAt:new Date().toISOString()};
   await tx.insert(s.merchantStockOperation).values({id:delivery.id,venueId,kind:'DELIVERY',data:delivery});const old={...value};Object.assign(value,{status:'APPROVED',revision:value.revision+1,deliveryId:delivery.id,approvedAt:delivery.createdAt,updatedAt:delivery.createdAt,approvedBy:taskActorKey(a)});await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,id));await h.audit(store,a,venueId,'inventory.purchase.approved',input.reason,old,value);return value;
  })});
 });
}
