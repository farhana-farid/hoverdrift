// ---------------------------------------------------------------------------
// Session: the bridge between the socket, the simulation and the renderer.
//
//   inputs  → 60 Hz local prediction (shared movement model) → server
//   server  → 20 Hz snapshots → reconcile own ship, interpolate everyone else
//   events  → audio + VFX + HUD feed
// ---------------------------------------------------------------------------

import {
  FIXED_DT,
  INTERP_DELAY,
  MATCH_SECONDS,
  TEAM_COLORS,
  WEAPON,
} from '../../shared/constants';
import { lerpAngle, stepPlayerMovement } from '../../shared/sim';
import type {
  Crate,
  InputFrame,
  Pickup,
  Player,
  Projectile,
  SimEvent,
  Snapshot,
} from '../../shared/types';
import { InputController } from '../input/input';
import { NetClient } from '../net/client';
import { store, type FeedItem, type ScoreRow } from '../store';
import { audio } from './audio';
import { Engine, type Quality, type ViewPlayer, type ViewState } from './engine';
import * as THREE from 'three';

const clonePlayer = (p: Player): Player => ({ ...p });
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Buffered {
  snap: Snapshot;
  at: number;
}

export class GameSession {
  readonly engine: Engine;
  private input: InputController;
  private net: NetClient;
  private quality: Quality;

  private localId: string | null = null;
  private buffer: Buffered[] = [];
  private latest: Snapshot | null = null;
  private latestAt = 0;

  private predicted: Player | null = null;
  private pending: InputFrame[] = [];
  private seq = 0;
  private aim = 0;
  private fireCd = 0;
  private crateScratch: Crate[] = [];
  private renderOffset = { x: 0, z: 0 };
  private joined = false;
  private paused = false;
  private localBoost = false;

  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private running = true;
  private feed: FeedItem[] = [];
  private feedSeq = 1;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private hudAt = 0;
  private lastNoticeAt = 0;

  private view: ViewState = {
    time: 0,
    localId: null,
    players: [],
    projectiles: [],
    crates: [],
    pickups: [],
    localBoosting: false,
  };

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.engine = new Engine(canvas, quality);
    this.engine.setPrefs(store.get().settings);
    this.input = new InputController(canvas, {
      onPause: () => this.togglePause(),
      onAnyInput: () => audio.resume(),
    });
    this.net = new NetClient({
      onWelcome: (you, snap) => {
        this.localId = you;
        this.latest = snap;
        this.latestAt = performance.now();
        this.view.localId = you;
        store.patchHud({ status: 'live', you });
      },
      onSnapshot: (snap) => this.onSnapshot(snap),
      onStatus: (status, reason) => {
        if (status === 'open') return; // wait for the welcome snapshot
        store.patchHud({ status });
        if (status === 'closed') {
          this.joined = false;
          this.localBoost = false;
          audio.silence();
          store.patch({ paused: true });
          store.patchHud({
            notice: reason ? `Connection lost: ${reason}` : 'Connection lost',
          });
        }
      },
    });

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ------------------------------------------------------------------ public
  join(name: string) {
    audio.resume();
    audio.setVolume(store.get().settings.volume);
    store.resetHud();
    store.patch({ screen: 'game', paused: false });
    this.localId = null;
    this.predicted = null;
    this.pending = [];
    this.buffer = [];
    this.latest = null;
    this.feed = [];
    this.seq = 0;
    this.aim = 0;
    this.joined = true;
    this.paused = false;
    store.patchHud({ status: 'connecting', notice: null });
    this.net.connect(name.trim() || 'Pilot');
  }

  leave() {
    this.joined = false;
    this.net.close();
    this.localId = null;
    this.predicted = null;
    this.buffer = [];
    this.latest = null;
    this.feed = [];
    this.view = { ...this.view, localId: null, players: [], projectiles: [] };
    audio.silence();
    store.resetHud();
    store.patch({ screen: 'menu', paused: false });
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.engine.setQuality(q);
  }

  applySettings() {
    const s = store.get().settings;
    this.engine.setPrefs(s);
    audio.setVolume(s.volume);
  }

