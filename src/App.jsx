import { lazy, Suspense, useState } from 'react';
import { decodeAppState } from './lib/urlState';

const LandingPage = lazy(() =>
  import('./ui/landing/LandingPage').then((module) => ({ default: module.LandingPage })),
);
const TrackerApp = lazy(() => import('./TrackerApp'));

/*
 * Shared scenario links (#lat=…&lng=…[&pins=…]) boot straight into the
 * tracker — no landing page, no intro overlay. The hydrate effect in
 * TrackerApp auto-runs the pipeline and replays the pins from the hash.
 */
function hasDeepLink() {
  if (typeof window === 'undefined') return false;
  try {
    const state = decodeAppState(window.location.hash);
    return Number.isFinite(state.lat) && Number.isFinite(state.lng);
  } catch {
    return false;
  }
}

function LoadingView() {
  return (
    <div
      className="flex h-screen items-center justify-center text-sm"
      style={{ background: 'var(--void)', color: 'rgba(255,255,255,0.75)' }}
    >
      Loading experience...
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState(() => (hasDeepLink() ? 'tracker' : 'landing'));

  // Home drops the searched location from the URL (2026-10-18), so a refresh
  // after going home stays home instead of reopening that location.
  function goHome() {
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    } catch { /* noop */ }
    setPhase('landing');
  }

  return (
    <Suspense fallback={<LoadingView />}>
      {phase === 'landing' ? (
        <LandingPage onLaunchSimulation={() => setPhase('tracker')} />
      ) : (
        <TrackerApp onHome={goHome} />
      )}
    </Suspense>
  );
}
