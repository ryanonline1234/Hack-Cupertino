# Food Desert AI — Impact Simulator

> Food Desert AI helps cities and public-health teams turn geography into clarity: type any US address and see whether the community is a food desert, why, and what changes if a grocery store opens.

An explainability-first React app for exploring US food-access conditions, classifying designation status, and modeling intervention impact. Built for the [Congressional App Challenge](https://www.congressionalappchallenge.us/) — see [`docs/CAC_SUBMISSION.md`](docs/CAC_SUBMISSION.md) for the submission packet (demo-video script, Q&A answers, AI disclosure, judges' checklist).

## Purpose (one sentence)

Food Desert AI answers three questions for any US community: what is the current food-access designation, why did the system make that designation, and what is likely to change under an intervention scenario.

## Target audience

- City planners and public-health teams evaluating grocery interventions
- Students, educators, and community advocates learning how food access is measured
- Congressional App Challenge judges evaluating idea, implementation, and code quality

## Features

1. Location-driven tract analysis merging USDA, CDC PLACES, Census ACS, and OpenStreetMap signals.
2. Transparent designation output with evidence trace, source-confidence badges, and Unknown-when-unsupported handling.
3. Community-average supermarket distance model (center-point value kept as a reference metric).
4. Impact projections across access, health directionality, local economics, and trip true-cost.
5. Scenario save/compare, threshold-sensitivity preview, and shareable URL deep links.
6. Nationwide designation map mode with zoom-aware in-view summaries and similar-tract comparison.
7. Landing experience with animated intro and nutrition-education content.
8. Installable PWA with offline app shell (data calls stay network-only — stale data is never presented as fresh).

## Tech stack

| Layer | Tools / languages |
|---|---|
| UI | React 19, Vite, Tailwind CSS, Framer Motion, Leaflet + Streets GL 3D map, Chart.js |
| Data pipeline | JavaScript (ES modules) over USDA Food Access Research Atlas, CDC PLACES, Census ACS, Overpass/OSM |
| AI narrative | OpenRouter (OpenAI-compatible `chat/completions`), on-demand two-paragraph community narrative |
| APIs | Vercel serverless functions in `api/` (Overpass + LLM proxies) |
| Tests | Node built-in test runner (`node --test`) |
| PWA | `vite-plugin-pwa` (Workbox) |

## Quick start

Prerequisites: Node.js 20+ and npm.

```bash
npm install
cp .env.example .env   # then fill in keys (optional — see below)
npm run dev -- --host 127.0.0.1 --port 5173
```

### Environment variables

| Variable | Required? | Used by |
|---|---|---|
| `OPEN_ROUTER_API_KEY` | No (production AI narrative) | `api/llmapi.js` on Vercel — set in the Vercel dashboard, never in the client bundle |
| `VITE_OPEN_ROUTER_API_KEY` | No (local-dev AI narrative) | Vite dev proxy → OpenRouter; only for `npm run dev` |
| `VITE_CENSUS_KEY` | No | Census ACS demographics; app falls back to built-in defaults without it |

**Judges / reviewers without keys:** the app runs fully keyless. Maps, designation classification, evidence trace, impact projections, scenario compare, and sample tracts all work. Only the AI narrative panel shows an on-demand prompt instead of generated text.

Get an OpenRouter key at <https://openrouter.ai/keys>.

### Build / lint / test

```bash
npm run lint     # eslint
npm test         # unit tests (node --test tests/**/*.test.js)
npm run build    # production build to dist/
npm run preview  # serve the production build locally
```

Current status: tests passing, production build passing (re-verify with the commands above before submitting).

## Project structure

```text
src/
  App.jsx                  # landing ↔ tracker shell
  TrackerApp.jsx           # analysis orchestration (location → pipeline → impact → UI)
  pipeline/                # geocoder, USDA, CDC, Census, OSM distance, normalizer
  engine/                  # designation evaluator, impact projection, simulation scoring
  components/              # map, stats/trace panels, AI narrative, impact, atlas views
  ui/landing/              # Food Desert AI landing experience
  lib/ / utils/ / hooks/   # citations, similar-tract search, URL state, formatting
api/
  llmapi.js                # server-side OpenRouter proxy (OPEN_ROUTER_API_KEY stays server-only)
  overpass.js              # server-side Overpass proxy with mirror failover
tests/                     # designation behavior, USDA fixtures, projection economics, distance model
public/data/               # bundled reference datasets
docs/
  CAC_SUBMISSION.md        # Congressional App Challenge packet (video script + Q&A + checklist)
PROJECT_HANDOFF.md         # implementation-level technical handoff
```

## Data sources

1. USDA Food Access Research Atlas (low-access / low-income context)
2. CDC PLACES (diabetes, obesity prevalence)
3. US Census ACS 5-year (income, poverty, vehicle access, population)
4. OpenStreetMap / Overpass (supermarket locations for the distance model)

### Caveats (shown in-app where relevant)

1. Distance metrics are model estimates (Haversine over sampled community points), not road-network travel distance/time.
2. Upstream coverage and quality vary by geography; OSM tagging completeness affects estimates.
3. `Unknown` designations are intentional when required evidence is missing — the app refuses to guess.
4. Health projections are directional planning estimates, not medical predictions.

## AI disclosure (Congressional App Challenge)

Per CAC rules, all AI usage is disclosed here and in [`docs/CAC_SUBMISSION.md`](docs/CAC_SUBMISSION.md):

- **What uses AI:** one optional feature — the Community Narrative panel, which turns the already-computed metrics into two short paragraphs via OpenRouter, free tier only (`google/gemma-4-31b-it:free`, fallback `nvidia/nemotron-3-super-120b-a12b:free`). All classification, distance modeling, and impact math is deterministic code in `src/engine/` and `src/pipeline/`, covered by unit tests.
- **What AI did not do:** app architecture, data pipeline, engines, UI, tests, and docs reflect the student's own design and implementation; AI tools assisted with specific implementation and documentation tasks only.
- **Human contribution:** the student(s) designed the system, wrote and debugged the code, chose data sources and thresholds, built the evidence-trace UX, and verified behavior with tests and builds.

## IDE setup

Open the repository root (`food-desert-simulator`) as the project root, use Node 20+, ensure `.env` is loaded, and keep the `@` import alias mapped to `src` (see `vite.config.js`).

## Technical handoff

Implementation-level transfer details (thresholds, pipeline contracts, caching, risk register): [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md).

## License

MIT — see [`LICENSE`](LICENSE). Students retain IP ownership of their submission; the license covers the public code repository.
