import type {MerchantOrder,MerchantReport,MerchantShift,InventoryDelivery,InventoryLoss,ProductionDraft,ProductionDraftExecution,CashSaleResult,CashRefund,RemoteVenue,LoyaltyCard,ShiftHandover,DayClose,FinanceReport} from '../packages/shared/src/index'
import {readFile} from 'node:fs/promises'
import {expect,test} from '@playwright/test'
import {connect} from './helpers'
import {API,EXPECTED,actorPage,changed,client,json,ownerToken,seed,staffSession} from './full-day.fixture'

test('SIMULATED wallet/chain: a full venue day uses real routes, native DB and four isolated roles',async({browser})=>{
 const owner=await actorPage(browser,'owner'),manager=await actorPage(browser,'manager'),cashier=await actorPage(browser,'cashier'),customer=await actorPage(browser,'customer')
 const operationalDate=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const part=(name:string)=>parts.find(p=>p.type===name)!.value;const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);if(Number(part('hour'))<4)date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10)}
 const startingDay=operationalDate()
 const runFrom=new Date(Date.now()-60000).toISOString().slice(0,16)
 const errors:string[]=[];for(const p of [owner,manager,cashier,customer])p.on('pageerror',e=>errors.push(e.message))
 try{
  await connect(owner);await connect(customer)
  const f=await seed(owner,customer),customerApi=client(customer,await ownerToken(customer))
  const managerSession=await f.login(f.manager,'5678');let activeManagerToken=managerSession.token
  await staffSession(manager,f.terminal.terminalToken,managerSession)
  await test.step('delivery received through manager UI; API stock is 120 raw and zero prepared',async()=>{
   await manager.getByRole('button',{name:'Inventory',exact:true}).click()
   await manager.getByRole('button',{name:'Deliveries, losses and stocktakes',exact:true}).click()
   await manager.getByLabel('Receipt quantity Full-day raw',{exact:true}).fill('20')
   await manager.getByLabel('Receipt reason Full-day delivery',{exact:true}).fill('Twenty raw units received')
   const delivery=await changed<InventoryDelivery>(manager,`${f.base}/inventory/deliveries/${f.delivery.id}/receipts`,()=>manager.getByRole('button',{name:'Receive delivery Full-day delivery',exact:true}).click())
   expect(delivery.status).toBe('RECEIVED');await expect(manager.getByText('Twenty raw units received',{exact:true})).toBeVisible();expect(await f.stock()).toEqual(EXPECTED.afterDelivery)
  })
  await test.step('save and execute production draft through manager UI',async()=>{
   await manager.getByRole('button',{name:'Production and preparations',exact:true}).click()
   // Playwright label text includes nested option text; keep strict single-element matching without exact text.
   await manager.getByLabel('Production recipe').selectOption(f.recipe.id)
   await manager.getByLabel('Finished stock item').selectOption(f.finished.id)
   await manager.getByLabel('Expected yield per batch',{exact:true}).fill('10')
   await manager.getByLabel('Production reason',{exact:true}).fill('One batch of ten portions')
   const draft=await changed<ProductionDraft>(manager,`${f.base}/production/drafts`,()=>manager.getByRole('button',{name:'Save production draft',exact:true}).click())
   expect(await f.stock()).toEqual(EXPECTED.afterDelivery)
   await manager.getByRole('button',{name:'Execute production draft',exact:true}).click()
   await manager.getByLabel('Actual finished quantity',{exact:true}).fill('10')
   const execution=await changed<ProductionDraftExecution>(manager,`${f.base}/production/drafts/${draft.id}/execute`,()=>manager.getByRole('button',{name:'Confirm draft execution',exact:true}).click())
   expect(execution.draft.status).toBe('EXECUTED');await expect(manager.getByText(/Produced · One batch of ten portions/)).toBeVisible();expect(await f.stock()).toEqual(EXPECTED.afterProduction)
  })
  // Same venue phone/terminal: selecting the cashier revokes the manager session.
  const cashierSession=await f.login(f.cashier,'1234'),cashierApi=client(cashier,cashierSession.token)
  await staffSession(cashier,f.terminal.terminalToken,cashierSession)
  expect((await manager.request.get(API+'/v1/merchant/session',{headers:{authorization:`Bearer ${managerSession.token}`}})).status()).toBe(401)
  const shift=await changed<MerchantShift>(cashier,'/shifts',()=>cashier.getByRole('button',{name:/^Open shift/}).click())
  let cashOrder!:MerchantOrder
  await test.step('cashier requests a 500-minor discount, owner approves, then cashier records 750 cash',async()=>{
   await cashier.getByRole('button',{name:/^Full-day coffee/}).click();await cashier.getByRole('button',{name:/^Add to basket/}).click()
   cashOrder=await changed<MerchantOrder>(cashier,'/orders',()=>cashier.getByRole('button',{name:/^Share checkout/}).click())
   await cashier.getByRole('button',{name:/^Queue(?: · \d+)?$/}).click()
   const card=cashier.locator('.m-order').first()
   await card.getByRole('button',{name:'Rabaty i zgody',exact:true}).click();await card.getByLabel('Rodzaj rabatu').selectOption('FIXED');await card.getByLabel('Wartość',{exact:true}).fill('500');await card.getByLabel('Powód rabatu',{exact:true}).fill('Full-day bounded promotion')
   await changed(cashier,`${f.base}/orders/${cashOrder.id}/discount`,()=>card.getByRole('button',{name:'Zapisz rabat lub wniosek',exact:true}).click())
   await expect(card.getByText(/Oczekuje na zgodę właściciela/)).toBeVisible()
   await owner.goto('/merchant/owner');await owner.getByRole('button',{name:'Rabaty i zgody',exact:true}).click()
   await changed(owner,`${f.base}/orders/${cashOrder.id}/discount/approve`,()=>owner.getByRole('button',{name:'Zatwierdź rabat',exact:true}).click())
   expect((await cashierApi<MerchantOrder[]>('GET',f.base+'/orders')).find(o=>o.id===cashOrder.id)!.totalMinor).toBe(750)
   await cashier.reload();await cashier.getByRole('button',{name:/^Queue(?: · \d+)?$/}).click()
   await card.getByRole('button',{name:'Rabaty i zgody',exact:true}).click();await expect(card.getByText(/Zastosowany: −/)).toBeVisible()
   await card.getByRole('button',{name:'Share checkout',exact:true}).click()
   await cashier.getByLabel('Cash received',{exact:true}).fill('10.00')
   const original=cashier.waitForRequest(r=>new URL(r.url()).pathname===`/v1/merchant/orders/${cashOrder.id}/cash/confirm`&&r.method()==='POST')
   const result=await changed<CashSaleResult>(cashier,`/orders/${cashOrder.id}/cash/confirm`,()=>cashier.getByRole('button',{name:'Confirm cash received',exact:true}).click())
   expect(result.cashReceipt).toMatchObject({dueMinor:750,tenderedMinor:1000,changeMinor:250});await expect(cashier.getByText('Cash recorded',{exact:true})).toBeVisible();expect(await f.stock()).toEqual(EXPECTED.afterCash)
   const sent=await original;expect(sent.headers()['idempotency-key']).toBeTruthy();const replayed=await cashierApi<CashSaleResult>('POST',`/orders/${cashOrder.id}/cash/confirm`,sent.postDataJSON(),sent.headers()['idempotency-key']);expect(replayed.cashReceipt).toEqual(result.cashReceipt);expect(await f.stock()).toEqual(EXPECTED.afterCash)
   await cashier.getByRole('button',{name:/^Queue(?: · \d+)?$/}).click()
   const paid=cashier.locator('.m-order').first();await paid.getByLabel('Ready quantity: Full-day coffee',{exact:true}).selectOption('1')
   await changed(cashier,`${f.base}/orders/${cashOrder.id}/readiness`,()=>paid.getByRole('button',{name:'Save readiness: Full-day coffee',exact:true}).click())
   await changed(cashier,`/orders/${cashOrder.id}/status`,()=>paid.getByRole('button',{name:/^Mark collected/}).click())
   await expect(paid.getByText('Collected',{exact:true})).toBeVisible()
  })
  let remote!:MerchantOrder
  await test.step('customer places a remote order, joins loyalty and approves the simulated NIM wallet',async()=>{
   await cashier.getByLabel('Accept new remote orders',{exact:true}).check()
   await expect.poll(async()=>(await customerApi<{venue:RemoteVenue}>('GET','/remote/venues/'+f.venue.id)).venue.available).toBe(true)
   await customer.goto('/venues/'+f.venue.id);await customer.getByRole('button',{name:/^Full-day coffee/}).click();await customer.getByRole('button',{name:/^Add to basket/}).click()
   remote=await changed<MerchantOrder>(customer,'/remote'+f.base+'/orders',()=>customer.getByRole('button',{name:/^Place order/}).click())
   await customer.getByRole('link',{name:/^Review & pay/}).click();await customer.getByRole('button',{name:'Join loyalty card',exact:true}).click()
   await expect(customer.getByLabel('Collect a stamp for this purchase',{exact:true})).toBeChecked()
   const quoted=await changed<MerchantOrder>(customer,`/checkout/${remote.checkoutToken}/quote`,()=>customer.getByRole('button',{name:/^Get exact NIM quote/}).click())
   expect(quoted.quote!.rateSource).toBe('FULL_DAY_SIMULATION');expect(quoted.quote!.amountAtomic).toBe(EXPECTED.money.nimAtomic)
   const paid=await changed<MerchantOrder>(customer,`/checkout/${remote.checkoutToken}/payment`,()=>customer.getByRole('button',{name:/^Approve exact amount in wallet/}).click())
   expect(paid.status).toBe('AWAITING_ACCEPTANCE');expect(await customer.evaluate(()=>(window as unknown as {__fullDayTransfers:object[]}).__fullDayTransfers)).toMatchObject([{recipient:f.venue.nimAddress,value:1250000,data:quoted.quote!.reference}]);await expect(customer.getByText('Payment received. The cashier must accept your order before preparation starts.',{exact:true})).toBeVisible();expect(await f.stock()).toEqual(EXPECTED.afterCash)
  })
  await test.step('cashier accepts, prepares and verifies pickup; customer earns one stamp',async()=>{
   await cashier.getByRole('button',{name:/^Accept order/}).click()
   await expect.poll(f.stock).toEqual(EXPECTED.afterRemote)
   // The remote card includes the same per-line readiness control as the counter queue.
   await cashier.getByLabel('Ready quantity: Full-day coffee',{exact:true}).selectOption('1')
   await changed(cashier,`${f.base}/orders/${remote.id}/readiness`,()=>cashier.getByRole('button',{name:'Save readiness: Full-day coffee',exact:true}).click())
   remote=await customerApi<MerchantOrder>('GET','/remote/orders/'+remote.id)
   expect(remote.status).toBe('READY');expect(remote.pickup!.code).toBeTruthy()
   await cashier.getByLabel('Pickup QR token or short code',{exact:true}).fill(remote.pickup!.code)
   await cashier.getByRole('button',{name:/^Verify pickup/}).click();await cashier.getByRole('button',{name:/^Confirm handover/}).click()
   await expect.poll(async()=>(await customerApi<MerchantOrder>('GET','/remote/orders/'+remote.id)).status).toBe('COLLECTED')
   await customer.goto('/orders/'+remote.id);await expect(customer.getByText('Enjoy your order.',{exact:true})).toBeVisible()
   await customer.goto('/merchant/cards');await expect(customer.getByLabel('1 / 5',{exact:true})).toBeVisible();expect((await customerApi<LoyaltyCard[]>('GET','/loyalty/cards'))[0].available).toBe(EXPECTED.loyaltyStamps)
  })
  await test.step('owner records a one-portion loss and checks physical stock',async()=>{
   await owner.goto('/merchant/owner');await owner.getByRole('button',{name:'Inventory',exact:true}).click();await owner.getByRole('button',{name:'Deliveries, losses and stocktakes',exact:true}).click();await owner.getByRole('button',{name:'Losses',exact:true}).click()
   await owner.getByLabel('Loss item').selectOption(f.finished.id);await owner.getByLabel('Loss quantity',{exact:true}).fill('1');await owner.getByLabel('Loss type').selectOption('DAMAGED');await owner.getByLabel('Loss explanation',{exact:true}).fill('One prepared portion damaged')
   const loss=await changed<InventoryLoss>(owner,`${f.base}/inventory/losses`,()=>owner.getByRole('button',{name:'Submit loss',exact:true}).click())
   expect(loss.status).toBe('APPLIED');await expect(owner.getByText('Damaged · Applied to stock',{exact:true})).toBeVisible();expect(await f.stock()).toEqual(EXPECTED.afterLoss)
  })
  let frozenShift!:MerchantReport
  await test.step('cashier hands over and closes; returning manager acknowledges on the same terminal',async()=>{
   await cashier.getByRole('button',{name:'Handover',exact:true}).click();await cashier.getByLabel('Handover note',{exact:true}).fill('Full-day stock and orders reconciled');await cashier.getByLabel('Successor').selectOption(f.manager.id)
   const handover=await changed<ShiftHandover>(cashier,`${f.base}/handovers`,()=>cashier.getByRole('button',{name:'Record handover snapshot',exact:true}).click());expect(handover.status).toBe('PENDING')
   await cashier.getByRole('button',{name:'Shift',exact:true}).click();frozenShift=await changed<MerchantReport>(cashier,`/shifts/${shift.id}/close`,()=>cashier.getByRole('button',{name:/^Close my shift/}).click());await expect(cashier.getByText('Shift closed. Your summary is ready.',{exact:true})).toBeVisible();expect(frozenShift.totals.grossMinor).toBe(2000)
   const next=await f.login(f.manager,'5678');activeManagerToken=next.token;await staffSession(manager,f.terminal.terminalToken,next);const managerShift=await changed<MerchantShift>(manager,'/shifts',()=>manager.getByRole('button',{name:/^Open shift/}).click());await manager.getByRole('button',{name:'Handover',exact:true}).click();await manager.getByRole('button',{name:'I acknowledge these open matters',exact:true}).click();await expect(manager.getByText('Acknowledged',{exact:true})).toBeVisible()
   expect((await f.call<{items:ShiftHandover[]}>('GET',f.base+'/handovers')).items.find(h=>h.id===handover.id)!.status).toBe('ACKNOWLEDGED')
   await manager.getByRole('button',{name:'Shift',exact:true}).click();const managerReport=await changed<MerchantReport>(manager,`/shifts/${managerShift.id}/close`,()=>manager.getByRole('button',{name:/^Close my shift/}).click());expect(managerReport.totals.grossMinor).toBe(0)
  })
  await test.step('owner confirms physical cash refund without altering stock or the closed shift',async()=>{
   await owner.goto('/merchant/owner');await owner.getByLabel('Cash order for refund').selectOption(cashOrder.id)
   await owner.getByLabel('Cash refund reason',{exact:true}).fill('Full-day customer return');await owner.getByLabel('I understand this request cannot be cancelled and stops pickup.',{exact:true}).check();const requested=await changed<CashRefund>(owner,`/orders/${cashOrder.id}/cash/refund/request`,()=>owner.getByRole('button',{name:'Request full cash refund',exact:true}).click())
   expect((await manager.request.post(API+`/v1/merchant/orders/${cashOrder.id}/cash/refund/confirm`,{headers:{authorization:`Bearer ${activeManagerToken}`,'idempotency-key':crypto.randomUUID()},data:{refundId:requested.id,cashHandedBack:true}})).status()).toBe(403)
   await owner.getByLabel('I have physically handed the full cash amount back to the customer.',{exact:true}).check();await owner.getByRole('button',{name:'Confirm cash physically handed back',exact:true}).click();await expect(owner.getByText('Cash refund confirmed',{exact:true})).toBeVisible()
   expect((await f.call<CashRefund>('GET',`/orders/${cashOrder.id}/cash/refund`)).amountMinor).toBe(750);expect(await f.stock()).toEqual(EXPECTED.afterLoss)
   expect(await f.call('GET',`/shifts/${shift.id}/report`)).toEqual(frozenShift)
  })
  await test.step('owner closes the operational day and exports real finance ledger',async()=>{
   expect(operationalDate(),'Run crossed Warsaw 04:00; repeat with a fresh empty test database.').toBe(startingDay)
   await owner.getByRole('button',{name:'Day closing',exact:true}).click();await owner.getByLabel('Operational timezone',{exact:true}).fill('Europe/Warsaw');await owner.getByLabel('Operational day starts at hour',{exact:true}).fill('4');await owner.getByRole('button',{name:'Review day closing',exact:true}).click();await expect(owner.getByText('No unresolved matters at this cutoff.',{exact:true})).toBeVisible()
   await owner.getByLabel('Day closing note',{exact:true}).fill('Full-day browser acceptance cutoff');const closed=await changed<DayClose>(owner,f.base+'/day-closes',()=>owner.getByRole('button',{name:'Close operational day',exact:true}).click());expect(closed.snapshot.sales).toEqual([{currency:'EUR',totalMinor:'2000',count:2}]);expect(closed.snapshot.cash![0]).toMatchObject({receivedMinor:'750',confirmedRefundsMinor:'750',netMinor:'0'});await expect(owner.getByText(/Full-day browser acceptance cutoff · owner:/)).toBeVisible()
   await owner.getByRole('button',{name:'Financial reconciliation',exact:true}).click();await owner.getByLabel('Finance from (UTC)').fill(runFrom);await owner.getByLabel('Finance until exclusive (UTC)').fill(new Date(Date.now()+120000).toISOString().slice(0,16));await owner.getByRole('button',{name:'Generate reconciliation',exact:true}).click();await expect(owner.getByText('Known records are consistent.',{exact:true})).toBeVisible()
   const query=new URLSearchParams({from:new Date((await owner.getByLabel('Finance from (UTC)').inputValue())+'Z').toISOString(),until:new Date((await owner.getByLabel('Finance until exclusive (UTC)').inputValue())+'Z').toISOString()})
   const finance=await f.call<FinanceReport>('GET',f.base+'/finance?'+query);expect(finance.entries.filter(e=>e.kind==='SALE')).toHaveLength(2);expect(finance.fiat[0]).toMatchObject({listMinor:EXPECTED.money.list,discountMinor:EXPECTED.money.discount,salesMinor:EXPECTED.money.sales,refundedSalesMinor:'750',netSalesMinor:EXPECTED.money.netSales});expect(finance.assets[0].receivedAtomic).toBe(EXPECTED.money.nimAtomic);expect(finance.cash[0].netMinor).toBe(EXPECTED.money.cashNet)
   const download=owner.waitForEvent('download');await owner.getByRole('button',{name:'Export displayed reconciliation CSV',exact:true}).click();const file=await download,csv=await readFile((await file.path())!,'utf8');expect(csv).toContain('"CASH_REFUND_CONFIRMED"');expect(csv).toContain('"1250000"');expect(csv).toContain('"payment_method","cash_receipt_id"')
   expect(await f.stock()).toEqual(EXPECTED.afterLoss)
  })
  await test.step('private second venue stays invisible to owner and operational actor',async()=>{
   const ownerHeaders={authorization:`Bearer ${await ownerToken(owner)}`},currentManager=await manager.evaluate(()=>JSON.parse(sessionStorage.getItem(`nimble:merchant:${'http://localhost:3100'}:cashier`)!).token)
   expect((await owner.request.get(API+`/v1/merchant/venues/${f.foreign.id}/finance?from=2026-10-01T00:00:00Z&until=2026-10-02T00:00:00Z`,{headers:ownerHeaders})).status()).toBe(404)
   expect((await manager.request.get(API+`/v1/merchant/venues/${f.foreign.id}/inventory`,{headers:{authorization:`Bearer ${currentManager}`}})).status()).toBe(404)
   await owner.reload();await expect(owner.getByRole('option',{name:'Private second venue',exact:true})).toHaveCount(0)
  })
  expect(errors).toEqual([])
 }finally{await Promise.allSettled([owner,manager,cashier,customer].map(p=>p.context().close()))}
})
