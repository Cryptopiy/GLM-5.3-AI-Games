import { OBSTACLES } from '../config/obstacles';
import type { HistoryEntry } from '../types';

export function HistoryTable({ history }: { history: HistoryEntry[] }): JSX.Element {
  return (
    <div className="history">
      <h3>Last runs</h3>
      {history.length === 0 ? (
        <p className="history__empty">No crashes yet. Run an experiment.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>km/h</th>
              <th>kg</th>
              <th>°</th>
              <th>Obst.</th>
              <th>kN</th>
              <th>Dmg</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{h.id}</td>
                <td>{h.speedKmh}</td>
                <td>{h.massKg}</td>
                <td>{h.angleDeg}</td>
                <td title={OBSTACLES[h.obstacle].label}>{OBSTACLES[h.obstacle].shortLabel}</td>
                <td>{h.forceKN.toFixed(0)}</td>
                <td>{h.damagePct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
