# State — Food Desert AI
_Updated: 2026-10-02 (security batch merged and live in production)_

## Now
Branch `security/close-relays` (off main @ 7361547, which includes
Siddharth's UI overhaul): runtime AI narrative removed, Census key behind
`api/acs.js`, `api/overpass.js` limited to `{lat, lng}`, dev middleware runs
the real handlers, build fails on a leaked key, OSM names escaped in tooltips,
pass-through rewrites exact. Merged to main (fast-forward, fb14c53) and live
in production 2026-10-02. CENSUS_KEY added in Vercel (Sensitive, Production +
Preview; VITE_CENSUS_KEY deleted) and production redeployed at e69da03:
/api/acs serves real ACS figures. Older deployment URLs still serve the old
key-bearing bundles and relays until the keys are revoked or Deployment
Protection is on (owner deferred rotation: spend $0, capped at $0.01).

## Verified (2026-10-02)
- `npm test`: 75/75 pass (36 new: handler validation, client calls,
  key-hygiene scan, bundle guard, review regressions, tooltip escaping,
  exact rewrite coverage).
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
- Vercel preview (2a65ae8): build log shows `[key-guard] ok` with both old
  VITE_ keys present in the build env; 15 deployed files (11 JS) contain no
  key value or key shape; /api/llmapi and /api/census 404; /api/overpass 400
  on raw QL and malformed JSON, stays up, 200 for San Jose (532 KB, 8 s);
  rewrites: nominatim ui/status and other paths 404, geocoder/reverse/CDC
  200; /api/acs 503 (no CENSUS_KEY yet).
- Production (food-desert-ai.vercel.app @ fb14c53, after deploy): 14 files,
  no key value or key shape; /api/llmapi and /api/census 404; /api/overpass
  400 on raw QL and malformed JSON, 200 for San Jose; nominatim ui 404;
  geocoder, reverse and CDC 200; /api/acs 503 (no CENSUS_KEY yet).
- Production @ e69da03 (after CENSUS_KEY): /api/acs 200 for Alviso
  (population 1,920, median income $107,438) and Greenville 28151000600;
  400 on a bad FIPS; bundle still has no key value. Production Alviso search
  fetched /api/acs 200 and stored the real figures (panel count-up not
  visually confirmed: the browser pane was hidden).
- Exposure audit: Census key and the LLMApi key (stored as
  VITE_ANTHROPIC_KEY) are in production and 33 of 34 deployments, all public;
  never committed to git (63 commits scanned); repo is public.

## Pending (in order)
1. Owner, when convenient (owner call 2026-10-02: spend is $0 and capped at
   the 1-cent minimum, so rotation is not blocking): revoke the LLMApi key(s)
   (VITE_ANTHROPIC_KEY, LLMAPI_KEY) and the OpenRouter key; request a new
   Census key for local `.env` as `CENSUS_KEY` (the name is already renamed).
2. Owner: write the AI-disclosure wording (README "AI disclosure",
   docs/CAC_SUBMISSION.md §3 lines 66-67) — both still describe the removed
   narrative — plus the video-script line (CAC_SUBMISSION.md:18) and the
   landing headline "The AI workspace for food access" (LandingPage.tsx:293).
   Use docs/AI_USE_LOG.md.
3. Owner, whenever: delete VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel (nothing reads them now); turn on Standard
   Deployment Protection.
4. Then: the access-test / impact / store-format design (10 open decisions
   from the 2026-10-02 session); roadmap W1-W3 items still open.

## Pending spec patches
- None. docs/01, 02, 03 and 06 carry superseded notes; PROJECT_HANDOFF §11 updated.

## Known, not fixed in this batch (owner's call)
- No rate limit on /api/overpass or /api/acs (Vercel Firewall rule).
- Fixed in this batch after review: stored XSS via OSM store names in Leaflet
  tooltips (roadmap SECCODE-P5) and the wildcard pass-through rewrites.
