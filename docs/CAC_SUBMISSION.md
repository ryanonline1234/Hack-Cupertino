# Congressional App Challenge — Submission Packet

App: **Food Desert AI**
Submission deadline: **October 26, 2026, 12:00 PM ET** · Demo video: **1–3 minutes**, public on YouTube or Vimeo.

Fill every `[BRACKET]` placeholder before submitting, then check the boxes in §5.

---

## 1. Demo video (2:51, covers all six required beats)

The video is a screen recording of the live production app, with title, code-explanation, diagram and closing-credits cards between the app scenes, narrated by the student. The voiceover script, the recording pipeline and the output files are kept locally in `notes-local/video/` (not in this repo); `notes-local/video/SCRIPT.md` is the script with timecodes. How the video was made is disclosed in §3.

| Required beat (2026 rules) | Where in the video |
|---|---|
| Participant name(s) | 0:17 spoken, title card, end card |
| App name | 0:17 spoken, title card, end card |
| Purpose in one clear sentence | 0:23 |
| Target audience | 0:34 |
| Tools and coding languages | 2:31 "Built with" card; AI coding tools at 2:18 and on the cards |
| Functionality showcase | 0:00–0:17 and 0:34–2:02, bookend at 2:42 |

Timecodes are the planned line starts in SCRIPT.md; re-check them against the final narrated cut.

- Video URL (public): `[YOUTUBE/VIMEO URL]`
- Deployed app URL: https://food-desert-ai.vercel.app

---

## 2. Submission Q&A (paste into the application form)

### What is the title of your app?

Food Desert AI

### Explain the app's purpose.

Food Desert AI answers three questions for any US community: what is the current food-access designation, why did the system make that designation, and what is likely to change if a grocery store opens. Users search any address; the app resolves the census tract, merges USDA, CDC PLACES, Census ACS, and OpenStreetMap supermarket data, classifies the tract with a transparent distance-first rule (1 mile urban / 5 miles rural over community-average distance), shows the full evidence trace with source-confidence badges, and projects intervention impact across access, health, economics, and trip true-cost — including save/compare scenarios for planning.

### What inspired you to create this app?

Food deserts affect millions of Americans, but the public data that describes them (USDA atlases, CDC tables, Census figures) is scattered and hard for non-experts — or busy city staff — to interpret. `[PERSONALIZE: e.g. a neighborhood you know, a class, Hack Cupertino.]` I wanted to turn that geography into clarity: one search, one honest answer, and a simulation that helps communities argue for a grocery store with numbers instead of anecdotes.

### What technical/coding difficulty did you face, and how did you address it?

Two related ones. First, the supermarket-distance provider (Overpass/OSM) returned HTTP 406 with no CORS headers to browser origins, so the map worked locally and broke when deployed. I moved the call into a Vercel serverless function (`api/overpass.js`) with three mirror endpoints, a 12-second timeout, and failover — same-origin for the browser, resilient upstream. Second, a single center-point distance misclassified edge tracts, so I built a 9-sample community-average model (`src/pipeline/storeDistanceFetch.js`) and kept the center value as a labeled reference; when distance data is unavailable the evaluator returns `Unknown` instead of guessing (`src/engine/foodDesertEvaluation.js`, covered by `tests/`).

### What did you learn while participating in the CAC? What was your biggest takeaway?

`[PERSONALIZE.]` Draft: I learned that explainability is a feature, not a footnote — showing the evidence chain and saying "Unknown" when data is missing earned more trust than a confident-sounding guess. My biggest takeaway is that real-world data is messy (coverage gaps, throttled APIs, incomplete map tags), so resilient software means designing the failure states first: caching, fallbacks, and honest empty states.

### What would you change about your app if you were to create a 2.0 version?

1. Population-weighted distance sampling using Census block-group centroids instead of fixed offsets.
2. Optional road-network distance fallback for high-stakes planning mode.
3. Persisted telemetry for stage timings and source failure rates.
4. A larger disagreement-analytics view (distance rule vs USDA benchmark across tract cohorts).
5. Snapshot tests for trace-drawer wording and model metadata.

---

## 3. AI disclosure (also summarized in README)

Per the 2026 CAC rules, AI usage must be fully disclosed and must not constitute the entirety of technical development. The per-change record is `docs/AI_USE_LOG.md`.

