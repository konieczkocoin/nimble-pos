import {createRequire} from 'node:module'
export function fullDayDatabase(value,allow){
 if(allow!=='yes')throw new Error('Set FULL_DAY_ALLOW_TEST_MIGRATIONS=yes for an empty dedicated test database')
 if(!value)throw new Error('Set FULL_DAY_TEST_DATABASE_URL; native PostgreSQL is required')
 const u=new URL(value)
 if(!['postgres:','postgresql:'].includes(u.protocol)||!/^\/[A-Za-z0-9_]+_test$/.test(u.pathname))throw new Error('Dedicated database name must end in _test')
 return value
}
export function assertNativeEmpty(sessions,tables){
 if(sessions.length!==2||sessions[0].pid===sessions[1].pid||sessions.some(s=>!/PostgreSQL/i.test(s.version)||/pglite|wasm|emscripten/i.test(s.version)))throw new Error('Two independent native PostgreSQL sessions required')
 if(tables.length)throw new Error('Full-day E2E requires an empty dedicated database; no data will be deleted')
}
export async function preflight(environment=process.env){
 const url=fullDayDatabase(environment.FULL_DAY_TEST_DATABASE_URL,environment.FULL_DAY_ALLOW_TEST_MIGRATIONS)
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url)),postgres=require('postgres')
 const connections=[postgres(url,{max:1,connect_timeout:5}),postgres(url,{max:1,connect_timeout:5})]
 try{
  const sessions=await Promise.all(connections.map(async sql=>(await sql`select version() as version,pg_backend_pid() as pid`)[0]))
  const tables=await connections[0]`select schemaname,tablename from pg_tables where schemaname not in ('pg_catalog','information_schema')`
  assertNativeEmpty(sessions,tables)
 }finally{await Promise.all(connections.map(sql=>sql.end()))}
 return url
}
