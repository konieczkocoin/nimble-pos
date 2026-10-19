import type {z} from 'zod';
import type {ProductionProposal,ProductionProposalQuery} from '@nimble/shared';
import type {Db} from '../db/client';
import {historyPurchaseSnapshot} from './historyPurchases';
import {recipeVersions} from './recipes';
import {inventoryItem} from './inventory';
import {stockAvailabilityBatch} from './stockReservations';
import {assertProductionDependencies} from './productionDependencies';
import {loyaltyFail as fail} from './loyalty';
const limit=2147483647n;
/** Planning snapshot only: incoming ingredients are not available before receipt. */
export function productionProposal(db:Db,venueId:string,input:z.infer<typeof ProductionProposalQuery>):Promise<ProductionProposal>{
 return db.transaction(async tx=>{
  const store=tx as unknown as Db,recipe=(await recipeVersions(store,venueId,[input.recipeVersionId])).get(input.recipeVersionId)!;
  await inventoryItem(store,venueId,input.outputItemId);
  await assertProductionDependencies(store,venueId,input.outputItemId,recipe.requirements,10000);
  const report=await historyPurchaseSnapshot(store,venueId,input),output=report.items.find(i=>i.itemId===input.outputItemId);if(!output)return fail(409,'OUTPUT_NOT_TRACKED');
  const items=await Promise.all(recipe.requirements.map(r=>inventoryItem(store,venueId,r.itemId))),availability=await stockAvailabilityBatch(store,items);
  const needed=output.recommendedQuantity,batches=needed===null?null:Number((BigInt(needed)+BigInt(input.expectedYieldPerBatch)-1n)/BigInt(input.expectedYieldPerBatch)),yieldQuantity=batches===null?null:BigInt(batches)*BigInt(input.expectedYieldPerBatch);
  const outputCapacityQuantity=Number(limit-BigInt(output.physicalQuantity)),outputBatchCapacity=Number(BigInt(outputCapacityQuantity)/BigInt(input.expectedYieldPerBatch));
  let feasible=Math.min(1000,outputBatchCapacity);
  const ingredients=items.map((item,index)=>{const r=recipe.requirements[index],a=availability.get(item.id)!,required=batches===null?null:BigInt(r.quantity)*BigInt(batches);feasible=Math.min(feasible,Number(BigInt(a.availableQuantity)/BigInt(r.quantity)));return {itemId:item.id,name:item.name,unit:item.unit,tracked:item.tracked,available:item.available,perBatch:r.quantity,requiredQuantity:required===null||required>limit?null:Number(required),physicalQuantity:item.quantity,reservedQuantity:a.reservedQuantity,pendingLossQuantity:a.pendingLossQuantity,availableQuantity:a.availableQuantity,shortageQuantity:required===null||required>limit?null:Number(required)>a.availableQuantity?Number(required)-a.availableQuantity:0}});
  const reason=output.reason??(needed===0?'NO_SHORTAGE':batches!>1000||yieldQuantity!>limit||batches!>outputBatchCapacity||ingredients.some(i=>i.requiredQuantity===null)?'PRODUCTION_LIMIT':ingredients.some(i=>!i.available||!i.tracked)?'INGREDIENT_UNAVAILABLE':batches!>feasible?'INGREDIENT_SHORTAGE':null);
  if(ingredients.some(i=>!i.available||!i.tracked))feasible=0;
  return {minimumSamples:report.minimumSamples,minimumActiveDays:report.minimumActiveDays,from:report.from,until:report.until,generatedAt:new Date().toISOString(),windowDays:report.windowDays,horizonDays:report.horizonDays,includeLosses:report.includeLosses,recipeVersionId:recipe.id,recipeName:recipe.name,recipeVersion:recipe.version,output,expectedYieldPerBatch:input.expectedYieldPerBatch,neededQuantity:needed,plannedBatches:batches,plannedYield:yieldQuantity===null||yieldQuantity>limit?null:Number(yieldQuantity),maxFeasibleBatches:feasible,outputCapacityQuantity,reason,ingredients};
 },{isolationLevel:'repeatable read'});
}
