import type { HudState } from '../game/types';

function Stars({ n }: { n: number }) {
  return (
    <span className={n > 0 ? 'stars hot' : 'stars'}>
      {'★'.repeat(n)}
      {'☆'.repeat(Math.max(0, 3 - n))}
    </span>
  );
}

export default function Hud({ state }: { state: HudState }) {
  const driving = state.mode === 'DRIVING';
  return (
    <div className="hud">
      {/* Top-left: mode / speed / car health */}
      <div className="panel status">
        <div className={driving ? 'mode driving' : 'mode onfoot'}>{state.mode}</div>
        {driving && (
          <div className="speed-row">
            <span className="speed-val">{state.speedKmh}</span>
            <span className="speed-unit">KM/H</span>
            {state.carHp !== null && (
              <div className="car-hp" style={{ marginLeft: 8 }}>
                <div className="fill" style={{ width: `${Math.max(0, state.carHp)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top-center: objective */}
      <div className="panel objective">
        <div className="title">OBJECTIVE</div>
        <div className="text">{state.objective}</div>
        {state.missionTimer !== null && (
          <div className="timer">{state.missionTimer.toFixed(1)}s</div>
        )}
      </div>

      {/* Top-right: wanted */}
      <div className="panel wanted">
        <div className="wanted-label">
          {state.wanted > 0 ? 'WANTED — POLICE IN PURSUIT' : 'NOT WANTED'}
        </div>
        <Stars n={state.wanted} />
        {state.wanted > 0 && (
          <div className="escape">
            <div className="fill" style={{ width: `${state.escapeProgress * 100}%` }} />
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="notifications">
        {state.notifications.slice(-3).map((n) => (
          <div key={n.id} className={`notif ${n.kind}`}>
            {n.text}
          </div>
        ))}
      </div>

      {/* Center banner */}
      {state.banner && (
        <div className={`banner ${state.banner.kind}`}>
          <div className="big">{state.banner.title}</div>
          <div className="sub">{state.banner.sub}</div>
        </div>
      )}

      {/* Interaction hint */}
      {state.hint && (
        <div className="hint">
          <span className="k">E</span>
          {state.hint}
        </div>
      )}

      {/* Bottom-left: controls */}
      <div className="panel controls">
        <div className="head">CONTROLS</div>
        <div>
          <span className="k">W A S D</span> move / drive
        </div>
        <div>
          <span className="k">E</span> enter / exit car
        </div>
        <div>
          <span className="k">SPACE</span> handbrake
        </div>
        <div>
          <span className="k">R</span> restart mission
        </div>
      </div>
    </div>
  );
}
