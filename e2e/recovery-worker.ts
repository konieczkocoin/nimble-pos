// A fresh, short-lived reconciliation process against the guarded acceptance DB.
import {makeDb} from '../apps/api/src/db/client'
import {merchantReconciliationTick} from '../apps/api/src/services/merchantSettlement'
import {fullDayDatabase} from '../scripts/full-day-preflight.mjs'
if(process.env.NODE_ENV==='production'||process.env.FULL_DAY_PREFLIGHT_PASSED!=='yes'||process.env.ACCEPTANCE_SUITE!=='recovery')throw new Error('Recovery worker requires the isolated acceptance runner')
const url=fullDayDatabase(process.env.FULL_DAY_TEST_DATABASE_URL,process.env.FULL_DAY_ALLOW_TEST_MIGRATIONS)
const mode=process.argv[2];if(mode!=='timeout'&&mode!=='confirm')throw new Error('Unknown worker mode')
const {db,sql}=makeDb(url)
try{
 const failures=await merchantReconciliationTick(db,{quote:async()=>{throw new Error('No quote creation in recovery worker')},verify:async({hash,quote})=>{if(mode==='timeout')throw new Error('SIMULATED provider timeout');return {...quote,hash,confirmedAt:new Date().toISOString()}}})
 process.stdout.write(JSON.stringify({pid:process.pid,failures}))
}finally{await sql.end()}
