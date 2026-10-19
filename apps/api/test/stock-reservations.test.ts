import {afterAll,afterEach,expect,it,vi} from 'vitest'
import {freshDb} from './helpers/db'
import {authedApp,makeUser} from './helpers/actors'
import {env} from '../src/env'
import {merchantStockReservation} from '../src/db/schema'
import {eq} from 'drizzle-orm'
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db)
afterAll(async()=>{await app.close();await close()});afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
const key=()=>crypto.randomUUID()
async function setup(tracked=true){
 const address='NQ-stock-'+key(),headers={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`}
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Stock',fiatCurrency:'EUR',nimAddress:address}})).json()
 const base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any)=>app.inject({method,url:base+path,headers,payload})
 const item=(await call('POST','/inventory',{name:'Last cake',unit:'PIECE',tracked,openingQuantity:1,threshold:0,reason:'Opening',idempotencyKey:key()})).json()
 const product=(await call('POST','/catalog',{name:'Cake',category:'Food',variants:[{id:key(),name:'Slice',priceMinor:400,stockBindings:[{itemId:item.id,quantity:1}]}],extras:[]})).json()
 const employee=(await call('POST','/employees',{name:'Ana',pin:'1234'})).json(),paired=(await call('POST','/terminal')).json()
 const token=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':paired.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json().token,cashier={authorization:`Bearer ${token}`}
 await app.inject({method:'POST',url:'/v1/merchant/shifts',headers:cashier})
 const lines=[{productId:product.id,variantId:product.variants[0].id,extraIds:[],quantity:1}]
 app.deps.merchantPayments={quote:async(input)=>({...input,id:key(),network:'nimiq:5',amountAtomic:String(input.totalMinor*1000),rate:'1',rateAt:new Date().toISOString(),rateSource:'test',issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}),verify:async()=>null}
 const order=async()=>{const r=await app.inject({method:'POST',url:'/v1/merchant/orders',headers:{...cashier,'idempotency-key':key()},payload:{lines}});expect(r.statusCode).toBe(201);return r.json()}
 const checkoutAuth=new Map<string,Record<string,string>>()
 const quote=(o:any,sender='NQ-stock-buyer')=>app.inject({method:'POST',url:`/v1/merchant/checkout/${o.checkoutToken}/quote`,headers:checkoutAuth.get(o.checkoutToken),payload:{revision:o.revision,asset:'NIM',sender}})
 const pay=(o:any,q:any,hash=o.id.replaceAll('-','').repeat(2))=>app.inject({method:'POST',url:`/v1/merchant/checkout/${o.checkoutToken}/payment`,headers:checkoutAuth.get(o.checkoutToken),payload:{revision:o.revision,quoteId:q.quote.id,hash}})
 const inventory=async()=>(await call('GET','/inventory')).json().items[0]
 async function remote(){
  env.remoteOrderingEnabled=true
  const wallet='NQ-customer-'+key(),customer={authorization:`Bearer ${await tokenFor(await makeUser(db,wallet))}`}
  await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${venue.id}/settings`,headers,payload:{published:true,description:'Lunch',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10}})
  await app.inject({method:'POST',url:`/v1/merchant/remote/venues/${venue.id}/heartbeat`,headers:cashier})
  await app.inject({method:'PATCH',url:`/v1/merchant/remote/venues/${venue.id}/availability`,headers:cashier,payload:{accepting:true}})
  const r=await app.inject({method:'POST',url:`/v1/merchant/remote/venues/${venue.id}/orders`,headers:{...customer,'idempotency-key':key()},payload:{lines}});expect(r.statusCode).toBe(201)
  checkoutAuth.set(r.json().checkoutToken,customer)
  return {order:r.json(),customer,wallet}
 }
 return {call,item,product,cashier,order,quote,pay,inventory,remote,base,employee,headers}
}
it('expires unsubmitted stock mathematically and refunds a late verified receipt without taking the next buyers hold',async()=>{
 const s=await setup(),a=await s.order(),b=await s.order(),qa=(await s.quote(a)).json(),before=Date.now()
 // Advance both Date.now() and new Date(); a partial clock leaves retry eligibility behind.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(before+61000)
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:0,availableQuantity:1})
 const qb=await s.quote(b);expect(qb.statusCode).toBe(200)
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date(before).toISOString()})
 expect((await s.pay(a,qa)).json().status).toBe('REFUND_PENDING')
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
})
it('pins an on-time submitted unknown hash through quote expiry and blocks physical corrections then settles once',async()=>{
 const s=await setup(),a=await s.order(),q=(await s.quote(a)).json(),before=Date.now()
 expect((await s.pay(a,q)).json().status).toBe('PAYMENT_PENDING')
 vi.spyOn(Date,'now').mockReturnValue(before+3600000)
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
 const corrected=await s.call('POST',`/inventory/${s.item.id}/movements`,{delta:-1,revision:1,reason:'Count',idempotencyKey:key()})
 expect(corrected.json().error.code).toBe('STOCK_RESERVED')
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date(before).toISOString()})
 expect((await s.pay(a,q)).json().status).toBe('PREPARING')
 expect(await s.inventory()).toMatchObject({quantity:0,reservedQuantity:0,availableQuantity:0})
})
it('retains the tracked decision even if tracking is switched off after quote, and freezes untracked decisions',async()=>{
 for(const tracked of [true,false]){
  const s=await setup(tracked),a=await s.order(),q=(await s.quote(a)).json()
  await s.call('PATCH',`/inventory/${s.item.id}`,{name:s.item.name,tracked:!tracked,threshold:0,revision:1,reason:'Policy'})
  app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})
  expect((await s.pay(a,q,tracked?'b'.repeat(64):'c'.repeat(64))).json().status).toBe('PREPARING')
  expect((await s.inventory()).quantity).toBe(tracked?0:1)
 }
})
it('keeps a paid remote order reserved until acceptance and releases rejection without a sale',async()=>{
 for(const accept of [true,false]){
  const s=await setup(),r=await s.remote(),q=(await s.quote(r.order,r.wallet)).json()
  app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})
  expect((await s.pay(r.order,q,accept?'d'.repeat(64):'f'.repeat(64))).json().status).toBe('AWAITING_ACCEPTANCE')
  expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
  const url=`/v1/merchant/remote/orders/${r.order.id}/${accept?'accept':'reject'}`,payload=accept?{preparationMinutes:10}:{reason:'Closing'}
  const decision=await app.inject({method:'POST',url,headers:s.cashier,payload});expect(decision.statusCode).toBe(200)
  expect((await app.inject({method:'POST',url,headers:s.cashier,payload})).statusCode).toBe(200)
  expect(await s.inventory()).toMatchObject({quantity:accept?0:1,reservedQuantity:0,availableQuantity:accept?0:1})
  const sales=(await s.call('GET',`/inventory/${s.item.id}/movements`)).json().movements.filter((m:any)=>m.kind==='SALE')
  if(accept)expect(sales).toMatchObject([{actorKind:'cashier',actorId:s.employee.id,actorName:'Ana'}]);else expect(sales).toHaveLength(0)
 }
})
it('gives POS and remote quotes competing for the last item exactly one winner',async()=>{
 const s=await setup(),pos=await s.order(),remote=await s.remote()
 const results=await Promise.all([s.quote(pos),s.quote(remote.order,remote.wallet)])
 expect(results.map(r=>r.statusCode).sort()).toEqual([200,409])
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
})
it('releases a customer cancellation and refunds any subsequent payment rather than taking a new hold',async()=>{
 const s=await setup(),r=await s.remote(),q=(await s.quote(r.order,r.wallet)).json()
 expect((await app.inject({method:'POST',url:`/v1/merchant/remote/orders/${r.order.id}/cancel`,headers:r.customer})).statusCode).toBe(200)
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:0,availableQuantity:1})
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})
 expect((await s.pay(r.order,q,'9'.repeat(64))).json().status).toBe('REFUND_PENDING')
 expect((await s.inventory()).quantity).toBe(1)
})
it('subtracts pending losses once from availability and prevents loss, reversal and stocktake from touching held units',async()=>{
 const s=await setup()
 const promoted=await app.inject({method:'PATCH',url:`/v1/merchant/employees/${s.employee.id}`,headers:s.headers,payload:{role:'MANAGER',permissions:['inventory.manage'],reason:'Stock duty'}})
 expect(promoted.statusCode).toBe(200)
 const loss=()=>app.inject({method:'POST',url:s.base+'/inventory/losses',headers:s.cashier,payload:{itemId:s.item.id,quantity:1,reason:'DAMAGED',comment:'Set aside',idempotencyKey:key()}})
 const pending=await loss();expect(pending.statusCode).toBe(200);expect(pending.json().status).toBe('PENDING')
 expect(await s.inventory()).toMatchObject({quantity:1,pendingLossQuantity:1,availableQuantity:0})
 expect((await s.call('POST',`/inventory/${s.item.id}/movements`,{delta:-1,revision:1,reason:'Count pending discard again',idempotencyKey:key()})).json().error.code).toBe('STOCK_RESERVED')
 const order=await s.order();expect((await s.quote(order)).json().error.code).toBe('INSUFFICIENT_STOCK')
 expect((await s.call('POST',`/inventory/losses/${pending.json().id}/decision`,{decision:'APPROVE',reason:'Reviewed',idempotencyKey:key()})).statusCode).toBe(200)
 expect(await s.inventory()).toMatchObject({quantity:0,pendingLossQuantity:0,availableQuantity:0})
 await s.call('POST',`/inventory/${s.item.id}/movements`,{delta:1,revision:2,reason:'Replacement',idempotencyKey:key()})
 const stocktake=(await s.call('POST','/inventory/stocktakes',{itemIds:[s.item.id],idempotencyKey:key()})).json()
 expect((await s.quote(order)).statusCode).toBe(200)
 expect((await loss()).json().error.code).toBe('STOCK_RESERVED')
 expect((await s.call('POST',`/inventory/stocktakes/${stocktake.id}/finalize`,{counts:[{itemId:s.item.id,countedQuantity:0}],reason:'Count at snapshot',idempotencyKey:key()})).json().error.code).toBe('STOCK_RESERVED')
 const history=(await s.call('GET',`/inventory/${s.item.id}/movements`)).json().movements
 const replacement=history.find((m:any)=>m.kind==='ADJUSTMENT')
 expect((await s.call('POST',`/inventory/${s.item.id}/movements/${replacement.id}/reverse`,{revision:3,reason:'Mistake',idempotencyKey:key()})).json().error.code).toBe('STOCK_RESERVED')
 expect(await s.inventory()).toMatchObject({quantity:1,pendingLossQuantity:0,reservedQuantity:1,availableQuantity:0})
})
it('bounds active reservations per cashier and makes quote retries idempotent',async()=>{
 const s=await setup()
 await s.call('POST',`/inventory/${s.item.id}/movements`,{delta:19,revision:1,reason:'Enough stock',idempotencyKey:key()})
 const first=await s.order(),q=await s.quote(first);expect(q.statusCode).toBe(200)
 expect((await s.quote(first)).json().quote.id).toBe(q.json().quote.id)
 for(let i=0;i<9;i++)expect((await s.quote(await s.order())).statusCode).toBe(200)
 expect((await s.quote(await s.order())).json().error.code).toBe('STOCK_RESERVATION_LIMIT')
 expect(await s.inventory()).toMatchObject({quantity:20,reservedQuantity:10,availableQuantity:10})
})
it('releases a paid remote timeout without restoring or consuming physical stock',async()=>{
 const s=await setup(),r=await s.remote(),q=(await s.quote(r.order,r.wallet)).json()
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})
 expect((await s.pay(r.order,q,'7'.repeat(64))).json().status).toBe('AWAITING_ACCEPTANCE')
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+181000)
 const timeout=await app.inject({method:'POST',url:`/v1/merchant/remote/orders/${r.order.id}/accept`,headers:s.cashier,payload:{preparationMinutes:10}})
 expect(timeout.statusCode).toBe(200);expect(timeout.json().status).toBe('REFUND_PENDING')
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:0,availableQuantity:1})
})

