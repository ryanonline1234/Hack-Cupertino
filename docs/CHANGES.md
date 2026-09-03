# Change log — security and correctness pass

**Branch:** `claude/food-desert-ai-improvements-skyrmp`
**Scope:** closed a live security hole in the `api/` endpoints, moved the AI call
onto the official Anthropic SDK, and fixed six places where the app displayed
wrong or fabricated numbers as findings.

Read this top to bottom before reviewing the diff. Each section says what
changed, why it was wrong, and what you should expect to look different.

---

## TL;DR for reviewers

| Area | Before | After |
|---|---|---|
| `/api/llmapi` | Open to any origin, forwarded caller-supplied prompts on our key | Origin-locked, rate-limited, prompt built server-side from validated numbers |
| `/api/overpass` | Relayed arbitrary Overpass QL from anyone | Takes `{lat, lng, radiusMiles}`, builds the query itself |
| Census API key | Inlined into the public JS bundle | Server-only `CENSUS_KEY`, never leaves `api/census.js` |
| AI provider | `api.llmapi.ai` aggregator, `claude-3-5-haiku` | Anthropic SDK direct, `claude-opus-5` (via `LLM_MODEL`) |
| Missing data | Rendered as `0` / `$0` / `0%` | Rendered as `—` / "unavailable" |
| One dead API | Blanked the entire dashboard | Other sources still render, failure is badged |

