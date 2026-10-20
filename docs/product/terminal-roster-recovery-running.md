# Terminal roster after session restoration —2026-10-20

Status: PASS; browser full-day run39480374937 passed all10steps. Found by task10, not a
completion of task11 or12.

Run39479273201 passed native API and remote payment/pickup/loyalty/loss, then
failed selecting the handover successor. The terminal was reloaded during the
cash scenario. `Terminal` initializes profiles to an empty array and previously
called `loadProfiles` only when no cashier session existed. A restored session
therefore had no employees in handover/task controls.

Regression: `merchant-manager.test.tsx` starts with a persisted session, opens
Handover, selects Ola and submits the exact successor/note. Before the change it
failed: `Unable to find role="option" and name "Ola"`. The failure reproduces the
browser's missing successor, without changing its fixture or relaxing selection.

Fix afb68bb / published5388dc58742f1b5fb939346c81f3582e7fec8a43 loads profiles
for restored sessions as well. Responses must belong to the active effect,
cashier token, pairing token and current session venue. Existing authority
verification still controls access. No API/schema/permission changes.

Validation:
- `corepack pnpm --filter @nimble/web exec vitest run test/merchant-manager.test.tsx test/handover.test.tsx`:10/10, fail0/skip0.
- Includes different-venue and changed-pairing response rejection cases.
- `corepack pnpm --filter @nimble/web test`:314/314 in72files, fail0/skip0.
- `corepack pnpm --filter @nimble/web build`:PASS (TypeScript and Vite).
- Independent Spec and Standards reviews: no findings.

Full-day1/1 PASS, retry0/skip0; successor selection and acknowledgement completed. Evidence: full-day-acceptance-20261020.json.
