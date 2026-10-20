import {expect,type Page,type Route} from '@playwright/test'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'

/** Execute the real route, then lose its response. No business response is fabricated. */
export async function lostResponse<T>(page:Page,path:string,action:()=>Promise<unknown>,retryName:string,retryStatus=200){
 let first=true
 let recorded!:T
 let original!: {url:string;body:unknown;headers:Record<string,string>}
 let committed!:()=>void,failed!:(error:unknown)=>void
 const done=new Promise<void>((resolve,reject)=>{committed=resolve;failed=reject})
 const timer=setTimeout(()=>failed(new Error('Real committed response not observed within15s')),15000)
 const handler=async(route:Route)=>{
  if(!first)return route.continue()
  first=false
  try{
  const request=route.request(),response=await route.fetch()
  expect(response.ok(),`Real write failed: ${response.status()}`).toBe(true)
  recorded=await response.json() as T
  original={url:request.url(),body:request.postDataJSON(),headers:request.headers()}
  await route.abort('failed');committed()
  }catch(error){failed(error);await route.abort('failed')}
 }
 const pattern='**/v1/merchant'+path
 await page.route(pattern,handler)
 try{
  await Promise.all([action(),done])
  const retried=page.waitForRequest(r=>new URL(r.url()).pathname==='/v1/merchant'+path&&r.method()==='POST')
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/v1/merchant'+path&&r.request().method()==='POST',{timeout:15000}),page.getByRole('button',{name:retryName,exact:true}).click()])
  expect(response.status()).toBe(retryStatus)
  const result=retryStatus===200?await response.json() as T:recorded
  const request=await retried
  expect(request.postDataJSON()).toEqual(original.body)
  expect(request.headers()['idempotency-key']).toBe(original.headers['idempotency-key'])
  // Independent HTTP requests use the real server's separate PostgreSQL sessions.
  const headers={authorization:original.headers.authorization,...(original.headers['idempotency-key']?{'idempotency-key':original.headers['idempotency-key']}:{})}
  const repeats=await Promise.all([1,2].map(()=>page.request.post(original.url,{headers,data:original.body})))
  for(const response of repeats){expect(response.status()).toBe(retryStatus);if(retryStatus===200)expect(await response.json()).toEqual(result)}
  return result
 }finally{clearTimeout(timer);await page.unroute(pattern,handler)}
}
export async function restartWorker(mode:'timeout'|'confirm'){
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./recovery-worker.ts',import.meta.url)),mode],{cwd:fileURLToPath(new URL('../apps/api',import.meta.url)),env:process.env,timeout:15000})
 return JSON.parse(stdout.trim()) as {pid:number;failures:{orderId:string;error:string}[]}
}
