const PIN_STYLES = {
  grocery: {
    label: 'Grocery',
    icon: 'G',
    color: 'var(--neon)',
    border: 'rgba(0,255,153,0.35)',
  },
  transit: {
    label: 'Transit Hub',
    icon: 'T',
    color: 'var(--cyan)',
    border: 'rgba(34,211,238,0.35)',
  },
  pantry: {
    label: 'Pantry',
    icon: 'P',
    color: 'var(--orange)',
    border: 'rgba(249,115,22,0.35)',
  },
};

function CountPill({ type, count }) {
  const style = PIN_STYLES[type];
  return (
    <div
      className="px-2 py-1 rounded-md text-[11px] font-medium"
      style={{
        color: style.color,
        border: `1px solid ${style.border}`,
        background: 'rgba(5,6,8,0.72)',
      }}
    >
      {style.label}: {count}
    </div>
  );
}

function DropButton({ type, onClick }) {
  const style = PIN_STYLES[type];
  return (
    <button
      onClick={() => onClick(type)}
      className="px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all hover:scale-[1.02]"
      style={{
        color: style.color,
        border: `1px solid ${style.border}`,
        background: 'rgba(5,6,8,0.85)',
      }}
      title={`Drop ${style.label} at map center`}
    >
      + {style.icon}
    </button>
  );
}

export default function SimLabControls({ mode, pinCounts, pinTotal, onAddPin, onUndoPin, onClearPins }) {
  if (mode !== 'simlab') return null;

  return (
    <div
      className="absolute right-4 top-16 z-20 p-3 rounded-xl w-[260px]"
      style={{
        background: 'rgba(5,6,8,0.88)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
          Sim Lab
        </p>
        <span className="text-[10px] text-white/35">Pins: {pinTotal}</span>
      </div>

      <p className="text-[11px] text-white/45 mb-2 leading-relaxed">
        Drop infrastructure pins at the center crosshair to recalculate impact.
      </p>

      <div className="flex gap-1.5 mb-2">
        <DropButton type="grocery" onClick={onAddPin} />
        <DropButton type="transit" onClick={onAddPin} />
        <DropButton type="pantry" onClick={onAddPin} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <CountPill type="grocery" count={pinCounts.grocery || 0} />
        <CountPill type="transit" count={pinCounts.transit || 0} />
        <CountPill type="pantry" count={pinCounts.pantry || 0} />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={onUndoPin}
          disabled={pinTotal === 0}
          className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium disabled:opacity-35"
          style={{
            border: '1px solid rgba(255,255,255,0.16)',
            color: 'rgba(255,255,255,0.65)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          Undo
        </button>
        <button
          onClick={onClearPins}
          disabled={pinTotal === 0}
          className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium disabled:opacity-35"
          style={{
            border: '1px solid rgba(239,68,68,0.25)',
            color: 'rgba(252,165,165,0.85)',
            background: 'rgba(239,68,68,0.08)',
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
