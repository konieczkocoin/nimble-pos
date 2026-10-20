import {afterAll,expect,it} from 'vitest';
import * as schema from '../src/db/schema';
import {eq} from 'drizzle-orm';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db),key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const owner={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-cash-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers:owner,payload:{name:'Cash cafe',fiatCurrency:'EUR',nimAddress:'NQ-cash-merchant'}})).json(),base='/v1/merchant/venues/'+venue.id;
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers:owner,payload});
 const stock=(await call('POST','/inventory',{name:'Cups',unit:'PORTION',openingQuantity:2,tracked:true,threshold:0,reason:'Opening stock',idempotencyKey:key()})).json();
 const product=(await call('POST','/catalog',{name:'Coffee',category:'Drinks',variants:[{id:key(),name:'Cup',priceMinor:1250,stockBindings:[{itemId:stock.id,quantity:1}]}],extras:[]})).json();
 const employee=(await call('POST','/employees',{name:'Cashier',pin:'5678'})).json(),terminal=(await call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'5678'}})).json().token}`};
 const shift=(await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})).json();
 const order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}})).json();
 const pay=(body:any,k=key())=>app.inject({method:'POST',url:'/v1/merchant/orders/'+order.id+'/cash/confirm',headers:{...cashier,'idempotency-key':k},payload:body});
 return {owner,venue,base,call,stock,product,cashier,shift,order,pay};
}
it('records physical cash, exact change and one stock issue without a blockchain payment',async()=>{
 const f=await setup(),k=key(),body={revision:1,tenderedMinor:2000};
 const r=await f.pay(body,k);expect(r.statusCode).toBe(200);
 expect(r.json()).toMatchObject({cashReceipt:{dueMinor:1250,tenderedMinor:2000,changeMinor:750,currency:'EUR'},order:{status:'PREPARING',paymentMethod:'CASH',payment:null,quote:null,paidSnapshot:{totalMinor:1250}}});
 expect((await f.pay(body,k)).json().cashReceipt).toEqual(r.json().cashReceipt);
 expect((await f.pay({...body,tenderedMinor:2500},k)).statusCode).toBe(409);
 expect((await f.pay(body)).statusCode).toBe(409);
 const inventory=(await f.call('GET','/inventory')).json().items;expect(inventory.find((s:any)=>s.id===f.stock.id).quantity).toBe(1);
 const publicOrder=(await app.inject({url:'/v1/merchant/checkout/'+f.order.checkoutToken})).json();expect(publicOrder.cashReceipt).not.toHaveProperty('tenderedMinor');expect(publicOrder.cashReceipt).not.toHaveProperty('employeeId');
 const receipt=await app.inject({url:'/v1/merchant/orders/'+f.order.id+'/cash/receipt',headers:f.cashier});expect(receipt.statusCode).toBe(200);expect(receipt.json()).toEqual(r.json().cashReceipt);
 const range='?from='+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&until='+encodeURIComponent(new Date(Date.now()+86400000).toISOString());
 const finance=(await f.call('GET','/finance'+range)).json();expect(finance.fiat[0].salesMinor).toBe('1250');expect(finance.assets).toEqual([]);
});

it('rejects insufficient tender and stale revisions without consuming stock or creating a receipt',async()=>{
 const f=await setup();
 expect((await f.pay({revision:1,tenderedMinor:1249})).statusCode).toBe(409);
 expect((await f.pay({revision:2,tenderedMinor:2000})).statusCode).toBe(409);
 const r=await app.inject({url:'/v1/merchant/orders/'+f.order.id+'/cash/receipt',headers:f.cashier});expect(r.statusCode).toBe(404);
 expect((await f.call('GET','/inventory')).json().items.find((s:any)=>s.id===f.stock.id).quantity).toBe(2);
 expect((await f.pay({revision:1,tenderedMinor:1250})).json().cashReceipt.changeMinor).toBe(0);
});
it('serializes concurrent retries to one receipt and one stock issue',async()=>{
 const f=await setup(),k=key(),body={revision:1,tenderedMinor:2000};
 const responses=await Promise.all([f.pay(body,k),f.pay(body,k)]);
 expect(responses.map(r=>r.statusCode)).toEqual([200,200]);expect(responses[0].json().cashReceipt.id).toBe(responses[1].json().cashReceipt.id);
 expect((await f.call('GET','/inventory')).json().items.find((s:any)=>s.id===f.stock.id).quantity).toBe(1);
});
it('does not allow an owner to record a cashier cash sale',async()=>{
 const f=await setup();const r=await app.inject({method:'POST',url:'/v1/merchant/orders/'+f.order.id+'/cash/confirm',headers:{...f.owner,'idempotency-key':key()},payload:{revision:1,tenderedMinor:2000}});expect(r.statusCode).toBe(403);
});

it('rejects a new sale after shift closure but recovers an already committed retry',async()=>{
 const f=await setup(),body={revision:1,tenderedMinor:2000},k=key();
 const paid=await f.pay(body,k);expect(paid.statusCode).toBe(200);
 await db.update(schema.merchantShift).set({closedAt:new Date()}).where(eq(schema.merchantShift.id,f.shift.id));
 expect((await f.pay(body,k)).json().cashReceipt.id).toBe(paid.json().cashReceipt.id);
 const g=await setup();await db.update(schema.merchantShift).set({closedAt:new Date()}).where(eq(schema.merchantShift.id,g.shift.id));
 expect((await g.pay(body)).json().error.code).toBe('SHIFT_REQUIRED');
});
it('rejects cash after expired wallet quote history and exposes that restriction to the cashier',async()=>{
 const f=await setup();
 await db.update(schema.merchantOrder).set({quoteHistory:[{id:key()}] as any}).where(eq(schema.merchantOrder.id,f.order.id));
 expect((await f.pay({revision:1,tenderedMinor:2000})).json().error.code).toBe('CRYPTO_PAYMENT_IN_PROGRESS');
 const current=(await app.inject({url:'/v1/merchant/checkout/'+f.order.checkoutToken})).json();expect(current.cashPaymentAvailable).toBe(false);
});
it('rolls back a receipt and stock issue when an immutable sale already conflicts',async()=>{
 const f=await setup();
 await db.insert(schema.merchantFinancialSale).values({orderId:f.order.id,venueId:f.venue.id,occurredAt:new Date(),data:{totalMinor:'1'} as any});
 expect((await f.pay({revision:1,tenderedMinor:2000})).json().error.code).toBe('SALE_SNAPSHOT_CONFLICT');
 const [o]=await db.select().from(schema.merchantOrder).where(eq(schema.merchantOrder.id,f.order.id));expect(o.cashReceiptId).toBeNull();expect(o.status).toBe('AWAITING_PAYMENT');
 expect((await f.call('GET','/inventory')).json().items.find((s:any)=>s.id===f.stock.id).quantity).toBe(2);
});

it('rejects cash with insufficient stock and supports resources without tracking',async()=>{
 const f=await setup();
 await db.update(schema.merchantInventoryItem).set({quantity:0}).where(eq(schema.merchantInventoryItem.id,f.stock.id));
 expect((await f.pay({revision:1,tenderedMinor:2000})).statusCode).toBe(409);
 const [o]=await db.select().from(schema.merchantOrder).where(eq(schema.merchantOrder.id,f.order.id));expect(o.cashReceiptId).toBeNull();
 await db.update(schema.merchantInventoryItem).set({tracked:false}).where(eq(schema.merchantInventoryItem.id,f.stock.id));
 const paid=await f.pay({revision:1,tenderedMinor:2000});expect(paid.statusCode).toBe(200);
 const [item]=await db.select().from(schema.merchantInventoryItem).where(eq(schema.merchantInventoryItem.id,f.stock.id));expect(item.quantity).toBe(0);
 const [sale]=await db.select().from(schema.merchantFinancialSale).where(eq(schema.merchantFinancialSale.orderId,f.order.id));expect(sale.data.totalMinor).toBe('1250');
});
it('isolates receipts and cash confirmation between venues',async()=>{
 const f=await setup(),g=await setup();
 const r=await app.inject({method:'POST',url:'/v1/merchant/orders/'+f.order.id+'/cash/confirm',headers:{...g.cashier,'idempotency-key':key()},payload:{revision:1,tenderedMinor:2000}});expect(r.statusCode).toBe(404);
 expect((await app.inject({url:'/v1/merchant/orders/'+f.order.id+'/cash/receipt',headers:g.cashier})).statusCode).toBe(404);
});
