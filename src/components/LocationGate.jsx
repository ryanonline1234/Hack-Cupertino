import { useEffect, useRef, useState } from 'react';
import { EXAMPLE_LOCATIONS, designationTag, fetchSuggestions, geocodeAddress } from '../lib/locationSearch';

/*
 * LocationGate: the tracker opens here instead of booting the heavy Streets
 * GL 3D iframe at a default city. The visitor picks a place first (search
 * with fuzzy suggestions, or a one-tap example), and only then does the
 * parent mount the map — already pointed at the chosen area.
 *
 * Props: onSelect(lat, lng)
 */

const DEBOUNCE_MS = 300;

export default function LocationGate({ onSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);
  const dropRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Close dropdown when clicking outside.
  useEffect(() => {
    function onPointerDown(e) {
      if (!dropRef.current?.contains(e.target)) setShowDrop(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function handleInputChange(value) {
    setQuery(value);
    setError('');
    setActiveIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowDrop(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      try {
        const results = await fetchSuggestions(value.trim());
        if (requestRef.current !== requestId) return;
        setSuggestions(results);
        setShowDrop(results.length > 0);
      } catch {
        if (requestRef.current !== requestId) return;
        setSuggestions([]);
        setShowDrop(false);
      }
    }, DEBOUNCE_MS);
  }

  function pickSuggestion(s) {
    setSuggestions([]);
    setShowDrop(false);
    setError('');
    onSelect(s.lat, s.lng);
  }

  async function submitExact() {
    const q = query.trim();
    if (!q) return;
    if (showDrop && activeIdx >= 0 && suggestions[activeIdx]) {
      pickSuggestion(suggestions[activeIdx]);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const { lat, lng } = await geocodeAddress(q);
      onSelect(lat, lng);
    } catch (err) {
      setError(err?.message || 'Location not found — try a US city, address, or ZIP code');
    } finally {
      setSearching(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown' && showDrop && suggestions.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp' && showDrop && suggestions.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      submitExact();
    }
  }

  return (
    <div className="relative w-full h-full overflow-hidden flex items-center justify-center px-4"
      style={{ background: '#050608' }}
    >
      <div className="w-full animate-fade-slide-up" style={{ maxWidth: '560px' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-2">
          Food access explorer
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
          Choose a location to analyze
        </h2>
        <p className="text-sm text-white/50 mb-6">
          The 3D map loads after you pick — already framed on your area —
          so there&apos;s no waiting on a map you didn&apos;t ask for.
        </p>

        <div className="relative" ref={dropRef}>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setShowDrop(suggestions.length > 0)}
              placeholder="City, address, or ZIP code…"
              aria-label="Location search"
              className="flex-1 min-w-0 px-4 py-3 rounded-xl text-sm text-white placeholder-white/30 focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            />
            <button
              type="button"
              onClick={submitExact}
              disabled={searching || query.trim().length === 0}
              className="px-5 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{
                background: 'rgba(34,211,238,0.12)',
                border: '1px solid rgba(34,211,238,0.30)',
                color: 'var(--cyan)',
              }}
            >
              {searching ? '…' : 'Analyze'}
            </button>
          </div>

          {showDrop && suggestions.length > 0 && (
            <ul
              className="absolute left-0 right-0 mt-2 rounded-xl overflow-hidden z-30"
              style={{
                background: 'rgba(10,12,16,0.97)',
                border: '1px solid rgba(255,255,255,0.10)',
              }}
            >
              {suggestions.map((s, i) => (
                <li key={`${s.lat},${s.lng},${i}`}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className="w-full text-left px-4 py-2.5"
                    style={{
                      background: i === activeIdx ? 'rgba(34,211,238,0.10)' : 'transparent',
                    }}
                  >
                    <span className="block text-sm text-white/85">{s.short}</span>
                    <span className="block text-[11px] text-white/40 truncate">{s.full}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs" style={{ color: 'rgba(252,165,165,0.85)' }}>
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2 flex-wrap items-center">
          <span className="text-xs text-white/30 mr-1">Try:</span>
          {EXAMPLE_LOCATIONS.map((loc) => {
            const tag = designationTag(loc);
            return (
              <button
                key={loc.label}
                type="button"
                onClick={() => onSelect(loc.lat, loc.lng)}
                title={tag ? `Model verdict: ${tag.text}` : loc.label}
                className="px-3 py-2 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-full text-xs"
                style={{
                  background: 'rgba(5,6,8,0.75)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.55)',
                }}
              >
                {tag && (
                  <span
                    className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
                    style={{ color: tag.color, border: tag.border, background: tag.background }}
                  >
                    {tag.text}
                  </span>
                )}
                {loc.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
