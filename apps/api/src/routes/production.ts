import {assertProductionDependencies} from '../services/productionDependencies';
import {productionProposal} from '../services/productionProposal';
import {randomUUID} from 'node:crypto';
import {and,desc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {ProductionDraftInput,ProductionDraftEditInput,ProductionDraftCancelInput,ProductionDraftExecuteInput,type ProductionDraft,ProductionProposalQuery,MerchantVenueInput,ProductionInput,type ProductionBatch} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {inventoryItem,inventoryMove,inventoryRetry} from '../services/inventory';
import {inventoryCosts,calculateRecipeCost} from '../services/inventoryCost';
import {recipeVersions} from '../services/recipes';
import {taskActorKey,type MerchantActor,type MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
export async function productionRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 const db=app.deps.db,base='/v1/merchant/venues/:venueId/production';
 async function context(req:FastifyRequest){const a=await h.actor(req),venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);if(a.kind!=='owner'&&!a.permissions?.includes('inventory.manage'))fail(403,'FORBIDDEN');return {a,venueId}}
 const publicView=(r:ProductionBatch)=>({...r,unitCosts:[],outputCost:null,recipe:{...r.recipe,costMinor:null,unitCosts:[]}});
 async function createProductionBatch(store:Db,a:MerchantActor,venueId:string,input:z.infer<typeof ProductionInput>,draftId?:string):Promise<ProductionBatch>{
    const recipe=(await recipeVersions(store,venueId,[input.recipeVersionId])).get(input.recipeVersionId)!;
    const requirements=recipe.requirements.map(b=>({itemId:b.itemId,quantity:b.quantity*input.batches}));
    const expectedYield=input.expectedYieldPerBatch*input.batches;
    if(expectedYield>2147483647||input.actualYield>expectedYield||requirements.some(b=>b.quantity>2147483647))fail(400,'INVALID_PRODUCTION_YIELD');
    await assertProductionDependencies(store,venueId,input.outputItemId,requirements);
    // Match checkout lock ordering even when output sorts before the ingredients.
    for(const id of [...new Set([input.outputItemId,...requirements.map(r=>r.itemId)])].sort()){const item=await inventoryItem(store,venueId,id,true);if(draftId&&(!item.tracked||!item.available))fail(409,'DRAFT_RESOURCE_UNAVAILABLE')}
    const [venue]=await store.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId));
    const fiatCurrency=MerchantVenueInput.shape.fiatCurrency.parse(venue.currency);
    const costs=await inventoryCosts(store,venueId),valuation=calculateRecipeCost(costs,requirements);
    const perBatch=calculateRecipeCost(costs,recipe.requirements);
    const outputCost=input.actualYield&&valuation.exactCost?{numerator:valuation.exactCost.numerator,denominator:(BigInt(valuation.exactCost.denominator)*BigInt(input.actualYield)).toString()}:null;
    const batchId=randomUUID(),inputLotDeltas:NonNullable<ProductionBatch['inputLotDeltas']>=[];
    for(const r of requirements){const {movement}=await inventoryMove(store,a,venueId,r.itemId,-r.quantity,'PRODUCTION',input.reason);inputLotDeltas.push({itemId:r.itemId,deltas:movement.lotAllocations})}
    const outputLotDeltas=input.actualYield?(await inventoryMove(store,a,venueId,input.outputItemId,input.actualYield,'PRODUCTION',input.reason,null,0,outputCost,{incoming:{...input.lot,source:'PRODUCTION',sourceId:batchId}})).movement.lotAllocations:[];
    const value:ProductionBatch={fiatCurrency,inputLotDeltas,outputLotDeltas,id:batchId,venueId,...(draftId?{draftId}:{}),status:'PRODUCED',recipe:{id:recipe.id,recipeId:recipe.recipeId,version:recipe.version,name:recipe.name,requirements:recipe.requirements,costMethod:'WEIGHTED_AVERAGE',costMinor:perBatch.costMinor,unitCosts:perBatch.unitCosts},batches:input.batches,outputItemId:input.outputItemId,expectedYield,actualYield:input.actualYield,waste:expectedYield-input.actualYield,requirements,unitCosts:requirements.map(r=>costs.get(r.itemId)??{itemId:r.itemId,numerator:null,denominator:'1'}),outputCost,reason:input.reason,createdAt:new Date().toISOString(),createdBy:taskActorKey(a),reversedAt:null,reversedBy:null,reversalReason:null};
    await store.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'PRODUCTION',data:value});
    await h.audit(store,a,venueId,'production.created',input.reason,null,publicView(value));return value;
 }
 async function draftPlan(store:Db,venueId:string,input:z.infer<typeof ProductionDraftInput>){
    const recipe=(await recipeVersions(store,venueId,[input.recipeVersionId])).get(input.recipeVersionId)!;
    const output=await inventoryItem(store,venueId,input.outputItemId);
    if(!output.tracked)return fail(409,'OUTPUT_NOT_TRACKED');
    if(recipe.requirements.some(r=>BigInt(r.quantity)*BigInt(input.batches)>2147483647n))return fail(400,'INVALID_PRODUCTION_YIELD');
    await assertProductionDependencies(store,venueId,input.outputItemId,recipe.requirements,10000);
    return {recipe,output};
 }
 app.get(base+'/drafts',async req=>{
  const {venueId}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
  const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION_DRAFT'))).orderBy(desc(s.merchantStockOperation.createdAt),desc(s.merchantStockOperation.id)).limit(51).offset(q.page*50);
  return {items:rows.slice(0,50).map(r=>r.data),hasMore:rows.length>50};
 });
 app.get(base+'/drafts/:id',async req=>{
  const {venueId}=await context(req),id=z.string().uuid().parse((req.params as {id:string}).id);
  const [row]=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION_DRAFT')));
  if(!row)return fail(404,'NOT_FOUND');return row.data;
 });
 app.post(base+'/drafts',async req=>{
  const {a,venueId}=await context(req),input=ProductionDraftInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.draft.create',input},async()=>{
    const {recipe,output}=await draftPlan(store,venueId,input);
    const value:ProductionDraft={id:randomUUID(),venueId,status:'DRAFT',revision:1,recipeVersionId:recipe.id,recipeName:recipe.name,recipeVersion:recipe.version,outputItemId:output.id,outputName:output.name,batches:input.batches,expectedYieldPerBatch:input.expectedYieldPerBatch,reason:input.reason,...(input.source?{source:input.source}:{}),createdAt:new Date().toISOString(),createdBy:taskActorKey(a)};
    await tx.insert(s.merchantStockOperation).values({id:value.id,venueId,kind:'PRODUCTION_DRAFT',data:value});
    await h.audit(store,a,venueId,'production.draft.created',input.reason,null,value);
    return value;
   });
  });
 });
 app.patch(base+'/drafts/:id',async req=>{
  const {a,venueId}=await context(req),id=z.string().uuid().parse((req.params as {id:string}).id),input=ProductionDraftEditInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.draft.edit',id,input},async()=>{
    const [row]=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION_DRAFT'))).for('update');
    if(!row)return fail(404,'NOT_FOUND');const previous=row.data as ProductionDraft;
    if(previous.status!=='DRAFT')return fail(409,'DRAFT_NOT_EDITABLE');
    if(previous.revision!==input.revision)return fail(409,'DRAFT_REVISION_CONFLICT');
    const {recipe,output}=await draftPlan(store,venueId,input);
    const value:ProductionDraft={...previous,recipeVersionId:recipe.id,recipeName:recipe.name,recipeVersion:recipe.version,outputItemId:output.id,outputName:output.name,batches:input.batches,expectedYieldPerBatch:input.expectedYieldPerBatch,reason:input.reason,source:input.source,revision:previous.revision+1,updatedAt:new Date().toISOString(),updatedBy:taskActorKey(a)};
    await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,id));
    await h.audit(store,a,venueId,'production.draft.edited',input.reason,previous,value);return value;
   });
  });
 });
 app.post(base+'/drafts/:id/cancel',async req=>{
  const {a,venueId}=await context(req),id=z.string().uuid().parse((req.params as {id:string}).id),input=ProductionDraftCancelInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.draft.cancel',id,input},async()=>{
    const [row]=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION_DRAFT'))).for('update');
    if(!row)return fail(404,'NOT_FOUND');const previous=row.data as ProductionDraft;
    if(previous.status!=='DRAFT')return fail(409,'DRAFT_NOT_EDITABLE');
    if(previous.revision!==input.revision)return fail(409,'DRAFT_REVISION_CONFLICT');
    const at=new Date().toISOString(),actor=taskActorKey(a);
    const value:ProductionDraft={...previous,status:'CANCELLED',revision:previous.revision+1,updatedAt:at,updatedBy:actor,cancelledAt:at,cancelledBy:actor,cancellationReason:input.reason};
    await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,id));
    await h.audit(store,a,venueId,'production.draft.cancelled',input.reason,previous,value);return value;
   });
  });
 });
 app.post(base+'/drafts/:id/execute',async req=>{
  const {a,venueId}=await context(req),id=z.string().uuid().parse((req.params as {id:string}).id),input=ProductionDraftExecuteInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   const result=await inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.draft.execute',id,input},async()=>{
    const [row]=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION_DRAFT'))).for('update');
    if(!row)return fail(404,'NOT_FOUND');const previous=row.data as ProductionDraft;
    if(previous.status!=='DRAFT')return fail(409,'DRAFT_NOT_EDITABLE');
    if(previous.revision!==input.revision)return fail(409,'DRAFT_REVISION_CONFLICT');
    const batchInput=ProductionInput.parse({recipeVersionId:previous.recipeVersionId,outputItemId:previous.outputItemId,batches:previous.batches,expectedYieldPerBatch:previous.expectedYieldPerBatch,actualYield:input.actualYield,lot:input.lot,reason:input.reason,idempotencyKey:input.idempotencyKey});
    const batch=await createProductionBatch(store,a,venueId,batchInput,id);
    const at=new Date().toISOString(),actor=taskActorKey(a);
    const draft:ProductionDraft={...previous,status:'EXECUTED',revision:previous.revision+1,batchId:batch.id,executedAt:at,executedBy:actor,updatedAt:at,updatedBy:actor};
    await tx.update(s.merchantStockOperation).set({data:draft}).where(eq(s.merchantStockOperation.id,id));
    await h.audit(store,a,venueId,'production.draft.executed',input.reason,previous,draft);return {draft,batch};
   });
   return {...result,batch:a.kind==='owner'||a.permissions?.includes('inventory.costs')?result.batch:publicView(result.batch)};
  });
 });
 app.get(base+'/proposal',async req=>{const {venueId}=await context(req);return productionProposal(db,venueId,ProductionProposalQuery.parse(req.query))});
 app.get(base,async req=>{const {a,venueId}=await context(req),q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query);const rows=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION'))).orderBy(desc(s.merchantStockOperation.createdAt),desc(s.merchantStockOperation.id)).limit(51).offset(q.page*50);return {items:rows.slice(0,50).map(r=>a.kind==='owner'||a.permissions?.includes('inventory.costs')?r.data:publicView(r.data as ProductionBatch)),hasMore:rows.length>50}});
 app.get(base+'/:id',async req=>{
  const {a,venueId}=await context(req),id=z.string().uuid().parse((req.params as {id:string}).id);
  const [row]=await db.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION')));
  if(!row)return fail(404,'NOT_FOUND');const value=row.data as ProductionBatch;
  return a.kind==='owner'||a.permissions?.includes('inventory.costs')?value:publicView(value);
 });
 app.post(base,async req=>{
  const {a,venueId}=await context(req),input=ProductionInput.parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;
   await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   const result=await inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.create',input},async()=>{
    return createProductionBatch(store,a,venueId,input);
   });
   return a.kind==='owner'||a.permissions?.includes('inventory.costs')?result:publicView(result);
  });
 });
 app.post(base+'/:id/reverse',async req=>{
  const {a,venueId}=await context(req);if(a.kind!=='owner')fail(403,'OWNER_REQUIRED');
  const id=z.string().uuid().parse((req.params as any).id),input=z.object({reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict().parse(req.body);
  return db.transaction(async tx=>{
   const store=tx as unknown as Db;await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock-operations:'+venueId}))`);
   return inventoryRetry(store,a,venueId,input.idempotencyKey,{action:'production.reverse',id,input},async()=>{
    const [row]=await tx.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.id,id),eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION'))).for('update');if(!row)fail(404,'NOT_FOUND');const value=row.data as ProductionBatch;
    if(value.status!=='PRODUCED')fail(409,'PRODUCTION_ALREADY_REVERSED');
    for(const itemId of [...new Set([value.outputItemId,...value.requirements.map(r=>r.itemId)])].sort())await inventoryItem(store,venueId,itemId,true);
    if(!value.inputLotDeltas||!value.outputLotDeltas)fail(409,'LOT_PROVENANCE_UNKNOWN');
    const [venue]=await tx.select({currency:s.merchantVenue.fiatCurrency}).from(s.merchantVenue).where(eq(s.merchantVenue.id,venueId));
    const currencyProven=value.fiatCurrency===venue.currency;
    if(value.actualYield)await inventoryMove(store,a,venueId,value.outputItemId,-value.actualYield,'PRODUCTION_REVERSAL',input.reason,null,0,currencyProven?value.outputCost:null,{deltas:value.outputLotDeltas!.map(l=>({lotId:l.lotId,delta:-l.delta}))});
    for(const r of value.requirements){const c=value.unitCosts.find(c=>c.itemId===r.itemId);await inventoryMove(store,a,venueId,r.itemId,r.quantity,'PRODUCTION_REVERSAL',input.reason,null,0,currencyProven&&c?.numerator!=null?{numerator:c.numerator,denominator:c.denominator}:null,{deltas:value.inputLotDeltas!.find(l=>l.itemId===r.itemId)!.deltas.map(l=>({lotId:l.lotId,delta:-l.delta}))})}
    Object.assign(value,{status:'REVERSED',reversedAt:new Date().toISOString(),reversedBy:taskActorKey(a),reversalReason:input.reason});await tx.update(s.merchantStockOperation).set({data:value}).where(eq(s.merchantStockOperation.id,id));await h.audit(store,a,venueId,'production.reversed',input.reason,null,publicView(value));return value;
   });
  });
 });
}
