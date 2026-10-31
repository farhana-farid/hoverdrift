// ---------------------------------------------------------------------------
// World: the authoritative arena state machine.
// Server owns an instance; clients never instantiate it (they predict their own
// ship with stepPlayerMovement and interpolate snapshots).
// ---------------------------------------------------------------------------

import {
  ARENA_RADIUS,
  BOT_FILL,
  MATCH_SECONDS,
  OBSTACLES,
  PICKUP,
  RESPAWN_TIME,
  SHIP,
  SPAWNS,
  TEAM_COLORS,
  WEAPON,
} from './constants';
import { blocked, clamp, makePlayer, makeRng, stepPlayerMovement } from './sim';
import type {
  Crate,
  InputFrame,
  Pickup,
  PickupKind,
  Player,
  Projectile,
  SimEvent,
  Snapshot,
} from './types';

const ZERO_INPUT = (aim: number): InputFrame => ({
  seq: 0,
  mx: 0,
  mz: 0,
  aim,
  fire: false,
  boost: false,
});

export class World {
  players = new Map<string, Player>();
  projectiles: Projectile[] = [];
  crates: Crate[] = [];
  pickups: Pickup[] = [];
  events: SimEvent[] = [];
  inputs = new Map<string, InputFrame>();
  time = 0;
  tick = 0;
  phase: 'live' | 'ended' = 'live';

  private nextProjectileId = 1;
  private nextCrateId = 1;
  private nextPickupId = 1;
  private pickupTimer = 3;
  private rng: () => number;

  constructor(seed = Math.floor(Math.random() * 1e9)) {
    this.rng = makeRng(seed);
    this.seedCrates();
  }

  // ---------------------------------------------------------------- players
  addPlayer(id: string, name: string, bot: boolean): Player {
    const color = this.pickColor();
    const spawn = this.pickSpawn();
    const p = makePlayer(id, this.uniqueName(name), color, bot, this.players.size);
    p.x = spawn.x;
    p.z = spawn.z;
    p.heading = Math.atan2(-spawn.x, -spawn.z);
    p.aim = p.heading;
    this.players.set(id, p);
    this.events.push({ t: 'join', id, name: p.name, bot, color });
    return p;
  }

  removePlayer(id: string): void {
    if (!this.players.delete(id)) return;
    this.inputs.delete(id);
    this.events.push({ t: 'leave', id });
  }

  setInput(id: string, frame: InputFrame): void {
    this.inputs.set(id, frame);
  }

  private pickColor(): number {
    const used = new Set([...this.players.values()].map((p) => p.color));
    for (let i = 0; i < TEAM_COLORS.length; i++) if (!used.has(i)) return i;
    return this.players.size % TEAM_COLORS.length;
  }

