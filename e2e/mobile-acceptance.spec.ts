import {expect,test,type Page,type TestInfo} from '@playwright/test'
import type {ProductionDraft} from '../packages/shared/src/index'
import {actorPage,seed,staffSession} from './full-day.fixture'

const english=/Something good|for your day\.|Your basket\.|Choose something from the menu|We’ll take it from here|Estimates in|Share checkout|Open shift|Shift open|Checking cash|Cash payment|Production reason|No staff tasks yet|Loading staff tasks|Network error|Failed to fetch/
async function inspect(page:Page,name:string,info:TestInfo){
 await page.screenshot({path:info.outputPath(name+'.png'),fullPage:true,animations:'disabled'})
 await expect(page.locator('body')).not.toContainText(english)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>document.documentElement.clientWidth+1))
 const overflow=await page.evaluate(()=>{
  const width=document.documentElement.clientWidth
  return [...document.querySelectorAll('main button, main input, main select, main textarea')].filter(el=>{
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
  await manager.getByRole('button',{name:/^(Open shift|Otwórz zmianę)/}).click()
  // Keep all labels Polish; seeded product/resource names are deliberate user data.
  await inspect(manager,'basket-empty',info)
  await manager.getByRole('button',{name:/^Full-day coffee/}).click()
  await manager.getByRole('button',{name:/^(Add to basket|Dodaj do koszyka)/}).click()
  await inspect(manager,'basket-filled',info)
  await manager.getByRole('button',{name:/^(Share checkout|Udostępnij płatność)/}).click()
  await expect(manager.getByRole('heading',{name:/^(Cash payment|Płatność gotówką)$/})).toBeVisible()
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
  await expect(manager.getByRole('button',{name:/^(Close my shift|Zamknij moją zmianę)/})).toBeVisible()
  await inspect(manager,'report',info)
 }finally{await Promise.allSettled([owner,customer,manager].map(p=>p.context().close()))}
})
