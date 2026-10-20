import {eq} from 'drizzle-orm';
import * as s from '../src/db/schema';
import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
import {env} from '../src/env';
const {db,close}=await freshDb(); const {app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});
it('owner gets explicit operations window, unknown presence and empty exception page without credentials',async()=>{
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-ops-'+crypto.randomUUID()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Cafe',fiatCurrency:'EUR',nimAddress:'NQ-owner-ops'}})).json();
 const base=`/v1/merchant/venues/${venue.id}`;
 const r=await app.inject({url:base+'/operations',headers});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({acceptedSalesMinor:'0',openOrderCount:0,terminal:{state:'UNKNOWN',lastSeenAt:null}});expect(Date.parse(r.json().window.to)-Date.parse(r.json().window.from)).toBe(86400000);
 expect((await app.inject({url:base+'/payment-exceptions',headers})).json().items).toEqual([]);
 expect((await app.inject({url:base+'/operations'})).statusCode).toBe(401);
});
async function setup(){
 const headers={authorization:`Bearer ${await tokenFor(await makeUser(db,'NQ-ops-'+crypto.randomUUID()))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Cafe',fiatCurrency:'EUR',nimAddress:'NQ-owner-ops'}})).json(); const base=`/v1/merchant/venues/${venue.id}`;
 const employee=(await app.inject({method:'POST',url:base+'/employees',headers,payload:{name:'Ana',pin:'1234'}})).json();const terminal=(await app.inject({method:'POST',url:base+'/terminal',headers})).json();const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json();return {headers,venue,base,employee,worker:{authorization:`Bearer ${login.token}`}};
}
it('dashboard permission is live, session polling records terminal presence and exception actions remain owner only',async()=>{
 const {headers,base,employee,worker}=await setup();
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(403);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:['reports.view'],reason:'View operations'}});
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(200);
 await app.inject({url:'/v1/merchant/session',headers:worker});
 expect((await app.inject({url:base+'/operations',headers})).json().terminal.state).toBe('ACTIVE');
 await db.update(s.merchantTerminal).set({lastSeenAt:new Date(Date.now()-61000)}).where(eq(s.merchantTerminal.venueId,base.split('/')[4]));
 expect((await app.inject({url:base+'/operations',headers})).json().terminal.state).toBe('STALE');

 expect((await app.inject({url:base+'/payment-exceptions',headers:worker})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:base+'/orders/'+crypto.randomUUID()+'/recheck',headers:worker,payload:{reason:'Check now',idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(403);
 await app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers,payload:{role:'MANAGER',permissions:[],reason:'Remove reports'}});
 expect((await app.inject({url:base+'/operations',headers:worker})).statusCode).toBe(403);
 const other=await setup();expect((await app.inject({url:base+'/operations',headers:other.headers})).statusCode).toBe(404);
});
it('recheck keeps an unknown hash unverified, persists safe diagnostics, and replays without spending another rate slot',async()=>{
 const {headers,base,worker}=await setup();await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:worker});
 const p=(await app.inject({method:'POST',url:base+'/catalog',headers,payload:{name:'Tea',category:'Drinks',variants:[{id:crypto.randomUUID(),name:'Cup',priceMinor:300}],extras:[]}})).json();
 let checks=0;app.deps.merchantPayments={quote:async input=>({...input,id:crypto.randomUUID(),network:'nimiq:5',amountAtomic:'1234',rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),verify:async()=>{checks++;return null}};
 const o=(await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...worker,'idempotency-key':crypto.randomUUID()},payload:{lines:[{productId:p.id,variantId:p.variants[0].id,extraIds:[],quantity:1}]}})).json();const checkout='/v1/merchant/checkout/'+o.checkoutToken;
 const quote=(await app.inject({method:'POST',url:checkout+'/quote',payload:{revision:1,asset:'NIM',sender:'NQ-customer'}})).json().quote;
 await app.inject({method:'POST',url:checkout+'/payment',payload:{revision:1,quoteId:quote.id,hash:'a'.repeat(64)}});
 const payload={reason:'Owner checks pending payment',idempotencyKey:crypto.randomUUID()},url=base+'/orders/'+o.id+'/recheck';
 const checked=await app.inject({method:'POST',url,headers,payload});expect(checked.statusCode,checked.body).toBe(200);expect(checked.json()).toMatchObject({state:'COMPLETE',outcome:'UNVERIFIED'});const count=checks;
 expect((await app.inject({method:'POST',url,headers,payload})).json()).toEqual(checked.json());expect(checks).toBe(count);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,reason:'Another reason'}})).statusCode).toBe(409);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(429);
 const list=(await app.inject({url:base+'/payment-exceptions?asset=NIM&kind=UNVERIFIED',headers})).json();expect(list.items).toHaveLength(1);expect(list.items[0].attempts[0]).toMatchObject({verification:'UNVERIFIED',verificationCode:'UNVERIFIED'});expect(list.items[0].attempts[0].lastCheckedAt).toBeTruthy();expect(JSON.stringify(list)).not.toContain(o.checkoutToken);
 expect((await app.inject({url:base+'/payment-exceptions?asset=USDT',headers})).json().items).toEqual([]);
 const other=await setup();expect((await app.inject({url:other.base+'/payment-exceptions?asset=NIM',headers:other.headers})).json().items).toEqual([]);

 expect((await app.inject({url:base+'/payment-exceptions?minAgeMinutes=60',headers})).json().items).toEqual([]);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()+60000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');expect(checks).toBe(count);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()-1000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 const recovered=await app.inject({method:'POST',url,headers,payload});expect(recovered.statusCode).toBe(200);expect(recovered.json().state).toBe('COMPLETE');expect(recovered.json().operationId).toBe(checked.json().operationId);expect(checks).toBeGreaterThan(count);
 await db.update(s.merchantOperation).set({result:null,leaseUntil:new Date(Date.now()-1000)}).where(eq(s.merchantOperation.id,checked.json().operationId));
 app.deps.merchantPayments.verify=async()=>{await db.update(s.merchantOperation).set({leaseToken:crypto.randomUUID(),leaseUntil:new Date(Date.now()+60000)}).where(eq(s.merchantOperation.id,checked.json().operationId));return null};
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');
 expect((await app.inject({method:'POST',url,headers,payload})).json().state).toBe('PENDING');


});
it('counts received atomic payments separately from accepted snapshot sales at their actual event time',async()=>{
 const previousRemote=env.remoteOrderingEnabled,previousPayments=app.deps.merchantPayments;
 env.remoteOrderingEnabled=true;
 try{
 const {headers,base,venue,worker}=await setup(),old=new Date(Date.now()-172800000);
 const address='NQ-ops-customer-'+crypto.randomUUID(),customer={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`};
 const remote='/v1/merchant/remote';
 async function post(url:string,auth:Record<string,string>,payload?:Record<string,unknown>,status=200,key?:string){
  const response=await app.inject({method:'POST',url,headers:{...auth,...(key?{'idempotency-key':key}:{})},payload});
  expect(response.statusCode,response.body).toBe(status);return response.json();
 }
 await post('/v1/merchant/shifts',worker,undefined,201);
 const settings=await app.inject({method:'PATCH',url:`${remote}/venues/${venue.id}/settings`,headers,payload:{published:true,description:'Coffee',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10}});
 expect(settings.statusCode,settings.body).toBe(200);
 await post(`${remote}/venues/${venue.id}/heartbeat`,worker);
 const availability=await app.inject({method:'PATCH',url:`${remote}/venues/${venue.id}/availability`,headers:worker,payload:{accepting:true}});
 expect(availability.statusCode,availability.body).toBe(200);
 app.deps.merchantPayments={
  quote:async input=>({...input,id:crypto.randomUUID(),network:'nimiq:5',amountAtomic:({500:'1000',900:'2000',700:'3000'} as Record<number,string>)[input.totalMinor],rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString()}),
  verify:async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()}),
  refreshRefundQuote:async quote=>quote,
 };
 let rejectedId='';
 for(const [accepted,oldPayment,price] of [[true,false,500],[false,false,900],[true,true,700]] as const){
  const variantId=crypto.randomUUID(),product=await post(base+'/catalog',headers,{name:'Tea '+price,category:'Drinks',variants:[{id:variantId,name:'Cup',priceMinor:price}],extras:[]},201);
  const order=await post(`${remote}/venues/${venue.id}/orders`,customer,{lines:[{productId:product.id,variantId,extraIds:[],quantity:1}]},201,crypto.randomUUID());
  const checkout='/v1/merchant/checkout/'+order.checkoutToken;
  const quoted=await post(checkout+'/quote',customer,{revision:1,asset:'NIM',sender:address});
  const paid=await post(checkout+'/payment',customer,{revision:1,quoteId:quoted.quote.id,hash:crypto.randomUUID().replaceAll('-','').padEnd(64,'a')});
  expect(paid.status).toBe('AWAITING_ACCEPTANCE');
  const action=`${remote}/orders/${order.id}/${accepted?'accept':'reject'}`,decision=accepted?{preparationMinutes:8}:{reason:'Kitchen closed'};
  const decided=await post(action,worker,decision);
  expect(decided.status).toBe(accepted?'PREPARING':'REFUND_PENDING');
  // Replay decisions through the public API; immutable sale must not be duplicated.
  await post(action,worker,decision);
  // Only time/current-row drift is injected. Money, acceptance, sale snapshots and
  // the refund are created through the actual API, not fabricated DB inserts.
  await db.update(s.merchantOrder).set({createdAt:old,totalMinor:9999,...(oldPayment?{decisionAt:old,payment:{...paid.payment,confirmedAt:old.toISOString()}}:{})}).where(eq(s.merchantOrder.id,order.id));
  if(oldPayment){
   await db.update(s.merchantVerifiedTransaction).set({receipt:{...paid.payment,confirmedAt:old.toISOString()}}).where(eq(s.merchantVerifiedTransaction.orderId,order.id));
   await db.update(s.merchantFinancialSale).set({occurredAt:old}).where(eq(s.merchantFinancialSale.orderId,order.id));
  }
  if(!accepted)rejectedId=order.id;
 }
 const pending=(await app.inject({url:base+'/operations',headers})).json();
 expect(pending.acceptedSalesMinor).toBe('500');expect(pending.refundCount).toBe(1);
 const approved=await post(`/v1/merchant/orders/${rejectedId}/refund/approve`,headers);
 const refund={hash:'e'.repeat(64),quoteId:approved.refund.quote.id};
 await post(`/v1/merchant/orders/${rejectedId}/refund/payment`,headers,refund);
 await post(`/v1/merchant/orders/${rejectedId}/refund/payment`,headers,refund);
 const r=(await app.inject({url:base+'/operations',headers})).json();
 expect(r.acceptedSalesMinor).toBe('500');expect(r.receivedPayments).toEqual([{asset:'NIM',network:'nimiq:5',amountAtomic:'3000',count:2}]);expect(r.refundCount).toBe(0);expect(r.openOrderCount).toBe(2);
 const response=await app.inject({url:base+'/report',headers});expect(response.statusCode,response.body).toBe(200);
 // Accepted sales: 500 + 700 = 1200. Rejected 900 was never a sale.
 // Atomic transfers: 1000 + 2000 + 3000 - rejected refund 2000 = 4000.
 expect(response.json().totals).toMatchObject({grossMinor:1200,netMinor:1200,refunded:1,refundedMinor:0,assets:{NIM:'4000',USDT:'0'}});
 }finally{env.remoteOrderingEnabled=previousRemote;app.deps.merchantPayments=previousPayments;}
});
