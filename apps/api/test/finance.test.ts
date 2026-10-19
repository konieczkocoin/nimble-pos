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
 async function pay(discount=0){let order=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:variant,extraIds:[],quantity:1}]}})).json();if(discount){const d=await call('POST',`/orders/${order.id}/discount`,{revision:1,kind:'FIXED',value:discount,reason:'Recorded discount',idempotencyKey:key()});expect(d.statusCode).toBe(200);order={...order,revision:2}}const quote=(await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/quote`,payload:{revision:order.revision,asset:'NIM',sender:'NQ-finance-customer'}})).json().quote,hash=key().replaceAll('-','').padEnd(64,'a');const response=await app.inject({method:'POST',url:`/v1/merchant/checkout/${order.checkoutToken}/payment`,payload:{revision:order.revision,quoteId:quote.id,hash}});expect(response.statusCode).toBe(200);return response.json()}
 const now=new Date(),from=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString(),until=new Date(Date.parse(from)+86400000).toISOString(),query=new URLSearchParams({from,until}).toString(),report=()=>call('GET','/finance?'+query);
 return {call,pay,report,base,headers,cashier,item,product,variant,from,until};
}
it('reads one coherent owner report and preserves the discounted sale after a stock-related refund decision and later confirmation',async()=>{
 const f=await setup(),paid=await f.pay(100);
 const first=await f.report();expect(first.statusCode).toBe(200);expect(first.json().fiat).toEqual([{currency:'EUR',listMinor:'1000',discountMinor:'100',salesMinor:'900',refundedSalesMinor:'0',netSalesMinor:'900'}]);expect(first.json().assets[0]).toMatchObject({receivedAtomic:'900000',confirmedRefundsAtomic:'0',refundLiabilityAtomic:'0'});
 const item=(await f.call('GET','/inventory')).json().items[0];expect((await f.call('PATCH',`/inventory/${item.id}`,{name:item.name,tracked:true,available:false,threshold:0,revision:item.revision,reason:'Ingredient safety hold'})).statusCode).toBe(200);
 expect((await f.call('POST',`/inventory/availability-impact/orders/${paid.id}/refund`,{reason:'Cannot finish this order',idempotencyKey:key()})).statusCode).toBe(200);
 const pending=(await f.report()).json();expect(pending.fiat[0]).toMatchObject({salesMinor:'900',refundedSalesMinor:'0',netSalesMinor:'900'});expect(pending.assets[0].refundLiabilityAtomic).toBe('900000');
 const pendingOperations=await f.call('GET','/operations');expect(pendingOperations.statusCode).toBe(200);expect(pendingOperations.json().acceptedSalesMinor).toBe('900');
 const approved=(await app.inject({method:'POST',url:`/v1/merchant/orders/${paid.id}/refund/approve`,headers:f.headers})).json();expect(approved.refund.quote.amountAtomic).toBe('900000');
 const refunded=await app.inject({method:'POST',url:`/v1/merchant/orders/${paid.id}/refund/payment`,headers:f.headers,payload:{hash:'f'.repeat(64),quoteId:approved.refund.quote.id}});expect(refunded.statusCode).toBe(200);
 const final=(await f.report()).json();expect(final.fiat[0]).toMatchObject({salesMinor:'900',discountMinor:'100',refundedSalesMinor:'900',netSalesMinor:'0'});expect(final.assets[0]).toMatchObject({receivedAtomic:'900000',submittedRefundsAtomic:'900000',confirmedRefundsAtomic:'900000',refundLiabilityAtomic:'0',netCashAtomic:'0'});
 expect(final.entries.filter((e:any)=>e.kind==='SALE')).toHaveLength(1);expect(final.entries.every((e:any)=>!('lines' in e)&&!('checkoutToken' in e)&&!('sender' in e))).toBe(true);
 const overview=(await f.call('GET','/report')).json();expect(overview.totals).toMatchObject({grossMinor:900,refundedMinor:900,netMinor:0});
 expect((await f.call('GET','/operations')).json().acceptedSalesMinor).toBe('900');
 const cutoff=(await f.call('GET','/day-closes/preview?'+new URLSearchParams({date:f.from.slice(0,10),timeZone:'UTC',boundaryHour:'0'}))).json();expect(cutoff.snapshot.sales).toEqual([{currency:'EUR',totalMinor:'900',count:1}]);
 const sale=(await db.select().from(s.merchantFinancialSale).where(eq(s.merchantFinancialSale.orderId,paid.id)))[0];expect(sale.data.discountMinor).toBe('100');
});
it('rejects non-owners and invalid ranges, isolates venues, and does not consult current exchange rates',async()=>{
 const f=await setup();await f.pay();const report=await f.report();expect(report.statusCode).toBe(200);
 const query=new URLSearchParams({from:f.from,until:f.until}).toString();expect((await app.inject({url:f.base+'/finance?'+query,headers:f.cashier})).statusCode).toBe(403);
 expect((await f.call('GET','/finance?'+new URLSearchParams({from:f.until,until:f.from}))).statusCode).toBe(400);
 const other=await setup();expect((await app.inject({url:f.base+'/finance?'+query,headers:other.headers})).statusCode).toBe(404);expect((await other.report()).json().entries).toEqual([]);
});
it('observes an atomic sale and receipt together while a payment is being verified',async()=>{
 const f=await setup(),[response]=await Promise.all([f.report(),f.pay(100)]);expect(response.statusCode).toBe(200);const r=response.json(),sales=r.entries.filter((e:any)=>e.kind==='SALE'),payments=r.entries.filter((e:any)=>e.kind==='PAYMENT');expect([0,1]).toContain(sales.length);expect(payments.length).toBe(sales.length);if(sales.length){expect(sales[0].amountMinor).toBe('900');expect(payments[0].amountAtomic).toBe('900000')}
});

it('backfills proven historical acceptance without fabricating acceptance for ambiguous legacy payments',async()=>{
 const f=await setup(),known=await f.pay(100),uncertain=await f.pay();
 await db.delete(s.merchantFinancialSale).where(eq(s.merchantFinancialSale.venueId,known.venueId));
 await db.delete(s.merchantStockReservation).where(eq(s.merchantStockReservation.orderId,uncertain.id));
 // Simulate the pre-valuation historical database, without leaving dependent new evidence.
 await db.delete(s.merchantInventoryValuation).where(sql`${s.merchantInventoryValuation.movementId} in (select ${s.merchantInventoryMovement.id} from ${s.merchantInventoryMovement} where ${s.merchantInventoryMovement.itemId}=${f.item.id} and ${s.merchantInventoryMovement.reason}=${'POS order '+uncertain.id})`);
 await db.delete(s.merchantInventoryMovement).where(and(eq(s.merchantInventoryMovement.itemId,f.item.id),eq(s.merchantInventoryMovement.reason,'POS order '+uncertain.id)));
 await db.update(s.merchantOrder).set({paymentRequiresRefund:true,cancelledAt:new Date(Date.parse(uncertain.payment.confirmedAt)+100)}).where(eq(s.merchantOrder.id,uncertain.id));
 const migration=await readFile(new URL('../drizzle/0040_financial_sales.sql',import.meta.url),'utf8'),statement=migration.split('--> statement-breakpoint').find(part=>part.includes('WITH facts AS'))!;
 await db.execute(sql.raw(statement));
 const rows=await db.select().from(s.merchantFinancialSale).where(eq(s.merchantFinancialSale.venueId,known.venueId)),old=rows.find(r=>r.orderId===known.id)!,missing=rows.find(r=>r.orderId===uncertain.id)!;
 expect(old.data).toMatchObject({status:'RECORDED',provenance:'LEGACY_CONSUMPTION',timeBasis:'PAYMENT_CONFIRMATION',totalMinor:'900',discountMinor:'100'});expect(old.occurredAt!.toISOString()).toBe(known.payment.confirmedAt);expect(missing.data.status).toBe('UNRESOLVED');expect(missing.occurredAt).toBeNull();
 const report=(await f.report()).json();expect(report.warnings).toContain('LEGACY_SALE_CLASSIFICATION_UNKNOWN');expect(report.entries.find((e:any)=>e.kind==='UNKNOWN_SALE'&&e.orderId===uncertain.id).amountMinor).toBeNull();
});
