import { useEffect, useRef } from 'react';

const TYPE_COLORS = {
  system:  { color: 'rgba(255,255,255,0.5)',  prefix: 'SYS' },
  info:    { color: 'rgba(34, 211, 238, 0.8)', prefix: '···' },
  success: { color: 'rgba(0, 255, 153, 0.9)',  prefix: ' ✓ ' },
  warning: { color: 'rgba(249, 115, 22, 0.9)', prefix: ' ⚠ ' },
  error:   { color: 'rgba(239, 68, 68, 0.9)',  prefix: 'ERR' },
};

export default function AgentStatusFeed({ logs, loading }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: loading ? 'var(--cyan)' : 'var(--neon)',
            boxShadow: loading ? '0 0 6px var(--cyan)' : '0 0 6px var(--neon)',
            animation: 'pulseNeon 2s ease-in-out infinite',
          }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Pipeline Log
        </span>
        {loading && (
          <svg className="w-3 h-3 ml-auto animate-spin" style={{ color: 'var(--cyan)' }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-0.5 font-mono">
        {logs.map((log, idx) => {
          const style = TYPE_COLORS[log.type] || TYPE_COLORS.info;
          return (
            <div
              key={log.id}
              className="flex items-start gap-2 text-[11px] leading-5 animate-fade-slide-left"
              style={{ animationDelay: `${Math.min(idx * 0.04, 0.3)}s`, opacity: 0, animationFillMode: 'forwards' }}
            >
              <span
                className="shrink-0 text-[10px] font-bold w-7 mt-0.5"
                style={{ color: style.color }}
              >
                {style.prefix}
              </span>
              <span className="text-white/60 break-words min-w-0">{log.text}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
