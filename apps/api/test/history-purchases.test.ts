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
}
it('explains a seven-day purchase projection and keeps losses optional without creating an order',async()=>{
 const f=await setup();
 // Existing setup has twenty portions; grow to 24 before recording real sales.
 await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:4,revision:1,reason:'Count',idempotencyKey:key()});
 // Three real accepted sales use 3, 6 and 9 portions respectively.
 await f.call('POST','/catalog',{...f.product,variants:[{...f.product.variants[0],stockBindings:[{itemId:f.item.id,quantity:3}]}],reason:'Three portions'});
 for(const quantity of [1,2,3])await f.pay(0,[{productId:f.product.id,variantId:f.variant,extraIds:[],quantity}]);
 const loss=(await f.call('POST','/inventory/losses',{itemId:f.item.id,quantity:1,reason:'EXPIRED',comment:'Recorded loss',idempotencyKey:key()})).json();expect(loss.status).toBe('APPLIED');
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:4}],idempotencyKey:key()});
 const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'),from=new Date(today.getTime()-7*86400000).toISOString(),until=today.toISOString();
 await db.update(s.merchantInventoryItem).set({createdAt:new Date(Date.parse(from)-86400000),threshold:5}).where(eq(s.merchantInventoryItem.id,f.item.id));
 const issues=await db.select().from(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.itemId,f.item.id),eq(s.merchantInventoryMovement.kind,'SALE')));
 for(let i=0;i<issues.length;i++)await db.update(s.merchantInventoryMovement).set({createdAt:new Date(Date.parse(from)+(i+1)*86400000)}).where(eq(s.merchantInventoryMovement.id,issues[i].id));
 await db.update(s.merchantInventoryMovement).set({createdAt:new Date(Date.parse(from)+4*86400000)}).where(eq(s.merchantInventoryMovement.id,loss.movementId));
 expect((await app.inject({method:'PATCH',url:`/v1/merchant/employees/${f.employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Manage stock'}})).statusCode).toBe(200);
 const pendingOrder=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...f.cashier,'idempotency-key':key()},payload:{lines:[{productId:f.product.id,variantId:f.variant,extraIds:[],quantity:1}]}})).json();
 expect((await app.inject({method:'POST',url:`/v1/merchant/checkout/${pendingOrder.checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-reserving-buyer'}})).statusCode).toBe(200);
 const pending=await app.inject({method:'POST',url:f.base+'/inventory/losses',headers:f.cashier,payload:{itemId:f.item.id,quantity:1,reason:'EXPIRED',comment:'Needs approval',idempotencyKey:key()}});expect(pending.json().status).toBe('PENDING');
 const path='/inventory/purchases/history?'+new URLSearchParams({from,until,horizonDays:'3',includeLosses:'false'});
 const response=await f.call('GET',path);expect(response.statusCode).toBe(200);
 const recommendation=response.json().items[0];
 // 18 / 7 * 3 -> ceil 8; buffer 5; physical 5 - reserved 3 - pending loss 1 = available 1; incoming 4 => buy 8.
 expect(recommendation).toMatchObject({sampleCount:3,activeDays:3,usageQuantity:'18',lossQuantity:'1',projectedUsageQuantity:'8',projectedLossQuantity:'0',physicalQuantity:5,reservedQuantity:3,pendingLossQuantity:1,availableQuantity:1,incomingQuantity:'4',recommendedQuantity:8,reason:null});
 expect((await f.call('GET',path.replace('includeLosses=false','includeLosses=true'))).json().items[0]).toMatchObject({projectedLossQuantity:'1',recommendedQuantity:9});
 expect((await f.call('GET','/inventory/purchases')).json().items).toHaveLength(0);
 expect((await app.inject({url:f.base+path,headers:f.cashier})).statusCode).toBe(200);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${f.employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions:[],reason:'Revoke stock'}});
 expect((await app.inject({url:f.base+path,headers:f.cashier})).statusCode).toBe(403);
 const draft={supplierId:supplier.id,lines:[{itemId:f.item.id,quantity:recommendation.recommendedQuantity-1}],reason:'Historical usage draft',idempotencyKey:key()};
 const first=await f.call('POST','/inventory/purchases',draft);expect(first.statusCode).toBe(200);expect(first.json().status).toBe('DRAFT');expect(first.json().lines[0].quantity).toBe(7);expect((await f.call('POST','/inventory/purchases',draft)).json()).toEqual(first.json());
});
it('refuses insufficient history, future periods and access from another venue owner',async()=>{
 const f=await setup(),today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'),from=new Date(today.getTime()-7*86400000).toISOString(),until=today.toISOString();
 const path='/inventory/purchases/history?'+new URLSearchParams({from,until,horizonDays:'3'});
 const r=await f.call('GET',path);expect(r.statusCode).toBe(200);expect(r.json().items[0]).toMatchObject({recommendedQuantity:null,reason:'INSUFFICIENT_HISTORY'});
 const other=await setup();expect((await app.inject({url:f.base+path,headers:other.headers})).statusCode).toBe(404);
 expect((await app.inject({url:f.base+path,headers:f.cashier})).statusCode).toBe(403);
 const future=new Date(today.getTime()+86400000).toISOString();expect((await f.call('GET',path.replace(encodeURIComponent(until),encodeURIComponent(future)))).statusCode).toBe(400);
});
it('nets returned production ingredients without treating a reversed output as new demand',async()=>{
 const f=await setup(),output=(await f.call('POST','/inventory',{name:'Prepared cake',unit:'PORTION',tracked:true,openingQuantity:0,threshold:0,reason:'Empty output',idempotencyKey:key()})).json();
 const recipe=(await f.call('POST','/recipes',{name:'Two portions',ingredients:[{kind:'ITEM',itemId:f.item.id,quantity:'1',unit:'portion'}],reason:'Recipe',idempotencyKey:key()})).json();
 const batches=[];for(let i=0;i<3;i++){const r=await f.call('POST','/production',{recipeVersionId:recipe.id,outputItemId:output.id,batches:1,expectedYieldPerBatch:2,actualYield:2,reason:'Production',idempotencyKey:key()});expect(r.statusCode).toBe(200);batches.push(r.json())}
 expect((await f.call('POST',`/production/${batches[0].id}/reverse`,{reason:'Reverse first batch',idempotencyKey:key()})).statusCode).toBe(200);
 const today=new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z'),from=new Date(today.getTime()-7*86400000).toISOString(),until=today.toISOString();
 for(const id of [f.item.id,output.id])await db.update(s.merchantInventoryItem).set({createdAt:new Date(Date.parse(from)-86400000)}).where(eq(s.merchantInventoryItem.id,id));
 const movements=await db.select().from(s.merchantInventoryMovement).where(eq(s.merchantInventoryMovement.venueId,f.item.venueId));let activeDay=1;
 for(const m of movements){if(m.kind==='PRODUCTION'||m.kind==='PRODUCTION_REVERSAL'){const when=m.kind==='PRODUCTION_REVERSAL'?4:m.delta<0?activeDay++:1;await db.update(s.merchantInventoryMovement).set({createdAt:new Date(Date.parse(from)+when*86400000)}).where(eq(s.merchantInventoryMovement.id,m.id))}}
 const r=await f.call('GET','/inventory/purchases/history?'+new URLSearchParams({from,until,horizonDays:'3'}));expect(r.statusCode).toBe(200);
 expect(r.json().items.find((i:any)=>i.itemId===f.item.id)).toMatchObject({sampleCount:3,activeDays:3,usageQuantity:'3',returnedProductionQuantity:'1',netUsageQuantity:'2',projectedUsageQuantity:'1',reason:null});
 expect(r.json().items.find((i:any)=>i.itemId===output.id)).toMatchObject({sampleCount:0,usageQuantity:'0',returnedProductionQuantity:'0',recommendedQuantity:null,reason:'INSUFFICIENT_HISTORY'});
});
