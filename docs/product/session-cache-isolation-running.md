# Cashier cache isolation — independent correction

2026-10-19. Supporting task11; task10 and full task11 remain blocked on native
PostgreSQL acceptance. No deployment or real transfer performed.

## Reproduction

Anna opens her personal shift report (net98765 EUR minor). She signs out and
Leo logs in. Leo's initial orders request remains pending. Previously the old
report remained in component state and rendered987.65 under Leo's personal
shift heading. The regression failed with three old amount nodes instead of0.

The initial test was tightened to wait for the profile/PIN form to disappear:
Leo may already be visible as an option before authentication completes. The
same completion assertion now strengthens both existing late401 cases.

## Change

On a non-demo session token change, clear catalog, orders, current shift,
report, cart, selected product, shared checkout, editing order, claim code,
rates and category, and generate a new checkout key. Keep durable pending
payment intents untouched. The existing token guards prevent old successful
loads and old errors from refilling or clearing a newer session.

No endpoint, schema, permission or financial calculation changed. This is an
independent UI correction and does not substitute for the recovery-day native
PostgreSQL scenarios. The test uses the rendered terminal UI and delayed HTTP
responses; it does not demonstrate actual server-session concurrency.

## Verification

Focused merchant-manager regression suite5/5 passed after the fix. Full web
suite and typecheck/build are recorded in session-cache-isolation-validation.json.
Source review runs separately against Spec and Standards. Native acceptance
remains open irrespective of these results.

## Recovery

Previous checkpoint: NIMBLE-SESSION-RECOVERY-FULL-CODE.zip,
libfile_3b64572f5afc8191b82709df3745c814,
SHA2562c509e42ac3ba81279ef76ca9489cb3a38d5a3e6b231eed862aa0f3f215315c9.
New archive target NIMBLE-SESSION-ISOLATION-FULL-CODE.zip includes all tracked
sources and reachable history after clean commit; verify fresh restore and
retain earlier archives. Confirm new identity/hash in continuation receipt.

Final results: web310/310 across72files; tsc and Vite build passed (existing large-chunk warning). Spec: no blocker, cart/checkout clearing not directly asserted. Standards: no blocker.