  private uniqueName(name: string): string {
    const base = name.trim().slice(0, 14) || 'Pilot';
    const existing = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    for (let i = 2; i < 99; i++) {
      const candidate = `${base.slice(0, 11)} ${i}`;
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  private pickSpawn(): { x: number; z: number } {
    let best = SPAWNS[0];
    let bestScore = -Infinity;
    for (const s of SPAWNS) {
      let nearest = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        nearest = Math.min(nearest, Math.hypot(p.x - s.x, p.z - s.z));
      }
      const score = nearest + this.rng() * 8;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ setup
  private seedCrates(): void {
    for (let i = 0; i < 16; i++) {
      let x = 0;
      let z = 0;
      let ok = false;
      for (let attempt = 0; attempt < 40 && !ok; attempt++) {
        const a = this.rng() * Math.PI * 2;
        const r = 8 + this.rng() * (ARENA_RADIUS - 16);
        x = Math.sin(a) * r;
        z = Math.cos(a) * r;
        ok = !blocked(x, z, 3) && !this.crates.some((c) => Math.hypot(c.x - x, c.z - z) < 4.2);
      }
      if (!ok) continue;
      this.crates.push({
        id: this.nextCrateId++,
        x,
        z,
        vx: 0,
        vz: 0,
        rot: this.rng() * Math.PI,
        vr: 0,
        size: 1.9 + this.rng() * 0.9,
      });
    }
  }

  /** After a match ends the room resets: scores cleared, arena repositioned. */
  reset(): void {
    this.time = 0;
    this.tick = 0;
    this.phase = 'live';
    this.projectiles = [];
    this.pickups = [];
    this.pickupTimer = 3;
    this.crates = [];
    this.seedCrates();
    for (const p of this.players.values()) {
      const s = this.pickSpawn();
      Object.assign(p, makePlayer(p.id, p.name, p.color, p.bot, 0));
      p.x = s.x;
      p.z = s.z;
      p.kills = 0;
      p.deaths = 0;
      p.heading = Math.atan2(-s.x, -s.z);
      p.aim = p.heading;
    }
    this.events.push({ t: 'round', winner: null });
  }

  // ------------------------------------------------------------------- tick
  step(dt: number): SimEvent[] {
    this.events = [];
    this.tick++;
    this.time += dt;

    if (this.phase === 'live' && this.time >= MATCH_SECONDS) {
      this.phase = 'ended';
      const ranked = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      this.events.push({ t: 'round', winner: ranked[0]?.id ?? null });
    }

    for (const p of this.players.values()) p.invuln = Math.max(0, p.invuln - dt);

    if (this.phase === 'live') {
      for (const p of this.players.values()) {
        if (!p.alive) {
          if (this.time >= p.respawnAt) this.respawn(p);
          continue;
        }
        const input = this.inputs.get(p.id) ?? ZERO_INPUT(p.aim);
        stepPlayerMovement(p, input, dt, this.crates, this.time);
        this.tryFire(p, input, dt);
      }
    }

    this.stepProjectiles(dt);
    this.stepCrates(dt);
    if (this.phase === 'live') {
      this.stepPickups(dt);
      this.spawnPickups(dt);
    }
    return this.events;
  }

  private respawn(p: Player): void {
    const s = this.pickSpawn();
    p.x = s.x;
    p.z = s.z;
    p.vx = 0;
    p.vz = 0;
    p.health = SHIP.maxHealth;
    p.shield = SHIP.maxShield;
    p.energy = 100;
    p.heat = 0;
    p.overheated = false;
    p.overdrive = 0;
    p.alive = true;
    p.respawnAt = 0;
    p.invuln = 2.5;
    p.lastDamage = -99;
    p.heading = Math.atan2(-s.x, -s.z);
    p.aim = p.heading;
    this.events.push({ t: 'spawn', id: p.id, x: p.x, z: p.z });
  }

  private tryFire(p: Player, input: InputFrame, dt: number): void {
    if (!input.fire || p.cooldown > 0 || p.overheated) return;
    const overdrive = p.overdrive > 0;
    const jitter = (this.rng() - 0.5) * WEAPON.spread * 2;
    const aim = p.aim + jitter;
    const spd = WEAPON.speed;
    const mx = p.x + Math.sin(aim) * WEAPON.muzzle;
    const mz = p.z + Math.cos(aim) * WEAPON.muzzle;
    this.projectiles.push({
      id: this.nextProjectileId++,
      owner: p.id,
      x: mx,
      z: mz,
      y: 1.25,
      vx: Math.sin(aim) * spd + p.vx * 0.25,
      vz: Math.cos(aim) * spd + p.vz * 0.25,
      life: WEAPON.life,
      dmg: WEAPON.damage * (overdrive ? WEAPON.overdriveDamage : 1),
      overdrive,
    });
    p.cooldown = WEAPON.interval * (overdrive ? WEAPON.overdriveRate : 1);
    p.heat = clamp(p.heat + WEAPON.heatPerShot, 0, 1);
    if (p.heat >= 1) {
      p.overheated = true;
      this.events.push({ t: 'overheat', id: p.id });
    }
    this.events.push({ t: 'shoot', id: p.id, x: mx, z: mz, aim, overdrive });
  }

  private damage(target: Player, dmg: number, killer: Player | null): void {
    if (!target.alive || target.invuln > 0) return;
    target.lastDamage = this.time;
    let remaining = dmg;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    target.health -= remaining * 0.92;
    this.events.push({
      t: 'hit',
      x: target.x,
      z: target.z,
      dmg,
      target: target.id,
      by: killer?.id ?? '',
    });
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      target.respawnAt = this.time + RESPAWN_TIME;
      target.deaths++;
      target.vx *= 0.25;
      target.vz *= 0.25;
      if (killer) killer.kills++;
      this.events.push({
        t: 'kill',
        x: target.x,
        z: target.z,
        killer: killer?.id ?? '',
        victim: target.id,
      });
    }
  }

  private stepProjectiles(dt: number): void {
    const alive: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.life <= 0) continue;
      pr.x += pr.vx * dt;
      pr.z += pr.vz * dt;

      if (Math.hypot(pr.x, pr.z) > ARENA_RADIUS - 0.4) {
        this.events.push({ t: 'impact', x: pr.x, z: pr.z });
        continue;
      }

      let hit = false;
      for (const o of OBSTACLES) {
        if (
          Math.abs(pr.x - o.x) < o.w / 2 + WEAPON.radius &&
          Math.abs(pr.z - o.z) < o.d / 2 + WEAPON.radius
        ) {
          this.events.push({ t: 'impact', x: pr.x, z: pr.z });
          hit = true;
          break;
        }
      }
      if (hit) continue;

      for (const c of this.crates) {
        const rr = c.size * 0.75 + WEAPON.radius;
        const dx = pr.x - c.x;
        const dz = pr.z - c.z;
        if (dx * dx + dz * dz < rr * rr) {
          const n = Math.hypot(pr.vx, pr.vz) || 1;
          c.vx += (pr.vx / n) * 12;
          c.vz += (pr.vz / n) * 12;
          c.vr += (this.rng() - 0.5) * 5;
          this.events.push({ t: 'crate', x: pr.x, z: pr.z });
          hit = true;
          break;
        }
      }
      if (hit) continue;

      for (const target of this.players.values()) {
        if (!target.alive || target.id === pr.owner) continue;
        const dx = pr.x - target.x;
        const dz = pr.z - target.z;
        if (dx * dx + dz * dz < WEAPON.hitRadius * WEAPON.hitRadius) {
          const killer = this.players.get(pr.owner) ?? null;
          this.damage(target, pr.dmg, killer);
          hit = true;
          break;
        }
      }
      if (!hit) alive.push(pr);
    }
    this.projectiles = alive;
  }

