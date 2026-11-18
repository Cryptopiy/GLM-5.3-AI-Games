export function ModelInfo(): JSX.Element {
  return (
    <details className="model">
      <summary>Physics model</summary>
      <div className="model__body">
        <h4>Collision response</h4>
        <p>
          3D oriented-box (OBB) SAT collision with an impulse-based rigid-body
          response, including angular terms and Coulomb friction:
        </p>
        <code>jₙ = −(1+e)·(v_rel·n) / (m₁⁻¹ + m₂⁻¹ + ang₁ + ang₂)</code>
        <p>
          Bodies integrate with semi-implicit Euler at 240 Hz; a box inertia
          tensor drives rotation, so off-centre hits spin the car physically.
        </p>
        <h4>Impact force (estimate)</h4>
        <p>
          <code>F ≈ J / Δt</code> — the impulse actually exchanged during the
          primary impact, divided by an assumed impact duration (wall 90 ms,
          heavy barrier 130 ms, light barrier 220 ms). It is an estimate, not a
          measurement of a real crash pulse.
        </p>
        <h4>Damage model</h4>
        <code>D = 100 · (1 − e^(−k·E_crush / E_ref))</code>
        <p>
          E_crush = kinetic energy dissipated by the impact; E_ref = ½m·(18 m/s)²
          ≈ a 65 km/h crash; k = obstacle rigidity (1.0 / 0.8 / 0.5). Bands:
          &lt;20% minor, &lt;50% moderate, &lt;80% severe, ≥80% catastrophic.
        </p>
        <h4>After the hit</h4>
        <p>
          Locked-wheel braking (0.62 g) and lateral tire grip (0.85 g) stop the
          slide; a damped suspension spring bounds pitch/roll. Debris flies
          ballistically with ground bounce; the same config always produces the
          same crumple pattern (seeded RNG).
        </p>
      </div>
    </details>
  );
}
