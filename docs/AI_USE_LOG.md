# AI use log — Food Desert AI

A factual, per-change record of AI-assisted work in this repo, kept so the
CAC AI disclosure (README.md "AI disclosure", docs/CAC_SUBMISSION.md §3) can
be written from evidence. This file is a log, not the disclosure: the
disclosure wording is the student's own.

One row per change, added the same day the change lands. "Claude" means
Claude Code (Anthropic). Commits Claude authored carry a
`Co-Authored-By: Claude` trailer.

| Date | Change | Files | What Claude did | What Ryan did | Commit |
|---|---|---|---|---|---|
| 2026-10-02 | Close the open API relays and stop shipping keys in the bundle: remove the runtime AI narrative; move the Census key server-side (`/api/acs`); limit `/api/overpass` to `{lat, lng}`; run `api/` handlers in local dev; post-build key check | `api/acs.js` (new), `api/overpass.js`, `api/llmapi.js` (deleted), `src/pipeline/censusFetch.js`, `src/pipeline/storeDistanceFetch.js`, `src/TrackerApp.jsx`, `src/components/AICard.jsx` (deleted), `src/lib/citeNumbers.js` (deleted), `src/lib/narrativeSanitize.js` (deleted), `vite.config.js`, `vite-plugin-api-dev.js` (new), `scripts/check-bundle-for-keys.mjs` (new), `vercel.json`, `eslint.config.js`, `package.json`, 6 test files, docs | Audited the live exposure (bundles, deployments, git history), proposed the scope, wrote all of the code, tests and doc edits listed here, and ran the verification (tests, lint, build, negative control, local browser check) | Chose the options (remove the narrative, server-side Census proxy, bound Overpass, this log), reviews the diff and preview, does the key revocations and Vercel settings | `f1c2097` (branch `security/close-relays`) |
| 2026-10-02 | Review fixes to the same batch: malformed-JSON crash, raw body cap, partial-answer caching, extra-parameter rejection, cache prefix v2, Vercel-faithful dev body parsing, stale docs | `api/overpass.js`, `api/acs.js`, `vite-plugin-api-dev.js`, `src/pipeline/censusFetch.js`, `src/pipeline/normalizer.js`, 2 test files, docs | Ran an adversarial review with subagents, reproduced the findings under Vercel's Node runtime, wrote the fixes and tests | Reviews the diff | Second commit on `security/close-relays` |
| 2026-10-02 | Escape OSM store names in map tooltips (stored XSS, roadmap SECCODE-P5); narrow the three pass-through rewrites to the exact paths used | `src/lib/storeTooltip.js` (new), `src/components/MapView.jsx`, `vercel.json`, 2 test files, docs | Wrote the fix, tests and rewrite rules, and checked the rules against Vercel's route compiler | Approved the fixes | Third commit on `security/close-relays` |
| 2026-10-02 | Access-test redesign, data + engine: dated SNAP store tiles, ERS county shards, Census block bundles and their builders; the low-access statistic and verdict; tract/place, block, store and ERS loaders; rewritten normalizer and scenario engine; share-link store formats | `scripts/build-store-snapshot.mjs`, `scripts/store-exclusions.json`, `scripts/build-ers-shards.mjs`, `scripts/build-block-bundles.mjs`, `public/data/{stores,ers,blocks}/`, `src/lib/geo.js`, `src/lib/stateCodes.js`, `src/engine/lowAccess.js`, `src/engine/foodAccessVerdict.js`, `src/engine/scenarioEngine.js`, `src/pipeline/{tractLookup,blockLoader,storeLoader,ersLoader,normalizer}.js`, `src/lib/urlState.js`, 6 test files, docs/07 | Proposed the method after a research and probe round, wrote the spec, and wrote all of this code and data tooling with subagents (tests first) | Approved the design and chose to have Claude write all of it | Commits on `redesign/access-test` |
| 2026-10-03 | Access-test redesign, UI: verdict card with scope line, references and Unknown reasons; store-format chips and per-pin editing; computed impact card with cited context; city detection and City summary; deletion of the 9-point model, projections, Overpass and related components; landing and README text | `src/TrackerApp.jsx`, `src/components/{CommunityStatsPanel,ScenarioResultCard,StreetsGlView,MapView,LocationGate,MobileResultsView,CitySummary,AgentStatusFeed,FeatureNav,DesignationAtlasView}.jsx`, `src/lib/{storeFormats,locationSearch,storeTooltip}.js`, `src/pipeline/placeLoader.js`, `src/ui/landing/LandingPage.tsx` (text only), `README.md`, `PROJECT_HANDOFF.md`, tests, ~25 files deleted | Wrote all of it with subagents (tests first where testable), ran headless browser smoke tests on the demo tracts and two cities | Approved the design, the text-only landing edits and having Claude write all of it | Commits on `redesign/access-test` |
| 2026-10-03 | Review fixes to the redesign: ERS-file failure and non-SNAP territories become named Unknowns; CDC/ACS can't block the verdict; cache eviction; faster City-summary point-in-polygon; guarded rounding; share-link precision; undo history; retry; focus, live region and contrast fixes; corrected jobs and health citations (checked against the PubMed abstracts) | `src/pipeline/{normalizer,placeLoader,cdcFetch,censusFetch}.js`, `src/lib/{format,storeFormats,locationSearch}.js`, `src/TrackerApp.jsx`, `src/components/{CommunityStatsPanel,CitySummary,ScenarioResultCard,MobileResultsView,StreetsGlView,MapView}.jsx`, `src/ui/landing/LandingPage.tsx` (text only), `index.html` (meta text), tests, docs | Ran a 4-lens adversarial review with refute-first verification, then wrote all fixes and tests with subagents and smoke-tested 13 cases headless | Approved | Commits on `redesign/access-test` |

## Backfill still needed (from git, 2026-10-02)

Known AI-assisted work that predates this log. Fill in the "what" for each
before writing the disclosure:

- April 29, 2026 — four commits on main carry a Claude co-author trailer:
  `179b22f`, `a5df48a`, `f622625`, `07164ba`.
- September 2026 — work done with Claude Code on main without trailers
  (owner to list which commits).
- Unmerged branch `claude/food-desert-ai-improvements-skyrmp` — 12 commits,
  all authored by Claude; not on main.
