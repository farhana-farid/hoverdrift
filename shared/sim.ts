// ---------------------------------------------------------------------------
// Authoritative simulation. Pure data in / pure data out so the same module
// runs on the Node server (truth) and in the browser (prediction).
// ---------------------------------------------------------------------------

import {
  ARENA_RADIUS,
  MATCH_SECONDS,
  OBSTACLES,
  PICKUP,
  RESPAWN_TIME,
  SHIP,
  SPAWNS,
  TEAM_COLORS,
  WEAPON,
  type Obstacle,
} from './constants';
import type { Crate, InputFrame, Pickup, PickupKind, Player, Projectile, SimEvent } from './types';

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest-path angle interpolation (keeps heading changes smooth). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Deterministic PRNG (mulberry32) so arena furniture is identical per room seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CircleHit {
  nx: number;
  nz: number;
  pen: number;
}

/** Circle vs axis-aligned box, returns the push-out vector if overlapping. */
export function circleVsBox(px: number, pz: number, r: number, o: Obstacle): CircleHit | null {
  const minX = o.x - o.w / 2;
  const maxX = o.x + o.w / 2;
  const minZ = o.z - o.d / 2;
  const maxZ = o.z + o.d / 2;
  const cx = clamp(px, minX, maxX);
  const cz = clamp(pz, minZ, maxZ);
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, pen: r - d };
  }
  // Centre is inside the box: eject through the closest face.
  const left = px - minX;
  const right = maxX - px;
  const near = pz - minZ;
  const far = maxZ - pz;
  const m = Math.min(left, right, near, far);
  if (m === left) return { nx: -1, nz: 0, pen: left + r };
  if (m === right) return { nx: 1, nz: 0, pen: right + r };
  if (m === near) return { nx: 0, nz: -1, pen: near + r };
  return { nx: 0, nz: 1, pen: far + r };
}

export function pointInBox(x: number, z: number, o: Obstacle, pad = 0): boolean {
  return (
    Math.abs(x - o.x) <= o.w / 2 + pad && Math.abs(z - o.z) <= o.d / 2 + pad
  );
}

export function blocked(x: number, z: number, pad: number): boolean {
  for (const o of OBSTACLES) if (pointInBox(x, z, o, pad)) return true;
  return Math.hypot(x, z) > ARENA_RADIUS - pad;
}

export function makePlayer(
  id: string,
  name: string,
  color: number,
  bot: boolean,
  spawnIndex = 0,
): Player {
  const s = SPAWNS[spawnIndex % SPAWNS.length];
  return {
    id,
    name,
    color,
    bot,
    x: s.x,
    z: s.z,
    vx: 0,
    vz: 0,
    heading: Math.atan2(-s.x, -s.z),
    aim: Math.atan2(-s.x, -s.z),
    health: SHIP.maxHealth,
    shield: SHIP.maxShield,
    energy: 100,
    heat: 0,
    overheated: false,
    cooldown: 0,
    lastDamage: -99,
    invuln: 2.5,
    overdrive: 0,
    alive: true,
    respawnAt: 0,
    kills: 0,
    deaths: 0,
  };
}

/**
 * The shared movement model. Called by the server every tick and by the
 * predicting client for its own ship. Velocity is steered toward a target
 * velocity instead of integrated with acceleration so the feel is identical at
 * any framerate and reconciliation converges quickly.
 */
export function stepPlayerMovement(
  p: Player,
  input: InputFrame,
  dt: number,
  crates: Crate[],
  time: number,
): void {
  const mag = Math.min(1, Math.hypot(input.mx, input.mz));
  const wantBoost = input.boost && p.energy > 0.5 && mag > 0.15;
  p.energy = clamp(
    p.energy + (wantBoost ? -SHIP.boostDrain : SHIP.energyRegen) * dt,
    0,
    100,
  );

  const speed = wantBoost ? SHIP.boostSpeed : SHIP.accelSpeed;
  let tx = 0;
  let tz = 0;
  if (mag > 0.02) {
    const inv = mag > 1 ? 1 / mag : 1;
    tx = input.mx * inv * speed;
    tz = input.mz * inv * speed;
  }
  const steer = mag > 0.15 ? SHIP.steer : SHIP.coast;
  const k = Math.min(1, steer * dt);
  p.vx += (tx - p.vx) * k;
  p.vz += (tz - p.vz) * k;

  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // --- static geometry -----------------------------------------------------
  for (const o of OBSTACLES) {
    const hit = circleVsBox(p.x, p.z, SHIP.radius, o);
    if (!hit) continue;
    p.x += hit.nx * hit.pen;
    p.z += hit.nz * hit.pen;
    const vn = p.vx * hit.nx + p.vz * hit.nz;
    if (vn < 0) {
      p.vx -= vn * hit.nx * 1.4;
      p.vz -= vn * hit.nz * 1.4;
    }
  }

  // --- arena wall ----------------------------------------------------------
  const dist = Math.hypot(p.x, p.z);
  const limit = ARENA_RADIUS - SHIP.radius;
  if (dist > limit) {
    const nx = p.x / dist;
    const nz = p.z / dist;
    p.x = nx * limit;
    p.z = nz * limit;
    const vn = p.vx * nx + p.vz * nz;
    if (vn > 0) {
      p.vx -= vn * nx * 1.35;
      p.vz -= vn * nz * 1.35;
    }
  }

  // --- physics props -------------------------------------------------------
  for (const c of crates) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const rr = SHIP.radius + c.size * 0.72;
    const d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const pen = rr - d;
    // Heavy crates: the ship gives a little, the crate gives more.
    p.x += nx * pen * 0.35;
    p.z += nz * pen * 0.35;
    c.x -= nx * pen * 0.65;
    c.z -= nz * pen * 0.65;
    const push = Math.max(0, -(p.vx * nx + p.vz * nz));
    c.vx -= nx * push * 0.85;
    c.vz -= nz * push * 0.85;
    c.vr += (nx * p.vz - nz * p.vx) * 0.02;
  }

  // --- facing --------------------------------------------------------------
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > 3) {
    const target = Math.atan2(p.vx, p.vz);
    p.heading = lerpAngle(p.heading, target, Math.min(1, 6 * dt));
  }
  p.aim = input.aim;
  p.cooldown = Math.max(0, p.cooldown - dt);
  p.overdrive = Math.max(0, p.overdrive - dt);
  if (time - p.lastDamage >= SHIP.shieldDelay) {
    p.shield = clamp(p.shield + SHIP.shieldRegen * dt, 0, SHIP.maxShield);
  }
  p.heat = clamp(p.heat - WEAPON.coolRate * dt, 0, 1);
  if (p.overheated && p.heat <= 0.02) p.overheated = false;
  if (p.overdrive <= 0) p.overdrive = 0;
}
