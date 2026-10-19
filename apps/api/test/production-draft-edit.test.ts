import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);const key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-production-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Production',fiatCurrency:'EUR',nimAddress:'NQ-production-123'}})).json();
 const base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});
 const item=async(name:string,unit:string,openingQuantity:number)=>(await call('POST','/inventory',{name,unit,openingQuantity,tracked:true,threshold:0,reason:'Opening',idempotencyKey:key()})).json();
 const raw=await item('Coffee','MILLIGRAM',100000),output=await item('Prepared coffee','PORTION',0);
 const recipe=(await call('POST','/recipes',{name:'Coffee batch',ingredients:[{kind:'ITEM',itemId:raw.id,quantity:'18',unit:'g'}],reason:'Batch recipe',idempotencyKey:key()})).json();
 const payload={recipeVersionId:recipe.id,outputItemId:output.id,batches:2,expectedYieldPerBatch:3,actualYield:5,reason:'Two prepared batches',idempotencyKey:key()};
 const stock=async()=>(await call('GET','/inventory')).json().items;
 return {call,raw,output,recipe,payload,stock,headers,base};
}
it('edits one revision once, preserves stale conflicts and cancels without stock movements',async()=>{
 const f=await setup(),{actualYield,...input}=f.payload,before=await f.stock();
 const created=(await f.call('POST','/production/drafts',input)).json(),path='/production/drafts/'+created.id;
 const update={...input,revision:1,batches:3,idempotencyKey:key()};
 const changed=await f.call('PATCH',path,update);expect(changed.statusCode).toBe(200);expect(changed.json()).toMatchObject({id:created.id,revision:2,batches:3,status:'DRAFT'});
 expect((await f.call('PATCH',path,update)).json()).toEqual(changed.json());
 const stale=await f.call('PATCH',path,{...update,batches:4,idempotencyKey:key()});expect(stale.statusCode).toBe(409);expect(stale.json().error.code).toBe('DRAFT_REVISION_CONFLICT');
 const cancelled=await f.call('POST',path+'/cancel',{revision:2,reason:'Plan no longer needed',idempotencyKey:key()});expect(cancelled.statusCode).toBe(200);expect(cancelled.json()).toMatchObject({status:'CANCELLED',revision:3,cancellationReason:'Plan no longer needed'});
 expect((await f.call('PATCH',path,{...update,revision:3,idempotencyKey:key()})).statusCode).toBe(409);
 expect((await f.call('GET',path)).json()).toEqual(cancelled.json());expect(await f.stock()).toEqual(before);
 expect((await f.call('GET','/production')).json().items).toHaveLength(0);
});
it('allows only one writer per revision, keeps cancellation idempotent and isolates mutations',async()=>{
 const f=await setup(),other=await setup(),{actualYield,...input}=f.payload;
 const created=(await f.call('POST','/production/drafts',input)).json(),path='/production/drafts/'+created.id;
 const attempts=await Promise.all([f.call('PATCH',path,{...input,revision:1,batches:3,idempotencyKey:key()}),f.call('PATCH',path,{...input,revision:1,batches:4,idempotencyKey:key()})]);
 expect(attempts.map(r=>r.statusCode).sort()).toEqual([200,409]);
 expect((await app.inject({method:'PATCH',url:f.base+path,headers:other.headers,payload:{...input,revision:2,idempotencyKey:key()}})).statusCode).toBe(404);
 const cancel={revision:2,reason:'Duplicate plan removed',idempotencyKey:key()};
 const cancelled=await f.call('POST',path+'/cancel',cancel);expect(cancelled.statusCode).toBe(200);
 expect((await f.call('POST',path+'/cancel',cancel)).json()).toEqual(cancelled.json());
 expect((await f.call('POST',path+'/cancel',{...cancel,reason:'Different request'})).statusCode).toBe(409);
 expect((await f.call('PATCH',path,{...input,revision:3,idempotencyKey:key()})).json().error.code).toBe('DRAFT_NOT_EDITABLE');
});
