import {defineConfig} from '@playwright/test'
const database=process.env.FULL_DAY_TEST_DATABASE_URL??'postgres://localhost/nimble_full_day_test'
export default defineConfig({testDir:'.',testMatch:'full-day.spec.ts',timeout:240000,fullyParallel:false,workers:1,retries:0,use:{baseURL:'http://localhost:5174',locale:'en-GB',timezoneId:'Europe/Warsaw'},webServer:[
 {command:'corepack pnpm --filter @nimble/api exec node --import tsx ../../e2e/full-day-server.ts',url:'http://localhost:3100/healthz',reuseExistingServer:false,timeout:30000,env:{FULL_DAY_TEST_DATABASE_URL:database,DATABASE_URL:database,PORT:'3100',MOCK_AUTH:'1',REMOTE_ORDERING_ENABLED:'1',CORS_ORIGIN:'http://localhost:5174',WEB_DIST:''}},
 {command:'corepack pnpm --filter @nimble/web dev --port 5174 --strictPort',url:'http://localhost:5174',reuseExistingServer:false,timeout:30000,env:{VITE_WALLET:'mock',VITE_API_URL:'http://localhost:3100'}},
]})
