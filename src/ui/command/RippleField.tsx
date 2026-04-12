import { cn } from "@/lib/utils";

export function RippleField({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden",
        className
      )}
      aria-hidden
    >
      <div className="command-ripple-ring" />
      <div className="command-ripple-ring delay-a" />
      <div className="command-ripple-ring delay-b" />
    </div>
  );
}
