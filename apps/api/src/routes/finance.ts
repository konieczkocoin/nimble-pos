import {readEconomics} from '../services/economics';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {MerchantTaskHelpers} from './tasks';
import {loyaltyFail as fail} from '../services/loyalty';
import {readFinanceReport} from '../services/finance';
export async function financeRoutes(app:FastifyInstance,h:MerchantTaskHelpers){
 app.get('/v1/merchant/venues/:venueId/finance',async req=>{const a=await h.actor(req);if(a.kind!=='owner')return fail(403,'OWNER_REQUIRED');const venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);const q=z.object({from:z.string().datetime({offset:true}),until:z.string().datetime({offset:true})}).strict().parse(req.query),from=Date.parse(q.from),until=Date.parse(q.until);if(until<=from||until-from>366*86400000)return fail(400,'INVALID_FINANCIAL_RANGE');return readFinanceReport(app.deps.db,venueId,new Date(from).toISOString(),new Date(until).toISOString())});

 app.get('/v1/merchant/venues/:venueId/economics',async req=>{const a=await h.actor(req);if(a.kind!=='owner')return fail(403,'OWNER_REQUIRED');const venueId=z.string().uuid().parse((req.params as any).venueId);await h.venueFor(a,venueId);const q=z.object({from:z.string().datetime({offset:true}),until:z.string().datetime({offset:true})}).strict().parse(req.query),from=Date.parse(q.from),until=Date.parse(q.until);if(until<=from||until-from>366*86400000)return fail(400,'INVALID_FINANCIAL_RANGE');return readEconomics(app.deps.db,venueId,new Date(from).toISOString(),new Date(until).toISOString())});
}
