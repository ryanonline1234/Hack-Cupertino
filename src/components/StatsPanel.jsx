import StatCard from './StatCard';
import RadarChart from './RadarChart';
import { fmtPct, fmtIncome } from '../utils/formatters';

export default function StatsPanel({ communityData, impactData, showImpact, onToggleImpact }) {
  if (!communityData) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center text-gray-400 gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm">Drop a pin on the map to see community data</p>
      </div>
    );
  }

  const { foodAccess, health, demographics } = communityData;
  const diabetesDelta = showImpact && impactData
    ? -(impactData.health.diabetesReductionPct)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard
          label="Food Desert Status"
          value={foodAccess.isFoodDesert ? 'Yes' : 'No'}
          highlight={foodAccess.isFoodDesert}
        />
        <StatCard
          label="Low Grocery Access"
          value={fmtPct(foodAccess.pctLowAccess1mi)}
          delta={
            showImpact && impactData
              ? -(impactData.foodAccess.pctLowAccessReduction)
              : null
          }
        />
        <StatCard
          label="Diabetes Rate"
          value={fmtPct(health.diabetes)}
          delta={diabetesDelta}
        />
        <StatCard
          label="Median Income"
          value={fmtIncome(demographics.medianIncome)}
        />
      </div>

      {/* Radar chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Community Health Profile
        </p>
        <RadarChart
          communityData={communityData}
          impactData={impactData}
          showImpact={showImpact}
        />
      </div>

      {/* Toggle button */}
      {impactData && (
        <button
          onClick={onToggleImpact}
          className={`w-full py-2 rounded-lg border text-sm font-medium transition-colors ${
            showImpact
              ? 'bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100'
              : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
          }`}
        >
          {showImpact ? 'Hide projection' : 'Show impact projection'}
        </button>
      )}
    </div>
  );
}
