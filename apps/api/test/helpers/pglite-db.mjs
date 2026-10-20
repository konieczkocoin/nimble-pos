// Optional local validation only. PGlite serializes work in-process and cannot
// satisfy the native PostgreSQL gate or prove independent-session concurrency.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile } from 'node:fs/promises'
import * as schema from '../../src/db/schema'

export async function freshDb() {
  const client = new PGlite()
  try {
    const db = drizzle(client, { schema })
    const folder = new URL('../../drizzle/', import.meta.url)
    const journal = JSON.parse(await readFile(new URL('meta/_journal.json', folder), 'utf8'))
    // exec supports complete migration scripts, including multi-statement SQL.
    // This fixture has a new empty in-memory database for every test module.
    for (const entry of journal.entries) {
      await client.exec(await readFile(new URL(entry.tag + '.sql', folder), 'utf8'))
    }
    // postgres-js returns raw rows directly; PGlite returns { rows, ... }.
    // Normalize the driver boundary without modifying SQL or assertions.
    function postgresResultShape(store) {
      const execute = store.execute.bind(store)
      store.execute = async (...args) => {
        const result = await execute(...args)
        return result.rows ?? result
      }
      const transaction = store.transaction.bind(store)
      store.transaction = (callback, ...options) => transaction(tx => callback(postgresResultShape(tx)), ...options)
      return store
    }
    return { db: postgresResultShape(db), close: () => client.close() }
  } catch (error) {
    await client.close()
    throw error
  }
}
