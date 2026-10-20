// Isolated full-day adapter: real application routes/DB, simulated identity and NIM wallet/chain.
import {migrate} from '../apps/api/node_modules/drizzle-orm/postgres-js/migrator'
import {buildApp} from '../apps/api/src/app'
import {makeDb} from '../apps/api/src/db/client'
import {SessionEvents} from '../apps/api/src/services/events'
import {fullDayDatabase} from '../scripts/full-day-preflight.mjs'
if(process.env.NODE_ENV==='production'||process.env.FULL_DAY_PREFLIGHT_PASSED!=='yes')throw new Error('Run only through test-full-day.mjs after native empty-database preflight')
const url=fullDayDatabase(process.env.FULL_DAY_TEST_DATABASE_URL,process.env.FULL_DAY_ALLOW_TEST_MIGRATIONS)
if(url!==process.env.DATABASE_URL)throw new Error('Full-day database configuration mismatch')
const {db,sql}=makeDb(url)
await migrate(db,{migrationsFolder:new URL('../apps/api/drizzle',import.meta.url).pathname})
const app=buildApp({db,events:new SessionEvents(),hostVerifier:{scheme:'mock',challenge:n=>`Full-day SIMULATED identity ${n}`,verify:async({payload})=>{const key=payload.publicKey??'';if(!key.startsWith('mock-pk:'))return null;const address=key.slice(8);return {subject:address,payoutAddress:address}}},rates:{getUsdPerNim:async()=>1},merchantPayments:{
 displayRates:async()=>({NIM:{value:'1',at:new Date().toISOString(),source:'FULL_DAY_SIMULATION'},USDT:null}),
 quote:async input=>{if(input.asset!=='NIM'||input.fiatCurrency!=='EUR')throw new Error('Full-day simulator supports EUR/NIM only');return {...input,id:crypto.randomUUID(),network:'nimiq:5',chainHeight:100,amountAtomic:(BigInt(input.totalMinor)*1000n).toString(),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),rate:'1',rateAt:new Date().toISOString(),rateSource:'FULL_DAY_SIMULATION'}},
 verify:async({hash,quote})=>{if(process.env.ACCEPTANCE_SUITE==='recovery'&&hash==='b'.repeat(64))throw new Error('SIMULATED provider timeout');return hash==='a'.repeat(64)?{...quote,hash,confirmedAt:new Date().toISOString()}:null},
}})
app.addHook('onClose',async()=>{await sql.end()})
await app.listen({port:3100,host:'127.0.0.1'})
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close())
