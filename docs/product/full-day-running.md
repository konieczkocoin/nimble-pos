# Full venue day — task10

2026-10-20. Status: **PASS — task10 browser acceptance completed**.
Run39480374937: native focused1/1, API401/401, report UI7/7; browser1/1,
all10steps passed, fail0/skip0/retry0/flaky0. Exact evidence:
full-day-acceptance-20261020.json/.txt and native-postgres-acceptance-final-20261020.txt.
Earlier failures and fixes below are retained as historical diagnosis.

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

## Native execution and first browser failure — 2026-10-19

The code is now published in draft PR1 in konieczkocoin/nimble-pos, on
recovery/native-acceptance-20261019. Native API401/401 and report UI6/6
passed in run39246603442. Full-day ran on a separate fresh PostgreSQL16.15
service with real business routes and Chromium. Delivery completed in433ms;
the production step timed out waiting for getByLabel('Production recipe',
{exact:true}). The overall scenario failed after240s. It is not accepted.

JSON artifact12184201839 locates the original failure at full-day.spec.ts:28.
Final context.close also threw after Playwright timed out; the main console
stack therefore pointed at cleanup. The JSON preserves the real selector error.

Minimal diagnostic: the actual getElementLabels implementation extracted from
installed Playwright1.62 injected source, evaluated with happy-dom against the
same nested-label/select markup, produces the normalized label
Production recipeChoose recipeFull-day batch · v1. Exact matching returns
false; substring matching returns true. This subsecond diagnostic explains
the observed failure without changing product code. A local Chromium install
was attempted but its downloads were truncated; real browser execution is CI.

Fix a4521c0: remove exact-text matching only from the seven affected select
labels, retaining Playwright strict single-element resolution. Bound actions
and response waiters to15seconds. Promise.all observes both the action and
response waiter; allSettled cleanup no longer masks an existing scenario error.
Text-only error-context.md is retained alongside the JSON/log artifact.
Business assertions, expected balances, server routes and database guards are
unchanged. Typecheck and discovery PASS; independent Spec/Standards reviews
found no issues. Discovery is not browser acceptance.

Retry run39248236837 uses head5a9c3dc31803baa0caccd2e8989c5aecceec8d2e,
with the exact tree of local a4521c0 (529b21be7028533a6aca4c562322b2d095d61f9e).
The actual retry result must be recorded before closing10 or proceeding to
11/12 acceptance.

## Second browser result and queue locator — 2026-10-20

Run39248236837 completed on19.10: API401/401 and report UI7/7 passed;
full-day failed at full-day.spec.ts:65. Production, measured yield, the owner
discount approval, physical cash750/tendered1000/change250 and exact cash
replay all completed. The next click expected the exact button name Queue,
but Merchant.tsx appends the live PREPARING/READY count: Queue · 1.

The stored textual context and real navigation JSX identify the mismatch.
Fix c49df3b matches only Queue or Queue · N with an anchored regex at all
three queue navigation points. Strict single-element resolution is preserved.
Typecheck PASS; independent Spec and Standards reviews found no issues.
No production code or financial assertion was changed. The original failure
artifact12184213555 contains log, JSON and text context; it expires02.11.

Retry headbd1bd4457e0d14eafba25de6805b05114654b11c, tree
0c67e51bf91ef505654d601d4d8d4909cf32dcf7, exactly matches local c49df3b.
The final browser result remains open pending execution.

## Third browser attempt and asynchronous toggle —2026-10-20

Run39477296697, head48c7873ff5c5c2c07875e7755fd79c27da2cfaa1:
native focused1/1, API401/401 and report UI7/7 all passed. Browser
job118818200410 completes delivery, production, discount approval, cash
recording/replay, readiness and collection. It fails in7.3s at remote
availability with `locator.check: Clicking the checkbox did not change its state`.
The real controlled checkbox updates only after asynchronous PATCH availability;
Playwright check requires the state immediately after the click.

Localf046f72 / published80d0cedc47708df2e217511bcb6c2145b3539d0d waits
for that real PATCH around a UI click, requires accepting=true, then awaits
the checked UI state. The existing public available=true assertion remains.
No application behavior, endpoint interception, seed or business assertion was
changed. E2E types PASS; independent Spec/Standards no findings.
Artifact12290660098 retains textual browser context, expires03Nov. The final
acceptance remains open until the new browser run succeeds.

## Fourth browser attempt and product name —2026-10-20

Run39478328133, head80d0cedc47708df2e217511bcb6c2145b3539d0d:
focused1/1, API401/401, UI7/7 PASS. Browser job118821681107 passes
the availability PATCH, checked UI and public availability assertions; next
it times out locating the customer product using /^Full-day coffee/.
RemoteMenu's product button begins with category Coffee before the product
name. Localfaeb68e / published26bcf09a721905f1fae166fac4d76c10934ecead
removes only that customer's start anchor, preserving strict unique-element
selection and all subsequent business assertions. Types PASS; independent
Spec/Standards no findings. Artifact12291181524 retains textual context.
Native checkout5acfc201fad94c2e47bc34db938dd8b657c32365, tree56e91c5910677beccb791aa848dc9e214a5fd664
equals localf046f72; full-suite PIDs103/104, duration156.92s.

## Fifth attempt: restored terminal roster —2026-10-20

Run39479273201, head26bcf09a721905f1fae166fac4d76c10934ecead, native
job118823269300 PASS. Browser job118824557493 passes remote placement,
loyalty enrollment, simulated payment, acceptance/readiness/pickup and owner
loss. It fails selecting the successor: select exists but manager option is
absent. The cashier session was restored by reload; production UI loaded the
terminal roster only without a session. Artifact12290772571 holds text context.

Fix afb68bb / published5388dc58742f1b5fb939346c81f3582e7fec8a43 restores
the real roster rather than injecting an option or changing the handover
assertion. Local RED→GREEN, web314/314, targeted10/10, build PASS;
Spec/Standards no findings. Details: terminal-roster-recovery-running.md.

## Final acceptance —2026-10-20

Run39480374937, browser job118828815672, head5388dc58742f1b5fb939346c81f3582e7fec8a43,
checkoutd6d84601cb7d602c27f6b5f80af57b2f20c2b617. Treebab9c3cbb541617632b47e9fa9d187c4f8296a64
verified identical to localafb68bb. PostgreSQL16.15, Node22.23.3, pnpm9.15.0,
Chromium. Browser1/1 in20.26s including startup (test13.387s), all10steps
PASS, no retry/skip/flakiness. Independent role contexts and private second
venue denial assertions passed. Empty native DB preflight ran before migrations.

Final asserted stock raw100/prepared7; net sales1250 minor, cash net0, NIM
received1250000 atomic, loyalty1. Refund preserves stock and the frozen cashier
shift gross2000. Downloaded real finance CSV passed its content assertions.
Artifacts12290563211/browser and12290114313/native expire03Nov; persistent
selected text and structured results live in the source docs above.
Local web314/314 in72files, handover/session targeted10/10, web build/typecheck
PASS. Independent Spec/Standards reviews found no outstanding issues.
Task11 and12 are now ready; their failure/device/mobile criteria are not
completed by this browser scenario. No deployment or live payment was performed.
Full checkpoint: NIMBLE-NATIVE-ACCEPTANCE-FULL-CODE.zip; final confirmed
identity/hash are recorded externally after durable save.
