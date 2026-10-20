import {and,eq} from 'drizzle-orm';
import type {ProductionBatch} from '@nimble/shared';
import type {Db} from '../db/client';
import * as s from '../db/schema';
import {loyaltyFail as fail} from './loyalty';
export async function assertProductionDependencies(store:Db,venueId:string,outputItemId:string,requirements:{itemId:string}[],historyLimit?:number){
 if(requirements.some(r=>r.itemId===outputItemId))fail(400,'PRODUCTION_CYCLE');
    const query=store.select().from(s.merchantStockOperation).where(and(eq(s.merchantStockOperation.venueId,venueId),eq(s.merchantStockOperation.kind,'PRODUCTION')));
    const history=await (historyLimit===undefined?query:query.limit(historyLimit+1));
    if(historyLimit!==undefined&&history.length>historyLimit)fail(400,'PRODUCTION_HISTORY_TOO_LARGE');
    const graph=new Map<string,Set<string>>();
    for(const row of history){const batch=row.data as ProductionBatch;const deps=graph.get(batch.outputItemId)??new Set<string>();for(const r of batch.requirements)deps.add(r.itemId);graph.set(batch.outputItemId,deps)}
    const reaches=(id:string,seen=new Set<string>()):boolean=>{if(id===outputItemId)return true;if(seen.has(id))return false;seen.add(id);return [...graph.get(id)??[]].some(next=>reaches(next,seen))};
    if(requirements.some(r=>reaches(r.itemId)))fail(400,'PRODUCTION_CYCLE');
}
