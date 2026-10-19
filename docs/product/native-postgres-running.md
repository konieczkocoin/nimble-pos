# PL-02 — native PostgreSQL acceptance

Status: **native API acceptance PASSED** (2026-10-19). Earlier blocked attempts
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