  togglePause() {
    if (!this.joined) return;
    this.setPaused(!this.paused);
    audio.ui(!this.paused);
  }

  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    this.paused = paused;
    store.patch({ paused });
    if (!paused) {
      // Drop stale inputs so prediction resumes from authority.
      this.pending = [];
      this.acc = 0;
    } else {
      this.sendNeutralInput();
      audio.silence();
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.net.close();
    this.engine.dispose();
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.sendNeutralInput();
      if (this.joined && !this.paused) this.setPaused(true);
    }
  };

  private sendNeutralInput() {
    const frame: InputFrame = {
      seq: ++this.seq,
      mx: 0,
      mz: 0,
      aim: this.predicted?.aim ?? 0,
      fire: false,
      boost: false,
    };
    this.net.sendInput(frame);
  }

  // ------------------------------------------------------------------ network
  private onSnapshot(snap: Snapshot) {
    this.latest = snap;
    this.latestAt = performance.now();
    this.buffer.push({ snap, at: performance.now() });
    if (this.buffer.length > 16) this.buffer.shift();
    this.processEvents(snap.events);
    this.reconcile(snap);
  }

  private reconcile(snap: Snapshot) {
    if (!this.localId) return;
    const auth = snap.players.find((p) => p.id === this.localId);
    if (!auth) return;

    const prev = this.predicted;
    this.pending = this.pending.filter((f) => f.seq > snap.ack);
    const next = clonePlayer(auth);
    for (let i = 0; i < this.pending.length; i++) {
      stepPlayerMovement(next, this.pending[i], FIXED_DT, snap.crates, snap.time + i * FIXED_DT);
    }

    if (prev && prev.alive && next.alive) {
      const dx = prev.x - next.x;
      const dz = prev.z - next.z;
      const err = Math.hypot(dx, dz);
      if (err < 6) {
        // Hide the correction: shift the render offset, then let it decay.
        this.renderOffset.x += dx;
        this.renderOffset.z += dz;
        const mag = Math.hypot(this.renderOffset.x, this.renderOffset.z);
        if (mag > 6) {
          this.renderOffset.x *= 6 / mag;
          this.renderOffset.z *= 6 / mag;
        }
      } else {
        this.renderOffset = { x: 0, z: 0 };
      }
    } else {
      this.renderOffset = { x: 0, z: 0 };
      this.aim = next.aim;
    }

    this.predicted = next;
    this.crateScratch = snap.crates.map((c) => ({ ...c }));
  }

  // ---------------------------------------------------------------- prediction
  private worldTimeEst(): number {
    if (!this.latest) return 0;
    return this.latest.time + (performance.now() - this.latestAt) / 1000;
  }

  private predictStep() {
    const p = this.predicted;
    if (!p || !p.alive || this.paused) return;

    const settings = store.get().settings;
    const sample = this.input.sample(this.engine.camYaw, settings.invertStick);

    let aimTarget = p.aim;
    if (sample.aim !== null) {
      aimTarget = sample.aim;
    } else if (sample.pointer) {
      aimTarget = this.engine.screenToAim(sample.pointer.x, sample.pointer.y, p.x, p.z, p.aim);
    }
    const smoothing = clamp(8 + 24 * settings.sensitivity, 4, 60);
    this.aim = lerpAngle(this.aim, aimTarget, Math.min(1, smoothing * FIXED_DT));

    const frame: InputFrame = {
      seq: ++this.seq,
      mx: sample.mx,
      mz: sample.mz,
      aim: this.aim,
      fire: sample.fire,
      boost: sample.boost,
    };
    stepPlayerMovement(p, frame, FIXED_DT, this.crateScratch, this.worldTimeEst());
    this.pending.push(frame);
    if (this.pending.length > 180) this.pending.shift();
    this.net.sendInput(frame);

    // Local muzzle flash + sound fire instantly, independent of round trip.
    this.fireCd -= FIXED_DT;
    if (frame.fire && !p.overheated && this.fireCd <= 0) {
      const color = TEAM_COLORS[p.color] ?? '#3ef0ff';
      this.engine.muzzle(p.x, p.z, p.aim, color);
      audio.shoot(p.overdrive > 0);
      this.input.rumble(0.12, 45);
      this.fireCd = WEAPON.interval * (p.overdrive > 0 ? WEAPON.overdriveRate : 1);
    }
    this.localBoost = sample.boost && Math.hypot(p.vx, p.vz) > 4;
    audio.setBoost(this.localBoost);
  }

  // ------------------------------------------------------------- interpolation
  private interpolate(): {
    players: Player[];
    projectiles: Projectile[];
    crates: Crate[];
    pickups: Pickup[];
  } {
    const snaps = this.buffer;
    if (!snaps.length) return { players: [], projectiles: [], crates: [], pickups: [] };
    const target = performance.now() - INTERP_DELAY * 1000;

    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].at <= target && snaps[i + 1].at >= target) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    if (target <= snaps[0].at) {
      a = b = snaps[0];
    }
    const span = Math.max(1, b.at - a.at);
    const alpha = clamp((target - a.at) / span, 0, 1);
    const ahead = Math.max(0, Math.min(0.12, (target - b.at) / 1000));

    const players = a.snap.players.map((pa) => {
      const pb = b.snap.players.find((x) => x.id === pa.id) ?? pa;
      const out = clonePlayer(pb);
      out.x = pa.x + (pb.x - pa.x) * alpha + pb.vx * ahead;
      out.z = pa.z + (pb.z - pa.z) * alpha + pb.vz * ahead;
      out.heading = lerpAngle(pa.heading, pb.heading, alpha);
      out.aim = lerpAngle(pa.aim, pb.aim, alpha);
      return out;
    });

    const projectiles = b.snap.projectiles.map((pr) => {
      const prev = a.snap.projectiles.find((x) => x.id === pr.id);
      if (!prev) {
        return {
          ...pr,
          x: pr.x + pr.vx * (ahead + INTERP_DELAY),
          z: pr.z + pr.vz * (ahead + INTERP_DELAY),
        };
      }
      return {
        ...pr,
        x: prev.x + (pr.x - prev.x) * alpha + pr.vx * (ahead + INTERP_DELAY),
        z: prev.z + (pr.z - prev.z) * alpha + pr.vz * (ahead + INTERP_DELAY),
      };
    });

    const crates = b.snap.crates.map((c) => {
      const prev = a.snap.crates.find((x) => x.id === c.id);
      if (!prev) return c;
      return {
        ...c,
        x: prev.x + (c.x - prev.x) * alpha,
        z: prev.z + (c.z - prev.z) * alpha,
        rot: prev.rot + (c.rot - prev.rot) * alpha,
      };
    });

    return { players, projectiles, crates, pickups: b.snap.pickups };
  }

  private buildView(dt: number) {
    const { players, projectiles, crates, pickups } = this.interpolate();
    const decay = Math.exp(-9 * dt);
    this.renderOffset.x *= decay;
    this.renderOffset.z *= decay;

    const views: ViewPlayer[] = [];
    for (const p of players) {
      if (p.id === this.localId) continue;
      views.push({
        id: p.id,
        name: p.name,
        color: TEAM_COLORS[p.color] ?? '#8b7bff',
        x: p.x,
        z: p.z,
        vx: p.vx,
        vz: p.vz,
        heading: p.heading,
        aim: p.aim,
        alive: p.alive,
        shield: p.shield,
        health: p.health,
        overdrive: p.overdrive,
        boosting: p.alive && Math.hypot(p.vx, p.vz) > 30,
      });
    }

    const me = this.predicted;
    if (me && this.localId) {
      views.push({
        id: me.id,
        name: me.name,
        color: TEAM_COLORS[me.color] ?? '#3ef0ff',
        x: me.x + this.renderOffset.x,
        z: me.z + this.renderOffset.z,
        vx: me.vx,
        vz: me.vz,
        heading: me.heading,
        aim: me.aim,
        alive: me.alive,
        shield: me.shield,
        health: me.health,
        overdrive: me.overdrive,
        boosting: this.localBoost,
      });
    }

    this.view = {
      time: this.worldTimeEst(),
      localId: this.localId,
      players: views,
      projectiles: projectiles.map((pr) => ({
        id: pr.id,
        x: pr.x,
        z: pr.z,
        vx: pr.vx,
        vz: pr.vz,
        overdrive: pr.overdrive,
        owner: pr.owner,
      })),
      crates: crates.map((c) => ({ id: c.id, x: c.x, z: c.z, rot: c.rot, size: c.size })),
      pickups: pickups.map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, born: p.born })),
      localBoosting: this.localBoost,
    };
  }

  // -------------------------------------------------------------------- events
  private processEvents(events: SimEvent[]) {
    const me = this.localId;
    const myPos = this.predicted;
    for (const e of events) {
      switch (e.t) {
        case 'shoot': {
          const near = myPos ? Math.hypot(e.x - myPos.x, e.z - myPos.z) < 55 : false;
          if (near) {
            audio.shoot(e.overdrive);
            this.engine.effects.burst(e.x, 1.1, e.z, e.overdrive ? '#ffb8e6' : '#bff8ff', 3, 5, 0.7);
          }
          break;
        }
        case 'hit': {
          if (e.target === me) {
            store.patchHud({ damageFlash: performance.now() });
            audio.damaged();
            this.engine.addShake(0.34);
            this.input.rumble(0.55, 130);
            this.engine.effects.burst(e.x, 1.2, e.z, '#ff5b7a', 9, 9, 1);
          } else {
            if (e.by === me) {
              store.patchHud({ hitMarker: performance.now() });
              audio.hit();
              this.input.rumble(0.14, 50);
            }
            this.engine.effects.burst(e.x, 1.2, e.z, '#ffb27a', 7, 8, 0.9);
          }
          break;
        }
        case 'kill': {
          const victim = this.latest?.players.find((p) => p.id === e.victim);
          const killer = this.latest?.players.find((p) => p.id === e.killer);
          const color = victim ? TEAM_COLORS[victim.color] ?? '#ff7a45' : '#ff7a45';
          this.engine.effects.debris(e.x, 1.4, e.z, new THREE.Color(color), 8);
          this.engine.effects.burst(e.x, 1.4, e.z, color, 42, 20, 2.4);
          this.engine.effects.burst(e.x, 1.4, e.z, '#fff2c4', 18, 12, 1.6);
          this.engine.effects.ring(e.x, e.z, color, 16, 0.7);
          this.engine.effects.flash(e.x, 2.2, e.z, color, 18, 0.35);
          const dist = myPos ? Math.hypot(e.x - myPos.x, e.z - myPos.z) : 100;
          this.engine.addShake(clamp(1.2 - dist / 60, 0.12, 0.9));
          audio.explode();
          this.input.rumble(clamp(0.9 - dist / 80, 0.15, 0.9), 250);

          if (e.killer === me) {
            store.patchHud({ killFlash: performance.now() });
            audio.kill();
            const name = victim?.name ?? 'target';
            this.pushFeed({ text: `ELIMINATED ${name.toUpperCase()}`, color: '#7dffb0' });
          } else if (e.victim === me) {
            store.patchHud({ damageFlash: performance.now() });
            this.pushFeed({ text: `DOWNED BY ${(killer?.name ?? 'FIELD').toUpperCase()}`, color: '#ff6b8a' });
            this.renderOffset = { x: 0, z: 0 };
          } else if (victim && killer) {
            this.pushFeed({ text: `${killer.name} → ${victim.name}`, color: '#ffb27a' });
          }
          break;
        }
        case 'impact': {
          const dist = myPos ? Math.hypot(e.x - myPos.x, e.z - myPos.z) : 100;
          if (dist < 60) {
            this.engine.effects.burst(e.x, 1.15, e.z, '#9fe8ff', 5, 7, 0.8);
            this.engine.effects.ring(e.x, e.z, '#4bd8ff', 2.6, 0.35);
          }
          break;
        }
        case 'crate': {
          this.engine.effects.burst(e.x, 1.4, e.z, '#ffd08a', 8, 9, 1);
          this.engine.effects.ring(e.x, e.z, '#ffb464', 3, 0.3);
          break;
        }
        case 'pickup': {
          this.engine.effects.ring(e.x, e.z, e.kind === 'health' ? '#5cff9d' : e.kind === 'energy' ? '#3ef0ff' : '#ff4d9d', 6, 0.5);
          this.engine.effects.flash(e.x, 1.6, e.z, '#ffffff', 4, 0.2);
          if (e.id === me) {
            audio.pickup(e.kind);
            this.input.rumble(0.2, 90);
            this.pushFeed({
              text:
                e.kind === 'health' ? 'REPAIRED +40 HULL' : e.kind === 'energy' ? 'CORE RECHARGED' : 'OVERDRIVE ONLINE',
              color: e.kind === 'health' ? '#5cff9d' : e.kind === 'energy' ? '#3ef0ff' : '#ff4d9d',
            });
          }
          break;
        }
        case 'spawn': {
          this.engine.effects.ring(e.x, e.z, '#8fe9ff', 7, 0.6);
          this.engine.effects.flash(e.x, 1.4, e.z, '#a8f6ff', 5, 0.25);
          break;
        }
        case 'overheat': {
          if (e.id === me) {
            audio.ui(false);
            this.notice('WEAPON OVERHEATED — COOL DOWN');
          }
          break;
        }
        case 'join': {
          if (!e.bot && e.id !== me) this.pushFeed({ text: `${e.name.toUpperCase()} JOINED`, color: '#9fd7ff' });
          break;
        }
        case 'leave': {
          const p = this.latest?.players.find((x) => x.id === e.id);
          if (p && !p.bot) this.pushFeed({ text: `${p.name.toUpperCase()} LEFT`, color: '#8fa3bb' });
          break;
        }
        case 'round': {
          const winner = e.winner ? this.latest?.players.find((p) => p.id === e.winner) : null;
          const win = !!winner && winner.id === me;
          setTimeout(() => audio.roundEnd(win), 200);
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------- touch input
  setTouchMove(x: number, y: number) {
    this.input.setTouchMove(x, y);
  }

  setTouchAim(x: number, y: number, active: boolean) {
    this.input.setTouchAim(x, y, active);
  }

  setTouchBoost(on: boolean) {
    this.input.touchBoost = on;
  }

  private notice(text: string) {
    const now = performance.now();
    if (now - this.lastNoticeAt < 600) return;
    this.lastNoticeAt = now;
    store.patchHud({ notice: text });
    setTimeout(() => {
      if (store.get().hud.notice === text) store.patchHud({ notice: null });
    }, 1800);
  }

  private pushFeed(item: Omit<FeedItem, 'id' | 'at'>) {
    this.feed.unshift({ ...item, id: this.feedSeq++, at: performance.now() });
    this.feed = this.feed.slice(0, 5);
  }

  // ---------------------------------------------------------------------- HUD
  private hudTick(now: number, dt: number) {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (now - this.hudAt < 100) return;
    this.hudAt = now;

    const fps = this.fpsAcc > 0 ? Math.round(this.fpsFrames / this.fpsAcc) : 0;
    this.fpsAcc = 0;
    this.fpsFrames = 0;

    const snap = this.latest;
    const me = this.predicted;
    const cutoff = now - 6000;
    this.feed = this.feed.filter((f) => f.at > cutoff);

    const rows: ScoreRow[] = (snap?.players ?? [])
      .map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        color: TEAM_COLORS[p.color] ?? '#9fd7ff',
        bot: p.bot,
        alive: p.alive,
        you: p.id === this.localId,
      }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);

    const winner = snap?.phase === 'ended' ? rows[0]?.name ?? null : null;

    store.patchHud({
      status: snap ? 'live' : store.get().hud.status,
      scoreboard: rows,
      timeLeft: snap ? Math.max(0, MATCH_SECONDS - snap.time) : MATCH_SECONDS,
      phase: snap?.phase ?? 'live',
      winner,
      health: me ? Math.max(0, Math.round(me.health)) : 0,
      shield: me ? Math.round(me.shield) : 0,
      energy: me ? Math.round(me.energy) : 0,
      heat: me ? me.heat : 0,
      overheat: me?.overheated ?? false,
      overdrive: me?.overdrive ?? 0,
      alive: me?.alive ?? true,
      respawnIn: me && !me.alive ? Math.max(0, me.respawnAt - this.worldTimeEst()) : 0,
      kills: me?.kills ?? 0,
      deaths: me?.deaths ?? 0,
      ping: Math.round(this.net.rtt),
      fps,
      feed: this.feed,
      boost: this.localBoost,
      radar: this.view.players.map((p) => ({
        x: p.x,
        z: p.z,
        heading: p.heading,
        color: p.color,
        you: p.id === this.localId,
        alive: p.alive,
        bot: false,
      })),
      radarPickups: this.view.pickups.map((p) => ({ x: p.x, z: p.z, kind: p.kind })),
    });
  }

  // --------------------------------------------------------------------- loop
  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000) || 0.016;
    this.lastFrame = now;

    if (this.joined && !this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 6) {
        this.predictStep();
        this.acc -= FIXED_DT;
        steps++;
      }
    }

    this.buildView(dt);
    this.engine.sync(this.view, dt);
    this.engine.render(dt);
    this.hudTick(now, dt);

    this.raf = requestAnimationFrame(this.frame);
  };
}

