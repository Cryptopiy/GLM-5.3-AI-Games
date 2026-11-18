/** Axis-aligned bounding box on the XZ plane (buildings, walls). */
export interface AABB {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** Static circular obstacle (trees, hydrants, lamps). */
export interface ObstacleCircle {
  x: number;
  z: number;
  r: number;
}

export type NotifKind = 'good' | 'bad' | 'info' | 'gold';

export interface HudNotification {
  id: number;
  text: string;
  kind: NotifKind;
}

export interface HudBanner {
  kind: 'passed' | 'failed';
  title: string;
  sub: string;
}

export interface HudState {
  mode: 'ON FOOT' | 'DRIVING';
  speedKmh: number;
  carHp: number | null;
  objective: string;
  missionTimer: number | null;
  wanted: number;
  escapeProgress: number; // 0..1, how close the player is to losing a star
  hint: string | null;
  banner: HudBanner | null;
  notifications: HudNotification[];
}
