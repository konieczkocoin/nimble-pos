import {defineConfig} from '@playwright/test'
import fullDay from './playwright.full-day.config'
const suite=process.env.ACCEPTANCE_SUITE
if(suite!=='recovery'&&suite!=='mobile')throw new Error('Select recovery or mobile through the acceptance runner')
export default defineConfig({...fullDay,testMatch:suite==='recovery'?'recovery-day.spec.ts':'mobile-acceptance.spec.ts'})
