# PL-02 — native PostgreSQL acceptance

Status: **PASS — regression repaired and complete native API accepted2026-10-20**.
Latest run39480374937: focused1/1, full API401/401 in79files, report UI7/7,
fail0/skip0. PostgreSQL16.15, full-suite backend PIDs103/104.
The20Oct deadlock was reproduced before the lock fix; RED evidence remains
in native-stock-locking-red-20261020.txt. Latest GREEN evidence:
full-day-acceptance-20261020.json and native-postgres-acceptance-final-20261020.txt.
Earlier first-GREEN evidence remains in native-postgres-acceptance-20261020.json/.txt. Full-day and device/live
network acceptance are separate gates.
Earlier blocked attempts
below are historical. Run39246316523:401/401 tests in79/79files, fail0/skip0,
PostgreSQL16.15, independent backend PIDs84/85. Evidence:
native-postgres-acceptance-20261019.json and .txt. Device/live-network gates
remain separate.

## Reproducible runner

`scripts/test-native-postgres.mjs` supports a disposable native cluster or an explicitly resettable dedicated test database. With no file arguments it runs the complete API suite; file arguments select a focused run. Existing fixtures apply migrations and seed their test scenarios. The runner checks PostgreSQL version and distinct backend PIDs before fixtures execute. There is no PGlite fallback.

Disposable cluster, as a non-root user (or root with UID 65534 available):

```sh
NATIVE_POSTGRES_BIN=/absolute/path/to/postgresql/bin node scripts/test-native-postgres.mjs
```

The bin directory must have a standard adjacent `lib`/`share` distribution. The runner copies the distribution into a temporary directory, creates a private Unix socket, disables TCP listening, creates `nimble_native_test`, and removes the cluster after execution. Root launches the server as UID/GID 65534.

Existing dedicated disposable database (destructive):

```sh
NATIVE_POSTGRES_TEST_URL='postgres://test_user:password@localhost:5432/nimble_test' NATIVE_POSTGRES_ALLOW_RESET=yes node scripts/test-native-postgres.mjs
```

The database name must end in `_test`. Explicit reset opt-in is required for an external database. This naming guard also protects the shared API fixture. Never use production credentials: suffix validation cannot establish that a database contains no valuable data.

Focused existing risk scenarios:

```sh
NATIVE_POSTGRES_BIN=/absolute/path/to/postgresql/bin node scripts/test-native-postgres.mjs test/stock-reservations.test.ts test/stock-reward-reservations.test.ts test/owner-release-race.test.ts test/inventory-operations.test.ts test/remote.test.ts test/schedules.test.ts
```

## Actual observations in this environment

- Installed native binaries report PostgreSQL 16.14.
- `initdb` exits 1: `cannot be run as root`.
- `/proc/self/uid_map` and `/proc/self/gid_map` each contain only `0 0 1`.
- `chown` to UID/GID 65534 or 1000 fails with EINVAL; an unprivileged server process cannot be created in this container.
- No PostgreSQL process was visible; loopback ports 5432 and 5433 had no listener. No usable native connection URL was identified.
- Disposable runner exits 1 with the specific root-only mapping explanation. **No native API/concurrency tests ran.**
- `node --check scripts/test-native-postgres.mjs`: passed.
- `node --test scripts/test-native-postgres.test.mjs`: 2/2 passed, verifying unsafe-name rejection and mandatory reset opt-in before connecting.

## Remaining acceptance

Run the complete API suite on native PostgreSQL and record results. Confirm concurrent last-portion competition (POS/remote/reward), queue-slot competition, delivery retry, overlapping counts/loss decisions and payment-versus-release. Explicit Promise.all scenarios now cover duplicate delivery receipt, competing overlapping stocktakes, competing owner loss approvals, concurrent draft version allocation/publication, and the last queue slot at quote creation. These supplement existing POS/remote/reward stock competition and payment-versus-release cases. Local PGlite results exercise assertions but do not prove native lock behaviour. All of these scenarios must pass natively before closing PL-02. Device acceptance is separate.

## Added parallel scenarios — local verification

2026-10-16: inventory-operations+schedules19/19 and remote14/14 passed on PGlite, including five new parallel scenarios. Initial queue-test fixture hit customer rate limiting and payer mismatch; using two distinct buyers with matching sender addresses isolates queue capacity. No production behaviour was changed for these tests. Native execution remains blocked as described above.

## Native CI environment

`.github/workflows/native-postgres.yml` provisions a disposable PostgreSQL16 service on an Ubuntu GitHub runner, installs the locked pnpm9.15.0 dependencies under Node22, verifies runner guards and executes the entire API suite with native backend-PID verification. It uses a dynamically assigned localhost port, a dedicated `nimble_native_test` database and no production secrets. Bash pipefail preserves failures while tee records the log; the log is retained as a14-day artifact tagged with the commit SHA.

Triggers: pull requests, pushes to main or feat/merchant-management, and manual workflow_dispatch. The workflow is prepared locally, not pushed or executed remotely in this session. YAML parsing and structure checks passed; runner guards2/2 passed. A successful native CI run is still required to close PL-02.

## Continuation: evidence header — 2026-10-19

The existing workflow records the actual checkout SHA and Node/pnpm versions
before dependency installation; native API output appends to that same log.
Independent Spec/Standards reviews found no issues. Guard and backup tests9/9
passed after locked installation. Full native execution still exits before API
tests due to missing PostgreSQL configuration; PL-02/task01 remain blocked.
Details and recovery: native-postgres-evidence-running.md.

## Deterministic contention regression — 2026-10-20

Local809791c / published6f97d6961127ea2d4b3ca914ad6c462510bbcaa2 adds
a remote-provider barrier to the existing three-way last-portion case. Native
run39476784632, job118814690235 fails in7.06s with
`POS and reward are blocked by an unrelated remote quote provider`; the
subsequent log also reports40P01. Full API and E2E correctly do not run.

Locala89cbdb / published48c7873ff5c5c2c07875e7755fd79c27da2cfaa1 changes
only the remote queue venue lock from FOR UPDATE to FOR NO KEY UPDATE.
Remote decisions still conflict with each other and venue updates; foreign-key
KEY SHARE checks can proceed while stock locks are held. Stock availability,
queue capacity and loyalty assertions are unchanged. PostgreSQL16 lock matrix:
https://www.postgresql.org/docs/16/explicit-locking.html

API TypeScript check passes. Independent Spec and Standards reviews of
c49df3b..a89cbdb report no findings. Run39477296697 is the required GREEN
attempt; acceptance remains open until native results are recorded.

### GREEN result —2026-10-20

Run39477296697, native job118816452434: focused1/1 in4.33s, complete
API401/401 in79/79files in171.76s, UI economics/finance7/7; zero failures
or skipped tests. Includes remote queue last-slot competition and notification
persistence. Node22.23.3, pnpm9.15.0, PostgreSQL16.15. Focused PIDs93/92,
full PIDs105/106. Checkout623709d4c2355bdd276cc9ff916cb63814055f90 has
tree03099c720763523f5a2b75818f284e02220afe88, verified through Git data and
identical to locala89cbdb. Full-day runs downstream with independent evidence.
