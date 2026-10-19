import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Opt-in only. The default config and native CI keep the real PostgreSQL helper.
export default defineConfig({
  resolve: { alias: [{
    find: /^\.\/helpers\/db$/,
    replacement: fileURLToPath(new URL('./test/helpers/pglite-db.mjs', import.meta.url)),
  }] },
  test: { include: ['test/**/*.test.ts'], fileParallelism: false },
})
