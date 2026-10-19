# Full venue day — task10

2026-10-19. Status: **blocked; scenario prepared, browser acceptance not executed**.

The isolated Playwright scenario uses four browser contexts (owner, manager,
cashier, customer), real business routes and migrations against a dedicated
native PostgreSQL database. Only wallet identity and chain payment verification
are simulated, explicitly labelled FULL_DAY_SIMULATION. This is not evidence
of a real transfer, external notification delivery or production acceptance.
No business endpoints are intercepted.

## Independent expected balances

| Stage | Raw pieces | Finished portions |
|---|---:|---:|
| Initial | 100 | 0 |
| Delivery +20 | 120 | 0 |
| Production consumes20, yields10 | 100 | 10 |
| Cash sale | 100 | 9 |
| Accepted remote sale | 100 | 8 |
| Damage loss | 100 | 7 |
| Cash refund | 100 | 7 |

Two products at1250 minor each: list2500, discount500, gross sales2000.
Cash due750, tendered1000, change250. Remote sale1250 corresponds to1250000
NIM atomic units in this simulation. Full cash refund750 leaves net sales1250,
cash received750/refunded750/net0. Refund does not restore stock. Loyalty earns
one stamp. Closed cashier shift remains an immutable gross2000 snapshot;
returning manager opens and closes a separate zero-sales shift.

The scenario also checks owner approval of a cashier discount, replay of the
original cash request/key, revoked manager session on terminal reuse, per-line
readiness, pickup code, handover, manager refund denial, foreign venue denial,
day close and downloaded finance CSV. An explicit operational-date assertion
rejects runs crossing Warsaw04:00; repeat on a fresh empty test database.

## Running

From repository root, provide FULL_DAY_TEST_DATABASE_URL pointing to an empty,
dedicated native PostgreSQL database whose name ends in _test, and set
FULL_DAY_ALLOW_TEST_MIGRATIONS=yes. Do not use a production database.

`corepack pnpm --filter @nimble/e2e test:full-day`

Preflight checks two independent native sessions and refuses any user tables
before migration. It never truncates, resets or deletes a database. The server
also refuses production mode or a missing preflight marker. Default Playwright
configuration excludes this scenario; use its dedicated runner. A successful
run leaves data behind, so another run needs a new empty test database.

## Evidence from this stage

- Guard/backup/native-runner tests:11/11 passed, zero skipped.
- Dedicated E2E TypeScript check passed.
- Playwright discovery found1 test in1 file; this is discovery only.
- Full runner stopped before migrations/browser: missing
  FULL_DAY_TEST_DATABASE_URL. Browser scenarios executed:0.
- Direct server startup without preflight marker correctly rejected.
- No application source changed; prior product test totals are not new results.

Spec review corrected the orders URL, added original-key cash replay and
updated runner instructions. Standards review replaced untyped response bodies
with typed helpers. Follow-up reviews found no further source-level blocker;
the operational boundary risk is now an explicit assertion. Source review does
not replace execution. Native acceptance for predecessors and task10 remains
open. Next action is execution on an available native test database, followed by
fixes to any observed UI/API mismatch; task11 is not started.

## Files and recovery

Scenario/server/fixtures/config live under e2e/full-day*, with a dedicated
playwright.full-day.config.ts and tsconfig.full-day.json. Guarded launcher and
its tests live under scripts/*full-day*.

Previous verified full checkpoint: NIMBLE-CASH-REFUND-FULL-CODE.zip,
Library identity libfile_df1615d7ce1c819180bf9105b6897d6f,
SHA256 e40e5838856becc7f8bb34743e8a44e5097bef76ad53d9e994f774c2fbb5fa82.
New checkpoint target: NIMBLE-FULL-DAY-E2E-FULL-CODE.zip. Create after committing,
verify fresh restore and retain all previous archives. Archive identity/hash are
recorded in the external checkpoint receipt, avoiding a circular self-hash.

## Continuation: isolated CI execution configuration

2026-10-19, after commit00f6d09. Local inspection confirms no postgres/initdb/
pg_ctl or container runtime and /proc/self/uid_map maps only UID0. Installing
binaries alone would not allow unprivileged initdb; no guard was bypassed.
The guarded run was repeated and failed before migrations with the same missing
FULL_DAY_TEST_DATABASE_URL. No native/browser execution occurred.

Added .github/workflows/full-day.yml, a manual workflow_dispatch job. It starts
a fresh PostgreSQL16 service and installs locked pnpm9.15.0 dependencies plus
Chromium on Node22. It invokes the existing guarded runner with the dedicated
nimble_full_day_test database and explicit migration consent. It retains only
text logs/JSON results for14days, including failures; no screenshots or traces
are uploaded. The service password is a public disposable fixture, not a secret.
No existing database or remote deployment is used.

Execution requires this commit to be available in an authorized GitHub repository
with Actions enabled. A manual-only workflow normally must be present on the
default branch to appear in the Actions UI; integrate through the repository's
normal review process first. Select Full venue day acceptance, then Run workflow
for the desired ref. The job creates its own database; no persistent database
credential is needed. This is an execution path prepared in source, not a claim
that the code has been pushed or Actions run. No external write was performed.

Checks this continuation: YAML parsed with PyYAML BaseLoader; all run blocks
passed bash -n; database guards2/2 passed; Playwright discovery1 test. These
checks do not validate Actions semantics or browser behavior. Spec review and
Standards review independently found no actionable source findings. Task10
remains blocked until real execution and predecessor acceptance are recorded.

Prior checkpoint: libfile_f99168c0846081918a79289e8fb05125,
NIMBLE-FULL-DAY-E2E-FULL-CODE.zip,
SHA25652800a6c3fb3ff277786535bc1cb5f18a0dbeac239806115b921edaa05dd2bb7.
Next full checkpoint: NIMBLE-FULL-DAY-CI-FULL-CODE.zip. Preserve earlier archives.
