# Docs index

Specs are numbered in the order they were written. 07 and 08 describe the app
as it is on `redesign/access-test`; 01–06 are historical specs from September
2026, kept for the record and partly superseded (each notes where). When a
spec and the code disagree, the code and the newer spec win.

| Doc | What it is | Status |
|---|---|---|
| [01-place-a-store.md](01-place-a-store.md) | User-placed "what-if" stores and PWA installability | Historical (implemented 2026-09-12). The recompute, delta line and narrative are superseded by 07's scenario engine; PWA installability still stands. |
| [02-mobile-info.md](02-mobile-info.md) | Phone info-only results page; compat-globe circle fix | Historical (implemented 2026-09-12). The info-only phone page still stands (07/08 add the scenario card and suggestions to it); the globe component is no longer used. |
| [03-narrative-reliability.md](03-narrative-reliability.md) | Narrative reliability, no-timeout maps, labelled examples, dual renderers | Historical, mostly superseded: the runtime narrative was removed 2026-10-02, the loaders now have 30 s timeouts, 3D is parked, and the example chips follow 07. |
| [04-deeplink-scenario.md](04-deeplink-scenario.md) | Share links boot to the map; experiment result card | Historical (implemented 2026-09-12). Deep links still stand (now with `pt=` formats); the result card is superseded by 07's scenario card. |
| [05-ui-polish.md](05-ui-polish.md) | GSAP, React Bits and Kokonut UI polish | Historical (implemented 2026-09-12). The vendored CountUp was removed on 2026-10-03. |
| [06-globe-home-zoom-narrative.md](06-globe-home-zoom-narrative.md) | PWA globe, brand home, no-zoom inputs, narrative budget, Overpass mirror race | Historical, partly superseded: the narrative budget went with the narrative, and Overpass was removed by 07; the globe component is no longer used. |
| [07-access-test-redesign.md](07-access-test-redesign.md) | The method contract: USDA ERS's low-income & low-access test on 2020 blocks, Point/Tract/City scope, store formats, computed-only impact, data builders | Current (approved 2026-10-02); built on `redesign/access-test`. |
| [08-suggest-sites-and-plan.md](08-suggest-sites-and-plan.md) | Suggest sites (deterministic greedy search) and the rules-based action plan (no runtime AI) | Current (approved 2026-10-03); built on `redesign/access-test`, behind the Oct 8 go/no-go. |
| [data.md](data.md) | Every committed dataset: source, selection, format, counts and dates, terms, rebuild command, self-checks, when to rebuild | Current (2026-10-03). |
| [AI_USE_LOG.md](AI_USE_LOG.md) | Per-change record of AI-assisted work, the evidence behind the AI disclosure | Current; append-only, one row per change on the day it lands. |
| [CAC_SUBMISSION.md](CAC_SUBMISSION.md) | Congressional App Challenge packet: demo-video beat map, Q&A answers, AI disclosure, judges' steps, checklist | In progress: §3 AI disclosure updated 2026-10-06, awaiting owner review; the answer prose in §2 and the judges' steps in §4 still describe the pre-07 method and are the owner's to rewrite; `[BRACKET]` placeholders remain. |

At the repository root: [`README.md`](../README.md) (overview, quick start,
deployment), [`PROJECT_HANDOFF.md`](../PROJECT_HANDOFF.md) (implementation
handoff), [`DECISIONS.md`](../DECISIONS.md) (append-only decision log),
[`STATE.md`](../STATE.md) (where the project is now) and
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) (libraries, vendored
code, data and tiles).
