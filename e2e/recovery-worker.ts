// A fresh, short-lived reconciliation process against the guarded acceptance DB.
import {makeDb} from '../apps/api/src/db/client'
import {merchantReconciliationTick} from '../apps/api/src/services/merchantSettlement'
import {fullDayDatabase} from '../scripts/full-day-preflight.mjs'
if(process.env.NODE_ENV==='production'||process.env.FULL_DAY_PREFLIGHT_PASSED!=='yes'||process.env.ACCEPTANCE_SUITE!=='recovery')throw new Error('Recovery worker requires the isolated acceptance runner')
const url=fullDayDatabase(process.env.FULL_DAY_TEST_DATABASE_URL,process.env.FULL_DAY_ALLOW_TEST_MIGRATIONS)
const mode=process.argv[2];if(mode!=='timeout'&&mode!=='confirm')throw new Error('Unknown worker mode')
const checkoutToken=process.argv[3];if(!/^[A-Za-z0-9_-]{16,128}$/.test(checkoutToken??''))throw new Error('Checkout observer required')
const {db,sql}=makeDb(url)
try{
 const gateway={quote:async()=>{throw new Error('No quote creation in recovery worker')},verify:async({hash,quote})=>{if(mode==='timeout')throw new Error('SIMULATED provider timeout');return {...quote,hash,confirmedAt:new Date().toISOString()}}} satisfies import('../apps/api/src/services/merchantGateway').MerchantPaymentGateway
 let failures:{orderId:string;error:string}[]=[],rounds=0
 const deadline=Date.now()+20000
 while(true){
  rounds++;failures=await merchantReconciliationTick(db,gateway)
  if(mode==='timeout')break
  const response=await fetch('http://127.0.0.1:3100/v1/merchant/checkout/'+encodeURIComponent(checkoutToken))
  if(!response.ok)throw new Error('Recovery observer failed')
  const order=await response.json() as {status:string}
  if(order.status!=='PAYMENT_PENDING')break
  if(Date.now()>=deadline)throw new Error('Persisted payment did not reconcile within its backoff window')
  await new Promise(resolve=>setTimeout(resolve,250))
 }
 process.stdout.write(JSON.stringify({pid:process.pid,failures,rounds}))
}finally{await sql.end()}
