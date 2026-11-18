// Live statistics readout, polled from the simulation engine at ~5 Hz.

import { Stats } from '../sim/engine';

export function StatsPanel({ stats }: { stats: Stats }) {
  const pct = Math.min(100, Math.max(0, stats.floodedPct));
  return (
    <div className="panel stats-panel">
      <h1>TSUNAMI <span>SIMULATOR</span></h1>
      <div className="flooded-block">
        <div className="flooded-label">Flooded Area</div>
        <div className="flooded-value">{pct.toFixed(1)}<span>%</span></div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span className="k">Max depth</span>
          <span className="v">{stats.maxDepth.toFixed(1)} m</span>
        </div>
        <div className="stat">
          <span className="k">Wave set</span>
          <span className="v">{stats.waveHeight.toFixed(1)} m</span>
        </div>
        <div className="stat">
          <span className="k">Vehicles hit</span>
          <span className="v">
            {stats.displacedCars} / {stats.carsTotal}
          </span>
        </div>
        <div className="stat">
          <span className="k">Buildings flooded</span>
          <span className="v">
            {stats.floodedBuildings} / {stats.buildingsTotal}
          </span>
        </div>
        <div className="stat">
          <span className="k">People safe</span>
          <span className="v ok">{stats.peopleSafe} / {stats.peopleTotal}</span>
        </div>
        <div className="stat">
          <span className="k">People caught</span>
          <span className="v bad">{stats.peopleCaught}</span>
        </div>
      </div>
      <div className="elapsed">
        Elapsed {stats.elapsed.toFixed(1)} s · {stats.phase.toUpperCase()}
      </div>
    </div>
  );
}
