import {afterAll,expect,it} from 'vitest';
import {financeCsv} from '@nimble/shared';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db),key=()=>crypto.randomUUID();
afterAll(async()=>{await app.close();await close()});
async function setup(){
 const owner={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-cash-report-'+key()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers:owner,payload:{name:'Mixed payments',fiatCurrency:'EUR',nimAddress:'NQ-report-merchant'}})).json(),base='/v1/merchant/venues/'+venue.id;
 const call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers:owner,payload});
 const product=(await call('POST','/catalog',{name:'Coffee',category:'Drinks',variants:[{id:key(),name:'Cup',priceMinor:1250}],extras:[]})).json();
 const employee=(await call('POST','/employees',{name:'Cashier',pin:'5678'})).json(),terminal=(await call('POST','/terminal')).json();
 const cashier={authorization:`Bearer ${(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'5678'}})).json().token}`};
 const shift=(await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})).json();
 app.deps.merchantPayments={displayRates:async()=>{throw new Error('No current FX in reports')},quote:async input=>({...input,id:key(),network:'nimiq:5',amountAtomic:'9876543210123456789',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'test'}),verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})};
 const order=async()=>(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines:[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]}})).json();
 const now=Date.now(),from=new Date(now-86400000).toISOString(),until=new Date(now+86400000).toISOString(),range='?'+new URLSearchParams({from,until});
 return {owner,venue,base,call,cashier,shift,product,order,range,from,until};
}
it('separates cash due from tendered notes and crypto atomic without duplicating recognized sales',async()=>{
 const f=await setup(),cash=await f.order(),crypto=await f.order();
 const body={revision:cash.revision,tenderedMinor:2000},cashKey=key();
 const record=()=>app.inject({method:'POST',url:'/v1/merchant/orders/'+cash.id+'/cash/confirm',headers:{...f.cashier,'idempotency-key':cashKey},payload:body});
 const paid=await record();expect(paid.statusCode).toBe(200);expect((await record()).statusCode).toBe(200);
 const discount=await f.call('POST',`/orders/${crypto.id}/discount`,{revision:1,kind:'FIXED',value:500,reason:'Recorded discount',idempotencyKey:key()});expect(discount.statusCode).toBe(200);
 const quoted=await app.inject({method:'POST',url:'/v1/merchant/checkout/'+crypto.checkoutToken+'/quote',payload:{revision:2,asset:'NIM',sender:'NQ-report-customer'}});expect(quoted.statusCode).toBe(200);
 expect((await app.inject({method:'POST',url:'/v1/merchant/checkout/'+crypto.checkoutToken+'/payment',payload:{revision:2,quoteId:quoted.json().quote.id,hash:'a'.repeat(64)}})).statusCode).toBe(200);
 const response=await f.call('GET','/finance'+f.range);expect(response.statusCode).toBe(200);const report=response.json();
 expect(report.fiat[0].salesMinor).toBe('2000');
 expect(report.cash).toEqual([{currency:'EUR',receivedMinor:'1250',confirmedRefundsMinor:'0',netMinor:'1250',refundLiabilityMinor:'0'}]);
 expect(report.salesByPaymentMethod).toEqual([{currency:'EUR',paymentMethod:'CASH',salesMinor:'1250',count:1},{currency:'EUR',paymentMethod:'CRYPTO',salesMinor:'750',count:1}]);
 expect(report.assets).toMatchObject([{asset:'NIM',receivedAtomic:'9876543210123456789'}]);
 expect(report.entries.filter((e:any)=>e.kind==='SALE')).toHaveLength(2);
 expect(report.entries.find((e:any)=>e.kind==='CASH_PAYMENT')).toMatchObject({amountMinor:'1250',asset:null,network:null,hash:null,amountAtomic:null,paymentMethod:'CASH',cashReceiptId:paid.json().cashReceipt.id});
 const csv=financeCsv(report);expect(csv.split('\r\n')[0]).toMatch(/"payment_method","cash_receipt_id"$/);expect(csv).toContain('"9876543210123456789"');expect(csv).toContain(paid.json().cashReceipt.id);
});
it('attributes cash to its recording day, includes product and shift sales, and preserves a closed cutoff',async()=>{
 const f=await setup(),o=await f.order();
 // An old basket paid today belongs to today's sale, not yesterday's basket creation.
 const {eq}=await import('drizzle-orm'),s=await import('../src/db/schema');
 await db.update(s.merchantOrder).set({createdAt:new Date(Date.now()-3*86400000)}).where(eq(s.merchantOrder.id,o.id));
 const paid=await app.inject({method:'POST',url:'/v1/merchant/orders/'+o.id+'/cash/confirm',headers:{...f.cashier,'idempotency-key':key()},payload:{revision:1,tenderedMinor:2000}});expect(paid.statusCode).toBe(200);
 const date=new Date().toISOString().slice(0,10),window={date,timeZone:'UTC',boundaryHour:0};
 const preview=async()=>(await f.call('GET','/day-closes/preview?'+new URLSearchParams({...window,boundaryHour:'0'}))).json();
 const p=await preview();expect(p.snapshot.sales).toEqual([{currency:'EUR',totalMinor:'1250',count:1}]);expect(p.snapshot.cash).toEqual([{currency:'EUR',receivedMinor:'1250',confirmedRefundsMinor:'0',netMinor:'1250',refundLiabilityMinor:'0'}]);expect(p.snapshot.salesByPaymentMethod).toEqual([{currency:'EUR',paymentMethod:'CASH',salesMinor:'1250',count:1}]);
 const shift=(await app.inject({url:'/v1/merchant/shifts/'+f.shift.id+'/report',headers:f.cashier})).json();expect(shift.totals.cash[0].receivedMinor).toBe('1250');expect(shift.totals.grossMinor).toBe(1250);expect(shift.totals.assets.NIM).toBe('0');
 const economics=(await f.call('GET','/economics'+f.range)).json();expect(economics.products).toMatchObject([{quantity:1,revenue:{numerator:'1250',denominator:'1'}}]);
 const closed=await f.call('POST','/day-closes',{...window,note:'Close recorded cash',carry:[],ownerExceptionReason:'Owner tracks open pickup',expectedFingerprint:p.fingerprint,idempotencyKey:key()});expect(closed.statusCode).toBe(200);
 const another=await f.order();expect((await app.inject({method:'POST',url:'/v1/merchant/orders/'+another.id+'/cash/confirm',headers:{...f.cashier,'idempotency-key':key()},payload:{revision:1,tenderedMinor:1250}})).statusCode).toBe(200);
 expect((await preview()).snapshot.cash[0].receivedMinor).toBe('2500');expect((await f.call('GET','/day-closes')).json().items[0]).toEqual(closed.json());
});
it('rejects a foreign owner and cashier, and never fabricates cash in an empty historical range',async()=>{
 const f=await setup(),other=await setup();
 expect((await app.inject({url:f.base+'/finance'+f.range,headers:other.owner})).statusCode).toBe(404);
 expect((await app.inject({url:f.base+'/finance'+f.range,headers:f.cashier})).statusCode).toBe(403);
 expect((await app.inject({url:'/v1/merchant/shifts/'+f.shift.id+'/report',headers:other.cashier})).statusCode).toBe(404);
 expect((await app.inject({url:f.base+'/day-closes/preview?date=2026-10-16&timeZone=Europe%2FWarsaw&boundaryHour=4',headers:other.cashier})).statusCode).toBe(404);
 const empty=(await f.call('GET','/finance?from=2026-01-01T00:00:00Z&until=2026-01-02T00:00:00Z')).json();expect(empty.cash).toEqual([]);expect(empty.salesByPaymentMethod).toEqual([]);
});
it('uses the venue timezone and boundary hour for cash around a daylight-saving day',async()=>{
 const f=await setup(),a=await f.order(),b=await f.order();
 const {eq}=await import('drizzle-orm'),s=await import('../src/db/schema');
 for(const [o,at] of [[a,'2026-03-29T01:59:59Z'],[b,'2026-03-29T02:00:00Z']] as const){
  const paid=await app.inject({method:'POST',url:'/v1/merchant/orders/'+o.id+'/cash/confirm',headers:{...f.cashier,'idempotency-key':key()},payload:{revision:1,tenderedMinor:1250}});expect(paid.statusCode).toBe(200);
  // Fixed recording facts either side of 04:00 Warsaw after the DST jump.
  await db.update(s.merchantCashReceipt).set({recordedAt:new Date(at)}).where(eq(s.merchantCashReceipt.id,paid.json().cashReceipt.id));
  await db.update(s.merchantFinancialSale).set({occurredAt:new Date(at)}).where(eq(s.merchantFinancialSale.orderId,o.id));
 }
 for(const date of ['2026-03-28','2026-03-29']){
  const p=(await f.call('GET','/day-closes/preview?'+new URLSearchParams({date,timeZone:'Europe/Warsaw',boundaryHour:'4'}))).json();expect(p.snapshot.cash[0].receivedMinor).toBe('1250');expect(p.snapshot.sales[0]).toMatchObject({totalMinor:'1250',count:1});
 }
});
