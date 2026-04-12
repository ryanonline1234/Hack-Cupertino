/**
 * Neon “impact” arcs over the map (visual layer; not geo-projected — iframe cannot share camera).
 */
export function DecorativeArcs() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <filter id="streets-arc-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M 14 74 Q 38 42 50 34"
        fill="none"
        stroke="#4ade80"
        strokeWidth="0.35"
        strokeLinecap="round"
        opacity={0.92}
        filter="url(#streets-arc-glow)"
      />
      <path
        d="M 86 71 Q 62 44 50 34"
        fill="none"
        stroke="#4ade80"
        strokeWidth="0.35"
        strokeLinecap="round"
        opacity={0.88}
        filter="url(#streets-arc-glow)"
      />
    </svg>
  );
}
