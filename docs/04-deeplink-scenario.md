# 04 — Share links boot to map + experiment result card

Status: implemented + verified headless 2026-09-12 (commit on main).

## A. Deep links skip landing + intro, arrive highlighted
`App.jsx` boots straight into the tracker when the hash carries lat/lng
(no landing page, no intro overlay — the intro lives on the landing page,
so it never mounts). `handleShareScenario` forces `hl=1` into scenario
links when pins exist; `StreetsGlView` initializes highlight from the
hash, so shared links arrive with sources highlighted (2D store layer
while 3D is parked). The debounced hash mirror doesn't preserve hl —
irrelevant, it is consumed once at mount. Plain location links (no pins)
get no hl and boot unhighlighted.

## B. Experiment result card + Recompute + setup breakdown
New `ScenarioResultCard` (null when no pins): big AFTER-designation
verdict (green NOT DESIGNATED unmistakable), before→after trail with
avg distances, engine impact numbers (residents, jobs, local spend,
diabetes Δ), a Recompute button (idempotent local re-run + log line),
and a "What it would take" breakdown. Breakdown rows are demand-side
numbers plus planning factors gated by real tract values (vehicle
access, poverty, diet health, rurality); the footer states build costs
need a site — no invented capex. Mounted as a map overlay on desktop
and above the panels on mobile (shared-link replays included).

## Gate (all passed)
Headless share-style URL: landing skipped, pipeline auto-ran, pin
replayed, Hide-Sources state on arrival, 201 store markers, result card
with NOT DESIGNATED verdict, breakdown present, Recompute logged —
ALL DEEP-LINK CHECKS PASSED (screenshot inspected).
