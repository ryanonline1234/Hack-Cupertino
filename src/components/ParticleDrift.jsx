const PARTICLES = [
  { x: 12, y: 20, size: 2, delay: 0 },
  { x: 85, y: 15, size: 1.5, delay: 0.8 },
  { x: 25, y: 70, size: 2.5, delay: 1.4 },
  { x: 70, y: 60, size: 1.5, delay: 0.3 },
  { x: 45, y: 35, size: 2, delay: 2.1 },
  { x: 90, y: 80, size: 1.5, delay: 0.6 },
  { x: 8,  y: 85, size: 2,   delay: 1.9 },
  { x: 60, y: 10, size: 1.5, delay: 1.1 },
  { x: 33, y: 90, size: 2,   delay: 0.4 },
  { x: 78, y: 40, size: 1.5, delay: 2.5 },
  { x: 55, y: 75, size: 2,   delay: 1.7 },
  { x: 18, y: 50, size: 1.5, delay: 0.9 },
];

export default function ParticleDrift() {
  return (
    <div className="absolute inset-0 pointer-events-none z-[2]">
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: i % 3 === 0 ? 'var(--neon)' : i % 3 === 1 ? 'var(--cyan)' : 'rgba(255,255,255,0.6)',
            boxShadow: i % 3 === 0
              ? '0 0 6px var(--neon)'
              : i % 3 === 1
              ? '0 0 6px var(--cyan)'
              : 'none',
            animation: `particleFloat ${4 + (i % 3)}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
