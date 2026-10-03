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
| 2026-10-02 | Close the open API relays and stop shipping keys in the bundle: remove the runtime AI narrative; move the Census key server-side (`/api/acs`); limit `/api/overpass` to `{lat, lng}`; run `api/` handlers in local dev; post-build key check | `api/acs.js` (new), `api/overpass.js`, `api/llmapi.js` (deleted), `src/pipeline/censusFetch.js`, `src/pipeline/storeDistanceFetch.js`, `src/TrackerApp.jsx`, `src/components/AICard.jsx` (deleted), `src/lib/citeNumbers.js` (deleted), `src/lib/narrativeSanitize.js` (deleted), `vite.config.js`, `vite-plugin-api-dev.js` (new), `scripts/check-bundle-for-keys.mjs` (new), `vercel.json`, `eslint.config.js`, `package.json`, 6 test files, docs | Audited the live exposure (bundles, deployments, git history), proposed the scope, wrote all of the code, tests and doc edits listed here, and ran the verification (tests, lint, build, negative control, local browser check) | Chose the options (remove the narrative, server-side Census proxy, bound Overpass, this log), reviews the diff and preview, does the key revocations and Vercel settings | Branch `security/close-relays`, first commit |

## Backfill still needed (from git, 2026-10-02)

Known AI-assisted work that predates this log. Fill in the "what" for each
before writing the disclosure:

- April 29, 2026 — four commits on main carry a Claude co-author trailer:
  `179b22f`, `a5df48a`, `f622625`, `07164ba`.
- September 2026 — work done with Claude Code on main without trailers
  (owner to list which commits).
- Unmerged branch `claude/food-desert-ai-improvements-skyrmp` — 12 commits,
  all authored by Claude; not on main.
