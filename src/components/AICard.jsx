import { useEffect, useMemo, useState } from 'react';

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const memoryCache = new Map();
const inFlightByFips = new Map();

function cacheKey(fips) {
  return `fds:narrative:${fips}`;
}

function readLocalCache(fips) {
  try {
    const raw = localStorage.getItem(cacheKey(fips));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.text || !parsed?.ts) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(fips, text) {
  try {
    localStorage.setItem(cacheKey(fips), JSON.stringify({ text, ts: Date.now() }));
  } catch {
    // Ignore storage failures (private mode / full quota).
  }
}

function getCachedNarrative(fips) {
  const memoHit = memoryCache.get(fips);
  if (memoHit && Date.now() - memoHit.ts <= CACHE_TTL_MS) return memoHit.text;
  const localHit = readLocalCache(fips);
  if (localHit) {
    memoryCache.set(fips, localHit);
    return localHit.text;
  }
  return null;
}

function normalizeTwoParagraphs(text) {
  const blocks = (text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (blocks.length >= 2) return `${blocks[0]}\n\n${blocks[1]}`;

  const oneBlock = blocks[0] || '';
  const sentences = oneBlock.match(/[^.!?]+[.!?]+/g) || [oneBlock];
  if (sentences.length < 2) return oneBlock;

  const pivot = Math.ceil(sentences.length / 2);
  return `${sentences.slice(0, pivot).join(' ').trim()}\n\n${sentences.slice(pivot).join(' ').trim()}`;
}

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function fetchNarrative(prompt, apiKey, signal) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const url = import.meta.env.DEV
        ? '/api/llmapi/v1/chat/completions'
        : 'https://api.llmapi.ai/v1/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku',
          max_tokens: 600,
          temperature: 0.45,
          messages: [
            {
              role: 'system',
              content: 'You are a civic-health narrative writer. Write clear, human language grounded only in provided numbers. Avoid hype, avoid hedging, and never use bullet points.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await wait(400 * (2 ** attempt));
          continue;
        }
        throw new Error(`LLMApi request failed: ${res.status}`);
      }

      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content?.trim();

      if (!text) throw new Error('LLMApi returned empty text');
      return normalizeTwoParagraphs(text);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
      if (attempt < 2) await wait(400 * (2 ** attempt));
    }
  }

  throw lastError || new Error('LLMApi request failed');
}

function Skeleton() {
  return (
    <div className="space-y-2 mt-1">
      <div className="skeleton h-2.5 rounded w-full" />
      <div className="skeleton h-2.5 rounded w-11/12" />
      <div className="skeleton h-2.5 rounded w-9/12" />
      <div className="skeleton h-2.5 rounded w-full mt-3" />
      <div className="skeleton h-2.5 rounded w-10/12" />
    </div>
  );
}

function toMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '0';
  return Number(value).toLocaleString();
}

export default function AICard({ communityData, impactData }) {
  const [narrative, setNarrative] = useState('');
  const [status, setStatus] = useState('idle');

  const fips = communityData?.meta?.fips;

  const prompt = useMemo(() => {
    if (!communityData || !impactData) return null;

    const { foodAccess, health, demographics } = communityData;
    const { foodAccess: impactFood, health: impactHealth, economic } = impactData;

    return `You are analyzing food access data for a US community. Respond in exactly two short paragraphs with no headers or bullet points.

Community data:
- Food desert: ${foodAccess.isFoodDesert}
- Population with low grocery access (within 1 mile): ${Number(foodAccess.pctLowAccess1mi || 0).toFixed(1)}%
- Diabetes prevalence: ${Number(health.diabetes || 0).toFixed(1)}%
- Obesity prevalence: ${Number(health.obesity || 0).toFixed(1)}%
- Median household income: $${toMoney(demographics.medianIncome)}
- Poverty rate: ${Number(demographics.pctPoverty || 0).toFixed(1)}%
- Households without vehicle and low access: ${Number(foodAccess.pctNoVehicleLowAccess || 0).toFixed(1)}%

Projected impact of adding one grocery store:
- Residents gaining access: ${toMoney(impactFood.residentsGainingAccess)}
- Diabetes rate change: -${Number(impactHealth.diabetesReductionPct || 0).toFixed(1)} percentage points
- Jobs created: ${economic.jobsMin}\u2013${economic.jobsMax}
- Annual local economic impact: $${toMoney(economic.annualLocalImpact)}

Paragraph 1: Describe in plain English what daily food access looks like for residents here. Be specific and human, not clinical.
Paragraph 2: Describe what would realistically change if a grocery store opened. Ground it in the numbers above. Avoid jargon and disclaimers.`;
  }, [communityData, impactData]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function run() {
      if (!fips || !prompt) {
        setNarrative('');
        setStatus('idle');
        return;
      }

      const apiKey = import.meta.env.VITE_ANTHROPIC_KEY;
      if (!apiKey) {
        setStatus('error');
        setNarrative('');
        return;
      }

      const cached = getCachedNarrative(fips);
      if (cached) {
        setNarrative(cached);
        setStatus('ready');
        return;
      }

      try {
        setStatus('loading');

        let request = inFlightByFips.get(fips);
        if (!request) {
          request = fetchNarrative(prompt, apiKey, controller.signal)
            .then((text) => {
              memoryCache.set(fips, { text, ts: Date.now() });
              writeLocalCache(fips, text);
              return text;
            })
            .finally(() => { inFlightByFips.delete(fips); });
          inFlightByFips.set(fips, request);
        }

        const text = await request;
        if (cancelled) return;
        setNarrative(text);
        setStatus('ready');
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error(err);
        if (cancelled) return;
        setStatus('error');
        setNarrative('');
      }
    }

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fips]);

  // ── Idle: no community selected ──
  if (!communityData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
        <svg className="w-8 h-8 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p className="text-xs text-white/30">AI narrative will appear here</p>
      </div>
    );
  }

  const paragraphs = narrative
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--neon)', boxShadow: '0 0 6px var(--neon)', animation: 'pulseNeon 2.5s ease-in-out infinite' }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Community Narrative
        </span>
        {status === 'loading' && (
          <span className="ml-auto text-[10px] font-medium" style={{ color: 'var(--cyan)' }}>
            Generating…
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {status === 'loading' && <Skeleton />}

        {status === 'ready' && paragraphs.length > 0 && (
          <div className="space-y-3 animate-fade-slide-up">
            {paragraphs.map((p, idx) => (
              <p key={idx} className="text-xs leading-relaxed text-white/70">
                {p}
              </p>
            ))}
          </div>
        )}

        {status === 'error' && (
          <p className="text-xs text-white/30 italic">
            Narrative unavailable — check VITE_ANTHROPIC_KEY in .env
          </p>
        )}

        {status === 'idle' && communityData && !import.meta.env.VITE_ANTHROPIC_KEY && (
          <p className="text-xs text-white/30 italic">
            Add VITE_ANTHROPIC_KEY to .env to enable AI narrative
          </p>
        )}
      </div>

      {/* Footer */}
      <p className="mt-2 shrink-0 text-[10px] text-white/25">
        Powered by real community data
        <span className="text-white/15"> · USDA · CDC PLACES · Census ACS</span>
      </p>
    </div>
  );
}
