import { cn } from "@/lib/utils";

export function GlitchTitle({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none relative z-20 flex justify-center px-4 pt-1",
        className
      )}
    >
      <h1 className="glitch-brand relative text-center text-[1.35rem] font-bold tracking-tight sm:text-2xl">
        <span
          className="relative z-[1] bg-gradient-to-r from-white via-fuchsia-100 to-cyan-200 bg-clip-text text-transparent"
          style={{ textShadow: "0 0 40px rgba(236, 72, 153, 0.25)" }}
        >
          NutriPlan.AI
        </span>
        <span
          className="glitch-brand-shadow pointer-events-none absolute inset-0 -z-0 opacity-40 blur-[0.5px]"
          aria-hidden
        >
          NutriPlan.AI
        </span>
      </h1>
    </div>
  );
}
