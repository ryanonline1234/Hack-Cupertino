import { useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import "./landing.css";

gsap.registerPlugin(ScrollTrigger);

const ADDRESS = "Greenville, MS";

const GUARDIAN_RI_URL =
  "https://www.theguardian.com/environment/2026/aug/28/rhode-island-grocery-store-restrictive-covenants";
const USDA_URL = "https://www.ers.usda.gov/data-products/food-access-research-atlas";
const SENATE_URL =
  "https://www.gillibrand.senate.gov/wp-content/uploads/2026/05/Gillibrand-Cantwell-Wyden-Booker-Letter-to-FTC-on-Anti-Competitive-Restrictive-Covenants.pdf";

const TREE = [
  { code: "CASE-RI", title: "Woonsocket, Rhode Island", depth: 0, mark: "epic" },
  { code: "SRC-NEWS", title: "Reported by The Guardian, August 2026", depth: 1, mark: "bars" },
  { code: "RISK-18", title: "18% of households have no vehicle", depth: 1, mark: "risk" },
  { code: "NOTE-37", title: "37% of residents are food insecure", depth: 1, mark: "dash" },
  { code: "DEED-75", title: "A 75-year covenant in a 128-page deed", depth: 1, mark: "risk" },
  { code: "EPIC-02", title: "What one new supermarket changes", depth: 0, mark: "epic" },
  { code: "CALC-01", title: "Residents brought within the distance limit, computed", depth: 1, mark: "bars" },
  { code: "US-03", title: "Read the test result and the reason beside it", depth: 1, mark: "dash" },
  { code: "SRC-USDA", title: "The rule comes from USDA ERS's Food Access Research Atlas", depth: 1, mark: "bars" },
] as const;

const PLACES = [
  { name: "Greenville, MS", meta: "Meets test", tone: "desert" },
  { name: "Woonsocket, RI", meta: "Cited case", tone: "deed" },
  { name: "San Jose, CA", meta: "City summary", tone: "served" },
  { name: "Detroit, MI", meta: "Example", tone: "tract" },
  { name: "Compton, CA", meta: "Example", tone: "tract" },
  { name: "Chicago", meta: "South Side", tone: "served" },
] as const;

const STATEMENT = [
  "Whether a neighborhood can reach a supermarket usually shows up as one label on a map, with the rule behind it out of sight.",
  "This app shows the rule.",
  "It computes USDA ERS's low-income and low-access test on 2020 Census blocks and USDA's list of SNAP-authorized supermarkets, and puts both published USDA maps beside the result.",
  "It is an estimate for one census tract at a time: not an official designation, and not a rating of a city.",
] as const;

const FAQS = [
  {
    q: "What does Food Desert AI actually check?",
    a: "You give it a US place. It finds the 2020 census tract at that point and applies USDA ERS's low-income and low-access rule: low income is USDA ERS's 2025 flag; low access means at least 33% or 500 of the tract's residents live more than 1 mile (urban) or 10 miles (rural), in a straight line from their 2020 Census block, from a SNAP-authorized supermarket. The answer is an estimate (meets the test, doesn't, or unknown with the reason), not an official USDA designation.",
  },
  {
    q: "Where do the numbers come from?",
    a: "Tracts and block populations come from the 2020 Census (TIGERweb); stores from USDA's SNAP Retailer Locator (supermarkets and super stores, dated); the income flag and the published 2019 and 2025 maps from the USDA ERS Food Access Research Atlas. The Woonsocket figures on this page — 37% food insecure, 18% with no vehicle, a 75-year covenant — are from reporting and a Senate letter, linked below.",
  },
  {
    q: "What changes if a store opens?",
    a: "Place a store on the map and the same rule runs again on the same tract: how many residents it brings within the distance limit, and whether the test result changes. Only supermarkets count, as in USDA's supermarket-based measure; small grocers, dollar stores and farmers markets are labeled as not counted. The numbers are computed access, not a forecast.",
  },
  {
    q: "Will a new store improve health?",
    a: "Philadelphia (Cummins et al. 2014): residents saw better food access, but fruit-and-vegetable intake and BMI didn't change. Pittsburgh (Dubowitz et al. 2015): overall diet quality improved and calories and added sugars fell compared with a similar neighborhood, though not because people used the new store; BMI and fruit-and-vegetable intake didn't change. Same Pittsburgh study (Richardson et al. 2017): food insecurity fell (−11.8% relative to the comparison neighborhood), with fewer new high-cholesterol and arthritis diagnoses. Bronx (Elbel et al. 2015): no appreciable change in household food availability or children's diets. This app does not project health outcomes.",
  },
  {
    q: "What does Launch simulation do?",
    a: "It opens the same location gate as the product: search a city, address, or ZIP, then read the tract test beside the map. For a city it says which tract it is showing and can add up the tract results for everyone inside the city boundary. Nothing on this page is a separate demo mode.",
  },
  {
    q: "Does this replace the USDA atlas?",
    a: "No. USDA ERS publishes the official maps. This app estimates the same rule live, shows both published USDA maps beside the estimate, and names the input when they differ. The atlas stays the record.",
  },
] as const;

type LandingPageProps = {
  onLaunchSimulation: () => void;
  className?: string;
};

function scrollToId(id: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
}

function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="5" fill="#C0D984" />
      <path d="M11.2 4.6c.6 1.1-.1 2-.9 2.3" stroke="#3c4a27" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="11" cy="12.4" r="4.15" fill="#3c4a27" />
    </svg>
  );
}

