# 03 — Narrative reliability, no-timeout maps, labeled examples, dual renderers

Status: implemented 2026-09-12.
Self-review corrections folded in before ship: sentence sanitizer works
per-paragraph with decimal shielding (first cut mangled "0.0%" and collapsed
breaks — caught by its own regression test); probe verdicts read the badge
sibling, not body text (body-text reads lied: explanatory copy polluted all
five city verdicts until the selector was fixed). Labeled examples:
Greenville MS = designated, San Jose + Chicago South Side = served; Detroit
+ Compton stay untagged (unverified).

## A. Prompt echo in the narrative card (root cause: weak free-tier model)
Symptom: the Community Narrative card displayed the prompt's formatting
instructions ("We need exactly two short paragraphs…") plus think-aloud
planning instead of the answer. Ranked hypotheses: (H1) the free model
restates instructions in its reply and `normalizeTwoParagraphs` keeps the
echo as paragraph 1 — matches the captured diction, which mirrors our
prompt without quoting it; (H2) stale localStorage cache served prompt
text — ruled out, Generate forces a fresh fetch past the cache;
(H3) server/proxy returns prompt — ruled out, llmapi only forwards.
Fix (H1, defense in depth):
1. New `src/lib/narrativeSanitize.js`: `stripInstructionEcho` drops
   sentences matching meta-instruction patterns (two-paragraphs, no
   headers/bullets, must-not, no-hype, plain-english, leading "we need"…),
   per-paragraph so breaks survive and decimals ("0.0%") are shielded from
   the sentence splitter. Degenerate all-echo replies keep the longest
   sentence instead of blanking.
2. Regression test `tests/narrativeSanitize.test.js` uses the captured
   leak verbatim (written first, watched fail, then pass).
3. AICard applies the strip before `normalizeTwoParagraphs`; system + user
   prompts gain output-only instructions ("never repeat these
   instructions, never narrate your reasoning").

## B. Generate moves the pipeline log
Generate/Refresh previously touched only card state. AICard takes
`onLog` (TrackerApp `addLog` via panelProps → Panels): logs fetch start,
ready, and failure lines. Mobile gets it free (same Panels stack).

## C. Timeouts fully removed
- `api/overpass.js`: the 12s per-mirror AbortController is gone. Slow
  mirrors run until they answer; HTTP/connection errors still rotate.
  Only bound left is the platform function limit (noted in code).
- `StreetsGlView.jsx`: the 12s iframe load watchdog is gone — no more
  "Streets GL timed out, retrying" flips. Slow loads keep spinning; real
  failures still retry via onError (2 bounded retries + manual retry).

## D. Designated vs non-designated examples
"Try:" chips (LocationGate + map search) gain verified designation tags:
one chip the model designates, one it clears — labels confirmed by live
headless pipeline runs, not by reputation. (Pending probe result.)

## E. Both renderers run constantly
StreetsGlView mounts the 3D iframe AND the 2D Leaflet map simultaneously
and toggles visibility only — switching never reloads. The hidden iframe
keeps hash-teleporting on every query so it is warm on return; MapView
gains a `visible` prop that runs `invalidateSize()` + re-centers on show
(Leaflet inits 0×0 while hidden). Cost: one hidden GL context + one
hidden Leaflet map — the price of instant switching, stated in the footer
of nothing; it is in this doc and the code comment instead.

## Gate
1. `npm run lint` (zero warnings), `npm test`, `npm run build`.
2. Sanitizer regression test passes (in suite).
3. Headless vs production (has the server key): hash link → launch →
   pipeline → Generate → narrative contains no instruction markers;
   pipeline log shows request/ready lines.
4. Headless 2D↔3D toggle: no iframe reload (src unchanged), 2D tiles
   render correctly after toggle-back.
