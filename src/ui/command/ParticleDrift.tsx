import { cn } from "@/lib/utils";

const DOTS = 18;

export function ParticleDrift({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-[4] overflow-hidden opacity-40",
        className
      )}
      aria-hidden
    >
      {Array.from({ length: DOTS }).map((_, i) => (
        <span
          key={i}
          className="particle-drift-dot absolute rounded-full bg-white"
          style={{
            width: 2 + (i % 3),
            height: 2 + (i % 3),
            left: `${(i * 47) % 100}%`,
            top: `${(i * 61) % 100}%`,
            animationDelay: `${i * 0.35}s`,
            opacity: 0.15 + (i % 5) * 0.06,
          }}
        />
      ))}
    </div>
  );
}
