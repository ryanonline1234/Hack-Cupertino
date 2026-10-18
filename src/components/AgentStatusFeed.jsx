import { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import PanelHeader from './bits/PanelHeader';

const TYPE_COLORS = {
  system:  { color: 'rgba(255,255,255,0.5)',  prefix: 'SYS' },
  info:    { color: 'rgba(34, 211, 238, 0.8)', prefix: '···' },
  success: { color: 'rgba(0, 255, 153, 0.9)',  prefix: ' ✓ ' },
  warning: { color: 'rgba(249, 115, 22, 0.9)', prefix: ' ⚠ ' },
  error:   { color: 'rgba(239, 68, 68, 0.9)',  prefix: 'ERR' },
};

// collapsed: one line (icon, label, latest entry, Show) so the Tract view gets
// the room; onToggle switches between the two (2026-10-18).
export default function AgentStatusFeed({ logs, loading, collapsed = false, onToggle }) {
  const scrollRef = useRef(null);

  // Scroll the log box only. scrollIntoView also scrolls every scrollable
  // ancestor, which on phones jumped the whole results page past the verdict
  // and the scenario card to the bottom of the log.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [logs]);

  const spinner = loading && (
    <svg className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--cyan)' }} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
  const toggle = typeof onToggle === 'function' && (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={collapsed ? undefined : 'pipeline-log-entries'}
      title={collapsed ? 'Show the pipeline log' : 'Shrink the pipeline log to one line'}
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors btn-press"
      style={{ border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.72)' }}
    >
      {collapsed ? 'Show' : 'Hide'}
    </button>
  );

  if (collapsed) {
    const latest = logs.length > 0 ? logs[logs.length - 1].text : 'Nothing yet';
    return (
      <div className="flex items-center gap-2 min-w-0">
        <PanelHeader icon={Activity} compact>Pipeline Log</PanelHeader>
        <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-white/45" title={latest}>{latest}</span>
        {spinner}
        {toggle}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <PanelHeader
        icon={Activity}
        right={(spinner || toggle) && <span className="ml-auto flex items-center gap-2">{spinner}{toggle}</span>}
      >
        Pipeline Log
      </PanelHeader>

      {/* Log entries */}
      <div id="pipeline-log-entries" ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 space-y-0.5 font-mono">
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
      </div>
    </div>
  );
}
