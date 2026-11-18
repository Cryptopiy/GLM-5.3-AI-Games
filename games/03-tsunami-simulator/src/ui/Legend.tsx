// Elevation legend generated from the same color ramp used by the terrain.

import { legendGradientCss } from '../sim/terrain';

export function Legend() {
  return (
    <div className="panel legend-panel">
      <div className="legend-title">ELEVATION</div>
      <div className="legend-ramp" style={{ background: legendGradientCss() }} />
      <div className="legend-scale">
        <span>0 m</span>
        <span>5</span>
        <span>10</span>
        <span>15 m+</span>
      </div>
      <div className="legend-note">
        <span className="dot safe" /> safe zone · <span className="dot wet" /> water depth ramps
        turquoise → deep blue
      </div>
    </div>
  );
}
