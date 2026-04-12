import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const LABELS = [
  'Low food access %',
  'Diabetes %',
  'Obesity %',
  'Poverty %',
  'No-vehicle low access %',
];

function normalise(values) {
  return values.map((v) => {
    const raw = Number(v);
    if (Number.isNaN(raw)) return 0;
    return Math.max(0, Math.min(100, raw));
  });
}

export default function RadarChart({ communityData, impactData, showImpact }) {
  if (!communityData) return null;

  const { foodAccess, health, demographics } = communityData;

  const currentValues = [
    foodAccess.pctLowAccess1mi,
    health.diabetes,
    health.obesity,
    demographics.pctPoverty,
    foodAccess.pctNoVehicleLowAccess,
  ];

  const impactValues = impactData
    ? [
        foodAccess.pctLowAccess1mi - impactData.foodAccess.pctLowAccessReduction,
        impactData.health.diabetesNewRate,
        impactData.health.obesityNewRate,
        demographics.pctPoverty,
        foodAccess.pctNoVehicleLowAccess,
      ]
    : null;

  const datasets = [
    {
      label: 'Current',
      data: normalise(currentValues),
      backgroundColor: 'rgba(249, 115, 22, 0.15)',
      borderColor: 'rgba(249, 115, 22, 0.8)',
      borderWidth: 2,
      pointBackgroundColor: 'rgba(249, 115, 22, 0.8)',
      pointRadius: 3,
    },
  ];

  if (showImpact && impactValues) {
    datasets.push({
      label: 'After grocery store',
      data: normalise(impactValues),
      backgroundColor: 'rgba(20, 184, 166, 0.15)',
      borderColor: 'rgba(20, 184, 166, 0.8)',
      borderWidth: 2,
      pointBackgroundColor: 'rgba(20, 184, 166, 0.8)',
      pointRadius: 3,
    });
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: { display: false },
        grid: { display: false },
        angleLines: { display: false },
        pointLabels: {
          font: { size: 11 },
          color: '#6b7280',
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { font: { size: 11 }, boxWidth: 12, padding: 12 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}`,
        },
      },
    },
  };

  return (
    <div className="h-64">
      <Radar data={{ labels: LABELS, datasets }} options={options} />
    </div>
  );
}
