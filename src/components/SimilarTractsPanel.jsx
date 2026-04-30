import { useMemo } from 'react';
import { findSimilarTracts } from '../lib/similarTracts';

/*
 * Renders a horizontal strip of "similar tracts" cards inside the community
 * stats panel. Each card jumps the analysis pipeline to that tract on click.
 *
 * Why include this:
 *   • Frames the current tract's situation as part of a pattern, not unique.
 *   • Gives journalists / civic planners a one-click pivot to a comparison.
 *
 * Sample dataset is hand-curated in src/data/sampleTracts.js; KNN is in
 * src/lib/similarTracts.js. Both are intentionally small/fast — this is
 * not a research surface, it's a "you are not alone" UI affordance.
 */

function similarityLabel(score) {
  // Lower is closer in our weighted-Euclidean space; the values empirically
  // sit in the 0–3 range. Translate to a friendly bucket.
  if (score < 0.6) return 'Very similar';
  if (score < 1.2) return 'Similar';
  if (score < 1.8) return 'Comparable';
  return 'Loose match';
}

export default function SimilarTractsPanel({ communityData, onJump }) {
  const matches = useMemo(() => findSimilarTracts(communityData, 4), [communityData]);

  if (!communityData || matches.length === 0) return null;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-white/45">
          Similar tracts
        </span>
        <span className="text-[10px] text-white/30">
          K-nearest neighbours · 4-D demographic vector
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
        {matches.map((tract) => (
          <button
            key={tract.fips}
            type="button"
            onClick={() => onJump?.(tract.lat, tract.lng)}
            className="shrink-0 text-left transition-all hover:scale-[1.02]"
            style={{
              width: 168,
              padding: 10,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${tract.isFoodDesert ? 'rgba(249,115,22,0.25)' : 'rgba(34,211,238,0.20)'}`,
            }}
            title={`${tract.label} (FIPS ${tract.fips})`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[9px] uppercase tracking-wider font-semibold"
                style={{ color: tract.isFoodDesert ? 'var(--orange)' : 'var(--cyan)' }}
              >
                {tract.isFoodDesert ? 'Designated' : 'Not designated'}
              </span>
              <span className="text-[9px] text-white/30">
                {similarityLabel(tract.similarityDistance)}
              </span>
            </div>
            <div className="text-[12px] font-semibold text-white/80 leading-snug truncate">
              {tract.label}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}
              >
                {tract.povertyPct.toFixed(0)}% poverty
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.55)' }}
              >
                {tract.communityAvgDistMiles.toFixed(1)}mi
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