- **No AI at runtime.** All verdicts and numbers are deterministic code over public data. The optional AI narrative panel (OpenRouter) was removed on 2026-10-02. "AI" in the product name is a name only.
- **Used AI for (Claude Code, Anthropic; plus Cursor for some hackathon commits and Grok Imagine for three unused images):**
  - April 2026, Hack Cupertino (April 11–12) and follow-up: the first version was built at the hackathon with teammates Vihaan Narkhede and Siddharth Vijay. Claude Code was in use from the start: the student's hackathon commits (`569a99d` through `106c319`) carry no trailers, but the first one already contains Claude Code's `.claude/launch.json`; which parts were AI-written was not recorded. Vihaan's four hackathon commits (`fb6f754`, `7f3b248`, `c37021e`, `4bf8034`, on the `landing` branch) carry a `Made-with: Cursor` trailer (Cursor, an AI code editor), and their code reached main through the student's integration commit `fb8ce1a`. Four of their files are unchanged: the six-line `cn()` helper in `src/lib/utils.ts`, which the landing page uses, and `src/components/ui/{badge,button,card}.tsx`, which nothing shipped imports. `tailwind.config.js`, which the build uses, is their file with 5 of its 51 lines since changed. Five more of their components remain, lightly edited and unused (`src/components/ui/{globe,horizontal-menu-bar,particle-text-effect,radial-orbital-timeline,ruler-carousel}.tsx`), and the landing page began as theirs and has since been rewritten. Four follow-up commits on April 29 carry a Claude co-author trailer (`179b22f`, `a5df48a`, `f622625`, `07164ba`).
  - September 2026: Claude Code was used throughout. None of the 26 commits on main from September 11–15 (`daa0830` through `6483fed`) carry trailers; they include the features described in `DECISIONS.md` and `docs/01`–`docs/06` (place-a-store scenarios, share links, the mobile results page, reliability and UI polish batches), the rebrand, the US map, the landing-page crisis section and the first draft of the CAC packet. Which parts were AI-written was not recorded commit by commit. Separately, the unmerged branch `claude/food-desert-ai-improvements-skyrmp` holds 12 commits authored by Claude Code (September 3–4); none of its code is on main.
  - October 2026: Claude Code wrote, at the student's direction, the security fix and the entire access-test redesign (`docs/07`): method, data builders and datasets, engine, loaders, UI, tests and documentation, plus Suggest sites and the action plan (`docs/08`) and the research and adversarial reviews behind them. Every commit Claude wrote in October carries a `Co-Authored-By: Claude` trailer (Siddharth Vijay's `7361547` carries no AI trailer).
  - Demo video (October 2026): Claude Code researched the 2026 CAC video rules and drafted and fact-checked the voiceover script, which the student narrates. It wrote the Playwright scripts that recorded the live app (including the scripted cursor, on-screen highlights and zooms), generated the title, code, diagram, "How the rebuild was made", "Built with" and end cards, and wrote the code that cut and assembled the video and made its caption file (logged in `docs/AI_USE_LOG.md`, 2026-10-06).
  - Submission text: this disclosure was drafted by Claude Code from `docs/AI_USE_LOG.md` and the git history (2026-10-03, updated 2026-10-06) and is reviewed by the student; the draft answers in `docs/CAC_SUBMISSION.md` §2 were first written with Claude Code in September (`daa0830`).
- **Human contribution:** `[NAME]` directed the work, chose among the options Claude Code researched and proposed (recorded in `DECISIONS.md`), reviewed the results, handled deployment and API-key management, and narrates the demo video. Siddharth Vijay redesigned the landing page and visual style (commit `7361547`); that commit added three AI-generated images (Grok Imagine, per their C2PA metadata) that the app does not display.

Open-source libraries in the shipped app (per rules, documented here): React, Vite, Tailwind CSS, GSAP, Leaflet, Lucide icons, PapaParse, clsx, tailwind-merge, Workbox/vite-plugin-pwa. Other declared dependencies (Framer Motion, Radix Slot, class-variance-authority, three, @react-three/fiber, @react-three/drei, ogl, chart.js, react-chartjs-2) are imported only by unused files or by nothing and are not in the bundle; the full list with licenses, fonts and map services is in `THIRD_PARTY_NOTICES.md`. Data (all public): USDA ERS Food Access Research Atlas (2019 and 2025), the USDA FNS SNAP Retailer Locator, Census TIGERweb (2020 blocks, tracts, places), Census ACS, CDC PLACES; map tiles from OpenStreetMap and CARTO; place search via OpenStreetMap Nominatim.

---

## 4. For judges: run it in 2 minutes (no keys needed)

1. Open https://food-desert-ai.vercel.app (or `npm install && npm run dev -- --host 127.0.0.1 --port 5173` locally).
2. Click **Launch simulation**, search **Chicago South Side, IL** (or pick a sample tract).
3. Read the designation + **evidence trace** + confidence badges.
4. Open the **impact panel**, move the threshold slider, **save a scenario** and compare.
5. Switch to **US map mode** and try **similar tracts**.
6. Census demographics come from the server-side `api/acs.js` (needs `CENSUS_KEY` on the server). Without it, designation and the evidence trace still work, but population, income and poverty figures, the income-based low-income test and the population-driven impact numbers fall back to zero.

Source: `https://github.com/ryanonline1234/Hack-Cupertino` (`food-desert-simulator/`). Created after October 30, 2025 (see git history).

---

## 5. Pre-submit checklist

- [ ] Registered at congressionalappchallenge.us before the deadline (individual or team ≤ 4; correct district of residence/school; US resident; middle/high school on Oct 26, 2026)
- [ ] App created after October 30, 2025; only one entry for the year
- [ ] Demo video 1–3 min, **public** on YouTube/Vimeo, covers all six beats in §1 (name on the title and end cards: `notes-local/video/pipeline/config.json`, then `rebuild_cards.sh`)
- [ ] Q&A answers pasted (§2), personalized where marked
- [ ] AI disclosure complete (§3 + README)
- [ ] `.env` NOT committed (`git status` clean of secrets; `.env` is gitignored); `CENSUS_KEY` set in the Vercel dashboard (no `VITE_` prefix), not in code; `npm run build` passes the bundle key check
- [ ] `npm run lint`, `npm test`, `npm run build` all green on the submitted commit
- [ ] Deployed URL loads keyless; sample search works (test in a fresh/incognito window)
- [ ] Exit Questionnaire completed after the deadline (every team member, individually)
