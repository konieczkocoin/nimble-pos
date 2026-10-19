# Terminal session recovery — isolated correction

2026-10-19. Independent UI correction supporting task11; task10 and full task11
acceptance remain blocked on native PostgreSQL and real recovery execution.

## Reproduction and change

On the shared terminal, Anna has a pending refresh. She signs out and Leo
signs in. Anna's refresh returns401. Previously the old interval catch deleted
Leo's stored session and signed him out. A regression through MerchantTerminal
UI reproduced removal of new-token from session storage before the fix.

Both initial-load and interval error callbacks now check effect lifetime and
captured session token before setting notices or clearing session storage.
Effect cleanup invalidates already-pending callbacks as well as the timer.
An old rejection cannot affect the newly signed-in cashier; a401 from the
current cashier still clears storage and returns to profile selection.
No business API, database schema or money behavior changed.

## Tests and review

Test seam: rendered MerchantTerminal with deferred fetch responses at the HTTP
boundary; real sign-out, profile/PIN and sign-in controls. This proves UI session
isolation, not API permission enforcement or native database concurrency.

Cases: old initial-load401, old interval401, current interval401, and existing
permission-revocation/late-report case. Focused4/4 passed. Full web suite and
build results are recorded in session-poll-recovery-validation.json.
The first build caught an unsupported Testing Library exact option in the new
test; replaced with an anchored accessible-name regex before final verification.

Spec review found no blocker and requested initial-load coverage, now included.
Standards review found no actionable issue. Full task11 worker restart,
provider timeout, lost money-operation response and independent native sessions
remain unverified. No claim of full recovery acceptance or deployment.

## Recovery

Previous full checkpoint: NIMBLE-FULL-DAY-CI-FULL-CODE.zip,
libfile_268b38125f888191b69918458b3c5832,
SHA2565f7490d3ce1c7520aedbfa1366e2adf5aefa8f663d62fb5bfec15b28c4221636.
New target: NIMBLE-SESSION-RECOVERY-FULL-CODE.zip, all tracked source and reachable
Git history, clean commit, fresh restore/HEAD/tree/fsck verification. Retain
previous checkpoints. Confirm save identity/hash in the continuation receipt.
