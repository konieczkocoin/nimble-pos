import {afterAll,expect,it} from 'vitest';
import {freshDb} from './helpers/db';
import {authedApp,makeUser} from './helpers/actors';
const {db,close}=await freshDb(),{app,tokenFor}=authedApp(db);
afterAll(async()=>{await app.close();await close()});
const key=()=>crypto.randomUUID();
async function setup(){
 const address='NQ-cost-history-'+key(),headers={authorization:`Bearer ${await tokenFor(await makeUser(db,address))}`};
 const venue=(await app.inject({method:'POST',url:'/v1/merchant/venues',headers,payload:{name:'Costs',fiatCurrency:'PLN',nimAddress:address}})).json();
 const base=`/v1/merchant/venues/${venue.id}`,call=(method:any,path:string,payload?:any,auth=headers)=>app.inject({method,url:base+path,headers:auth,payload});
 const item=(await call('POST','/inventory',{name:'Flour',unit:'MILLIGRAM',tracked:true,openingQuantity:0,threshold:0,reason:'Empty',idempotencyKey:key()})).json();
 const supplier=(await call('POST','/inventory/suppliers',{name:'Mill',idempotencyKey:key()})).json();
 async function receive(quantity:number,totalCostMinor:number){
  const d=(await call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:item.id,expectedQuantity:quantity,totalCostMinor}],idempotencyKey:key()})).json();
  expect((await call('POST',`/inventory/deliveries/${d.id}/receipts`,{lines:[{itemId:item.id,quantity}],reason:'Receipt',idempotencyKey:key()})).statusCode).toBe(200);
 }
 return {headers,base,call,item,receive};
}
it('preserves exact historical issue costs after a later differently priced receipt and retries once',async()=>{
 const f=await setup();await f.receive(3000,10);
 const payload={delta:-1000,revision:2,reason:'Used',idempotencyKey:key()};
 const first=await f.call('POST',`/inventory/${f.item.id}/movements`,payload);expect(first.statusCode).toBe(200);
 expect((await f.call('POST',`/inventory/${f.item.id}/movements`,payload)).json()).toEqual(first.json());
 await f.receive(2000,20);
 const r=await f.call('GET',`/inventory/${f.item.id}/cost-history`);expect(r.statusCode).toBe(200);
 const entries=r.json().items,issue=entries.find((e:any)=>e.movementId===first.json().movement.id);
 // 10 groszy / 3000 mg * -1000 mg = -10/3 groszy; no rounding of the evidence.
 expect(issue).toMatchObject({delta:-1000,valuation:{fiatCurrency:'PLN',unit:'MILLIGRAM',unitCost:{numerator:'1',denominator:'300'},totalCost:{numerator:'-10',denominator:'3'},method:'WEIGHTED_AVERAGE'}});
 expect(entries.filter((e:any)=>e.movementId===issue.movementId)).toHaveLength(1);
 expect(entries).toHaveLength(4); // opening, first receipt, issue, second receipt
 expect(entries.find((e:any)=>e.kind==='OPENING').valuation).toBeNull();
 const other=await setup();expect((await other.call('GET',`/inventory/${f.item.id}/cost-history`)).statusCode).toBe(404);
});
it('keeps unknown issue costs unknown and reverses the original value rather than the current average',async()=>{
 const f=await setup();
 const unknown=(await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:3000,revision:1,reason:'Unpriced stock',idempotencyKey:key()})).json();
 const used=(await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-3000,revision:unknown.item.revision,reason:'Use unknown stock',idempotencyKey:key()})).json();
 await f.receive(3000,10);
 const known=(await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:-1000,revision:used.item.revision+1,reason:'Use known stock',idempotencyKey:key()})).json();
 await f.receive(2000,20);
 const reversal=await f.call('POST',`/inventory/${f.item.id}/movements/${known.movement.id}/reverse`,{revision:known.item.revision+1,reason:'Undo issue',idempotencyKey:key()});expect(reversal.statusCode).toBe(200);
 const entries=(await f.call('GET',`/inventory/${f.item.id}/cost-history`)).json().items;
 expect(entries.find((e:any)=>e.movementId===used.movement.id).valuation).toMatchObject({unitCost:null,totalCost:null});
 expect(entries.find((e:any)=>e.movementId===reversal.json().movement.id).valuation).toMatchObject({method:'REVERSAL',totalCost:{numerator:'10',denominator:'3'}});
});
it('checks live cost permission, isolates venues and keeps operational movement responses free of costs',async()=>{
 const f=await setup();await f.receive(3000,10);
 const employee=(await f.call('POST','/employees',{name:'Worker',pin:'1234'})).json(),terminal=(await f.call('POST','/terminal')).json();
 const login=(await app.inject({method:'POST',url:'/v1/merchant/terminal/login',headers:{'x-terminal-token':terminal.terminalToken},payload:{employeeId:employee.id,pin:'1234'}})).json();
 const worker={authorization:`Bearer ${login.token}`},path=`/inventory/${f.item.id}/cost-history`;
 expect((await f.call('GET',path,undefined,worker)).statusCode).toBe(403);
 const edit=(permissions:string[])=>app.inject({method:'PATCH',url:`/v1/merchant/employees/${employee.id}`,headers:f.headers,payload:{role:'MANAGER',permissions,reason:'Cost access'}});
 expect((await edit(['inventory.costs'])).statusCode).toBe(200);
 expect((await f.call('GET',path,undefined,worker)).statusCode).toBe(200);
 const page=(await f.call('GET',path+'?limit=1')).json();expect(page.items).toHaveLength(1);expect(page.hasMore).toBe(true);
 const next=(await f.call('GET',path+'?limit=1&page=1')).json();expect(next.items[0].movementId).not.toBe(page.items[0].movementId);
 expect((await edit([])).statusCode).toBe(200);
 expect((await f.call('GET',path,undefined,worker)).statusCode).toBe(403);
 const ordinary=await f.call('GET',`/inventory/${f.item.id}/movements`,undefined,worker);expect(ordinary.statusCode).toBe(200);
 expect(JSON.stringify(ordinary.json())).not.toMatch(/unitCost|totalCost|valuation/);
});
it('locks the venue currency after stock exists so a later delivery cannot mix currencies',async()=>{
 const f=await setup();await f.receive(3000,10);
 const result=await app.inject({method:'PATCH',url:f.base,headers:f.headers,payload:{name:'Costs',fiatCurrency:'EUR',nimAddress:'NQ-currency-test-address'}});
 expect(result.statusCode).toBe(409);expect(result.json().error.code).toBe('CURRENCY_LOCKED');
});
it('does not turn legacy currencyless averages or production batches into known new costs',async()=>{
 const f=await setup();
 await f.call('POST',`/inventory/${f.item.id}/movements`,{delta:3000,revision:1,reason:'Legacy stock',idempotencyKey:key()});
 const {merchantStockOperation}=await import('../src/db/schema'),{and,eq,sql}=await import('drizzle-orm');
 // Fixture represents an existing pre-migration cost record, not a new API write.
 await db.update(merchantStockOperation).set({data:{itemId:f.item.id,numerator:'9',denominator:'1'}}).where(and(eq(merchantStockOperation.venueId,f.item.venueId),eq(merchantStockOperation.kind,'COST')));
 const output=(await f.call('POST','/inventory',{name:'Prepared flour',unit:'PORTION',tracked:true,openingQuantity:0,threshold:0,reason:'Empty output',idempotencyKey:key()})).json();
 const recipe=(await f.call('POST','/recipes',{name:'Portion',ingredients:[{kind:'ITEM',itemId:f.item.id,quantity:'1',unit:'g'}],reason:'Recipe',idempotencyKey:key()})).json();
 const made=await f.call('POST','/production',{recipeVersionId:recipe.id,outputItemId:output.id,batches:1,expectedYieldPerBatch:1,actualYield:1,reason:'Production',idempotencyKey:key()});expect(made.statusCode).toBe(200);
 const outputEntries=(await f.call('GET',`/inventory/${output.id}/cost-history`)).json().items;
 expect(outputEntries.find((e:any)=>e.kind==='PRODUCTION').valuation.totalCost).toBeNull();
 const legacy={...made.json(),outputCost:{numerator:'9000',denominator:'1'},unitCosts:[{itemId:f.item.id,numerator:'9',denominator:'1'}]};delete legacy.fiatCurrency;
 await db.update(merchantStockOperation).set({data:legacy}).where(eq(merchantStockOperation.id,legacy.id));
 expect((await f.call('POST',`/production/${legacy.id}/reverse`,{reason:'Correct old batch',idempotencyKey:key()})).statusCode).toBe(200);
 for(const id of [output.id,f.item.id]){
  const entries=(await f.call('GET',`/inventory/${id}/cost-history`)).json().items;
  expect(entries.find((e:any)=>e.kind==='PRODUCTION_REVERSAL').valuation.totalCost).toBeNull();
 }
});
it('keeps receipts and corrections from a legacy differently denominated delivery unknown',async()=>{
 const f=await setup();
 const supplier=(await f.call('POST','/inventory/suppliers',{name:'Legacy mill',idempotencyKey:key()})).json();
 const delivery=(await f.call('POST','/inventory/deliveries',{supplierId:supplier.id,lines:[{itemId:f.item.id,expectedQuantity:3000,totalCostMinor:10}],idempotencyKey:key()})).json();
 const {merchantStockOperation}=await import('../src/db/schema'),{eq}=await import('drizzle-orm');
 // Persisted upgrade state: delivery was denominated differently before currency locking existed.
 await db.update(merchantStockOperation).set({data:{...delivery,fiatCurrency:'EUR'}}).where(eq(merchantStockOperation.id,delivery.id));
 const received=await f.call('POST',`/inventory/deliveries/${delivery.id}/receipts`,{lines:[{itemId:f.item.id,quantity:3000}],reason:'Old delivery',idempotencyKey:key()});expect(received.statusCode).toBe(200);
 const receipt=received.json().receipts[0];
 expect((await f.call('POST',`/inventory/deliveries/${delivery.id}/receipts/${receipt.id}/reverse`,{reason:'Return old delivery',idempotencyKey:key()})).statusCode).toBe(200);
 const entries=(await f.call('GET',`/inventory/${f.item.id}/cost-history`)).json().items;
 for(const kind of ['RECEIPT','RECEIPT_CORRECTION'])expect(entries.find((e:any)=>e.kind===kind).valuation).toMatchObject({fiatCurrency:'PLN',unitCost:null,totalCost:null});
});