export function LandingPage({ onLaunchSimulation, className }: LandingPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const winRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<HTMLSpanElement>(null);
  const pinRef = useRef<HTMLSpanElement>(null);
  const gapsRef = useRef<HTMLElement>(null);
  const statementRef = useRef<HTMLElement>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useLayoutEffect(() => {
    const page = rootRef.current;
    const win = winRef.current;
    const addr = addrRef.current;
    const pin = pinRef.current;
    const gaps = gapsRef.current;
    const statement = statementRef.current;
    if (!page || !win || !addr || !pin || !gaps || !statement) return;

    const scroller = document.getElementById("root");
    const scenes = gsap.utils.toArray<HTMLElement>(".df-scene", page);
    const mm = gsap.matchMedia();

    mm.add("(prefers-reduced-motion: reduce)", () => {
      gsap.set(win, { y: 0, scale: 1, rotationX: 0, autoAlpha: 1 });
      gsap.set(scenes, { autoAlpha: 0, y: 0 });
      gsap.set(scenes[1], { autoAlpha: 1 });
      gsap.set(pin, { autoAlpha: 1, scale: 1, rotation: -45 });
      gsap.set([".df-rows li", ".df-letter-line", ".df-badge", ".df-chip", ".df-rail-btn", ".df-shift-card"], {
        autoAlpha: 1,
        y: 0,
        x: 0,
        scale: 1,
      });
      addr.textContent = ADDRESS;
      gsap.set(".df-word", { color: "#141413", filter: "none" });
    });

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const typer = { n: 0 };
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });
      const railBtns = gsap.utils.toArray<HTMLElement>(".df-rail-btn", win);
      const rows = gsap.utils.toArray<HTMLElement>(".df-rows li", page);
      const chip = page.querySelector(".df-chip");
      const badge = page.querySelector(".df-badge");
      const shifts = gsap.utils.toArray<HTMLElement>(".df-shift-card", page);
      const lines = gsap.utils.toArray<HTMLElement>(".df-letter-line", page);
      const glow = page.querySelector(".df-stage-glow");

      const resetFilm = () => {
        addr.textContent = "";
        typer.n = 0;
      };

      tl.set(win, {
        y: 170,
        scale: 0.9,
        rotationX: 9,
        autoAlpha: 1,
        transformOrigin: "50% 100%",
        transformPerspective: 1400,
      });
      tl.set(scenes, { autoAlpha: 0, y: 0 });
      tl.set(scenes[0], { autoAlpha: 1 });
      tl.set(railBtns, { autoAlpha: 0, y: 10 });
      tl.set(chip, { autoAlpha: 0, y: 10 });
      tl.set(rows, { autoAlpha: 0, y: 12 });
      tl.set(badge, { autoAlpha: 0, scale: 0.86 });
      tl.set(pin, { autoAlpha: 0, scale: 0.5, rotation: -45 });
      tl.set(shifts, { autoAlpha: 0 });
      tl.set(lines, { autoAlpha: 0, y: 10 });
      if (glow) tl.set(glow, { scale: 0.65, autoAlpha: 0.25, transformOrigin: "50% 50%" });
      tl.call(resetFilm);

      tl.to(win, { y: 0, scale: 1, rotationX: 0, duration: 1.2, ease: "power3.out" });
      if (glow) tl.to(glow, { scale: 1, autoAlpha: 1, duration: 1.2, ease: "power3.out" }, "<");
      tl.to(railBtns, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.07, ease: "power2.out" }, "-=0.75");
      tl.to(typer, {
        n: ADDRESS.length,
        duration: 1.35,
        ease: "none",
        onUpdate: () => {
          addr.textContent = ADDRESS.slice(0, Math.round(typer.n));
        },
      }, "-=0.15");
      tl.to(chip, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power2.out" }, "-=0.15");

      tl.to(scenes[0], { autoAlpha: 0, y: -14, duration: 0.4, ease: "power2.in" }, "+=0.4");
      tl.fromTo(scenes[1], { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" }, "<+=0.12");
      tl.to(badge, { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(1.7)" }, "<+=0.12");
      tl.to(rows, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.09, ease: "power2.out" }, "<+=0.08");
      tl.to(pin, { autoAlpha: 1, scale: 1.18, rotation: -45, duration: 0.32, ease: "power2.out" }, "<+=0.15");
      tl.to(pin, { scale: 1, duration: 0.22, ease: "power2.out" });

      tl.to(scenes[1], { autoAlpha: 0, y: -14, duration: 0.38, ease: "power2.in" }, "+=1.5");
      tl.fromTo(scenes[2], { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.48, ease: "power2.out" }, "<+=0.1");
      tl.fromTo(shifts[0], { autoAlpha: 0, x: -22 }, { autoAlpha: 1, x: 0, duration: 0.48, ease: "power3.out" }, "<+=0.08");
      tl.fromTo(shifts[1], { autoAlpha: 0, x: 22 }, { autoAlpha: 1, x: 0, duration: 0.48, ease: "power3.out" }, "<");

      tl.to(scenes[2], { autoAlpha: 0, y: -12, duration: 0.35, ease: "power2.in" }, "+=1.55");
      tl.fromTo(scenes[3], { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" }, "<+=0.1");
      tl.to(lines, { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.14, ease: "power2.out" }, "<+=0.12");
      tl.to(win, { y: -10, scale: 1.025, duration: 0.7, ease: "power2.out" }, "<");
      if (glow) tl.to(glow, { scale: 1.08, duration: 0.7, ease: "power2.out" }, "<");

      tl.to(win, { y: 80, scale: 0.94, rotationX: 7, autoAlpha: 0, duration: 0.7, ease: "power2.in" }, "+=1.7");
      if (glow) tl.to(glow, { scale: 0.7, autoAlpha: 0, duration: 0.7, ease: "power2.in" }, "<");

      const scroll = scroller ?? undefined;
      gsap.from(gaps.querySelectorAll(".df-panel"), {
        y: 46,
        scale: 0.96,
        autoAlpha: 0,
        duration: 0.95,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: { trigger: gaps, scroller: scroll, start: "top 78%", once: true },
      });
      gsap.from(gaps.querySelectorAll(".df-doc span"), {
        scaleX: 0,
        duration: 0.55,
        stagger: 0.07,
        ease: "power2.out",
        scrollTrigger: { trigger: gaps, scroller: scroll, start: "top 62%", once: true },
      });
      gsap.from(gaps.querySelectorAll(".df-place"), {
        y: 16,
        autoAlpha: 0,
        duration: 0.5,
        stagger: 0.06,
        ease: "power2.out",
        scrollTrigger: { trigger: gaps, scroller: scroll, start: "top 60%", once: true },
      });

      const words = gsap.utils.toArray<HTMLElement>(".df-word", statement);
      gsap.fromTo(
        words,
        { color: "rgba(20, 20, 18, 0.18)", filter: "blur(5px)" },
        {
          color: "#141413",
          filter: "blur(0px)",
          ease: "none",
          stagger: 0.03,
          scrollTrigger: {
            trigger: statement,
            scroller: scroll,
            start: "top 72%",
            end: "bottom 48%",
            scrub: 0.6,
          },
        },
      );

      gsap.from(page.querySelectorAll(".df-cards article"), {
        y: 20,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: "power2.out",
        scrollTrigger: {
          trigger: page.querySelector(".df-method"),
          scroller: scroll,
          start: "top 78%",
          once: true,
        },
      });

      return () => {
        tl.kill();
      };
    });

    return () => mm.revert();
  }, []);

  return (
    <div id="top" ref={rootRef} className={cn("df", className)}>
      <header className="df-nav">
        <button type="button" className="df-brand" onClick={() => scrollToId("top")}>
          <Mark />
          <span>Food Desert</span>
        </button>
        <nav className="df-links" aria-label="Main">
          <button type="button" onClick={() => scrollToId("top")}>Home</button>
          <button type="button" onClick={() => scrollToId("how")}>How it works</button>
          <button type="button" onClick={() => scrollToId("sources")}>Sources</button>
          <button type="button" onClick={() => scrollToId("method")}>Method</button>
        </nav>
        <div className="df-nav-end">
          <a className="df-btn df-btn-ghost" href={USDA_URL} target="_blank" rel="noreferrer">
            USDA atlas
          </a>
          <button type="button" className="df-btn df-btn-green" onClick={onLaunchSimulation}>
            Launch simulation
          </button>
        </div>
      </header>

      <section className="df-wrap df-hero">
        <h1>Food access, tested tract by tract</h1>
        <p>
          Food Desert AI turns a US address into USDA’s low-income and low-access test for its
          census tract, computed live on 2020 Census blocks and USDA’s SNAP supermarket list, with
          the reason beside the result and a test of what one new supermarket changes. An estimate,
          not an official designation.
        </p>
        <div className="df-actions">
          <button type="button" className="df-btn df-btn-green" onClick={onLaunchSimulation}>
            Launch simulation
          </button>
          <button type="button" className="df-textlink" onClick={() => scrollToId("sources")}>
            Read the sources
          </button>
        </div>
      </section>

      <section className="df-wrap df-stage-wrap" aria-label="Food Desert AI product demo">
        <div className="df-stage">
          <div className="df-stage-glow" aria-hidden="true" />
          <div className="df-window" ref={winRef}>
            <aside className="df-rail" aria-hidden="true">
              <Mark size={26} />
              <span className="df-rail-btn is-on" />
              <span className="df-rail-btn" />
              <span className="df-rail-btn" />
              <span className="df-rail-btn" />
            </aside>
            <div className="df-screen">
              <div className="df-scene">
                <p className="df-kicker">Checking an address…</p>
                <h2>What should we look up?</h2>
                <div className="df-query">
                  <span ref={addrRef} />
                  <i className="df-caret" />
                </div>
                <p className="df-chip">USDA ERS rule · 2020 census tract</p>
              </div>

              <div className="df-scene">
                <p className="df-kicker">Reading the tract…</p>
                <div className="df-result-head">
                  <div>
                    <h2>Greenville, Mississippi</h2>
                    <p>Census tract 6 meets the test in this estimate.</p>
                  </div>
                  <span className="df-badge">Meets test</span>
                </div>
                <div className="df-map" aria-hidden="true">
                  <span className="df-pin" ref={pinRef} />
                </div>
                <ul className="df-rows">
                  <li><span>Test</span><b>Low income, low access</b></li>
                  <li><span>Rule</span><b>33% or 500 residents over 1 mile (urban)</b></li>
                  <li><span>Next</span><b>Place a store and run it again</b></li>
                </ul>
              </div>

              <div className="df-scene">
                <p className="df-kicker">Testing a new store…</p>
                <h2>Place a supermarket in Greenville</h2>
                <div className="df-shift">
                  <div className="df-shift-card">
                    <small>Now</small>
                    <strong>Meets test</strong>
                  </div>
                  <em>→</em>
                  <div className="df-shift-card">
                    <small>With a store</small>
                    <strong>Recomputed</strong>
                  </div>
                </div>
                <p className="df-note">
                  The same rule runs again on the same Census blocks with your store added:
                  computed access, not a health forecast.
                </p>
              </div>

              <div className="df-scene">
                <p className="df-kicker">Sharing the result…</p>
                <div className="df-to">
                  <span>Link</span>
                  <b>Greenville + 1 store <i>↗</i></b>
                </div>
                <h2>Greenville, tract 6</h2>
                <p className="df-letter">
                  <span className="df-letter-line">The link reopens this tract and the store you placed.</span>
                  <span className="df-letter-line">Both published USDA maps sit beside the estimate,</span>
                  <span className="df-letter-line">so anyone who opens it can check the same numbers.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="df-gaps" id="how" ref={gapsRef}>
        <div className="df-wrap">
          <h2>Access fails in the gaps. Food Desert AI shows the rule behind each one.</h2>
          <div className="df-board">
            <div className="df-panel df-panel-blue">
              <ul className="df-tree">
                {TREE.map((item) => (
                  <li key={item.code} data-depth={item.depth}>
                    <span className={cn("df-node", `is-${item.mark}`)} aria-hidden="true" />
                    <code>{item.code}</code>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="df-panel df-panel-green">
              <p className="df-reviewed">
                <i /><i /><i />
                Census blocks · SNAP stores · USDA ERS
              </p>
              <div className="df-doc">
                <h3>Tract test</h3>
                <span /><span /><span className="is-short" />
                <span /><span className="is-mid" /><span />
              </div>
            </div>
            <div className="df-panel df-panel-gold">
              <div className="df-places">
                {PLACES.map((place) => (
                  <article key={place.name} className={cn("df-place", `is-${place.tone}`)}>
                    <span className="df-place-mark" aria-hidden="true" />
                    <strong>{place.name}</strong>
                    <em>{place.meta}</em>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="df-captions">
            <article>
              <h3>The reason, not just a label.</h3>
              <p>
                Every result names the rule, the counts behind it, and the data dates; an unknown
                says which input was missing.
              </p>
            </article>
            <article>
              <h3>Tracts, not cities.</h3>
              <p>
                USDA rates census tracts. A city search shows the tract at that point and can add up
                every tract inside the city boundary.
              </p>
            </article>
            <article>
              <h3>A link that replays it.</h3>
              <p>
                Share a link and it reopens the same place with the stores you placed, so someone else
                can check the same estimate.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="df-statement" ref={statementRef}>
        <div className="df-statement-inner">
          {STATEMENT.map((line) => (
            <p key={line}>
              {line.split(" ").map((word, i) => (
                <span className="df-word" key={`${i}-${word}`}>
                  {word}{" "}
                </span>
              ))}
            </p>
          ))}
        </div>
      </section>

      <section className="df-method" id="method">
        <div className="df-wrap">
          <h2>Built so the answer can be checked</h2>
          <div className="df-cards">
            <article>
              <p className="df-card-kicker">The test</p>
              <h3>A label with a rule under it</h3>
              <p>Low income from USDA ERS 2025; low access computed on the tract’s 2020 Census blocks: at least 33% or 500 residents beyond 1 mile (urban) or 10 miles (rural) from a SNAP supermarket.</p>
              <ul>
                <li>Straight-line distance from each populated 2020 Census block</li>
                <li>Every unknown names the input that was missing</li>
                <li>USDA’s own 2019 and 2025 maps shown beside it</li>
              </ul>
            </article>
            <article>
              <p className="df-card-kicker">The case</p>
              <h3>Woonsocket is on the record</h3>
              <p>Reported by The Guardian. The constraint is written down, not remembered from a call.</p>
              <ul>
                <li>37% food insecure, 18% of households with no vehicle</li>
                <li>A 75-year covenant in a 128-page deed</li>
                <li>Linked below, so the sentence can be opened</li>
              </ul>
            </article>
            <article>
              <p className="df-card-kicker">The intervention</p>
              <h3>One store, recomputed</h3>
              <p>Place a store and the same rule runs again on the same blocks: residents brought within the limit, and whether the result changes.</p>
              <ul>
                <li>Only supermarkets count; other store types are labeled as not counted</li>
                <li>No health or jobs projections: computed access only</li>
                <li>Launch the same tool the rest of the product uses</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="df-faq" id="sources">
        <div className="df-wrap df-faq-grid">
          <h2>Questions &amp; answers</h2>
          <div>
            {FAQS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className={cn("df-faq-item", open && "is-open")}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    {item.q}
                    <span aria-hidden="true">{open ? "–" : "+"}</span>
                  </button>
                  {open && <p>{item.a}</p>}
                </div>
              );
            })}
            <ul className="df-source-links">
              <li><a href={USDA_URL} target="_blank" rel="noreferrer">USDA Food Access Research Atlas</a></li>
              <li><a href={GUARDIAN_RI_URL} target="_blank" rel="noreferrer">The Guardian on Woonsocket’s covenant</a></li>
              <li><a href={SENATE_URL} target="_blank" rel="noreferrer">Senate letter on restrictive covenants</a></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="df-close">
        <h2>A clearer picture of food access.</h2>
        <button type="button" className="df-btn df-btn-green" onClick={onLaunchSimulation}>
          Launch simulation
        </button>
      </section>

      <footer className="df-foot">
        <div className="df-brand df-foot-brand">
          <Mark />
          <span>Food Desert</span>
        </div>
        <p>An estimate of USDA’s low-income and low-access test, and of what a new supermarket would change.</p>
        <div className="df-foot-cols">
          <div>
            <p>Navigation</p>
            <button type="button" onClick={() => scrollToId("top")}>Overview</button>
            <button type="button" onClick={() => scrollToId("how")}>How it works</button>
            <button type="button" onClick={() => scrollToId("method")}>Method</button>
          </div>
          <div>
            <p>Sources</p>
            <a href={USDA_URL} target="_blank" rel="noreferrer">USDA Atlas</a>
            <a href={GUARDIAN_RI_URL} target="_blank" rel="noreferrer">Woonsocket reporting</a>
            <a href={SENATE_URL} target="_blank" rel="noreferrer">Senate letter</a>
          </div>
        </div>
        <p className="df-copy">Food Desert AI · access-test estimate</p>
      </footer>
    </div>
  );
}
