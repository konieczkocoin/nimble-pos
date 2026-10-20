import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {preflight} from './full-day-preflight.mjs'
const args=process.argv.slice(2),suite=args.shift()
if(suite!=='recovery'&&suite!=='mobile')throw new Error('Choose recovery or mobile')
const url=await preflight(),require=createRequire(new URL('../e2e/package.json',import.meta.url))
const child=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'test','--config=playwright.acceptance.config.ts',...args],{cwd:fileURLToPath(new URL('../e2e',import.meta.url)),stdio:'inherit',env:{...process.env,FULL_DAY_TEST_DATABASE_URL:url,FULL_DAY_PREFLIGHT_PASSED:'yes',ACCEPTANCE_SUITE:suite}})
child.on('error',()=>{console.error('Could not start the full-day browser runner');process.exitCode=1})
child.on('exit',(code)=>{process.exitCode=code??1})
