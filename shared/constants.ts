// ---------------------------------------------------------------------------
// Tuning constants. These are shared by the authoritative server and the
// predicting client so that both run the exact same movement model.
// ---------------------------------------------------------------------------

export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3; // broadcast 20 Hz from a 60 Hz simulation
export const INTERP_DELAY = 0.1; // seconds of interpolation buffer for remotes

export const ARENA_RADIUS = 56;
export const WALL_HEIGHT = 5;
export const MATCH_SECONDS = 180;
export const RESPAWN_TIME = 3.5;
export const MAX_PLAYERS = 8;
export const BOT_FILL = 4; // keep at least this many combatants in a room

export const SHIP = {
  radius: 1.15,
  maxHealth: 100,
  maxShield: 50,
  shieldRegen: 9,
  shieldDelay: 5,
  accelSpeed: 27,
  boostSpeed: 41,
  steer: 7.5, // velocity responsiveness while steering
  coast: 4.2, // velocity responsiveness while coasting
  knockSteer: 3.2,
  boostDrain: 34,
  energyRegen: 17,
} as const;

export const WEAPON = {
  interval: 0.115,
  speed: 96,
  damage: 13,
  spread: 0.014,
  heatPerShot: 0.058,
  coolRate: 0.42,
  life: 1.5,
  radius: 0.42,
  muzzle: 1.9,
  hitRadius: 1.45,
  overdriveRate: 0.55,
  overdriveDamage: 1.5,
  overdriveTime: 8,
} as const;

export const PICKUP = {
  interval: 7.5,
  max: 7,
  radius: 1.5,
  health: 40,
} as const;

export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

// Symmetric arena furniture: cover in the middle, four corner towers,
// two long walls and a raised centre block.
export const OBSTACLES: readonly Obstacle[] = [
  { x: 0, z: 0, w: 13, d: 6, h: 7 },
  { x: 0, z: 20, w: 5, d: 5, h: 4.5 },
  { x: 0, z: -20, w: 5, d: 5, h: 4.5 },
  { x: 23, z: 19, w: 7, d: 7, h: 9 },
  { x: -23, z: 19, w: 7, d: 7, h: 9 },
  { x: 23, z: -19, w: 7, d: 7, h: 9 },
  { x: -23, z: -19, w: 7, d: 7, h: 9 },
  { x: 39, z: 0, w: 5, d: 13, h: 6 },
  { x: -39, z: 0, w: 5, d: 13, h: 6 },
  { x: 14, z: -34, w: 10, d: 4.5, h: 5 },
  { x: -14, z: 34, w: 10, d: 4.5, h: 5 },
];

export interface SpawnPoint {
  x: number;
  z: number;
}

export const SPAWNS: readonly SpawnPoint[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  return { x: Math.sin(a) * 44, z: Math.cos(a) * 44 };
});

// Palette is shared so the server-assigned colour index means the same thing
// on every client.
export const TEAM_COLORS = [
  '#3ef0ff',
  '#ff4d9d',
  '#ffc247',
  '#8b7bff',
  '#5cff9d',
  '#ff7a45',
  '#59a8ff',
  '#e2e8ff',
] as const;
