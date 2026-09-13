# 06 — PWA globe composition, brand home, no-zoom inputs, narrative budget

Status: implemented + verified headless 2026-09-12 (commit on main).

## Globe (the actual complaint was composition, not geometry)
The circle fix held (screenshot-measured square), but on phones the big
centered disc read as a blue mound cropped by the viewport, then — sized
down — as a blob behind the headline. Now: 72vw/300px disc pinned 104px
into its region (clear of the headline, verified 281×281 at top:384),
night-side shading for depth, desktop untouched.

## Brand homes
FeatureNav logo+title and the mobile header brand are buttons back to
the landing page (App phase state via TrackerApp onHome, both shells).

## No auto-zoom on search
Both search inputs were text-sm (14px) — iOS zooms on focus below 16px.
Now text-base (16px). Viewport meta already allows zoom (untouched).

## Narrative budget
max_tokens 600 → 1000 (client + server default) and the prompt now
budgets ~120-180 words with an explicit finish-both-paragraphs,
never-trail-off instruction.

## Mirror race (found while verifying)
With the per-mirror abort removed, overpass-api.de 504s fast but
kumi.systems HANGS — sequential rotation wedged the pipeline forever
(reproduced: 100s+ stall, zero API responses). api/overpass.js now races
all mirrors via Promise.any, first success wins, still zero timeouts.
Measured: 200 in 55s with two mirrors degraded. Cost: 3× upstream load
per query; traffic is tiny. Prod carried the same hang — redeploy
included here, not left for later.
