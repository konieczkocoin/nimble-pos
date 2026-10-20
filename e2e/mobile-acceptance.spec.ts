import {writeFile} from 'node:fs/promises'
import {expect,test,type Page,type TestInfo} from '@playwright/test'
import type {ProductionDraft} from '../packages/shared/src/index'
import {actorPage,seed,staffSession} from './full-day.fixture'

const english=/Something good|for your day\.|Your basket\.|Choose something from the menu|We’ll take it from here|Estimates in|Share checkout|Open shift|Shift open|Checking cash|Cash payment|Production reason|No staff tasks yet|Loading staff tasks|Network error|Failed to fetch|PERSONAL SHIFT|COUNTER|OWNER WORKSPACE|TODAY’S LITTLE JOYS|Server confirms prices and availability|Made for good moments|Pay by code|A moment for|your customer\.|Customer scans the QR|Scan to review & pay|Copy checkout link|Your summary covers only|YOUR VENUE|Live estimate unavailable/
async function inspect(page:Page,name:string,info:TestInfo){
 await page.screenshot({path:info.outputPath(name+'.png'),fullPage:true,animations:'disabled'})
 await expect(page.locator('body')).not.toContainText(english)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>document.documentElement.clientWidth+1))
 const overflow=await page.evaluate(()=>{
  const width=document.documentElement.clientWidth
  return Array.from(document.querySelectorAll('main button, main input, main select, main textarea')).filter(el=>{
   const r=el.getBoundingClientRect(),s=getComputedStyle(el)
   if(r.width===0||r.height===0||s.position==='fixed'||el.closest('[data-horizontal-scroll="table"]'))return false
   return r.right>width+1||r.left< -1
  }).slice(0,12).map(el=>({tag:el.tagName,class:el.className,text:(el.textContent??'').slice(0,90),right:el.getBoundingClientRect().right}))
 })
 expect(overflow,`Horizontal overflow on ${name}`).toEqual([])
}
async function connectPolish(page:Page){await page.goto('/');await page.getByRole('button',{name:'Połącz portfel',exact:true}).click();await expect(page.getByRole('button',{name:'Zapłać',exact:true})).toBeVisible()}
for(const width of [320,390,736,1280])test(`Polish operational screens at ${width}px`,async({browser},info)=>{
 const owner=await actorPage(browser,'mobile-owner-'+width,'pl-PL'),customer=await actorPage(browser,'mobile-customer-'+width,'pl-PL'),manager=await actorPage(browser,'mobile-manager-'+width,'pl-PL')
 await manager.setViewportSize({width,height:900});await owner.setViewportSize({width,height:900})
 try{
  await connectPolish(owner);await connectPolish(customer);const f=await seed(owner,customer)
  await f.call('POST',f.base+'/production',{recipeVersionId:f.recipe.id,outputItemId:f.finished.id,batches:1,expectedYieldPerBatch:10,actualYield:10,reason:'Mobilne dane testowe',lot:{label:'',expiresAt:null},idempotencyKey:crypto.randomUUID()})
  const session=await f.login(f.manager,'5678');await staffSession(manager,f.terminal.terminalToken,session)
  await manager.getByRole('button',{name:/^Otwórz zmianę/}).click()
  // Keep all labels Polish; seeded product/resource names are deliberate user data.
  await inspect(manager,'basket-empty',info)
  await manager.getByRole('button',{name:/^Full-day coffee/}).click()
  await manager.getByRole('button',{name:/^Dodaj do koszyka/}).click()
  await inspect(manager,'basket-filled',info)
  await manager.getByRole('button',{name:/^Udostępnij płatność/}).click()
  await expect(manager.getByRole('heading',{name:/^Płatność gotówką$/})).toBeVisible()
  await manager.getByLabel('Otrzymana gotówka',{exact:true}).fill('błąd')
  await expect(manager.getByRole('button',{name:'Potwierdź przyjęcie gotówki',exact:true})).toBeDisabled()
  await manager.getByLabel('Otrzymana gotówka',{exact:true}).fill('20,00')
  await expect(manager.getByRole('button',{name:'Potwierdź przyjęcie gotówki',exact:true})).toBeEnabled()
  await inspect(manager,'payment',info)
  await manager.getByRole('button',{name:'Magazyn',exact:true}).click()
  await expect(manager.getByRole('button',{name:'Full-day raw',exact:true})).toBeVisible()
  await inspect(manager,'inventory',info)
  await manager.getByRole('button',{name:'Produkcja i półprodukty',exact:true}).click()
  await manager.getByLabel('Receptura produkcyjna').selectOption(f.recipe.id)
  await manager.getByLabel('Zasób gotowego produktu').selectOption(f.finished.id)
  await manager.getByLabel('Oczekiwany uzysk z partii',{exact:true}).fill('10')
  await manager.getByLabel('Opis produkcji',{exact:true}).fill('Mobilny szkic testowy')
  await manager.getByRole('button',{name:'Zapisz szkic produkcji',exact:true}).click()
  await expect(manager.getByRole('button',{name:'Otwórz szkic produkcji',exact:true})).toBeVisible()
  await inspect(manager,'draft',info)
  const drafts=await f.call<{items:ProductionDraft[]}>('GET',f.base+'/production/drafts');expect(drafts.items).toHaveLength(1)
  await manager.getByRole('button',{name:'Zadania pracowników',exact:true}).click()
  await expect(manager.getByText('Nie ma jeszcze zadań pracowników.',{exact:true})).toBeVisible()
  await inspect(manager,'tasks-empty',info)
  await manager.getByRole('button',{name:'Zmiana',exact:true}).click()
  await expect(manager.getByRole('button',{name:/^Zamknij moją zmianę/})).toBeVisible()
  await inspect(manager,'report',info)
 }catch(error){for(const [name,page] of [['owner',owner],['manager',manager]] as const){if(page.url()!=='about:blank'){await writeFile(info.outputPath('failure-'+name+'.txt'),await page.locator('body').innerText());await page.screenshot({path:info.outputPath('failure-'+name+'.png'),fullPage:true})}}throw error
 }finally{await Promise.allSettled([owner,customer,manager].map(p=>p.context().close()))}
})

