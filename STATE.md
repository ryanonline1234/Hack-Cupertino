# State — Miles to Market
_Updated: 2026-10-17 (renamed from "Food Desert AI" to "Miles to Market")_

## Now
Renamed to "Miles to Market" (slug `miles-to-market`) in code, PWA manifest
and docs; not yet redeployed — production (food-desert-ai.vercel.app,
main @ 2b6f0a8, deployed 2026-10-06) still serves the old brand until the next
deploy, and the Vercel URL is unchanged.
Live in production (food-desert-ai.vercel.app, main @ 2b6f0a8, deployed
2026-10-06): the docs/07 access-test redesign, docs/08 Suggest sites and
action plan, the security fixes, the repo docs, the product name "Food Desert
AI" (header, title, PWA) and the git-audited AI disclosure. 2026-10-06
production check: title and header say Food Desert AI, /api/acs 200 with
data, /api/llmapi 404, Alviso village pin flips, no page errors.
Earlier (2026-10-03) post-deploy check: Production check after deploy: data files and /api/acs serve,
/api/overpass and /api/llmapi are 404, no key values in the 14 bundle files,
Alviso + village pin flips MEETS → DOES NOT MEET.

## Live (2026-10-19)
New search, Home clearing the location, US-map county search
(DECISIONS 2026-10-19). `npm test` 388/388, lint clean, build ok.

## Live (2026-10-18, main 86015dc)
These are live at https://miles-to-market.vercel.app: the placing redesign,
guide zones, the compact place-store bar, the collapsible log, the removal of
Highlight Food, and the tract-level US map (DECISIONS 2026-10-18, docs/08
§3a, docs/data.md). Checked on production in a fresh browser:
- the placement flows;
- the log toggle;
- the US map, which loads all 9,293 tracts in about 2 seconds;
- no page errors.

`npm test` passes 376/376, lint is clean, and build and the key check are
ok. The demo video was re-recorded from production with the timing
unchanged, so the teammates' recorded voice parts still line up. The video
they recorded against is in `notes-local/video/pre-2026-10-18/`.

## Verified (2026-10-17)
- React Bits copies deleted. Build output is identical apart from one unused
  utility rule (`.shrink`, which sets the browser default) and the file hashes
  that follow from it. Lint is clean, and `npm test` passes 358/358.
- The stray chessboard branch is no longer on GitHub (`git ls-remote`).

## Verified (2026-10-06)
- `npm test` 358/358; lint: only the 2 pre-existing GooeyNav.jsx errors;
  `npm run build` + key check ok. Store snapshot rebuilt: only
  `public/data/stores/manifest.json` `retrievedAt` changed.
- Disclosure facts re-checked against git by two refute-first reviewers and by
  hand (trailers, ancestry, blob matches, import trace, bundle).

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

## Demo video (re-recorded 2026-10-17 from the renamed production site)
`notes-local/video/` (git-excluded) holds the 2:50 cut as
`miles-to-market_cac_demo_{silent,teleprompter,tts-guide_NOT-FOR-UPLOAD}.mp4`
plus `_captions.srt`. `TRANSCRIPT.md` is the team read: Vihaan 0:00–1:02,
Siddharth 1:02–2:10, Ryan 2:10–2:50. The old Food Desert AI cuts are in
`notes-local/video/old-food-desert-ai/`. `pipeline/rerecord_all.sh`
re-records after any on-screen change, about 10 min. The cover photo is
`notes-local/cover/miles-to-market_cover_600x800.jpg`, with a 1200×1600 copy.
Production is live at https://miles-to-market.vercel.app, and the old
https://food-desert-ai.vercel.app still serves it.

## Pending (in order)
1. Owner: review the AI disclosure (README, docs/CAC_SUBMISSION.md §3; drafted
   by Claude, rewritten 2026-10-06 from a git audit) and confirm three facts:
   Claude Code use in the April hackathon commits (inferred from
   `.claude/launch.json` in 569a99d), whether Siddharth used AI tools in
   7361547 (yes, confirmed 2026-10-17; which tools is still to ask), and record the review date in docs/AI_USE_LOG.md. The §2 answer
   prose and §4 judges' steps still describe the old method; §2's "I moved the
   call…" is Claude co-authored work (179b22f), so reword it when rewriting.
2. Owner: put the CAC registration name in
   `notes-local/video/pipeline/config.json` (and `"team"` if it is a team
   entry), run `rebuild_cards.sh`, record the voiceover (SCRIPT.md), upload
   public. Fill `[NAME]` in docs/CAC_SUBMISSION.md §3.
   2026-10-12: config now has "Ryan Tseng" + team Vihaan Narkhede, Siddharth
   Vijay (confirm exact registration names); `notes-local/video/TRANSCRIPT.md`
   splits the read into 3 parts (Part 3 must be Ryan); captions, teleprompter
   and cards rebuilt to match. For a solo entry set `"team": []` and run
   `rebuild_cards.sh`.
3. Code freeze Oct 11: no store-snapshot rebuild after it (done 2026-10-06:
   USDA data unchanged since 2026-09-17, tiles identical, numbers unchanged).
4. Done 2026-10-17: the stray chessboard branch is no longer on GitHub.
5. Owner, whenever: delete VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel; Deployment Protection; key rotation.
6. Done 2026-10-17: React Bits copies deleted (no visual change; lint clean).

## Known, not fixed
- A browser that visited before a deploy can show the previous build once (the
  old service worker serves the cached shell; seen on 2026-10-03, fixed by one
  reload). Before recording the video, load the site and reload once. Roadmap
  item GAP-P6 (service-worker update handling) would remove the window.
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
