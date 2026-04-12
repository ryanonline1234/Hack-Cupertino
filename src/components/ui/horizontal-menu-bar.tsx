import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type HorizontalMenuItem = {
  label: string;
  icon: React.ReactNode;
  /** Use for in-page actions (e.g. smooth scroll). */
  onSelect?: () => void;
  /** Use for real navigation when no onSelect. */
  href?: string;
};

export type HorizontalMenuBarProps = {
  siteName?: string;
  items: HorizontalMenuItem[];
  ctaLabel?: string;
  onCtaClick?: () => void;
  /** When true, pins to top over hero content (landing). */
  fixed?: boolean;
  className?: string;
};

export function HorizontalMenuBar({
  siteName = "NutriPlan.AI",
  items,
  ctaLabel = "Launch simulation",
  onCtaClick,
  fixed = true,
  className,
}: HorizontalMenuBarProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  return (
    <nav
      role="navigation"
      aria-label="Main"
      className={cn(
        "w-full border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md",
        fixed &&
          "fixed left-0 right-0 top-0 z-50 pt-[max(0.65rem,env(safe-area-inset-top))]",
        className
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-y-3">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="text-base font-semibold tracking-tight text-neutral-100 sm:text-lg"
          >
            {siteName}
          </motion.div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              {items.map((item, index) => {
                const content = (
                  <>
                    {hoveredIndex === index && (
                      <motion.div
                        layoutId="horizontalMenuHoverBg"
                        className="absolute inset-0 rounded-md bg-white/[0.06]"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      {item.icon}
                      <span className="whitespace-nowrap">{item.label}</span>
                    </span>
                  </>
                );

                const className =
                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-neutral-400 transition-colors duration-150 hover:text-neutral-100 focus-visible:outline focus-visible:ring-2 focus-visible:ring-neutral-600 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950";

                if (item.onSelect) {
                  return (
                    <motion.button
                      key={`${item.label}-${index}`}
                      type="button"
                      className={className}
                      onClick={item.onSelect}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.06 }}
                    >
                      {content}
                    </motion.button>
                  );
                }

                return (
                  <motion.a
                    key={`${item.href}-${index}`}
                    href={item.href ?? "#"}
                    className={className}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.06 }}
                  >
                    {content}
                  </motion.a>
                );
              })}
            </div>

            {onCtaClick && (
              <motion.button
                type="button"
                className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 focus-visible:outline focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.1 }}
                onClick={onCtaClick}
              >
                {ctaLabel}
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
