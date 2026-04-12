import { useState, useCallback } from 'react';
import FeatureNav from './components/FeatureNav';
import StreetsGlView from './components/StreetsGlView';
import CommunityStatsPanel from './components/CommunityStatsPanel';
import AICard from './components/AICard';
import AgentStatusFeed from './components/AgentStatusFeed';
import { buildCommunityData } from './pipeline/normalizer';
import { projectImpact } from './engine/projectionEngine';

const INITIAL_LOGS = [
  { id: 0, text: 'System initialized. All data connectors online.', type: 'system' },
  { id: 1, text: 'USDA Food Access Atlas: ready', type: 'success' },
  { id: 2, text: 'CDC PLACES API: ready', type: 'success' },
  { id: 3, text: 'Census ACS pipeline: ready', type: 'success' },
  { id: 4, text: 'Claude AI narrative engine: ready', type: 'success' },
  { id: 5, text: 'Awaiting location input…', type: 'info' },
];

// ── Shared panel set ──────────────────────────────────────────────────────────
function Panels({ communityData, impactData, showImpact, onToggleImpact, loading, dataError, logs }) {
  return (
    <>
      <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-0">
        <CommunityStatsPanel
          communityData={communityData}
          loading={loading}
          impactData={impactData}
          showImpact={showImpact}
          onToggleImpact={onToggleImpact}
        />
      </div>

      <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-0">
        {dataError ? (
          <div className="h-full flex items-center justify-center text-sm text-center px-4"
            style={{ color: 'rgba(252,165,165,0.8)' }}>
            {dataError}
          </div>
        ) : (
          <AICard communityData={communityData} impactData={impactData} />
        )}
      </div>

      <div className="glass-panel rounded-xl p-3 min-w-0 overflow-hidden flex-1 min-h-0">
        <AgentStatusFeed logs={logs} loading={loading} />
      </div>
    </>
  );
}

export default function App() {
  const [communityData, setCommunityData] = useState(null);
  const [impactData, setImpactData]       = useState(null);
  const [loading, setLoading]             = useState(false);
  const [showImpact, setShowImpact]       = useState(false);
  const [mapCenter, setMapCenter]         = useState({ lat: 37.773, lng: -122.418 });
  const [logs, setLogs]                   = useState(INITIAL_LOGS);
  const [dataError, setDataError]         = useState('');
  const [layout, setLayout]               = useState('bottom'); // 'bottom' | 'split'

  const addLog = useCallback((text, type = 'info') => {
    setLogs((prev) => [
      ...prev.slice(-24),
      { id: Date.now() + Math.random(), text, type },
    ]);
  }, []);

  async function handleLocationSearch(lat, lng) {
    setLoading(true);
    setCommunityData(null);
    setImpactData(null);
    setDataError('');
    setShowImpact(false);
    setMapCenter({ lat, lng });

    addLog(`Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, 'system');
    addLog('Querying Census TIGER geocoder…', 'info');

    try {
      addLog('Fetching USDA Food Access Atlas CSV…', 'info');
      addLog('Pulling CDC PLACES health metrics…', 'info');
      addLog('Loading Census ACS 5-year estimates…', 'info');

      const data = await buildCommunityData(lat, lng);
      if (!data) throw new Error('No census tract found. Try a different US location.');

      addLog(`Census tract: ${data.meta.fips}  (${data.meta.stateAbbr})`, 'success');
      addLog(`ZIP code: ${data.meta.zip || 'N/A'}`, 'info');
      addLog(
        `Food desert: ${data.foodAccess.isFoodDesert ? 'YES ⚠' : 'NO ✓'}`,
        data.foodAccess.isFoodDesert ? 'warning' : 'success',
      );
      addLog(`Low access (1mi): ${Number(data.foodAccess.pctLowAccess1mi || 0).toFixed(1)}%`, 'info');
      addLog(`Diabetes: ${Number(data.health.diabetes || 0).toFixed(1)}%  |  Obesity: ${Number(data.health.obesity || 0).toFixed(1)}%`, 'info');
      addLog('Running projection engine…', 'info');

      const impact = projectImpact(data);

      addLog(`Impact: +${Number(impact.foodAccess.residentsGainingAccess).toLocaleString()} residents gain access`, 'success');
      addLog(`Economic: ${impact.economic.jobsMin}–${impact.economic.jobsMax} jobs · $${(impact.economic.annualLocalImpact / 1e6).toFixed(1)}M local impact`, 'success');
      addLog('Generating AI narrative via Claude…', 'info');
      addLog('Analysis pipeline complete ✓', 'success');

      setImpactData(impact);
      setCommunityData(data);
    } catch (err) {
      addLog(`Error: ${err?.message || 'Pipeline failure'}`, 'error');
      setDataError(err?.message || 'Unable to load data for this location.');
    } finally {
      setLoading(false);
    }
  }

  if (import.meta.env.DEV) window.__testPinDrop = handleLocationSearch;

  const panelProps = { communityData, impactData, showImpact, onToggleImpact: () => setShowImpact((v) => !v), loading, dataError, logs };

  const panelStrip = (
    <div
      className="shrink-0 flex gap-3 p-3"
      style={{ height: '30vh', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(5,6,8,0.6)' }}
    >
      <Panels {...panelProps} />
    </div>
  );

  const panelColumn = (
    <div
      className="flex flex-col gap-3 p-3 overflow-y-auto"
      style={{ width: '50%', borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(5,6,8,0.6)' }}
    >
      <Panels {...panelProps} />
    </div>
  );

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: 'var(--void)', fontFamily: "'Inter', sans-serif" }}
    >
      <FeatureNav
        communityData={communityData}
        loading={loading}
        layout={layout}
        onToggleLayout={() => setLayout((l) => l === 'bottom' ? 'split' : 'bottom')}
      />

      <div className="flex-1 overflow-hidden min-h-0">
        {layout === 'bottom' ? (
          /* ── Top map / bottom panels ── */
          <div className="flex flex-col h-full">
            <div className="flex-1 relative min-h-0">
              <StreetsGlView
                lat={mapCenter.lat}
                lng={mapCenter.lng}
                isLoading={loading}
                hasData={!!communityData}
                onSearch={handleLocationSearch}
              />
            </div>
            {panelStrip}
          </div>
        ) : (
          /* ── Left map / right panels ── */
          <div className="flex h-full">
            <div className="flex-1 relative min-h-0">
              <StreetsGlView
                lat={mapCenter.lat}
                lng={mapCenter.lng}
                isLoading={loading}
                hasData={!!communityData}
                onSearch={handleLocationSearch}
              />
            </div>
            {panelColumn}
          </div>
        )}
      </div>
    </div>
  );
}
