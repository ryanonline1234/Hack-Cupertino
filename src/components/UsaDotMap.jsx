import { useEffect, useRef, useState } from 'react';

/*
 * UsaDotMap: landing-hero canvas. A dot grid rasterized from real US state
 * boundaries (see scripts/gen-us-dotgrid.mjs) with the curated sample-tract
 * dataset as glowing hotspots. Clicking a hotspot analyzes that community.
 *
 * Motion budget: one opacity-only pulse ring per hotspot (2.4s cycle,
 * staggered), static frame under prefers-reduced-motion. No layout/paint
 * churn — everything is canvas alpha + radius.
 *
 * Props:
 *   hotspots: [{ lat, lng, label, isFoodDesert }]
 *   onSelect: (lat, lng) => void
 */

const PULSE_MS = 2400;
const DESERT_CORE = '251,146,60';   // warm orange for food-desert samples
const SERVED_CORE = '34,211,238';   // cyan for well-served comparison samples

function pickRegion(regions, lon, lat) {
  for (const r of regions) {
    if (lon >= r.lonMin && lon <= r.lonMax && lat >= r.latMin && lat <= r.latMax) {
      return r;
    }
  }
  return null;
}

function project(region, lon, lat) {
  return [
    region.ox + (lon - region.lonMin) * region.cos * region.k,
    region.oy + (region.latMax - lat) * region.k,
  ];
}

export default function UsaDotMap({ hotspots = [], onSelect }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const dataRef = useRef(null);
  const hoverRef = useRef(-1);
  const rafRef = useRef(0);
  const [hovered, setHovered] = useState(false);

  // Load the grid once.
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/us-dotgrid.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) dataRef.current = json;
      })
      .catch(() => {
        if (!cancelled) dataRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Paint loop (single static frame when reduced motion is preferred).
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || typeof ResizeObserver === 'undefined') return undefined;

    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const spots = (hotspots || [])
      .map((h, i) => ({ ...h, phase: (i / Math.max(1, hotspots.length)) * PULSE_MS }))
      .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));

    function paint(now) {
      const grid = dataRef.current;
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, rect.width);
      const H = Math.max(1, rect.height);

      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!grid) return;

      const scale = Math.min(W / grid.width, H / grid.height);
      const ox = (W - grid.width * scale) / 2;
      const oy = (H - grid.height * scale) / 2;
      const toPx = (gx, gy) => [ox + gx * scale, oy + gy * scale];

      // Base land dots.
      const dotR = Math.max(0.7, grid.gap * scale * 0.16);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      for (const [gx, gy] of grid.dots) {
        const [x, y] = toPx(gx, gy);
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
      ctx.fill();

      // Hotspots projected with the same transform the grid was built with.
      const pxSpots = [];
      for (const s of spots) {
        const region = pickRegion(grid.regions, s.lng, s.lat);
        if (!region) continue;
        const [gx, gy] = project(region, s.lng, s.lat);
        pxSpots.push({ ...s, x: ox + gx * scale, y: oy + gy * scale });
      }
      const pulseR = Math.max(5, 9 * scale);

      for (let i = 0; i < pxSpots.length; i += 1) {
        const s = pxSpots[i];
        const core = s.isFoodDesert ? DESERT_CORE : SERVED_CORE;
        const t = reduceMotion ? 0.5 : ((now - s.phase) % PULSE_MS) / PULSE_MS;

        // Expanding ring (opacity-only fade).
        const ringR = pulseR * (0.5 + t);
        ctx.strokeStyle = `rgba(${core},${(0.5 * (1 - t)).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Core dot + soft halo.
        const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, pulseR * 0.8);
        halo.addColorStop(0, `rgba(${core},0.85)`);
        halo.addColorStop(1, `rgba(${core},0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(s.x, s.y, pulseR * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${core},1)`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(2, 2.6 * scale), 0, Math.PI * 2);
        ctx.fill();

        // Hovered / keyboard-adjacent label.
        if (i === hoverRef.current) {
          ctx.font = '12px Inter, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const label = s.label || 'Sample community';
          const tw = ctx.measureText(label).width;
          const lx = Math.min(Math.max(s.x, tw / 2 + 8), W - tw / 2 - 8);
          const ly = Math.max(20, s.y - pulseR - 14);
          ctx.fillStyle = 'rgba(5,6,8,0.9)';
          ctx.strokeStyle = `rgba(${core},0.4)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(lx - tw / 2 - 8, ly - 11, tw + 16, 22, 6);
          } else {
            ctx.rect(lx - tw / 2 - 8, ly - 11, tw + 16, 22);
          }
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(label, lx, ly + 4);
        }
      }
      canvas._spots = pxSpots;
    }

    const ro = new ResizeObserver(() => paint(performance.now()));
    ro.observe(wrap);

    if (reduceMotion) {
      paint(0);
      return () => ro.disconnect();
    }
    const tick = (now) => {
      paint(now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [hotspots]);

  function spotsAt(clientX, clientY) {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const spots = canvas._spots || [];
    let best = -1;
    let bestD = 26;
    for (let i = 0; i < spots.length; i += 1) {
      const d = Math.hypot(spots[i].x - x, spots[i].y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: hovered ? 'pointer' : 'default' }}
        onMouseMove={(e) => {
          const i = spotsAt(e.clientX, e.clientY);
          if (i !== hoverRef.current) {
            hoverRef.current = i;
            setHovered(i >= 0);
          }
        }}
        onMouseLeave={() => {
          hoverRef.current = -1;
          setHovered(false);
        }}
        onClick={(e) => {
          const spots = e.currentTarget._spots || [];
          const i = spotsAt(e.clientX, e.clientY);
          if (i >= 0 && onSelect) onSelect(spots[i].lat, spots[i].lng);
        }}
        role="img"
        aria-label="Map of the United States showing sample food-desert communities. Activate a glowing point to analyze it."
      />
      <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-3 text-[10px] text-white/35">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#fb923c' }} />
          sample food desert
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#22d3ee' }} />
          comparison tract
        </span>
      </div>
    </div>
  );
}
