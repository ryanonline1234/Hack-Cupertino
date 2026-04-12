import { lazy, Suspense, useState } from 'react';

const LandingPage = lazy(() =>
  import('./ui/landing/LandingPage').then((module) => ({ default: module.LandingPage })),
);
const TrackerApp = lazy(() => import('./TrackerApp'));

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
  const [phase, setPhase] = useState('landing');

  return (
    <Suspense fallback={<LoadingView />}>
      {phase === 'landing' ? (
        <LandingPage onLaunchSimulation={() => setPhase('tracker')} />
      ) : (
        <TrackerApp />
      )}
    </Suspense>
  );
}
