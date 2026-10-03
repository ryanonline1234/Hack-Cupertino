# State — Food Desert AI
_Updated: 2026-10-03 (access-test redesign built on branch redesign/access-test)_

## Now
Production (main @ e69da03) still runs the old 9-point verdict, minus the
closed relays. Branch `redesign/access-test` holds the redesign from
docs/07: USDA ERS's low-income & low-access test on 2020 Census blocks and a
dated USDA SNAP store list, Point/Tract/City scope, store-format pins and a
computed-only impact card. Committed locally; NOT pushed, NOT deployed.

## Verified (2026-10-03)
- `npm test`: 230/230. Lint: only the 2 pre-existing GooeyNav.jsx errors.
  `npm run build` + key check: ok.
- Golden tracts on the committed data: Alviso 06085504602 MEETS (≈1,900 of
  2,060 beyond 1 mi), a village pin flips it (→ 41); Greenville 28151000600
  MEETS and flips with one pin; Los Altos Hills not low income; Cupertino
  06085508101 0 beyond; Chinle 04001944202 low access by count (rural, 10 mi).
- Headless smoke (13 cases, no page errors): the demo tracts, dollar-store pin
  (no flip), San Juan PR (UNKNOWN, SNAP doesn't operate there), Hartford CT
  (definite verdict), ERS file blocked (named Unknown + Try again), CDC hung
  (verdict at ≈13 s), 390 px, Undo after Clear.
- City summary: San Jose in-city 1,013,240 (exact), ≈79,730 beyond (8%), 7 of
  235 tracts meet the test; Sacramento (live TIGERweb) 524,943, ≈3 s.
- Adversarial review (4 lenses, refute-first): confirmed findings fixed; the
  jobs/health context lines were rewritten against the PubMed abstracts.

## Pending (in order)
1. Owner: rewrite the AI disclosure (README "AI disclosure",
   docs/CAC_SUBMISSION.md §1–§3) from docs/AI_USE_LOG.md. It still describes
   the removed narrative and claims the student wrote the code; the redesign
   was written by Claude at the owner's direction. Merge blocker.
2. Owner: approve pushing the branch for a Vercel preview; then review it.
3. Owner: decide product naming ("Food Desert AI — Impact Simulator" in the
   nav, title and PWA name; the impact projections it implied are gone).
4. Merge to main (production) on the owner's OK; re-verify the demo chips live.
5. Owner, whenever: delete VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel; Deployment Protection; key rotation.
6. Before the Oct 11 freeze: rebuild the store snapshot once
   (`node scripts/build-store-snapshot.mjs`) and re-run the golden tests;
   never after the freeze.

## Known, not fixed
- Connecticut ACS profile: /api/acs returns 502 for 2020 CT tract ids
  (ACS 2022 uses the new planning-region county codes); the verdict is
  unaffected, the profile rows show "unavailable".
- The City summary makes one live TIGERweb call even for bundled counties
  (tract names/internal points); very large cities (LA, NYC) untested.
- No rate limit on /api/acs (Vercel Firewall rule).
- docs/CAC_SUBMISSION.md answer prose describes the old method (lines listed
  in the 2026-10-03 session); the owner rewrites it.

## Pending spec patches
- None. docs/07 matches the code (signatures, reasons, data formats, copy).
