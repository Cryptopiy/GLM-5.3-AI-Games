import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import type { HudState } from '../game/types';
import Hud from './Hud';

/** Mounts the Three.js game into a DOM container and renders the React HUD
 *  on top of it. The game owns all simulation state; React only displays
 *  immutable HUD snapshots. */
export default function GameCanvas() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const hudRef = useRef(setHud);
  hudRef.current = setHud;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const game = new Game(mount, (s) => hudRef.current(s));
    game.start();
    return () => game.dispose();
  }, []);

  return (
    <div className="game-root">
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {hud && <Hud state={hud} />}
    </div>
  );
}
