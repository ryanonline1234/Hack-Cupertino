# State — Food Desert AI
_Updated: 2026-10-06 (product name, pre-freeze snapshot, disclosure update, demo video)_

## Now
Live in production (food-desert-ai.vercel.app, main @ 2b6f0a8, deployed
2026-10-06): the docs/07 access-test redesign, docs/08 Suggest sites and
action plan, the security fixes, the repo docs, the product name "Food Desert
AI" (header, title, PWA) and the git-audited AI disclosure. 2026-10-06
production check: title and header say Food Desert AI, /api/acs 200 with
data, /api/llmapi 404, Alviso village pin flips, no page errors.
Earlier (2026-10-03) post-deploy check: Production check after deploy: data files and /api/acs serve,
/api/overpass and /api/llmapi are 404, no key values in the 14 bundle files,
Alviso + village pin flips MEETS → DOES NOT MEET.

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

## Demo video (built 2026-10-06, local only)
`notes-local/video/` (git-excluded): 2:51 silent cut recorded from production,
a teleprompter cut, captions, a TTS timing guide (not for upload) and
`SCRIPT.md`, the voiceover script with timecodes; docs/CAC_SUBMISSION.md §1
maps the six required beats to those timecodes. Re-recorded 2026-10-06 from
main @ 2b6f0a8 (new header; focus-ring highlights, crossfades).
`pipeline/rebuild_cards.sh` puts the name on the cards; `pipeline/rerecord_all.sh`
re-records after any on-screen change (deploy first, reload once).

## Pending (in order)
1. Owner: review the AI disclosure (README, docs/CAC_SUBMISSION.md §3; drafted
   by Claude, rewritten 2026-10-06 from a git audit) and confirm three facts:
   Claude Code use in the April hackathon commits (inferred from
   `.claude/launch.json` in 569a99d), whether Siddharth used AI tools in
   7361547, and record the review date in docs/AI_USE_LOG.md. The §2 answer
   prose and §4 judges' steps still describe the old method; §2's "I moved the
   call…" is Claude co-authored work (179b22f), so reword it when rewriting.
2. Owner: put the CAC registration name in
   `notes-local/video/pipeline/config.json` (and `"team"` if it is a team
   entry), run `rebuild_cards.sh`, record the voiceover (SCRIPT.md), upload
   public. Fill `[NAME]` in docs/CAC_SUBMISSION.md §3.
3. Code freeze Oct 11: no store-snapshot rebuild after it (done 2026-10-06:
   USDA data unchanged since 2026-09-17, tiles identical, numbers unchanged).
4. Owner: the public repo has an unrelated branch
   `claude/robotic-chessboard-feasibility-3ittpi` (chessboard project pushed
   here by mistake); delete it on GitHub if wanted.
5. Owner, whenever: delete VITE_ANTHROPIC_KEY, LLMAPI_KEY and
   OPEN_ROUTER_API_KEY in Vercel; Deployment Protection; key rotation.
6. Ask Siddharth to delete the unused React Bits copies (license + lint).

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
