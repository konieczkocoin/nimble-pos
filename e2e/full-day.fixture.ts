import type {InventoryDelivery,InventoryItem,InventorySupplier,MerchantEmployee,MerchantProduct,MerchantVenue,RecipeVersion} from '../packages/shared/src/index'
export type StaffSession={token:string;employee:MerchantEmployee;venue:MerchantVenue}
import {expect,type Browser,type Page} from '@playwright/test'
export const API='http://localhost:3100'
export const EXPECTED={afterDelivery:{raw:120,finished:0},afterProduction:{raw:100,finished:10},afterCash:{raw:100,finished:9},afterRemote:{raw:100,finished:8},afterLoss:{raw:100,finished:7},money:{list:'2500',discount:'500',sales:'2000',cashReceived:'750',cashRefunded:'750',cashNet:'0',netSales:'1250',nimAtomic:'1250000'},loyaltyStamps:1} as const
export async function json<T=unknown>(response:{ok():boolean;url():string;status():number;text():Promise<string>;json():Promise<unknown>}){expect(response.ok(),`${response.url()} → ${response.status()} ${await response.text()}`).toBeTruthy();return await response.json() as T}
export async function actorPage(browser:Browser,role:string){
 const ctx=await browser.newContext({locale:'en-GB',timezoneId:'Europe/Warsaw'}),page=await ctx.newPage()
 await ctx.addInitScript(({address})=>{
  localStorage.setItem('nimble.mockAddress',address)
  // Wallet/host boundary only. No business route interception and no actual signature/transfer.
  const transfers:{recipient:string;value:number;data:string}[]=[]
  Object.assign(window,{__fullDayTransfers:transfers,nimiqPay:{network:'testnet',language:'en'},nimiq:{listAccounts:async()=>[address],getNetworkId:async()=>5,isConsensusEstablished:async()=>true,getBlockNumber:async()=>100,sendBasicTransactionWithData:async(tx:{recipient:string;value:number;data:string})=>{transfers.push(tx);return 'a'.repeat(64)}}})
 },{address:`NQ07 FULLDAY ${role} ${crypto.randomUUID().slice(0,8)}`})
 return page
}
export async function ownerToken(page:Page){const token=await page.evaluate(()=>localStorage.getItem('nimble.jwt'));expect(token).toBeTruthy();return token!}
export function client(page:Page,token:string){return async<T=unknown>(method:string,path:string,data?:object,key?:string)=>json<T>(await page.request.fetch(API+'/v1/merchant'+path,{method,headers:{authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})},data}))}
export async function changed<T=unknown>(page:Page,path:string,action:()=>Promise<unknown>){const response=page.waitForResponse(r=>new URL(r.url()).pathname===('/v1/merchant'+path)&&['POST','PATCH'].includes(r.request().method()));await action();return json<T>(await response)}
export async function staffSession(page:Page,terminalToken:string,session:StaffSession){
 await page.goto('/')
 await page.evaluate(({terminalToken,session,base})=>{localStorage.setItem(`nimble:merchant:${base}:terminal`,terminalToken);sessionStorage.setItem(`nimble:merchant:${base}:cashier`,JSON.stringify(session))},{terminalToken,session,base:API})
 await page.goto('/merchant/terminal')
}
export async function seed(owner:Page,customer:Page){
 const headers={authorization:`Bearer ${await ownerToken(owner)}`},call=client(owner,await ownerToken(owner)),key=()=>crypto.randomUUID()
 const venue=await call<MerchantVenue>('POST','/venues',{name:'Full-day cafe',fiatCurrency:'EUR',nimAddress:await owner.evaluate(()=>localStorage.getItem('nimble.mockAddress'))}),base='/venues/'+venue.id
 const raw=await call<InventoryItem>('POST',base+'/inventory',{name:'Full-day raw',unit:'PIECE',openingQuantity:100,tracked:true,threshold:0,reason:'Opening count',idempotencyKey:key()})
 const finished=await call<InventoryItem>('POST',base+'/inventory',{name:'Full-day prepared',unit:'PORTION',openingQuantity:0,tracked:true,threshold:0,reason:'Empty prepared stock',idempotencyKey:key()})
 const recipe=await call<RecipeVersion>('POST',base+'/recipes',{name:'Full-day batch',ingredients:[{kind:'ITEM',itemId:raw.id,quantity:'20',unit:'piece'}],reason:'Twenty raw units make ten portions',idempotencyKey:key()})
 const product=await call<MerchantProduct>('POST',base+'/catalog',{name:'Full-day coffee',category:'Coffee',variants:[{id:key(),name:'Cup',priceMinor:1250,stockBindings:[{itemId:finished.id,quantity:1}]}],extras:[]})
 const supplier=await call<InventorySupplier>('POST',base+'/inventory/suppliers',{name:'Full-day supplier',idempotencyKey:key()})
 const delivery=await call<InventoryDelivery>('POST',base+'/inventory/deliveries',{supplierId:supplier.id,reference:'Full-day delivery',lines:[{itemId:raw.id,expectedQuantity:20,unitCostMinor:100}],idempotencyKey:key()})
 const manager=await call<MerchantEmployee>('POST',base+'/employees',{name:'Full-day manager',pin:'5678'}),cashier=await call<MerchantEmployee>('POST',base+'/employees',{name:'Full-day cashier',pin:'1234'})
 await json(await owner.request.patch(API+'/v1/merchant/employees/'+manager.id,{headers,data:{role:'MANAGER',permissions:['inventory.manage','inventory.costs','menu.manage','reports.view','tasks.manage'],reason:'Full-day delegated operational access'}}))
 await call('POST',base+'/loyalty/program',{minimumMinor:500,productId:product.id,variantId:product.variants[0].id},key())
 await call('PATCH','/remote'+base+'/settings',{published:true,description:'Full-day simulation cafe',address:'Main 1',city:'Gliwice',pickupInstructions:'Counter',preparationMinutes:10,queueLimit:10})
 const terminal=await call<{terminalToken:string}>('POST',base+'/terminal')
 const login=async(employee:MerchantEmployee,pin:string)=>json<StaffSession>(await owner.request.post(API+'/v1/merchant/terminal/login',{headers:{'x-terminal-token':terminal.terminalToken},data:{employeeId:employee.id,pin}}))
 const stock=async()=>{const r=await call<{items:InventoryItem[]}>('GET',base+'/inventory');return {raw:r.items.find(i=>i.id===raw.id)!.quantity,finished:r.items.find(i=>i.id===finished.id)!.quantity}}
 const foreign=await client(customer,await ownerToken(customer))<MerchantVenue>('POST','/venues',{name:'Private second venue',fiatCurrency:'EUR',nimAddress:'NQ07 FOREIGN FULL DAY'})
 return {call,venue,base,raw,finished,recipe,product,delivery,manager,cashier,terminal,login,stock,foreign}
}