**Action required before deploy:** set `ANTHROPIC_API_KEY` and `CENSUS_KEY` in
the Vercel project. `VITE_ANTHROPIC_KEY`, `VITE_CENSUS_KEY` and `LLMAPI_KEY` are
no longer read and can be removed. See [Environment variables](#environment-variables).

---

## 1. Security

### 1.1 `/api/llmapi` was an open LLM proxy

`api/llmapi.js` accepted a POST from **any** origin (`Access-Control-Allow-Origin: *`),
took the caller's own `messages` array, and forwarded it upstream authenticated
with our key. There was no auth, no origin check, no rate limit, and no payload
validation.

In practice: anyone who opened the network tab on the deployed site could copy
the request and use it as a free, unmetered LLM endpoint billed to us.

**What changed.** The endpoint no longer accepts prompts at all. It accepts
`{ metrics }` — a fixed list of numeric fields — and every one is coerced to a
number or `null` before use. The prompt is assembled server-side in
`api/_llm.js` from a template the caller cannot influence. There is no request
shape that makes this endpoint say something we did not write.

Also added, via the new shared `api/_guard.js`:

- **Origin allowlist.** Vercel's own deployment URLs and localhost are allowed
  automatically; add a custom domain with `ALLOWED_ORIGINS`.
- **Per-IP rate limit.** 10/min on `/api/llmapi`, 30/min on `/api/overpass`,
  40/min on `/api/census`.
- **Body size cap** (8 KB) and JSON-shape validation.
- **Specific CORS origin** echoed back instead of `*`.

> **Known limitation, stated plainly:** the rate limiter holds state in memory,
> so on Vercel it is per-instance and resets on cold start. It raises the cost
> of casual abuse; it is not a hard guarantee. If this takes real traffic,
> swap in `@upstash/ratelimit` over Vercel KV — `underRateLimit()` in
> `api/_guard.js` is written to be replaced without touching the handlers.

### 1.2 `/api/overpass` relayed arbitrary queries

The old handler forwarded the raw request body to three Overpass mirrors. The
body *is* Overpass QL, so it was an anonymous relay letting anyone run
arbitrary, arbitrarily expensive queries against volunteer-run OSM
infrastructure from our egress IP — a reliable way to get that IP banned.

**What changed.** It takes `{ lat, lng, radiusMiles }`, validates coordinate
ranges, clamps the radius to 1–50 miles, and builds the query itself. Callers
cannot supply query text.

### 1.3 The Census API key shipped in the browser bundle

`src/pipeline/censusFetch.js` read `VITE_CENSUS_KEY` and appended it as a `key=`
URL parameter. **Vite inlines every `VITE_`-prefixed variable into the
production bundle**, so the key was readable by anyone who viewed source — the
same leak the team had already fixed for the LLM key. Keys in query strings are
additionally logged by every proxy in between.

**What changed.** New `api/census.js` reads a server-only `CENSUS_KEY` and
issues both ACS requests. The browser POSTs `{ fips }` and never sees the key.

Verify after a build:

```bash
npm run build && grep -r "VITE_CENSUS_KEY\|&key=" dist/assets/   # → no matches
```

### 1.4 Two `vercel.json` rewrites bypassed the functions

`/api/llmapi/:path*` rewrote straight to `api.llmapi.ai`, and `/api/census/*` to
`api.census.gov`. Because the serverless function sits at `/api/llmapi` with no
trailing path, the two coexisted only by exact-path luck — a request to
`/api/llmapi/v1/chat/completions` in production bypassed the function, and its
server-side key, entirely. Both rewrites are deleted.

---

## 2. AI: aggregator → official Anthropic SDK

The narrative previously went to `api.llmapi.ai`, a third-party
OpenAI-compatible aggregator, asking for the alias `claude-3-5-haiku`. It now
calls Anthropic directly through `@anthropic-ai/sdk`.

**Model is `claude-opus-5`, set via `LLM_MODEL`.** Current Anthropic model IDs
carry no date suffix.

Three request-shape changes worth knowing, because they are easy to get wrong:

1. **`temperature` is gone.** It is removed on current models and sending it
   returns a 400. The old code sent `0.45`.
2. **`max_tokens` went from 600 to 2048.** Thinking is on by default on Opus 5
   and thinking tokens count against `max_tokens`, so 600 would have truncated
   the reply mid-sentence. `output_config: { effort: 'low' }` keeps the spend
   down — this is a short, grounded rewrite of numbers we already computed.
3. **Structured output replaced a string-splitting hack.** `normalizeTwoParagraphs`
   in `AICard.jsx` used to split a single block of prose at the sentence
   midpoint whenever the model ignored the "exactly two paragraphs"
   instruction — a guess that could cut a paragraph mid-thought. The server now
   requests a two-field schema (`daily_reality`, `what_would_change`), so the
   shape is guaranteed by the API. That function is deleted.

**A tradeoff we made deliberately:** the plan mentioned streaming the narrative
so it types in. Streaming and structured output pull against each other — you
cannot render half a JSON object as prose. We chose the guaranteed two-field
shape over the typing effect, because the alternative was keeping the midpoint-
splitting heuristic. The existing skeleton loader already covers the wait. If
you want streaming later, it means dropping structured output and re-solving
the format problem another way.

### Swapping model or provider

- **Different model:** set `LLM_MODEL`. Nothing else changes.
  Cheaper option: `claude-haiku-4-5` ($1/$5 per MTok vs $5/$25).
- **Different provider:** `api/_llm.js` is the only file that knows about
  Anthropic. Replace `generateNarrative()`, keep its signature and return
  shape (`{ daily_reality, what_would_change }`), and no caller changes.

Cost at current settings is negligible — roughly 2K tokens per narrative,
behind the existing 6-hour client cache.

---

## 3. Correctness: numbers the UI presented as findings

### 3.1 Commute-hours saved was inflated ~2.7x

`src/engine/projectionEngine.js` had:

```js
const householdsAffected = population * clamp01(qualifyingLowAccessPct / 100);
const commuteHoursSavedAnnual = householdsAffected * 52 * hoursSavedPerTrip;
```

The variable said *households*; the value was *people*. Multiplying by 52 trips
a year asserted that every resident — including children — makes a weekly
grocery run. Grocery trips are a per-household behaviour.

**Fixed** using ACS `B11001_001E` (total households), newly requested in
`api/census.js`.

### 3.2 Diabetes cases avoided counted children

The estimate multiplied total tract population (ACS `B01003_001E`, all ages) by
a CDC PLACES prevalence measured among **adults 18+**. Now uses ACS
`B09021_001E` (population 18+).

The expression was also algebraically redundant — `diabetesReductionPct` is
itself `diabetes × diabetesReductionRelative × healthEffectFactor`, so the
`diabetesReductionPct / diabetes` term cancelled. It is written out plainly now.

### What these two fixes do to displayed numbers

Reference tract: population 12,000, households 4,500, adults 9,200, 45% low access.

| metric | before | after | change |
|---|---:|---:|---:|
| commute-hours saved / yr | 53,850 | 20,194 | **−62.5%** |
| diabetes cases avoided | 25 | 19 | **−23.3%** |

Everything else (residents gaining access, annual local impact, jobs) is
unchanged — those formulas were not touched.

**Expect the headline commute-hours figure to drop by roughly two thirds.**
That is the fix working, not a regression. If someone screenshotted the old
number for a deck, it was wrong.

### 3.3 Missing Census data rendered as confident zeros

`censusFetch` returned `{ medianIncome: 0, population: 0, pctPoverty: 0, ... }`
whenever the key was absent or the request failed. Nothing downstream could
tell that apart from real data:

- the UI printed `$0` and `0%` as findings;
- `projectImpact` computed zero residents helped and `$0` economic impact;
- the USDA low-income test silently evaluated false, because `0` is not `>= 20`.

This was the one place the app contradicted its own design principle. It
already handles unknown *distance* honestly — designation goes to `UNKNOWN`
rather than guessing. Demographics now work the same way: **every field is a
number or `null`**, and `null` means "we do not know".

`src/utils/formatters.js` already rendered `null` as `—`, so most of the display
path needed no change. Two spots in `CommunityStatsPanel.jsx` that used
`|| 0` now say "Census unavailable" instead.

### 3.4 A zero-result OSM query produced a confident designation

`storeDistanceFetch.js` had:

```js
isTwentyFivePlusMiles: nearestMiles == null ? true : nearestMiles >= 25
```

A **successful** Overpass response that simply contained no supermarkets gives a
null distance — so this asserted "at least 25 miles to a store", which the
evaluator treats as an automatic food-desert designation regardless of the
configured threshold. A gap in OpenStreetMap tagging became a confident finding.

**Fixed.** We only claim ≥25 miles when we measured a distance. "Queried, found
nothing" is now its own state (`noStoresFound`), distinct from "the query
failed" (`source: 'unavailable'`). Both leave the designation as **Unknown**.

### 3.5 One failed source blanked the whole dashboard

`normalizer.js` used `Promise.all` across the four fetches, so a single
rejection rejected the entire payload and the panel rendered one red line in
place of everything — discarding the three sources that had succeeded.

**Fixed** with `Promise.allSettled`. Each source degrades independently, and
`meta.sourceStatus` now carries `ok` / `failed` / `no_stores_found` per source
so the UI can badge them.

### 3.6 Sample count always reported 9

`computeCommunityDistanceMetrics` returned `sampleCount: samplePoints.length`
after already filtering out sample points that found no store — so the UI
claimed nine contributing samples even when three contributed. Now returns the
contributing count, with `sampleAttemptCount` alongside it.

---

## Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Server | Yes, for narratives | Never prefix with `VITE_` |
| `CENSUS_KEY` | Server | Yes, for demographics | [Request one](https://api.census.gov/data/key_signup.html) |
| `LLM_MODEL` | Server | No | Defaults to `claude-opus-5` |
| `ALLOWED_ORIGINS` | Server | No | Comma-separated; for custom domains |

**Removed — delete these from Vercel:** `VITE_ANTHROPIC_KEY`, `VITE_CENSUS_KEY`,
`LLMAPI_KEY`.

---

## Local development

`npm run dev` still works and now exercises the **real** handlers. Previously
`/api/llmapi` and `/api/census` were plain Vite proxy rewrites in dev, so dev
and production took different code paths. Those endpoints now hold real logic —
validation, the prompt, the keys — so `vite-plugin-api-dev.js` mounts
`api/*.js` as dev middleware. Local testing exercises what ships.

Put `ANTHROPIC_API_KEY` and `CENSUS_KEY` in a local `.env` (see `.env.example`).

---

## Verification

```bash
npm ci
npm run lint     # clean
npm test         # 40 tests, all passing (was 29)
npm run build    # clean
```

Endpoint guards, checked against the dev server:

| Case | Expected |
|---|---|
| Foreign `Origin` on any endpoint | `403` |
| No `Origin` and no `Referer` | `403` |
| `GET` instead of `POST` | `405` |
| Caller-supplied `messages` array | `400` — ignored, not forwarded |
| Raw Overpass QL body | `400` |
| `lat: 999` | `400` |
| `fips: "1; DROP TABLE"` | `400` |
| 11th call within a minute | `429` |

All of the above were confirmed. The upstream-reachable paths (a real Overpass
query, a real ACS lookup, a real narrative generation) could **not** be
exercised in the sandbox this work was done in — outbound network to
`overpass-api.de`, `api.census.gov` and the Anthropic API is blocked there. The
failure handling was verified: a blocked upstream produced a clean `502` with a
logged reason rather than a crash. **Someone should run one live end-to-end
tract lookup before this is considered done.**

---

## New test coverage

10 new assertions, mostly regression guards for the bugs above:

- `commute-hours saved scales with household count, not population` — doubling
  population while holding households fixed must not move the figure. This is
  the test that would have caught 3.1.
- `commute-hours saved is null when household count is unavailable`
- `diabetes cases avoided ignores total population` — the guard for 3.2.
- `economic projections are null when population is unavailable` — the guard
  for 3.3; asserts `null`, not `0`.
- `a successful query that finds no stores yields Unknown, not Designated` —
  the guard for 3.4.
- `sampleCount counts only the samples that found a store` — the guard for 3.6.

---

## Not done — recorded backlog

Deliberately out of scope for this pass. The full reasoning is in the planning
document; the short version:

1. **Tract-polygon distance sampling (highest-value remaining fix).** The nine
   sample points feeding classification are a fixed ±1.5-mile cross regardless
   of tract size. For a dense urban tract, eight of nine land in *other tracts*;
   for a large rural one, all nine cluster near the centroid. Since the urban
   rule fires at ≥1 mile, the 1.5-mile offset is larger than the entire decision
   threshold — **the sampling geometry can flip the designation on its own.**
   The fix is Census TIGERweb tract polygons plus population-weighted
   block-group sampling. Deferred because it needs a new data path and its own
   fixtures, and would have made this diff hard to review.
2. **Accessibility.** 20 of 26 components have zero `aria-*`/`role`/`alt`/
   keyboard handlers; 38 `onClick` handlers sit on non-button elements. For a
   civic tool this is the widest-reach gap.
3. **Mobile.** No breakpoint anywhere in the layout logic; the tracker is a
   desktop splitter UI. Residents checking food access are mostly on phones.
4. **SEO.** `index.html` has a title and nothing else — no description, no
   Open Graph, no canonical URL.
5. **Grounded Q&A over the tract data**, using tool use against the already-
   computed pipeline output.
6. **Isochrones** (travel time rather than straight-line distance) — the right
   long-term answer, but sequence it *after* item 1 or it compounds the error.
7. **Perf and hygiene.** The 5.6 MB USDA CSV is parsed in the browser twice;
   five components are dead code; `chart.js` is a dependency solely for an
   unused chart; there is no CI, no `tsconfig.json`, and the `.tsx` files are
   neither typechecked nor linted.

### One thing to fix soon

`npm install` fails on a pre-existing peer conflict — `vite-plugin-pwa@1.2.0`
does not declare support for Vite 8. `npm ci` works (it uses the lockfile), and
`npm install --legacy-peer-deps` works. Either upgrade the plugin or pin an
`overrides` entry so contributors do not hit this.
