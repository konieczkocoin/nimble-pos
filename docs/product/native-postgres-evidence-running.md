# Native PostgreSQL — acceptance log metadata

2026-10-19. Base: cd44b60d30a8122dd69ad21453f2b370642afed4.
Implementation: d17ac1ca7761e82c34ed20dd5d5f38ac0dd2c114.
Status: independent workflow change implemented and reviewed; task01 / PL-02
remain BLOCKED pending native execution. No deployment or remote write.

## Change

The existing native-postgres workflow now records the actual checkout SHA,
Node version and pnpm version before dependency installation. The API runner
appends to the same native-postgres.log instead of overwriting the header.
The existing runner still records the server-reported PostgreSQL version and
two distinct backend PIDs. Explicit Bash with pipefail preserves failure status.
No test exclusions, reset guards, product code or database schema changed.

## Verification performed

- Restored the preceding bundle; HEAD matched its manifest, git fsck --full
  passed. Full source history retained.
- corepack pnpm install --frozen-lockfile: PASS, pnpm9.15.0, no lockfile change.
- YAML parsing (PyYAML BaseLoader) and bash -n for every workflow run block:
  PASS. These checks do not establish GitHub Actions runtime acceptance.
- Temporary shell harness used the actual metadata/API run blocks under
  bash --noprofile --norc -eo pipefail with stub git/node/pnpm commands:
  header values recorded, successful output appended, failed output retained,
  runner exit17 propagated. Four checks PASS. This is a shell test, not a
  simulated claim of database acceptance.
- node --test scripts/test-native-postgres.test.mjs scripts/test-backup.test.mjs:
  9/9 PASS, fail0, skip0 on Node24.19.0. Workflow targets Node22.
- node scripts/test-native-postgres.mjs: exit1 before API tests because neither
  NATIVE_POSTGRES_BIN nor NATIVE_POSTGRES_TEST_URL is configured. API tests
  executed in this continuation:0. No native PID evidence generated.
- git diff --check: PASS.
- Independent Spec review:0 findings. Actual checkout SHA remains correct
  even for a pull-request merge checkout; append and failure propagation meet
  the scoped brief. Full task01 acceptance remains open.
- Independent Standards review:0 findings; existing Bash/tee conventions and
  safety rules preserved.

Current local environment maps only UID0 (0 0 1); postgres/initdb/docker/podman
are absent from PATH and standard PostgreSQL directories are absent. No
external test database was supplied. Read-only repository inspection confirms
access to konieczkocoin/nimble-pos; a recovery branch search returned no
branches. This does not establish availability of Actions or any CI results.
No workflow was pushed, dispatched or run remotely in this continuation.

The earlier preparation attempt without dependencies failed while importing
postgres; after locked installation both runner-guard tests now pass. Neither
result substitutes for a full native API run.

## Handoff and recovery

Next: execute the existing Native PostgreSQL acceptance workflow on a runner
with its disposable PostgreSQL16 service. Retain SHA, versions, PIDs and complete
pass/fail/skip evidence; fix reproducible failures before closing01. Then follow
the predecessor acceptance order in implementation-tickets-index.md.

Previous complete archive: NIMBLE-SESSION-ISOLATION-FULL-CODE.zip,
libfile_0f71810700f8819199bff68f2c7976e1,
SHA2563cc9ec55f37d8d76126602f729ff828f81930a765b73cc3e50f6d38df3303890.
New archive target: NIMBLE-NATIVE-EVIDENCE-FULL-CODE.zip. Create after a clean
commit with scripts/checkpoint-code.py, retain full history and verify a fresh
restore. Confirm archive identity and SHA256 in the external continuation
receipt after saving. Earlier archives remain retained.
