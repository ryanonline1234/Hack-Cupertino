import { useState } from 'react';

/*
 * Draggable splitter between the map surface and the panel strip/column.
 *
 * Implementation notes:
 *   • Pointer Events API (works for mouse, touch, and pen) with
 *     setPointerCapture so dragging continues even when the pointer leaves
 *     the bar geometry.
 *   • While dragging we also render a fixed full-viewport overlay. The
 *     Streets GL iframe is cross-origin and will happily steal pointer
 *     events the moment the cursor enters it; the overlay prevents that.
 *   • Double-click resets to `defaultSize` if provided.
 *   • orientation: 'horizontal' = a horizontal bar (resizes height of the
 *     panel BELOW it). 'vertical' = a vertical bar (resizes width of the
 *     panel TO ITS RIGHT).
 *   • The size is interpreted as the bottom/right panel's pixel size, so
 *     dragging up (or left) increases that size — `next = startSize - delta`.
 */

export default function ResizeHandle({
  orientation = 'horizontal',
  size,
  onSize,
  min = 120,
  max = Infinity,
  defaultSize,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isH = orientation === 'horizontal';
  const cursor = isH ? 'row-resize' : 'col-resize';
  const active = isDragging || isHovered;

  function handlePointerDown(e) {
    e.preventDefault();
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Some older browsers throw on capture for non-mouse pointers.
    }
    setIsDragging(true);

    const startCoord = isH ? e.clientY : e.clientX;
    const startSize = size;

    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    function handleMove(ev) {
      const coord = isH ? ev.clientY : ev.clientX;
      const delta = coord - startCoord;
      // Drag up / left → bigger panel (panel is anchored to bottom/right).
      const next = Math.min(Math.max(startSize - delta, min), max);
      onSize(next);
    }

    function handleUp() {
      try { handle.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      handle.removeEventListener('pointermove', handleMove);
      handle.removeEventListener('pointerup', handleUp);
      handle.removeEventListener('pointercancel', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsDragging(false);
    }

    handle.addEventListener('pointermove', handleMove);
    handle.addEventListener('pointerup', handleUp);
    handle.addEventListener('pointercancel', handleUp);
  }

  function handleDoubleClick() {
    if (defaultSize != null) onSize(defaultSize);
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation={isH ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={max === Infinity ? undefined : max}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onKeyDown={(e) => {
          // Keyboard nudge: ±16px per arrow press, ±64px with shift.
          const step = e.shiftKey ? 64 : 16;
          let next = size;
          if (isH && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            next += e.key === 'ArrowUp' ? step : -step;
          } else if (!isH && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            next += e.key === 'ArrowLeft' ? step : -step;
          } else {
            return;
          }
          e.preventDefault();
          onSize(Math.min(Math.max(next, min), max));
        }}
        title="Drag to resize · Double-click to reset · Arrow keys nudge"
        style={{
          position: 'relative',
          cursor,
          flexShrink: 0,
          height: isH ? 8 : '100%',
          width: isH ? '100%' : 8,
          zIndex: 12,
          touchAction: 'none',
          background: active ? 'rgba(34,211,238,0.12)' : 'transparent',
          transition: 'background 140ms ease-out',
          outline: 'none',
        }}
      >
        {/* Hairline so the splitter is discoverable when idle. */}
        <div
          style={{
            position: 'absolute',
            background: active ? 'rgba(34,211,238,0.7)' : 'rgba(255,255,255,0.08)',
            transition: 'background 140ms ease-out',
            pointerEvents: 'none',
            ...(isH
              ? { left: 0, right: 0, top: 3, height: 2 }
              : { top: 0, bottom: 0, left: 3, width: 2 }),
          }}
        />
        {/* Centered grip — fades in on hover/drag. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              opacity: active ? 0.95 : 0,
              transition: 'opacity 140ms ease-out',
              borderRadius: 9999,
              background: 'var(--cyan)',
              boxShadow: '0 0 10px rgba(34,211,238,0.5)',
              width: isH ? 36 : 3,
              height: isH ? 3 : 36,
            }}
          />
        </div>
      </div>
      {/* Full-viewport overlay only while dragging. Crucially this lives
          ABOVE the cross-origin Streets GL iframe (z-index 9999), so the
          iframe can't capture the pointer mid-drag. */}
      {isDragging && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            cursor,
          }}
        />
      )}
    </>
  );
}
