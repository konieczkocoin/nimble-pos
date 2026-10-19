import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, readdirSync, existsSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync, gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../deploy/backup.sh', import.meta.url))

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nimble-backup-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const deploy = join(root, 'deploy'), dest = join(root, 'backups'), bin = join(root, 'bin')
  for (const dir of [deploy, dest, bin, join(root, 'media/menu-images'), join(root, 'media/task-photos')]) mkdirSync(dir, { recursive: true })
  // Inject only the destination into legacy versions, so a red run cannot touch real backups.
  writeFileSync(join(deploy, 'backup.sh'), readFileSync(script, 'utf8').replace('DEST=/var/backups/nimble', 'DEST="${NIMBLE_BACKUP_DEST:-/var/backups/nimble}"'))
  copyFileSync(fileURLToPath(new URL('../deploy/docker-compose.prod.yml', import.meta.url)), join(deploy, 'docker-compose.prod.yml'))
  for (const stack of options.stacks ?? ['main', 'test']) writeFileSync(join(deploy, `.env.${stack}`), '# disposable fixture\n')
  const sql = `CREATE TABLE recovery_test(value text);\nINSERT INTO recovery_test VALUES ('${randomBytes(6000).toString('hex')}');\n`
  writeFileSync(join(root, 'dump.sql'), sql)
  writeFileSync(join(root, 'media/menu-images/menu.webp'), 'public menu fixture')
  writeFileSync(join(root, 'media/task-photos/private.webp'), 'private photo fixture')
  assert.equal(spawnSync('tar', ['-C', join(root, 'media'), '-czf', join(root, 'media.tar.gz'), 'menu-images', 'task-photos']).status, 0)
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
import {appendFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2), stack=args[args.indexOf('-p')+1]?.replace('nimble-','');
appendFileSync(process.env.FIXTURE_ROOT+'/events',JSON.stringify({stack,args})+'\\n');
const fail=process.env.FAIL_STACK===stack;
if(args.includes('ps')) {if(process.env.APP_STOPPED!=='yes')console.log('app');}
else if(args.includes('pg_dump')) {if(fail&&process.env.FAIL_PHASE==='dump')process.exit(1);process.stdout.write(readFileSync(process.env.FIXTURE_ROOT+'/dump.sql'));}
else if(args.includes('tar')) {if(fail&&process.env.FAIL_PHASE==='media')process.exit(1);process.stdout.write(readFileSync(process.env.FIXTURE_ROOT+'/media.tar.gz'));}
else if(args.includes('start')&&fail&&process.env.FAIL_PHASE==='start')process.exit(1);
`)
  chmodSync(join(bin, 'docker'), 0o755)
  function old(stack) {
    const name = `${stack}-20000101T000000Z-fixture.backup`, path = join(dest, name)
    mkdirSync(path)
    writeFileSync(join(path, 'database.sql.gz'), gzipSync('last good database'))
    const oldTime = new Date('2000-01-01T00:00:00Z')
    utimesSync(path, oldTime, oldTime)
    // Preserve the old deployment's flat SQL copies too on failure.
    const legacy = join(dest, `${stack}-20000101-000000.sql.gz`)
    writeFileSync(legacy, gzipSync('legacy last good database'))
    utimesSync(legacy, oldTime, oldTime)
    return { path, legacy }
  }
  function run(stacks = ['main', 'test']) {
    return spawnSync('bash', [join(deploy, 'backup.sh'), ...stacks], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_ROOT: root, NIMBLE_BACKUP_DEST: dest, ...options.env },
    })
  }
  const events = () => existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8').trim().split('\n').map(JSON.parse) : []
  const snapshots = stack => readdirSync(dest).filter(name => name.startsWith(`${stack}-`) && name.endsWith('.backup'))
  return { root, dest, old, run, events, snapshots, sql }
}

test('failed dumps preserve the last good copies and report failure', t => {
  const f = fixture(t, { stacks: ['main'], env: { FAIL_STACK: 'main', FAIL_PHASE: 'dump' } })
  const before = f.old('main'), result = f.run(['main'])
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.ok(existsSync(before.path), 'last complete backup was removed')
  assert.ok(existsSync(before.legacy), 'last legacy backup was removed')
  assert.equal(f.snapshots('main').length, 1)
  assert.ok(f.events().some(e => e.args.includes('start')), 'app was not resumed after failed dump')
})

test('a complete backup contains exact database and both media sets before rotating only its own old snapshots', t => {
  const f = fixture(t), main = f.old('main'), other = f.old('test')
  const result = f.run(['main'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(main.path), false)
  assert.ok(existsSync(main.legacy), 'legacy backups require a verified restore before removal')
  assert.ok(existsSync(other.path), 'another stack was rotated')
  const snapshots = f.snapshots('main')
  assert.equal(snapshots.length, 1)
  const saved = join(f.dest, snapshots[0])
  assert.equal(gunzipSync(readFileSync(join(saved, 'database.sql.gz'))).toString(), f.sql)
  assert.equal(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: saved }).status, 0)
  const restored = join(f.root, 'restored-media')
  mkdirSync(restored)
  assert.equal(spawnSync('tar', ['-xzf', join(saved, 'media.tar.gz'), '-C', restored]).status, 0)
  assert.equal(readFileSync(join(restored, 'task-photos/private.webp'), 'utf8'), 'private photo fixture')
  assert.equal(readFileSync(join(restored, 'menu-images/menu.webp'), 'utf8'), 'public menu fixture')
  const events = f.events().map(e => e.args)
  const at = action => events.findIndex(args => args.includes(action))
  assert.ok(at('stop') < at('pg_dump') && at('pg_dump') < at('tar') && at('tar') < at('start'))
})

test('a failed media copy resumes the app and preserves the last complete backup', t => {
  const f = fixture(t, { env: { FAIL_STACK: 'main', FAIL_PHASE: 'media' } }), before = f.old('main')
  const result = f.run(['main'])
  assert.notEqual(result.status, 0)
  assert.ok(existsSync(before.path))
  assert.equal(f.snapshots('main').length, 1)
  assert.ok(f.events().some(e => e.args.includes('start')))
  assert.equal(readdirSync(f.dest).some(name => name.includes('partial')), false)
})

test('failure in one stack never deletes its backup when another stack succeeds', t => {
  const f = fixture(t, { env: { FAIL_STACK: 'test', FAIL_PHASE: 'dump' } })
  const main = f.old('main'), failed = f.old('test'), result = f.run()
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(main.path), false)
  assert.equal(f.snapshots('main').length, 1)
  assert.ok(existsSync(failed.path))
  assert.ok(existsSync(failed.legacy))
})

test('missing configuration is a failure without touching old backups', t => {
  const f = fixture(t, { stacks: [] }), before = f.old('main')
  const result = f.run(['main'])
  assert.notEqual(result.status, 0)
  assert.ok(existsSync(before.path))
  assert.ok(existsSync(before.legacy))
  assert.equal(f.events().length, 0)
})

test('an app stopped by the operator stays stopped after a successful backup', t => {
  const f = fixture(t, { env: { APP_STOPPED: 'yes' } }), result = f.run(['main'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(f.snapshots('main').length, 1)
  assert.equal(f.events().some(e => e.args.includes('stop') || e.args.includes('start')), false)
})

test('failed restart reports failure, retains the last complete backup and publishes no partial copy', t => {
  const f = fixture(t, { env: { FAIL_STACK: 'main', FAIL_PHASE: 'start' } }), before = f.old('main')
  const result = f.run(['main'])
  assert.notEqual(result.status, 0)
  assert.ok(existsSync(before.path))
  assert.equal(f.snapshots('main').length, 1)
  assert.match(result.stderr, /operator intervention required/)
  assert.equal(readdirSync(f.dest).some(name => name.includes('partial')), false)
})
