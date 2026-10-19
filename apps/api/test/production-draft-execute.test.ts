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
it('executes a saved plan with measured yield exactly once and persists its batch link',async()=>{
 const f=await setup(),{actualYield,...plan}=f.payload;
 const draft=(await f.call('POST','/production/drafts',{...plan,batches:3,expectedYieldPerBatch:4})).json(),path='/production/drafts/'+draft.id+'/execute';
 const input={revision:1,actualYield:10,reason:'Measured ten finished portions',idempotencyKey:key()};
 const made=await f.call('POST',path,input);expect(made.statusCode).toBe(200);
 expect(made.json().batch).toMatchObject({expectedYield:12,actualYield:10,waste:2,draftId:draft.id});
 expect(made.json().draft).toMatchObject({status:'EXECUTED',revision:2,batchId:made.json().batch.id});
 expect((await f.call('POST',path,input)).json()).toEqual(made.json());
 expect((await f.call('POST',path,{...input,idempotencyKey:key()})).statusCode).toBe(409);
 expect((await f.call('GET','/production/drafts/'+draft.id)).json()).toEqual(made.json().draft);
 expect((await f.call('GET','/production')).json().items).toHaveLength(1);
 expect(await f.stock()).toEqual(expect.arrayContaining([expect.objectContaining({id:f.raw.id,quantity:46000}),expect.objectContaining({id:f.output.id,quantity:10})]));
});
it('keeps a draft unchanged when ingredient validation rolls back production',async()=>{
 const f=await setup(),before=await f.stock(),{actualYield,...plan}=f.payload;
 const draft=(await f.call('POST','/production/drafts',{...plan,batches:10})).json();
 const result=await f.call('POST','/production/drafts/'+draft.id+'/execute',{revision:1,actualYield:5,reason:'Measured result',idempotencyKey:key()});expect(result.statusCode).toBe(409);
 expect((await f.call('GET','/production/drafts/'+draft.id)).json()).toEqual(draft);
 expect((await f.call('GET','/production')).json().items).toHaveLength(0);expect(await f.stock()).toEqual(before);
});
it('serializes repeat execution and cancellation against one saved draft',async()=>{
 const f=await setup(),{actualYield,...plan}=f.payload,draft=(await f.call('POST','/production/drafts',plan)).json(),path='/production/drafts/'+draft.id;
 const input={revision:1,actualYield:5,reason:'Five measured portions',idempotencyKey:key()};
 const repeated=await Promise.all([f.call('POST',path+'/execute',input),f.call('POST',path+'/execute',input)]);
 expect(repeated.map(r=>r.statusCode)).toEqual([200,200]);expect(repeated[0].json()).toEqual(repeated[1].json());expect((await f.call('GET','/production')).json().items).toHaveLength(1);
 expect((await f.call('POST',path+'/cancel',{revision:2,reason:'Already executed',idempotencyKey:key()})).statusCode).toBe(409);
 const g=await setup(),{actualYield:ignored,...otherPlan}=g.payload,other=(await g.call('POST','/production/drafts',otherPlan)).json(),otherPath='/production/drafts/'+other.id;
 const raced=await Promise.all([g.call('POST',otherPath+'/execute',{...input,idempotencyKey:key()}),g.call('POST',otherPath+'/cancel',{revision:1,reason:'Do not execute',idempotencyKey:key()})]);
 expect(raced.map(r=>r.statusCode).sort()).toEqual([200,409]);
 const final=(await g.call('GET',otherPath)).json();expect(['EXECUTED','CANCELLED']).toContain(final.status);
 expect((await g.call('GET','/production')).json().items).toHaveLength(final.status==='EXECUTED'?1:0);
});
it('rejects stale or foreign execution and redacts costs on live permission checks',async()=>{
 const f=await setup(),other=await setup(),{actualYield,...plan}=f.payload,draft=(await f.call('POST','/production/drafts',plan)).json(),path='/production/drafts/'+draft.id+'/execute';
 const input={revision:1,actualYield:5,reason:'Measured portions',idempotencyKey:key()};
 expect((await app.inject({method:'POST',url:f.base+path,headers:other.headers,payload:input})).statusCode).toBe(404);
 expect((await f.call('POST',path,{...input,revision:2})).statusCode).toBe(409);
 expect((await f.call('POST',path,{...input,batches:1})).statusCode).toBe(400);
 expect((await f.call('POST',path,{...input,actualYield:7})).statusCode).toBe(400);
 const employee=(await f.call('POST','/employees',{name:'Cook',pin:'5678'})).json(),paired=(await f.call('POST','/terminal')).json();
 const headers={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':paired.terminalToken},payload:{employeeId:employee.id,pin:'5678'}})).json().token}`};
 expect((await app.inject({method:'POST',url:f.base+path,headers,payload:input})).statusCode).toBe(403);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Production only'}});
 const made=await app.inject({method:'POST',url:f.base+path,headers,payload:input});expect(made.statusCode).toBe(200);expect(made.json().batch.recipe.costMinor).toBeNull();expect(made.json().batch.unitCosts).toEqual([]);
 const batchPath=f.base+'/production/'+made.json().batch.id;
 expect((await app.inject({url:batchPath,headers})).json().unitCosts).toEqual([]);
 expect((await app.inject({url:batchPath,headers:other.headers})).statusCode).toBe(404);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers:f.headers,payload:{role:'CASHIER',permissions:[],reason:'Remove production access'}});
 expect((await app.inject({method:'POST',url:f.base+path,headers,payload:input})).statusCode).toBe(403);
 expect((await app.inject({url:batchPath,headers})).statusCode).toBe(403);
});
