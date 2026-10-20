import { afterAll, expect, it } from 'vitest'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(async () => { await app.close(); await close() })
const key = () => crypto.randomUUID()
function beforeDeadline<T>(pending:PromiseLike<T>,message:string):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(message)),5000)
    Promise.resolve(pending).then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})
  })
}
it('accepts a reward only when stock is available, atomically spends stamps and never consumes twice', async () => {
  const owner = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-reward-stock-owner'))}` }
  const customer = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-reward-stock-customer'))}` }
  const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers: owner, payload: { name: 'Reward Cafe', fiatCurrency: 'EUR', nimAddress: 'NQ-reward-stock-owner' } })).json()
  const base = `/v1/merchant/venues/${venue.id}`
  const call = (method: any, path: string, payload?: any) => app.inject({ method, url: base + path, headers: { ...owner, 'idempotency-key': key() }, payload })
  const product = (await call('POST', '/catalog', { name: 'Coffee', category: 'Drinks', variants: [{ id: key(), name: 'Small', priceMinor: 450 }], extras: [] })).json()
  expect((await call('POST', '/loyalty/program', { minimumMinor: 400, productId: product.id, variantId: product.variants[0].id })).statusCode).toBe(200)
  const card = (await app.inject({ method: 'POST', url: base + '/loyalty/join', headers: { ...customer, 'idempotency-key': key() }, payload: {} })).json()
  const employee = (await call('POST', '/employees', { name: 'Ana', pin: '1234' })).json()
  const terminal = (await call('POST', '/terminal')).json()
  const login = (await app.inject({ method: 'POST', url: '/v1/merchant/terminal/login', headers: { 'x-terminal-token': terminal.terminalToken }, payload: { employeeId: employee.id, pin: '1234' } })).json()
  const cashier = { authorization: `Bearer ${login.token}` }
  expect((await app.inject({ method: 'POST', url: '/v1/merchant/shifts', headers: cashier })).statusCode).toBe(201)
  app.deps.merchantPayments = {
    quote: async input => ({ ...input, id: key(), network: 'nimiq:5', amountAtomic: '1000', rate: '1', rateAt: new Date().toISOString(), rateSource: 'test', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString() }),
    verify: async ({ quote, hash }) => ({ ...quote, hash, confirmedAt: new Date().toISOString() }),
  }
  const lines = [{ productId: product.id, variantId: product.variants[0].id, extraIds: [], quantity: 1 }]
  async function earnFive() {
    for (let i = 0; i < 5; i++) {
      const created = await app.inject({ method: 'POST', url: '/v1/merchant/orders', headers: { ...cashier, 'idempotency-key': key() }, payload: { lines } })
      expect(created.statusCode, created.body).toBe(201)
      const order = created.json()
      const checkout = `/v1/merchant/checkout/${order.checkoutToken}`
      expect((await app.inject({ method: 'POST', url: checkout + '/loyalty', headers: { ...customer, 'idempotency-key': key() }, payload: { cardId: card.id, revision: 1 } })).statusCode).toBe(200)
      const q = (await app.inject({ method: 'POST', url: checkout + '/quote', payload: { revision: 1, asset: 'NIM', sender: 'NQ-reward-stock-customer' } })).json()
      expect((await app.inject({ method: 'POST', url: checkout + '/payment', payload: { revision: 1, quoteId: q.quote.id, hash: key().replaceAll('-', '').repeat(2) } })).statusCode).toBe(200)
    }

  }
  await earnFive()
  const item = (await call('POST', '/inventory', { name: 'Coffee portions', unit: 'PORTION', tracked: true, openingQuantity: 0, threshold: 0, reason: 'Opening', idempotencyKey: key() })).json()
  const recipe=(await call('POST','/recipes',{name:'Reward recipe',ingredients:[{kind:'ITEM',itemId:item.id,quantity:'1',unit:'portion'}],reason:'Reward stock',idempotencyKey:key()})).json()
  expect((await call('POST', '/catalog', { ...product, variants: [{ ...product.variants[0], recipeVersionId:recipe.id }] })).statusCode).toBe(200)
  const reward = (await app.inject({ method: 'POST', url: `/v1/merchant/loyalty/cards/${card.id}/reserve`, headers: { ...customer, 'idempotency-key': key() }, payload: {} })).json()
  const accept = (retryKey = key()) => app.inject({ method: 'POST', url: base + '/loyalty/accept', headers: { ...cashier, 'idempotency-key': retryKey }, payload: { token: reward.token } })
  expect((await accept()).statusCode).toBe(409)
  const getCard = async () => (await app.inject({ url: `/v1/merchant/loyalty/cards/${card.id}`, headers: customer })).json()
  expect(await getCard()).toMatchObject({ balance: 5 })
  expect((await getCard()).entries.filter((x: any) => x.kind === 'REDEEM')).toHaveLength(0)
  expect((await call('POST', `/inventory/${item.id}/movements`, { delta: 1, revision: item.revision, reason: 'Restocked', idempotencyKey: key() })).statusCode).toBe(200)
  // A paid order and a reward compete for the same last portion.
  const paidOrder = (await app.inject({ method: 'POST', url: '/v1/merchant/orders', headers: { ...cashier, 'idempotency-key': key() }, payload: { lines } })).json()
  const checkout = `/v1/merchant/checkout/${paidOrder.checkoutToken}`
  const quoted = (await app.inject({ method: 'POST', url: checkout + '/quote', payload: { revision: 1, asset: 'NIM', sender: 'NQ-reward-stock-customer' } })).json()
  expect(quoted.quote).toBeDefined()
  expect((await accept()).statusCode).toBe(409)
  expect((await app.inject({ method: 'POST', url: checkout + '/payment', payload: { revision: 1, quoteId: quoted.quote.id, hash: key().replaceAll('-', '').repeat(2) } })).statusCode).toBe(200)
  expect((await accept()).statusCode).toBe(409)
  const depleted = (await call('GET', '/inventory')).json().items[0]
  expect(depleted.quantity).toBe(0)
  expect((await call('POST', `/inventory/${item.id}/movements`, { delta: 1, revision: depleted.revision, reason: 'Reward portion', idempotencyKey: key() })).statusCode).toBe(200)
  const retryKey = key(), accepted = await accept(retryKey)
  expect(accepted.statusCode).toBe(200)
  expect(accepted.json()).toMatchObject({ id: reward.id, status: 'PREPARING' })
  const {merchantStockOperation}=await import('../src/db/schema')
  const frozenRecipe=(await db.select().from(merchantStockOperation)).find(row=>(row.data as any).rewardId===reward.id)
  expect((frozenRecipe!.data as any).recipeSnapshot).toMatchObject({id:recipe.id,version:1,costMinor:null})
  expect((await call('GET', '/inventory')).json().items[0].quantity).toBe(0)
  expect(await getCard()).toMatchObject({ balance: 0 })
  // Changing the current menu after acceptance cannot change the already consumed reward.
  expect((await call('POST', '/catalog', { ...product, variants: [{ ...product.variants[0], stockBindings: [{ itemId: item.id, quantity: 9 }] }] })).statusCode).toBe(200)
  expect((await accept(retryKey)).json()).toEqual(accepted.json())
  expect((await accept()).json()).toEqual(accepted.json())
  const movements = (await call('GET', `/inventory/${item.id}/movements`)).json().movements
  expect(movements.filter((x: any) => x.kind === 'SALE')).toHaveLength(2)
  expect(movements.find((x: any) => x.kind === 'SALE').delta).toBe(-1)
  // Three independent public operations race for one shared remaining portion.
  expect((await call('POST', '/catalog', { ...product, variants: [{ ...product.variants[0], stockBindings: [{ itemId: item.id, quantity: 1 }] }] })).statusCode).toBe(200)
  const beforeRace = (await call('GET', '/inventory')).json().items[0]
  expect((await call('POST', `/inventory/${item.id}/movements`, { delta: 6, revision: beforeRace.revision, reason: 'Next loyalty cycle', idempotencyKey: key() })).statusCode).toBe(200)
  await earnFive()
  expect((await call('GET', '/inventory')).json().items[0].quantity).toBe(1)
  const raceRewardResponse = await app.inject({ method: 'POST', url: `/v1/merchant/loyalty/cards/${card.id}/reserve`, headers: { ...customer, 'idempotency-key': key() }, payload: {} })
  expect(raceRewardResponse.statusCode).toBe(200)
  const raceReward = raceRewardResponse.json()
  const { env } = await import('../src/env')
  const priorRemoteFlag = env.remoteOrderingEnabled
  env.remoteOrderingEnabled = true
  try {
    expect((await app.inject({ method: 'PATCH', url: `/v1/merchant/remote/venues/${venue.id}/settings`, headers: owner, payload: { published: true, description: 'Coffee', address: 'Main 1', city: 'Gliwice', pickupInstructions: 'Counter', preparationMinutes: 10 } })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/v1/merchant/remote/venues/${venue.id}/heartbeat`, headers: cashier })
    expect((await app.inject({ method: 'PATCH', url: `/v1/merchant/remote/venues/${venue.id}/availability`, headers: cashier, payload: { accepting: true } })).statusCode).toBe(200)
    const remoteCustomer = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-threeway-remote-customer'))}` }
    const contenders = []
    for (const [url, headers] of [['/v1/merchant/orders', cashier], [`/v1/merchant/remote/venues/${venue.id}/orders`, remoteCustomer]] as const) {
      const created = await app.inject({ method: 'POST', url, headers: { ...headers, 'idempotency-key': key() }, payload: { lines } })
      expect(created.statusCode, created.body).toBe(201)
      contenders.push(created.json())
    }
    // Pause the external quote provider after the remote queue decision is locked.
    // Other public operations must still settle without waiting for that provider.
    const gateway=app.deps.merchantPayments!
    let entered!:()=>void,release!:()=>void
    const atProvider=new Promise<void>(resolve=>{entered=resolve})
    const providerReleased=new Promise<void>(resolve=>{release=resolve})
    app.deps.merchantPayments={...gateway,quote:async input=>{
      const quote=await gateway.quote(input)
      if(input.sender==='NQ-threeway-remote-customer'){entered();await providerReleased}
      return quote
    }}
    const remotePending=app.inject({method:'POST',headers:remoteCustomer,url:`/v1/merchant/checkout/${contenders[1].checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-threeway-remote-customer'}})
    type Response=Awaited<typeof remotePending>
    let otherRequests:Promise<[Response,Response]>|undefined
    let pos!:Response,remote!:Response,rewardResult!:Response
    try{
      await beforeDeadline(atProvider,'Remote quote did not reach the provider')
      otherRequests=Promise.all([
        app.inject({method:'POST',url:`/v1/merchant/checkout/${contenders[0].checkoutToken}/quote`,payload:{revision:1,asset:'NIM',sender:'NQ-reward-stock-customer'}}),
        app.inject({method:'POST',url:base+'/loyalty/accept',headers:{...cashier,'idempotency-key':key()},payload:{token:raceReward.token}}),
      ])
      ;[pos,rewardResult]=await beforeDeadline(otherRequests,'POS and reward are blocked by an unrelated remote quote provider')
      release()
      remote=await remotePending
    }finally{
      release()
      await Promise.allSettled([remotePending,...(otherRequests?[otherRequests]:[])])
      app.deps.merchantPayments=gateway
    }
    expect([pos.statusCode, remote.statusCode, rewardResult.statusCode].sort()).toEqual([200, 409, 409])
    for (const response of [pos, remote, rewardResult].filter(response => response.statusCode !== 200)) {
      expect(response.json().error.code).toBe('INSUFFICIENT_STOCK')
    }
    expect(await getCard()).toMatchObject({ balance: rewardResult.statusCode === 200 ? 0 : 5 })
    const currentReward = (await getCard()).rewards.find((r: any) => r.id === raceReward.id)
    expect(currentReward.status).toBe(rewardResult.statusCode === 200 ? 'PREPARING' : 'RESERVED')
    const finalItem = (await call('GET', '/inventory')).json().items[0]
    expect(finalItem.quantity).toBeGreaterThanOrEqual(0)
    expect(finalItem.availableQuantity).toBe(0)
  } finally {
    env.remoteOrderingEnabled = priorRemoteFlag
  }

},15000)
