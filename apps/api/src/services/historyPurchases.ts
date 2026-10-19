import {and,asc,eq,gte,lt} from 'drizzle-orm';
import type {HistoryPurchaseReport,InventoryDelivery} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {stockAvailabilityBatch} from './stockReservations';
import {loyaltyFail as fail} from './loyalty';
const day=86400000,minimumSamples=3,minimumActiveDays=3,maxQuantity=2147483647n;
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
/** Projection of recorded physical issues, not an estimate of unobserved customer demand. */
export async function historyPurchaseSnapshot(store:Db,venueId:string,input:{from:string;until:string;horizonDays:number;includeLosses:boolean}):Promise<HistoryPurchaseReport>{
 const from=Date.parse(input.from),until=Date.parse(input.until),today=Math.floor(Date.now()/day)*day,windowDays=(until-from)/day;
 if(from%day||until%day||windowDays<3||windowDays>90||until>today)fail(400,'INVALID_HISTORY_RANGE');
  const items=await store.select().from(s.merchantInventoryItem).where(and(eq(s.merchantInventoryItem.venueId,venueId),eq(s.merchantInventoryItem.tracked,true))).orderBy(asc(s.merchantInventoryItem.name),asc(s.merchantInventoryItem.id)).limit(1001);
  const movements=await store.select().from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.venueId,venueId),gte(s.merchantInventoryMovement.createdAt,new Date(from)),lt(s.merchantInventoryMovement.createdAt,new Date(until)))).limit(50001);
  const deliveries=await store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'DELIVERY'))).limit(10001);
  if(items.length>1000||movements.length>50000||deliveries.length>10000)fail(400,'HISTORY_REPORT_TOO_LARGE');
  const availability=await stockAvailabilityBatch(store,items),incoming=new Map<string,bigint>();
  for(const row of deliveries){const d=row.data as InventoryDelivery;for(const l of d.lines){const remaining=BigInt(l.expectedQuantity)-BigInt(l.receivedQuantity);if(remaining>0n)incoming.set(l.itemId,(incoming.get(l.itemId)??0n)+remaining)}}
  const history=new Map<string,{usage:bigint;returned:bigint;loss:bigint;samples:number;days:Set<string>}>();
  for(const m of movements){let h=history.get(m.itemId);if(!h){h={usage:0n,returned:0n,loss:0n,samples:0,days:new Set()};history.set(m.itemId,h)}
   if((m.kind==='SALE'||m.kind==='PRODUCTION')&&m.delta<0){h.usage-=BigInt(m.delta);h.samples++;h.days.add(m.createdAt.toISOString().slice(0,10))}
   if(m.kind==='PRODUCTION_REVERSAL'&&m.delta>0)h.returned+=BigInt(m.delta);
   if(m.kind==='LOSS'&&m.delta<0)h.loss-=BigInt(m.delta);
  }
  return {from:new Date(from).toISOString(),until:new Date(until).toISOString(),generatedAt:new Date().toISOString(),windowDays,horizonDays:input.horizonDays,includeLosses:input.includeLosses,minimumSamples,minimumActiveDays,method:'Recorded physical sale/reward and production issues, less returned production inputs; target = ceil(net usage × horizon / history days) + optional ceil(applied losses × horizon / history days) + threshold buffer; buy = max(0, target - available - outstanding deliveries). No inference about missing activity.',items:items.map(item=>{
   const h=history.get(item.id)??{usage:0n,returned:0n,loss:0n,samples:0,days:new Set<string>()},a=availability.get(item.id)!,net=h.usage>h.returned?h.usage-h.returned:0n;
   const projected=ceil(net*BigInt(input.horizonDays),BigInt(windowDays)),projectedLoss=input.includeLosses?ceil(h.loss*BigInt(input.horizonDays),BigInt(windowDays)):0n,target=projected+projectedLoss+BigInt(item.threshold),onOrder=incoming.get(item.id)??0n,shortage=target-BigInt(a.availableQuantity)-onOrder,recommendation=shortage>0n?shortage:0n;
   const reason=!item.available?'RESOURCE_UNAVAILABLE':item.createdAt.getTime()>from||h.samples<minimumSamples||h.days.size<minimumActiveDays?'INSUFFICIENT_HISTORY':target>maxQuantity||recommendation>maxQuantity?'QUANTITY_LIMIT':null;
   return {itemId:item.id,name:item.name,unit:item.unit,sampleCount:h.samples,activeDays:h.days.size,usageQuantity:String(h.usage),returnedProductionQuantity:String(h.returned),netUsageQuantity:String(net),lossQuantity:String(h.loss),projectedUsageQuantity:String(projected),projectedLossQuantity:String(projectedLoss),physicalQuantity:item.quantity,reservedQuantity:a.reservedQuantity,pendingLossQuantity:a.pendingLossQuantity,availableQuantity:a.availableQuantity,incomingQuantity:String(onOrder),bufferQuantity:item.threshold,targetQuantity:String(target),recommendedQuantity:reason?null:Number(recommendation),reason};
  })};
}


export function historyPurchases(db:Db,venueId:string,input:Parameters<typeof historyPurchaseSnapshot>[2]){return db.transaction(tx=>historyPurchaseSnapshot(tx as unknown as Db,venueId,input),{isolationLevel:'repeatable read'})}