test('Polish loading/error/empty, keyboard recovery and late venue response',async({browser},info)=>{
 const owner=await actorPage(browser,'mobile-states-owner','pl-PL'),customer=await actorPage(browser,'mobile-states-customer','pl-PL')
 await owner.setViewportSize({width:390,height:900})
 let release:()=>void=()=>{}
 try{
  await connectPolish(owner);await connectPolish(customer);const f=await seed(owner,customer)
  const next=await f.call<{id:string}>('POST','/venues',{name:'Drugi lokal mobilny',fiatCurrency:'EUR',nimAddress:'NQ07 MOBILE SECOND'})
  await owner.goto('/merchant/owner');await owner.getByLabel('Lokal',{exact:true}).selectOption(f.venue.id)
  let delivered!:()=>void;const delivery=new Promise<void>(resolve=>{delivered=resolve})
  let entered!:()=>void;const fetched=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  await owner.route('**/v1/merchant'+f.base+'/inventory?*',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});delivered()})
  await owner.getByRole('button',{name:'Magazyn',exact:true}).click();await fetched
  await expect(owner.getByText('Wczytywanie magazynu…',{exact:true})).toBeVisible()
  await owner.getByLabel('Lokal',{exact:true}).selectOption(next.id)
  await expect(owner.getByText('Nie ma jeszcze zasobów magazynowych.',{exact:true})).toBeVisible()
  const lateResponse=owner.waitForResponse(r=>new URL(r.url()).pathname==='/v1/merchant'+f.base+'/inventory')
  release();await delivery;await (await lateResponse).finished()
  await owner.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  await owner.unroute('**/v1/merchant'+f.base+'/inventory?*')
  await expect(owner.getByRole('button',{name:'Full-day raw',exact:true})).toHaveCount(0)
  await inspect(owner,'venue-after-late-response',info)
  const taskPath='**/v1/merchant/venues/'+next.id+'/tasks'
  await owner.route(taskPath,route=>route.abort('failed'))
  await owner.getByRole('button',{name:'Zadania pracowników',exact:true}).click()
  const alert=owner.getByRole('alert');await expect(alert).toBeVisible();await expect(alert).toBeFocused()
  await expect(owner.getByText('Nie ma jeszcze zadań pracowników.',{exact:true})).toHaveCount(0)
  await inspect(owner,'tasks-error',info)
  await owner.keyboard.press('Tab');await expect(owner.getByRole('button',{name:'Ponów',exact:true})).toBeFocused()
  await owner.unroute(taskPath);await owner.keyboard.press('Enter')
  await expect(owner.getByText('Nie ma jeszcze zadań pracowników.',{exact:true})).toBeVisible()
  await expect(owner.getByRole('alert')).toHaveCount(0)
  await inspect(owner,'tasks-after-keyboard-retry',info)
 }catch(error){await writeFile(info.outputPath('failure-states.txt'),await owner.locator('body').innerText());await owner.screenshot({path:info.outputPath('failure-states.png'),fullPage:true});throw error
 }finally{release();await Promise.allSettled([owner,customer].map(p=>p.context().close()))}
})
