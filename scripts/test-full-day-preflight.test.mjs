import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fullDayDatabase,assertNativeEmpty} from './full-day-preflight.mjs'
const native=[{version:'PostgreSQL 16.4',pid:101},{version:'PostgreSQL 16.4',pid:102}]
test('requires explicit empty-test-database intent and a dedicated name',()=>{
 assert.throws(()=>fullDayDatabase('postgres://localhost/production','yes'),/_test/)
 assert.throws(()=>fullDayDatabase('postgres://localhost/nimble_test','no'),/MIGRATIONS/)
 assert.throws(()=>fullDayDatabase(undefined,'yes'),/DATABASE_URL/)
 assert.throws(()=>fullDayDatabase('https://localhost/nimble_test','yes'),/_test/)
 assert.equal(fullDayDatabase('postgres://localhost/nimble_test','yes'),'postgres://localhost/nimble_test')
})
test('refuses in-process databases, reused sessions and any pre-existing user tables',()=>{
 assert.throws(()=>assertNativeEmpty([{...native[0],version:'PostgreSQL PGlite'},native[1]],[]),/native/)
 assert.throws(()=>assertNativeEmpty([native[0],native[0]],[]),/native/)
 assert.throws(()=>assertNativeEmpty(native,[{schemaname:'public',tablename:'merchant_order'}]),/empty/)
 assert.doesNotThrow(()=>assertNativeEmpty(native,[]))
})
