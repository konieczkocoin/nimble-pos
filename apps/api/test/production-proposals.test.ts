import {readFile} from 'node:fs/promises';
import {sql,and} from 'drizzle-orm';
import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
import {eq} from 'drizzle-orm';
import * as s from '../src/db/schema';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db),key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-finance-'+key()))}`},venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Finance',fiatCurrency:'EUR',nimAddress:'NQ-finance-merchant'}})).json(),base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload});
 const item=(await call('POST','/inventory',{name:'Cake',unit:'PORTION',openingQuantity:20,threshold:0,tracked:true,reason:'Opening',idempotencyKey:key()})).json(),variant=key(),product=(await call('POST','/catalog',{name:'Cake',category:'Food',variants:[{id:variant,name:'Piece',priceMinor:1000,stockBindings:[{itemId:item.id,quantity:1}]}],extras:[]})).json();
 const employee=(await call('POST','/employees',{name:'Cashier',pin:'1234'})).json(),terminal=(await call('POST','/terminal')).json(),token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token,cashier={authorization:`Bearer ${token}`};await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier});
 app.deps.merchantPayments={displayRates:async()=>{throw new Error('Finance must not request current FX')},quote:async input=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'historical-test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})};
 async function pay(discount=0,lines=[{productId:product.id,variantId:variant,extraIds:[],quantity:1}]){let order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines}})).json();if(discount){const d=await call('POST',`/orders/${order.id}/discount`,{revision:1,kind:'FIXED',value:discount,reason:'Recorded discount',idempotencyKey:key()});expect(d.statusCode).toBe(200);order={...order,revision:2}}const quote=(await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:{revision:order.revision,asset:'NIM',sender:'NQ-finance-customer'}})).json().quote,hash=key().replaceAll('-','').padEnd(64,'a');const response=await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/payment`,payload:{revision:order.revision,quoteId:quote.id,hash}});expect(response.statusCode).toBe(200);return response.json()}
 const now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString(),until=new Date(Date.parse(from)+86400000).toISOString(),query=new URLSearchParams({from,until}).toString(),report=()=>call('GET','/finance?'+query);
 return {call,pay,report,base,headers,cashier,item,product,variant,from,until,employee};
}async function proposalSetup(){
 const f=await setup(),output=(await f.call('POST','/inventory',{name:'Prepared cake',unit:'PORTION',tracked:true,openingQuantity:20,threshold:3,reason:'Opening',idempotencyKey:key()})).json(),variant=key();
 const product=(await f.call('POST','/catalog',{name:'Prepared cake',category:'Food',variants:[{id:variant,name:'Piece',priceMinor:1000,stockBindings:[{itemId:output.id,quantity:1}]}],extras:[]})).json();
 for(const quantity of [3,6,9])await f.pay(0,[{productId:product.id,variantId:variant,extraIds:[],quantity}]);
 const recipe=(await f.call('POST','/recipes',{name:'Two raw portions per batch',ingredients:[{kind:'ITEM',itemId:f.item.id,quantity:'2',unit:'portion'}],reason:'Recipe',idempotencyKey:key()})).json();
 const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'),from=new Date(today.getTime()-7*86400000).toISOString(),until=today.toISOString();
 await db.update(s.merchantInventoryItem).set({createdAt:new Date(Date.parse(from)-86400000)}).where(eq(s.merchantInventoryItem.id,output.id));
 const issues=await db.select().from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.itemId,output.id),eq(s.merchantInventoryMovement.kind,'SALE')));
 for(let i=0;i<issues.length;i++)await db.update(s.merchantInventoryMovement).set({createdAt:new Date(Date.parse(from)+(i+1)*86400000)}).where(eq(s.merchantInventoryMovement.id,issues[i].id));
 const query=new URLSearchParams({from,until,horizonDays:'3',recipeVersionId:recipe.id,outputItemId:output.id,expectedYieldPerBatch:'4'}),path='/production/proposal?'+query;
 return {...f,output,recipe,path,query};
}
it('projects batches from history and checks reserved ingredients without changing stock',async()=>{
 const f=await proposalSetup(),initial=await f.call('GET',f.path);expect(initial.statusCode).toBe(200);
 // ceil(18*3/7)=8; buffer3 - physical2 =9 portions; ceil(9/4)=3 batches ->12 portions.
 expect(initial.json()).toMatchObject({neededQuantity:9,plannedBatches:3,plannedYield:12,maxFeasibleBatches:10,reason:null});
 expect(initial.json().ingredients[0]).toMatchObject({itemId:f.item.id,perBatch:2,requiredQuantity:6,availableQuantity:20,shortageQuantity:0});
 expect((await f.call('GET','/production')).json().items).toHaveLength(0);
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...f.cashier,'idempotency-key':key()},payload:{lines:[{productId:f.product.id,variantId:f.variant,extraIds:[],quantity:17}]}})).json();
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-reserving-ingredients'}})).statusCode).toBe(200);
 const blocked=(await f.call('GET',f.path)).json();expect(blocked).toMatchObject({plannedBatches:3,maxFeasibleBatches:1,reason:'INGREDIENT_SHORTAGE'});expect(blocked.ingredients[0]).toMatchObject({requiredQuantity:6,availableQuantity:3,shortageQuantity:3});
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Supplier',idempotencyKey:key()})).json();
 await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:100}],idempotencyKey:key()});
 expect((await f.call('GET',f.path)).json().maxFeasibleBatches).toBe(1);
 await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.output.id,expectedQuantity:5}],idempotencyKey:key()});
 expect((await f.call('GET',f.path)).json()).toMatchObject({neededQuantity:4,plannedBatches:1,plannedYield:4,maxFeasibleBatches:1,reason:null});
});
it('refuses unknown history, cyclic or foreign recipes and unauthorized access',async()=>{
 const f=await proposalSetup(),other=await proposalSetup();
 expect((await app.inject({url:f.base+f.path,headers:f.cashier})).statusCode).toBe(403);
 expect((await app.inject({url:f.base+f.path,headers:other.headers})).statusCode).toBe(404);
 const foreign=new URLSearchParams(f.query);foreign.set('recipeVersionId',other.recipe.id);expect((await f.call('GET','/production/proposal?'+foreign)).statusCode).toBe(400);
 const cyclic=(await f.call('POST','/recipes',{name:'Cycle',ingredients:[{kind:'ITEM',itemId:f.output.id,quantity:'1',unit:'portion'}],reason:'Recipe',idempotencyKey:key()})).json();
 const cycle=new URLSearchParams(f.query);cycle.set('recipeVersionId',cyclic.id);expect((await f.call('GET','/production/proposal?'+cycle)).json().error.code).toBe('PRODUCTION_CYCLE');
 await db.update(s.merchantInventoryItem).set({createdAt:new Date()}).where(eq(s.merchantInventoryItem.id,f.output.id));
 expect((await f.call('GET',f.path)).json()).toMatchObject({plannedBatches:null,plannedYield:null,reason:'INSUFFICIENT_HISTORY'});
});
it('blocks a rounded-up batch that would exceed remaining finished-stock capacity',async()=>{
 const f=await proposalSetup(),limit=2147483647;
 const current=(await f.call('GET','/inventory')).json().items.find((i:any)=>i.id===f.output.id);
 const grown=await f.call('POST',`/inventory/${f.output.id}/movements`,{delta:limit-9,revision:current.revision,reason:'Capacity fixture',idempotencyKey:key()});expect(grown.statusCode).toBe(200);
 expect((await f.call('PATCH',`/inventory/${f.output.id}`,{name:f.output.name,tracked:true,threshold:limit-8,revision:grown.json().item.revision,reason:'Buffer near capacity'})).statusCode).toBe(200);
 const query=new URLSearchParams(f.query);query.set('expectedYieldPerBatch','10');
 const r=await f.call('GET','/production/proposal?'+query);expect(r.statusCode).toBe(200);
 // Seven units fit, but rounding the seven-unit shortfall to a ten-unit batch does not.
 expect(r.json()).toMatchObject({neededQuantity:7,plannedBatches:1,plannedYield:10,maxFeasibleBatches:0,reason:'PRODUCTION_LIMIT'});
});
