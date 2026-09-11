# Congressional App Challenge — Submission Packet

App: **Food Desert AI — Impact Simulator**
Submission deadline: **October 26, 2026, 12:00 PM ET** · Demo video: **1–3 minutes**, public on YouTube or Vimeo.

Fill every `[BRACKET]` placeholder before submitting, then check the boxes in §5.

---

## 1. Demo video script (~2:30, covers all six required beats)

> Required beats per the 2026 CAC rules: participant name(s) · app name · purpose in one clear sentence · target audience · tools and coding languages · functionality showcase. Keep the video 1–3 minutes; entries outside the window can be penalized.

| Time | Say | Show |
|---|---|---|
| 0:00–0:15 | "Hi, I'm `[YOUR NAME(S)]`, a `[GRADE]` at `[SCHOOL]` in `[DISTRICT, e.g. CA-16]`. My app is **Food Desert AI — Impact Simulator**." | Landing page (`Food Desert AI` hero) |
| 0:15–0:35 | Purpose in one sentence: "Food Desert AI tells any US community whether it is a food desert, explains exactly why, and simulates what changes if a grocery store opens." Audience: "It's for city planners, public-health teams, and anyone learning how food access is measured." | Scroll the landing: Why we care → Features → How it works |
| 0:35–0:55 | "I built it with React, Vite, and Tailwind, plus Leaflet and a 3D streets map. Data comes from the USDA, CDC, Census, and OpenStreetMap. The optional AI narrative runs through OpenRouter." | Architecture: `src/pipeline/`, `src/engine/`, `api/` (quick file-tree glance) |
| 0:55–1:40 | "Watch: I search an address — let's use Chicago's South Side. The app resolves the census tract, pulls the four data sources, and classifies it with a one-mile urban threshold over community-average distance." | Live search → designation result → evidence trace drawer → confidence badges |
| 1:40–2:10 | "Here's the part I'm proud of: it never guesses. When evidence is missing it says Unknown. And the impact panel projects residents gaining access, health direction, jobs, and trip true-cost — with a save-and-compare scenario table." | Impact panel → threshold-sensitivity slider → scenario compare |
| 2:10–2:30 | "The hardest bug was the map data failing in production — I fixed it with a server-side proxy and mirror failover. If I build 2.0, I'd add population-weighted sampling and road-network distances. Thanks for watching!" | US map mode → similar tracts → closing on the app URL |

Recording tips: record at 1080p, zoom the browser to 125% so text is readable, narrate over a real search (Chicago South Side and Detroit east side are strong demo tracts — see `src/data/sampleTracts.js`), and end on the deployed URL.

- Video URL (public): `[YOUTUBE/VIMEO URL]`
- Deployed app URL: `[VERCEL URL]`

---

## 2. Submission Q&A (paste into the application form)

### What is the title of your app?

Food Desert AI — Impact Simulator

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

Per the 2026 CAC rules, AI usage must be fully disclosed and must not constitute the entirety of technical development:

- **Used AI for:** one optional feature — the Community Narrative panel, which renders the already-computed metrics as two short paragraphs via OpenRouter at runtime, free tier only (`google/gemma-4-31b-it:free`, fallback `nvidia/nemotron-3-super-120b-a12b:free`); plus AI-assisted coding/debugging and documentation drafting during development.
- **Did not use AI for:** the core intellectual work — system design, data-source and threshold choices, the designation evaluator, distance model, projection engine, evidence-trace UX, tests, and verification (tests + production build run green).
- **Human contribution:** `[NAME(S)]` designed, implemented, debugged, and tested the app and can explain every module listed in README § Project structure. All classification and impact math is deterministic, reviewable code — not model output.

Open-source libraries/frameworks used (per rules, documented here): React, Vite, Tailwind CSS, Framer Motion, Leaflet, Streets GL, Chart.js, Radix Slot, Lucide icons, PapaParse, Workbox/vite-plugin-pwa. Data: USDA, CDC PLACES, Census ACS, OpenStreetMap (all public).

---

## 4. For judges: run it in 2 minutes (no keys needed)

1. Open `[VERCEL URL]` (or `npm install && npm run dev -- --host 127.0.0.1 --port 5173` locally).
2. Click **Launch simulation**, search **Chicago South Side, IL** (or pick a sample tract).
3. Read the designation + **evidence trace** + confidence badges.
4. Open the **impact panel**, move the threshold slider, **save a scenario** and compare.
5. Switch to **US map mode** and try **similar tracts**.
6. AI narrative is on-demand (needs `OPEN_ROUTER_API_KEY` on the server); everything above works without it.

Source: `https://github.com/ryanonline1234/Hack-Cupertino` (`food-desert-simulator/`). Created after October 30, 2025 (see git history).

---

## 5. Pre-submit checklist

- [ ] Registered at congressionalappchallenge.us before the deadline (individual or team ≤ 4; correct district of residence/school; US resident; middle/high school on Oct 26, 2026)
- [ ] App created after October 30, 2025; only one entry for the year
- [ ] Demo video 1–3 min, **public** on YouTube/Vimeo, covers all six beats in §1
- [ ] Q&A answers pasted (§2), personalized where marked
- [ ] AI disclosure complete (§3 + README)
- [ ] `.env` NOT committed (`git status` clean of secrets; `.env` is gitignored); `OPEN_ROUTER_API_KEY` set in the Vercel dashboard, not in code
- [ ] `npm run lint`, `npm test`, `npm run build` all green on the submitted commit
- [ ] Deployed URL loads keyless; sample search works (test in a fresh/incognito window)
- [ ] Exit Questionnaire completed after the deadline (every team member, individually)
