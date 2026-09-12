# 05 — Friend-suggested UI polish (GSAP, React Bits, Kokonut UI)

Status: implemented + verified headless 2026-09-12 (commit on main).

Friend's list, decoded: GSAP (animation library), React Bits
(animated React primitives), Kokonut UI (Tailwind component collection).
"Rest bit" / "S" were message fragments — skipped, not guessed.
reactbits.com currently redirects to an unrelated domain, so the CountUp
source came from the project's GitHub repo instead.

## What each tool contributed (and what was deliberately not used)
- React Bits: `CountUp` vendored to `src/components/bits/` (MIT credit),
  `motion/react` import swapped for the framer-motion v12 already here,
  plus a reduced-motion path and an explicit `decimals` prop — the
  original derives decimals from `to`, which renders computed floats
  like 0.2124… at full 16-decimal precision (caught in screenshots).
  Wired into stat rows, income, and experiment-card figures; remounts
  per value so each analysis re-animates; starts on scroll into view.
- GSAP 3.15 (installed): used ONLY for the landing hero SplitText
  word-stagger reveal — the one motion job framer-motion can't do.
  Scroll reveals already existed via whileInView; duplicating them in
  ScrollTrigger would be redundant motion, so that was cut.
- Kokonut UI: registry install skipped honestly — their components
  target Tailwind v4, this project is v3.4, and their flashiest pieces
  (particle buttons, glass cards, shimmer text) fight the no-slop rules.
  Instead, hand-adapted treatments in our tokens: shared `PanelHeader`
  with lucide icon tiles across all three panels, `.btn-press`
  transform-only press feedback on every action button, exact-property
  chip hovers (the old `hover:scale-105` + `transition-all` are gone),
  focus-visible rings on chips.

## Gate
Lint clean, 43/43 tests, build green; headless: hero splits into 24
word nodes with text intact, income counts to a formatted dollar figure,
diabetes pinned to 1 decimal, zero page errors (screenshots inspected).
