# HOVERDRIFT

A physics-driven **multiplayer hover-combat arena** that runs in the browser: Three.js/WebGL2 rendering, an
authoritative Node simulation at 60 Hz, client-side prediction with reconciliation, interpolated remote pilots,
bots that fill the lobby, destructible-feeling physics props, and a full game-feel layer (shake, hit-stop style
flashes, particles, procedural audio, radar, adaptive quality).

No art, fonts, or audio files are downloaded — the arena, ships, textures, particles and all sound effects are
generated procedurally at runtime.

---

## Quick start

```bash
npm install

# dev: Vite client on :5173 + game server on :8080 (proxied through Vite)
npm run dev

# production: build the client, then one process serves static files + websockets
npm run build
npm start            # http://localhost:8080
```

Open **http://localhost:5173**, press **ENTER ARENA**. Three bots deploy immediately; every other browser tab that
opens the same URL lands in the same arena (rooms auto-open past 8 pilots).

```bash
npm run typecheck    # tsc --noEmit
node scripts/smoke.mjs   # headless protocol test against a running server
```

Environment: `PORT` (default `8080`).

---

## Architecture

```
shared/          ← runs identically on the server and in the browser
  constants.ts     tuning: movement, weapon, arena layout, match rules
  types.ts         wire + simulation types
  sim.ts           movement model, collision primitives, deterministic RNG
  world.ts         authoritative arena state machine (step, damage, pickups, rounds)

server/
  index.ts         HTTP + WebSocket rooms, 60 Hz loop, 20 Hz snapshots, round lifecycle
  ai.ts            bots that emit InputFrames (same rules as humans, no cheating)

src/
  net/client.ts    transport, latency probe
  input/input.ts   keyboard/mouse, gamepad polling, injected touch
  game/session.ts  prediction, reconciliation, interpolation, event → FX/audio/HUD
  game/engine.ts   renderer, camera rig, quality switching, aim raycast
  game/arena.ts    procedural floor/wall/cover/hologram/starfield
  game/ships.ts    procedural hover craft + emissive trim + shield + thrusters
  game/effects.ts  pooled particles, shockwaves, debris, muzzle flashes
  game/audio.ts    WebAudio synthesis (no files)
  ui/*             React HUD, radar, menus, pause/settings, results, touch sticks
```

### Netcode

| Layer | Rate | Detail |
| --- | --- | --- |
| Authority | 60 Hz fixed step | Server owns hits, kills, pickups, crates |
| Snapshots | 20 Hz | Full state + event list, per-client `ack` of the last processed input |
| Client input | 60 Hz | `{seq, move, aim, fire, boost}` |
| Remotes | rendered 100 ms behind | snapshot interpolation + capped extrapolation |
| Own ship | rendered now | local prediction, replayed pending inputs on every snapshot |

1. The client steps the **same** `stepPlayerMovement` function from `shared/sim.ts` for its own ship each frame and
   keeps the unacknowledged inputs.
2. Each snapshot carries `ack` (the newest input the server consumed) plus authoritative state. The client drops
   acked inputs, rewinds to authority, replays the rest, and hides small correction deltas with a decaying render
   offset (large errors snap).
3. Other pilots and projectiles are interpolated between the two snapshots that bracket `now − 100 ms`. Projectiles
   are additionally extrapolated along their velocity so tracer fire feels present.
4. Movement steers velocity toward a target velocity instead of integrating acceleration. That makes the model
   framerate-independent and converges in a few frames after reconciliation.

### Physics

- Ship collision is a swept circle against axis-aligned cover blocks and the circular arena wall, with restitution.
- Dynamic crates are server-simulated rigid-ish bodies: impulse transfer from ship contact and plasma hits, spin,
  drag, wall bounce, and crate-vs-crate separation. They block shots (real cover) and can be shoved into a duel.
- Predictions reuse the same collision math against the latest crate positions, so prediction and authority agree
  except when a prop was just hit.

### Game rules

- 3-minute free-for-all; most kills wins; the room resets 10 s after the round ends.
- Hull 100 + regenerating shield 50 (regen starts 5 s after damage).
- Boost drains an energy meter; the weapon has a heat budget and overheats into a lockout.
- Pickups every ~7.5 s (max 7): hull repair, core recharge, **overdrive** (8 s of faster, harder-hitting fire).
- 2.5 s spawn protection so a respawn is not instantly deleted.

Bots orbit at an engagement distance, lead their shots, avoid cover, and fire in **bursts**, so incoming damage is
readable instead of a continuous laser.

---

## Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Thrust | `WASD` / arrows | left stick | left stick |
| Aim | mouse | right stick | right stick |
| Fire | LMB / `Space` | `RT` / `A` | auto-fire while aiming |
| Boost | `Shift` | `LT` / `X` | BOOST pad |
| Standings | `Tab` | — | — |
| Pause | `Esc` / `P` | `Start` | pause button |

Settings (menu or pause): volume, aim smoothing, screen shake, render quality (`auto`/`high`/`low`), chase vs fixed
camera, stick inversion, performance readout. Settings persist in `localStorage`.

---

## Performance

- Instanced tracers, pooled point-sprite particles, pooled shockwave rings, shared hull geometry.
- Pixel ratio capped (2× high / 1.25× low); bloom, shadows and MSAA are disabled on the low tier and on coarse-pointer
  devices when quality is `auto`.
- HUD updates at ~10 Hz through a tiny external store; the crosshair is moved with direct DOM writes so pointer
  motion never triggers React renders.
- Measured in headless Chrome on this machine at 1440×900: **60 FPS** (16.6 ms average frame, 22 ms p95),
  38–144 draw calls, ~15.7 k triangles, prediction error ~0 units against authority.

## Tuning

Everything that shapes the feel lives in [`shared/constants.ts`](shared/constants.ts): movement speeds, boost,
weapon cadence/damage/heat, shield regen, pickup cadence, arena furniture (`OBSTACLES`), spawn ring, match length.
Bot personality and burst discipline live in [`server/ai.ts`](server/ai.ts).

## Verification performed

- `npm run typecheck` clean; `npm run build` succeeds.
- Headless protocol test: 4 pilots, 16 crates, projectiles, hit/kill events across ~300 ticks.
- Browser run: joined via UI, confirmed HUD/net stats, keyboard thrust moved the ship ~17 units in 0.8 s, fire
  produced projectiles and heat, reconciliation error 0, 60 FPS sampling.
- Production single-process serving checked: `/healthz`, HTML, hashed JS asset with correct MIME.
- Not verified here: real gamepad hardware, multi-device sessions across a network, and a full 3-minute round ending
  (round lifecycle exercised only through code paths).
