/*
 * PanelHeader: shared section header for the tracker panels — a small
 * lucide icon tile (Kokonut-style) + uppercase label + optional right-side
 * slot. One component so the three panels read as a family instead of
 * three one-off header treatments.
 */
export default function PanelHeader({ icon: Icon, tint, children, right }) {
  return (
    <div className="flex items-center gap-2 mb-2 shrink-0">
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0"
        style={{
          background: tint?.background || 'rgba(34,211,238,0.10)',
          border: tint?.border || '1px solid rgba(34,211,238,0.28)',
          color: tint?.color || 'var(--cyan)',
        }}
        aria-hidden
      >
        {Icon && <Icon className="w-3 h-3" strokeWidth={2.25} />}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
        {children}
      </span>
      {right}
    </div>
  );
}
