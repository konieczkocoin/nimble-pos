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
 return {call,pay,report,base,headers,cashier,item,product,variant,from,until};
}it('reports historical ingredient margin, keeps consumed cost after a refund and separates loss',async()=>{
 const f=await setup();
 expect((await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-20,revision:1,reason:'Empty unknown stock',idempotencyKey:key()})).statusCode).toBe(200);
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Bakery',idempotencyKey:key()})).json();
 const delivery=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:10,totalCostMinor:1000}],idempotencyKey:key()})).json();
 await f.call('POST',`/inventory/deliveries/${delivery.id}/receipts`,{lines:[{itemId:f.item.id,quantity:10}],reason:'Receipt',idempotencyKey:key()});
 const lossPayload={itemId:f.item.id,quantity:1,reason:'EXPIRED',comment:'Closing loss',idempotencyKey:key()};
 expect((await f.call('POST','/inventory/losses',lossPayload)).statusCode).toBe(200);
 expect((await f.call('POST','/inventory/losses',lossPayload)).statusCode).toBe(200);
 const order=await f.pay(100),path='/economics?'+new URLSearchParams({from:f.from,until:f.until});
 const initial=await f.call('GET',path);expect(initial.statusCode).toBe(200);
 expect(initial.json().stockChanges.find((v:any)=>v.kind==='LOSS')).toMatchObject({value:{numerator:'-100',denominator:'1'},unknownMovements:0});
 expect(initial.json().products[0]).toMatchObject({productId:f.product.id,revenue:{numerator:'900',denominator:'1'},ingredientCost:{numerator:'100',denominator:'1'},ingredientMargin:{numerator:'800',denominator:'1'},unknownCostSales:0});
 const p='/v1/merchant/orders/'+order.id;
 await app.inject({method:'POST',url:p+'/refund',headers:f.cashier,payload:{reason:'Unable to fulfil'}});
 expect((await app.inject({method:'POST',url:p+'/refund/approve',headers:f.headers})).statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:p+'/refund/payment',headers:f.headers,payload:{hash:'e'.repeat(64)}})).statusCode).toBe(200);
 const later=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:2,totalCostMinor:1000}],idempotencyKey:key()})).json();
 const receipt=(await f.call('POST',`/inventory/deliveries/${later.id}/receipts`,{lines:[{itemId:f.item.id,quantity:2}],reason:'Later expensive receipt',idempotencyKey:key()})).json().receipts[0];
 expect((await f.call('POST',`/inventory/deliveries/${later.id}/receipts/${receipt.id}/reverse`,{reason:'Return expensive receipt',idempotencyKey:key()})).statusCode).toBe(200);
 const refunded=(await f.call('GET',path)).json();
 expect(refunded.stockChanges.find((v:any)=>v.kind==='RECEIPT_CORRECTION')).toMatchObject({value:{numerator:'-1000',denominator:'1'}});
 expect(refunded.products[0]).toMatchObject({revenue:{numerator:'0',denominator:'1'},ingredientCost:{numerator:'100',denominator:'1'},ingredientMargin:{numerator:'-100',denominator:'1'}});
 expect((await app.inject({url:f.base+path,headers:f.cashier})).statusCode).toBe(403);
 const other=await setup();expect((await app.inject({url:f.base+path,headers:other.headers})).statusCode).toBe(404);
});
it('does not invent costs for unknown opening stock and validates the reporting window',async()=>{
 const f=await setup();await f.pay();
 const path='/economics?'+new URLSearchParams({from:f.from,until:f.until});
 const r=await f.call('GET',path);expect(r.statusCode).toBe(200);
 expect(r.json().products[0]).toMatchObject({ingredientCost:null,ingredientMargin:null,unknownCostSales:1});
 expect(r.json().warnings).toContain('INGREDIENT_COST_UNKNOWN');
 expect((await f.call('GET','/economics?'+new URLSearchParams({from:f.until,until:f.from}))).statusCode).toBe(400);
});
it('allocates a shared ingredient and order discount exactly and groups by the frozen category',async()=>{
 const f=await setup();await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-20,revision:1,reason:'Empty',idempotencyKey:key()});
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Bakery',idempotencyKey:key()})).json(),d=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:10,totalCostMinor:1000}],idempotencyKey:key()})).json();
 await f.call('POST',`/inventory/deliveries/${d.id}/receipts`,{lines:[{itemId:f.item.id,quantity:10}],reason:'Receipt',idempotencyKey:key()});
 const variant=key(),other=(await f.call('POST','/catalog',{name:'Premium cake',category:'Food',variants:[{id:variant,name:'Piece',priceMinor:2000,stockBindings:[{itemId:f.item.id,quantity:1}]}],extras:[]})).json();
 const order=await f.pay(1,[{productId:f.product.id,variantId:f.variant,extraIds:[],quantity:1},{productId:other.id,variantId:variant,extraIds:[],quantity:1}]);
 // A new catalogue grouping must not reclassify an already accepted sale.
 await f.call('POST','/catalog',{...other,category:'New group',reason:'Reclassified'});
 const r=(await f.call('GET','/economics?'+new URLSearchParams({from:f.from,until:f.until}))).json();
 expect(r.products.find((v:any)=>v.productId===f.product.id)).toMatchObject({category:'Food',revenue:{numerator:'2999',denominator:'3'},ingredientCost:{numerator:'100',denominator:'1'},ingredientMargin:{numerator:'2699',denominator:'3'}});
 expect(r.groups).toEqual([{category:'Food',currency:'EUR',revenue:{numerator:'2999',denominator:'1'},ingredientCost:{numerator:'200',denominator:'1'},ingredientMargin:{numerator:'2799',denominator:'1'},unknownCostSales:0}]);
 expect(order.payment).toBeTruthy();
});
it('charges the produced portion at its transferred cost without charging production inputs again',async()=>{
 const f=await setup();await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-20,revision:1,reason:'Empty',idempotencyKey:key()});
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Bakery',idempotencyKey:key()})).json(),d=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:10,totalCostMinor:1000}],idempotencyKey:key()})).json();
 await f.call('POST',`/inventory/deliveries/${d.id}/receipts`,{lines:[{itemId:f.item.id,quantity:10}],reason:'Receipt',idempotencyKey:key()});
 const output=(await f.call('POST','/inventory',{name:'Half cake',unit:'PORTION',openingQuantity:0,threshold:0,tracked:true,reason:'Empty output',idempotencyKey:key()})).json();
 const recipe=(await f.call('POST','/recipes',{name:'Halve cake',ingredients:[{kind:'ITEM',itemId:f.item.id,quantity:'1',unit:'portion'}],reason:'Recipe',idempotencyKey:key()})).json();
 expect((await f.call('POST','/production',{recipeVersionId:recipe.id,outputItemId:output.id,batches:1,expectedYieldPerBatch:2,actualYield:2,reason:'Two halves',idempotencyKey:key()})).statusCode).toBe(200);
 expect((await f.call('POST','/catalog',{...f.product,variants:[{...f.product.variants[0],stockBindings:[{itemId:output.id,quantity:1}]}],reason:'Sell halves'})).statusCode).toBe(200);
 await f.pay();
 const r=(await f.call('GET','/economics?'+new URLSearchParams({from:f.from,until:f.until}))).json();
 expect(r.products[0]).toMatchObject({ingredientCost:{numerator:'50',denominator:'1'},ingredientMargin:{numerator:'950',denominator:'1'}});
 expect(r.stockChanges.some((v:any)=>v.kind.startsWith('PRODUCTION'))).toBe(false);
});
