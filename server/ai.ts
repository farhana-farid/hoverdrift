// ---------------------------------------------------------------------------
// Server-side bots. They only produce InputFrames, so they are bound by the
// exact same movement/weapon rules as human players (no cheating, no teleport).
// ---------------------------------------------------------------------------

import { ARENA_RADIUS, OBSTACLES, WEAPON } from '../shared/constants';
import { blocked, lerpAngle } from '../shared/sim';
import type { InputFrame, Player } from '../shared/types';
import type { World } from '../shared/world';

export interface BotBrain {
  strafe: number;
  nextFlip: number;
  error: number;
  errorTarget: number;
  aggression: number;
  reaction: number;
  lastSeen: string | null;
  burst: number;
  resting: boolean;
  targetId: string | null;
  acquire: number;
}

export function makeBrain(): BotBrain {
  return {
    strafe: Math.random() < 0.5 ? 1 : -1,
    nextFlip: 1 + Math.random() * 2,
    error: (Math.random() - 0.5) * 0.25,
    errorTarget: (Math.random() - 0.5) * 0.25,
    aggression: 0.15 + Math.random() * 0.3,
    reaction: 0.2 + Math.random() * 0.25,
    lastSeen: null,
    burst: 0.8 + Math.random() * 1.2,
    resting: false,
    targetId: null,
    acquire: 0.7 + Math.random() * 0.3,
  };
}

function lineBlocked(x1: number, z1: number, x2: number, z2: number): boolean {
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    for (const o of OBSTACLES) {
      if (Math.abs(x - o.x) < o.w / 2 + 0.5 && Math.abs(z - o.z) < o.d / 2 + 0.5) return true;
    }
  }
  return false;
}

export function updateBot(world: World, bot: Player, brain: BotBrain, dt: number): InputFrame {
  const time = world.time;

  let target: Player | null = null;
  let bestScore = Infinity;
  for (const p of world.players.values()) {
    if (p.id === bot.id || !p.alive) continue;
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    // Prefer humans slightly: bots gang up on the player enough to feel alive.
    const score = d * (p.bot ? 1.08 : 0.95);
    if (score < bestScore) {
      bestScore = score;
      target = p;
    }
  }

  if (!target) {
    return {
      seq: 0,
      mx: Math.sin(time * 0.7) * 0.6,
      mz: Math.cos(time * 0.7) * 0.6,
      aim: bot.aim + 0.01,
      fire: false,
      boost: false,
    };
  }

  // Fresh targets must be acquired before shooting: nothing feels cheaper than
  // being lasered the frame a bot sees you.
  if (brain.targetId !== target.id) {
    brain.targetId = target.id;
    brain.acquire = 0.35 + Math.random() * 0.45;
    brain.resting = false;
    brain.burst = 0.5 + Math.random() * 0.5;
  }
  brain.acquire = Math.max(0, brain.acquire - dt);

  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dirX = dx / dist;
  const dirZ = dz / dist;

  // Lead the target based on projectile travel time.
  const travel = dist / WEAPON.speed;
  const aimX = target.x + target.vx * travel * 0.85 - bot.x;
  const aimZ = target.z + target.vz * travel * 0.85 - bot.z;
  let aim = Math.atan2(aimX, aimZ);

  brain.nextFlip -= dt;
  if (brain.nextFlip <= 0) {
    brain.strafe *= -1;
    brain.nextFlip = 1.1 + Math.random() * 2.2;
    // Bots get less accurate the further away the target is.
    brain.errorTarget = (Math.random() - 0.5) * (0.1 + Math.min(0.34, dist * 0.0075));
  }

  // Burst discipline: bots fire in bursts with recovery gaps so incoming
  // damage is readable and survivable instead of a continuous laser.
  brain.burst -= dt;
  if (brain.burst <= 0) {
    brain.resting = !brain.resting;
    brain.burst = brain.resting ? 0.85 + Math.random() * 1.1 : 0.4 + Math.random() * 0.5;
  }
  brain.error = lerpAngle(brain.error, brain.errorTarget, Math.min(1, dt * 2.2));
  aim += brain.error;

  // Desired engagement band: orbit at ~22 units, close in when aggressive.
  const desired = 30 - brain.aggression * 16;
  let radial = dist > desired + 5 ? 1 : dist < desired - 6 ? -0.85 : 0.1;
  if (dist > 52) radial = 1;

  const strafeWeight = dist < 38 ? 0.85 : 0.4;
  let mx = dirX * radial + -dirZ * brain.strafe * strafeWeight;
  let mz = dirZ * radial + dirX * brain.strafe * strafeWeight;

  // Wall and cover avoidance: probe ahead, then lean toward the arena centre.
  const probeX = bot.x + mx * 6;
  const probeZ = bot.z + mz * 6;
  if (blocked(probeX, probeZ, 2.6) || Math.hypot(probeX, probeZ) > ARENA_RADIUS - 4) {
    const toCenterX = -bot.x / (Math.hypot(bot.x, bot.z) || 1);
    const toCenterZ = -bot.z / (Math.hypot(bot.x, bot.z) || 1);
    mx = mx * 0.15 + toCenterX * 0.9 - dirZ * brain.strafe * 0.5;
    mz = mz * 0.15 + toCenterZ * 0.9 + dirX * brain.strafe * 0.5;
  }

  const len = Math.hypot(mx, mz) || 1;
  mx /= len;
  mz /= len;

  let angleDiff = ((aim - bot.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const canSee = !lineBlocked(bot.x, bot.z, target.x, target.z);
  const fire =
    canSee &&
    brain.acquire <= 0 &&
    !brain.resting &&
    Math.abs(angleDiff) < 0.2 &&
    dist < 46 &&
    !bot.overheated;
  const boost = bot.energy > 25 && dist > 34 && brain.aggression > 0.5;

  return {
    seq: 0,
    mx,
    mz,
    aim,
    fire,
    boost,
  };
}