  private stepCrates(dt: number): void {
    for (const c of this.crates) {
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.rot += c.vr * dt;
      const damp = Math.exp(-2.1 * dt);
      c.vx *= damp;
      c.vz *= damp;
      c.vr *= Math.exp(-3.2 * dt);

      const dist = Math.hypot(c.x, c.z);
      const limit = ARENA_RADIUS - c.size * 0.7;
      if (dist > limit) {
        const nx = c.x / dist;
        const nz = c.z / dist;
        c.x = nx * limit;
        c.z = nz * limit;
        const vn = c.vx * nx + c.vz * nz;
        if (vn > 0) {
          c.vx -= vn * nx * 1.45;
          c.vz -= vn * nz * 1.45;
          if (Math.abs(vn) > 6) this.events.push({ t: 'impact', x: c.x, z: c.z });
        }
      }

      for (const o of OBSTACLES) {
        const minX = o.x - o.w / 2;
        const maxX = o.x + o.w / 2;
        const minZ = o.z - o.d / 2;
        const maxZ = o.z + o.d / 2;
        const cx = clamp(c.x, minX, maxX);
        const cz = clamp(c.z, minZ, maxZ);
        const dx = c.x - cx;
        const dz = c.z - cz;
        const r = c.size * 0.7;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const d = Math.sqrt(d2) || 0.0001;
        const nx = d2 > 1e-6 ? dx / d : 1;
        const nz = d2 > 1e-6 ? dz / d : 0;
        const pen = r - d;
        c.x += nx * pen;
        c.z += nz * pen;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) {
          c.vx -= vn * nx * 1.35;
          c.vz -= vn * nz * 1.35;
        }
      }
    }

    // Crate vs crate separation (few bodies, cheap and stable enough).
    for (let i = 0; i < this.crates.length; i++) {
      for (let j = i + 1; j < this.crates.length; j++) {
        const a = this.crates[i];
        const b = this.crates[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const min = (a.size + b.size) * 0.7;
        const d2 = dx * dx + dz * dz;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = (min - d) * 0.5;
        a.x -= nx * pen;
        a.z -= nz * pen;
        b.x += nx * pen;
        b.z += nz * pen;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const imp = rel * 0.55;
          a.vx += nx * imp;
          a.vz += nz * imp;
          b.vx -= nx * imp;
          b.vz -= nz * imp;
        }
      }
    }
  }

  private spawnPickups(dt: number): void {
    this.pickupTimer -= dt;
    if (this.pickupTimer > 0 || this.pickups.length >= PICKUP.max) return;
    this.pickupTimer = PICKUP.interval;
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = this.rng() * Math.PI * 2;
      const r = 6 + this.rng() * (ARENA_RADIUS - 14);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (blocked(x, z, 2.6)) continue;
      if (this.crates.some((c) => Math.hypot(c.x - x, c.z - z) < 3)) continue;
      if (this.pickups.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) continue;
      const roll = this.rng();
      const kind: PickupKind = roll < 0.5 ? 'health' : roll < 0.8 ? 'energy' : 'overdrive';
      this.pickups.push({ id: this.nextPickupId++, kind, x, z, born: this.time });
      return;
    }
  }

  private stepPickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - pk.x, p.z - pk.z) > PICKUP.radius + SHIP.radius) continue;
        if (pk.kind === 'health') p.health = clamp(p.health + PICKUP.health, 0, SHIP.maxHealth);
        if (pk.kind === 'energy') {
          p.energy = 100;
          p.heat = 0;
          p.overheated = false;
        }
        if (pk.kind === 'overdrive') p.overdrive = WEAPON.overdriveTime;
        this.events.push({ t: 'pickup', x: pk.x, z: pk.z, kind: pk.kind, id: p.id });
        this.pickups.splice(i, 1);
        break;
      }
    }
  }

  // --------------------------------------------------------------- snapshots
  snapshot(ack: number, serverTime: number): Snapshot {
    return {
      tick: this.tick,
      time: this.time,
      phase: this.phase,
      serverTime,
      ack,
      players: [...this.players.values()],
      projectiles: this.projectiles,
      crates: this.crates,
      pickups: this.pickups,
      events: this.events,
    };
  }

  get humans(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  get capacity(): number {
    return BOT_FILL + 4;
  }
}
