import {InventoryLotMetadata,type LotDelta} from './inventoryLots';
import {z} from 'zod';
import type {RecipeSnapshot} from './recipes';
export const ProductionInput=z.object({lot:InventoryLotMetadata.optional(),recipeVersionId:z.string().uuid(),outputItemId:z.string().uuid(),batches:z.number().int().min(1).max(1000),expectedYieldPerBatch:z.number().int().min(1).max(2147483647),actualYield:z.number().int().min(0).max(2147483647),reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict();
export type ProductionBatch={draftId?:string;fiatCurrency?:'EUR'|'PLN'|'USD';inputLotDeltas?:{itemId:string;deltas:LotDelta[]}[];outputLotDeltas?:LotDelta[];id:string;venueId:string;status:'PRODUCED'|'REVERSED';recipe:RecipeSnapshot;batches:number;outputItemId:string;expectedYield:number;actualYield:number;waste:number;requirements:{itemId:string;quantity:number}[];unitCosts:{itemId:string;numerator:string|null;denominator:string}[];outputCost:{numerator:string;denominator:string}|null;reason:string;createdAt:string;createdBy:string;reversedAt:string|null;reversedBy:string|null;reversalReason:string|null};

export const ProductionDraftSource=z.object({from:z.string().datetime(),until:z.string().datetime(),horizonDays:z.number().int().min(1).max(30),includeLosses:z.boolean()}).strict().refine(s=>{
 const day=86400000,from=Date.parse(s.from),until=Date.parse(s.until),days=(until-from)/day;
 return from%day===0&&until%day===0&&days>=3&&days<=90&&until<=Math.floor(Date.now()/day)*day;
},'Invalid complete UTC history window');
const ProductionDraftFields=ProductionInput.omit({actualYield:true,lot:true}).extend({source:ProductionDraftSource.optional()}).strict();
const draftYieldValid=(i:{batches:number;expectedYieldPerBatch:number})=>BigInt(i.batches)*BigInt(i.expectedYieldPerBatch)<=2147483647n;
export const ProductionDraftInput=ProductionDraftFields.refine(draftYieldValid,'Planned yield exceeds limit');
export const ProductionDraftEditInput=ProductionDraftFields.extend({revision:z.number().int().min(1).max(2147483646)}).refine(draftYieldValid,'Planned yield exceeds limit');
export const ProductionDraftCancelInput=z.object({revision:z.number().int().min(1).max(2147483646),reason:z.string().trim().min(3).max(500),idempotencyKey:z.string().uuid()}).strict();
export const ProductionDraftExecuteInput=ProductionInput.pick({actualYield:true,reason:true,lot:true,idempotencyKey:true}).extend({revision:z.number().int().min(1).max(2147483646)}).strict();
export type ProductionDraft={id:string;venueId:string;status:'DRAFT'|'CANCELLED'|'EXECUTED';revision:number;batchId?:string;executedAt?:string;executedBy?:string;updatedAt?:string;updatedBy?:string;cancelledAt?:string;cancelledBy?:string;cancellationReason?:string;recipeVersionId:string;recipeName:string;recipeVersion:number;outputItemId:string;outputName:string;batches:number;expectedYieldPerBatch:number;reason:string;source?:z.infer<typeof ProductionDraftSource>;createdAt:string;createdBy:string};

export type ProductionDraftExecution={draft:ProductionDraft;batch:ProductionBatch};

import {HistoryPurchaseQuery,type HistoryPurchaseItem} from './purchasing';
export const ProductionProposalQuery=HistoryPurchaseQuery.extend({recipeVersionId:z.string().uuid(),outputItemId:z.string().uuid(),expectedYieldPerBatch:z.coerce.number().int().min(1).max(2147483647)}).strict();
export type ProductionProposal={minimumSamples:number;minimumActiveDays:number;from:string;until:string;generatedAt:string;windowDays:number;horizonDays:number;includeLosses:boolean;recipeVersionId:string;recipeName:string;recipeVersion:number;output:HistoryPurchaseItem;expectedYieldPerBatch:number;neededQuantity:number|null;plannedBatches:number|null;plannedYield:number|null;maxFeasibleBatches:number;outputCapacityQuantity:number;reason:HistoryPurchaseItem['reason']|'NO_SHORTAGE'|'INGREDIENT_SHORTAGE'|'INGREDIENT_UNAVAILABLE'|'PRODUCTION_LIMIT';ingredients:{itemId:string;name:string;unit:string;tracked:boolean;available:boolean;perBatch:number;requiredQuantity:number|null;physicalQuantity:number;reservedQuantity:number;pendingLossQuantity:number;availableQuantity:number;shortageQuantity:number|null}[]};
