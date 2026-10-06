# State — Food Desert AI
_Updated: 2026-10-06 (product name, pre-freeze snapshot, disclosure update, demo video)_

## Now
Live in production (food-desert-ai.vercel.app, main @ 4f36d89, deployed
2026-10-03): the docs/07 access-test redesign, docs/08 Suggest sites and
action plan, the security fixes, the rewritten AI disclosure and the repo
docs. Production check after deploy: data files and /api/acs serve,
/api/overpass and /api/llmapi are 404, no key values in the 14 bundle files,
Alviso + village pin flips MEETS → DOES NOT MEET.

## Verified (2026-10-03)
- `npm test`: 230/230. Lint: only the 2 pre-existing GooeyNav.jsx errors.
  `npm run build` + key check: ok.
- Golden tracts on the committed data: Alviso 06085504602 MEETS (≈1,900 of
  2,060 beyond 1 mi), a village pin flips it (→ 41); Greenville 28151000600
  MEETS and flips with one pin; Los Altos Hills not low income; Cupertino
  06085508101 0 beyond; Chinle 04001944202 DOES NOT MEET after the SNAP
  coordinate fix for Bashas' (215 of 3,608 beyond 10 mi; was 1,088 with SNAP's
  wrong point).
- Headless smoke (13 cases, no page errors): the demo tracts, dollar-store pin
  (no flip), San Juan PR (UNKNOWN, SNAP doesn't operate there), Hartford CT
  (definite verdict), ERS file blocked (named Unknown + Try again), CDC hung
  (verdict at ≈13 s), 390 px, Undo after Clear.
- City summary: San Jose in-city 1,013,240 (exact), ≈79,730 beyond (8%), 7 of
  235 tracts meet the test; Sacramento (live TIGERweb) 524,943, ≈3 s.
- Adversarial review (4 lenses, refute-first): confirmed findings fixed; the
  jobs/health context lines were rewritten against the PubMed abstracts.

## Demo video (built 2026-10-06, local only)
`notes-local/video/` (git-excluded): 2:51 silent cut recorded from production,
a teleprompter cut, captions, a TTS timing guide (not for upload) and
`SCRIPT.md`, the voiceover script. That file replaces docs/CAC_SUBMISSION.md
§1, which describes the old method. `pipeline/rebuild_cards.sh` puts the name
on the cards; `pipeline/rerecord_all.sh` re-records after any on-screen change
(header rename, snapshot rebuild). Before upload, see SCRIPT.md's "Before you
upload" list: name, team, disclosure (Cursor, September, the video itself),
header name, snapshot.

## Pending (in order)
1. Owner: review the AI disclosure (README, docs/CAC_SUBMISSION.md §3; drafted
   by Claude 2026-10-03, updated 2026-10-06 with Cursor, the September record
   gap and the demo video). The CAC packet's §2 answer prose and §4 judges'
   steps still describe the old method; §1 now points to the video script.
2. Owner: put the CAC registration name in
   `notes-local/video/pipeline/config.json` (and `"team"` if it is a team
   entry), run `rebuild_cards.sh`, record the voiceover (SCRIPT.md), upload
   public. Fill `[NAME]` in docs/CAC_SUBMISSION.md §3.
3. Code freeze Oct 11: no store-snapshot rebuild after it (done 2026-10-06:
   USDA data unchanged since 2026-09-17, tiles identical, numbers unchanged).
4. Owner, whenever: delete VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel; Deployment Protection; key rotation.
5. Ask Siddharth to delete the unused React Bits copies (license + lint).

## Known, not fixed
- A browser that visited before a deploy can show the previous build once (the
  old service worker serves the cached shell; seen on 2026-10-03, fixed by one
  reload). Before recording the video, load the site and reload once. Roadmap
  item GAP-P6 (service-worker update handling) would remove the window.
- Unused React Bits copies in the public repo (src/ui/landing/GooeyNav.jsx,
  FlexCarousel.jsx; MIT + Commons Clause forbids redistributing the
  components) and their 2 lint errors: Siddharth's files; ask him to delete.
- package.json still lists unshipped deps (three, @react-three/*, chart.js,
  react-chartjs-2, ogl); the PWA precaches two unused PNGs (~800 KB).
- Location search hits Nominatim as you type (300 ms debounce); Nominatim's
  policy forbids client autocomplete. Consider Census geocoder or a debounce
  plus submit-only search.
- LICENSE copyright line says "NutriPlan.AI contributors" (owner's call).
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
