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
  siteName = "Food Desert AI",
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
        "material-nav w-full border-b",
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
            className="flex items-center text-base font-semibold tracking-tight text-neutral-100 sm:text-lg"
          >
            <span
              className="mr-2 inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--neon)", boxShadow: "0 0 0 4px rgba(94, 242, 160, 0.16)" }}
              aria-hidden
            />
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
                        className="absolute inset-0 rounded-full bg-[rgba(94,242,160,0.14)]"
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
                  "relative flex items-center gap-2 rounded-full px-3 py-2 text-sm font-normal text-neutral-300 transition-colors duration-150 hover:text-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#5ef2a0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1411]";

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
                className="cta-produce btn-press px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#b8ffd8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1411]"
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
