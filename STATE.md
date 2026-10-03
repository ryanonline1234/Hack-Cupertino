# State — Food Desert AI
_Updated: 2026-10-02 (security batch: relays closed, keys out of the bundle)_

## Now
Branch `security/close-relays` (off main @ 7361547, which includes
Siddharth's UI overhaul): runtime AI narrative removed, Census key behind
`api/acs.js`, `api/overpass.js` limited to `{lat, lng}`, dev middleware runs
the real handlers, build fails on a leaked key. Committed locally; NOT pushed,
NOT deployed. Production still serves the old bundle with both leaked keys
until this ships and the keys are revoked.

## Verified (2026-10-02)
- `npm test`: 70/70 pass (31 new: handler validation, client calls,
  key-hygiene scan, bundle guard, review regressions).
- `npm run lint`: only the 2 pre-existing react-hooks/purity errors in
  `src/ui/landing/GooeyNav.jsx` (unused React Bits copy from 7361547).
- `npm run build`: green; key check passes even with the old VITE_ keys still
  set at build time. Negative control: the same check on a build of 7361547
  fails on both leaked keys (same chunk hash as production).
- Dev server: `/api/acs` 200 with real ACS data; 400 on a bad FIPS; 405 on
  POST. `/api/overpass` 400 on raw QL or non-US coords, 413 on an oversized
  body, 200 with 968 elements for San Jose; no ACAO header.
- Browser check (dev, Alviso deep link): tracker boots, Census and stores load
  through the new endpoints, verdict unchanged (1.9 mi, DESIGNATED), no
  console errors, narrative panel gone.
- Adversarial review (3 lenses + refute-first verification): fixes folded in
  (malformed-JSON crash, raw body cap, partial-ACS CDN caching, cache-busting
  params, v2 cache prefix, stale docs). Re-checked under Vercel's Node runtime
  (@vercel/node dev server): malformed JSON → 400 and the function stays up;
  padded body → 413; valid → 200; /api/acs extra or duplicate params → 400.
- Exposure audit: Census key and the LLMApi key (stored as
  VITE_ANTHROPIC_KEY) are in production and 33 of 34 deployments, all public;
  never committed to git (63 commits scanned); repo is public.

## Pending (in order)
1. Owner, now: revoke the LLMApi key(s) (VITE_ANTHROPIC_KEY, LLMAPI_KEY) and
   check usage since Apr 12; check OpenRouter Activity since Sep 11 and revoke
   the key; request a new Census key and paste it into local `.env` as
   `CENSUS_KEY` (the name is already renamed there).
2. Owner: write the AI-disclosure wording (README "AI disclosure",
   docs/CAC_SUBMISSION.md §3 lines 66-67) — both still describe the removed
   narrative — plus the video-script line (CAC_SUBMISSION.md:18) and the
   landing headline "The AI workspace for food access" (LandingPage.tsx:293).
   Use docs/AI_USE_LOG.md.
3. Owner: add `CENSUS_KEY` (Sensitive; Production + Preview) in Vercel.
4. Push the branch → check the Vercel preview. Gate before merging:
   `GET <preview>/api/acs?fips=06085504602` returns 200 with population > 0
   (a 503 means CENSUS_KEY is missing for Preview), and an Alviso search
   shows non-zero income. Then merge to main (= production).
5. After deploy: delete VITE_CENSUS_KEY, VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel; turn on Standard Deployment Protection.
6. Then: the access-test / impact / store-format design (10 open decisions
   from the 2026-10-02 session); roadmap W1-W3 items still open.

## Pending spec patches
- None. docs/01, 02, 03 and 06 carry superseded notes; PROJECT_HANDOFF §11 updated.

## Known, not fixed in this batch (owner's call)
- Stored XSS: OSM store names go into Leaflet tooltips as HTML
  (MapView.jsx:141; roadmap SECCODE-P5). Reproduced in headless Chromium.
- vercel.json still has three wildcard pass-through rewrites (nominatim, cdc,
  census-geocoder) that can serve third-party HTML on the app origin.
- No rate limit on /api/overpass or /api/acs (Vercel Firewall rule).