it('routes a predeployment paid remote order without a stock hold to refund instead of accepting it',async()=>{
 const s=await setup(),r=await s.remote(),q=(await s.quote(r.order,r.wallet)).json()
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()})
 expect((await s.pay(r.order,q,'6'.repeat(64))).json().status).toBe('AWAITING_ACCEPTANCE')
 // Upgrade fixture: before reservation deployment paid remote rows had no stock header.
 await db.delete(merchantStockReservation).where(eq(merchantStockReservation.orderId,r.order.id))
 const result=await app.inject({method:'POST',url:`/v1/merchant/remote/orders/${r.order.id}/accept`,headers:s.cashier,payload:{preparationMinutes:10}})
 expect(result.statusCode).toBe(200);expect(result.json().status).toBe('REFUND_PENDING')
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:0,availableQuantity:1})
})

it('settles a previously untracked quote using its original decision and releases a newer sibling reservation',async()=>{
 const s=await setup(false),a=await s.order(),original=(await s.quote(a)).json(),before=Date.now()
 expect(original.stockReservation.status).toBe('NONE')
 await s.call('PATCH',`/inventory/${s.item.id}`,{name:s.item.name,tracked:true,threshold:0,revision:1,reason:'Start tracking'})
 // Advance both Date.now() and new Date(); a partial clock leaves retry eligibility behind.
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(before+61000)
 const refreshed=await s.quote(a);expect(refreshed.statusCode).toBe(200)
 expect(refreshed.json().stockReservation.status).toBe('HELD')
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:1,availableQuantity:0})
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date(before).toISOString()})
 const paid=await s.pay(a,original,'5'.repeat(64));expect(paid.statusCode).toBe(200);expect(paid.json().status).toBe('PREPARING')
 expect(await s.inventory()).toMatchObject({quantity:1,reservedQuantity:0,availableQuantity:1})
})
it('allows either food disposal hold or POS reservation to claim the last portion, never both',async()=>{
 const s=await setup(),order=await s.order();
 const snapshot=(await s.call('POST','/inventory/stocktakes',{itemIds:[s.item.id],foodDay:{timeZone:'UTC',boundaryHour:0},idempotencyKey:key()})).json();
 const results=await Promise.all([
  s.call('POST',`/inventory/stocktakes/${snapshot.id}/finalize`,{counts:[{itemId:s.item.id,countedQuantity:1,allocation:{keep:0,disposal:1,donation:0,staffMeal:0}}],reason:'End of food day',idempotencyKey:key()}),
  s.quote(order),
 ]);
 expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
 const stock=await s.inventory();expect(stock.quantity).toBe(1);expect(stock.reservedQuantity+stock.pendingLossQuantity).toBe(1);expect(stock.availableQuantity).toBe(0);
});
it('keeps the day cutoff immutable while a payment confirms and leaves the cashier shift open',async()=>{
 const s=await setup(),order=await s.order(),quote=(await s.quote(order)).json();
 const w={date:new Date().toISOString().slice(0,10),timeZone:'UTC',boundaryHour:0};
 const previewPath='/day-closes/preview?'+new URLSearchParams({...w,boundaryHour:'0'});
 const p=(await s.call('GET',previewPath)).json();
 app.deps.merchantPayments!.verify=async({quote,hash})=>({...quote,hash,confirmedAt:new Date().toISOString()});
 const [closing,payment]=await Promise.all([
  s.call('POST','/day-closes',{...w,note:'Concurrent payment cutoff',expectedFingerprint:p.fingerprint,carry:p.snapshot.issues.map((i:any)=>({key:i.key,reason:'Service continues'})),idempotencyKey:key()}),
  s.pay(order,quote),
 ]);
 expect(payment.statusCode).toBe(200);expect([200,409]).toContain(closing.statusCode);
 if(closing.statusCode===200){
  const saved=closing.json(),issue=saved.snapshot.issues.find((i:any)=>i.key==='ORDER:'+order.id);
  expect(issue.status).toBe('AWAITING_PAYMENT');expect(saved.snapshot.sales).toHaveLength(0);
  expect((await s.call('GET','/day-closes')).json().items[0]).toEqual(saved);
 }else expect(closing.json().error.code).toBe('DAY_PREVIEW_CHANGED');
 const shift=await app.inject({url:'/v1/merchant/shifts/current',headers:s.cashier});expect(shift.json().closedAt).toBeNull();
});
