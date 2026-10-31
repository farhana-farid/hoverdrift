// ---------------------------------------------------------------------------
// WebGL renderer + camera rig. The engine is a pure view: it never owns game
// state, it consumes an interpolated ViewState and draws it.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { ARENA_RADIUS, TEAM_COLORS } from '../../shared/constants';
import { lerpAngle } from '../../shared/sim';
import type { PickupKind } from '../../shared/types';
import { createArena, type ArenaHandles } from './arena';
import { Effects } from './effects';
import { createShip, type ShipHandles } from './ships';

export interface ViewPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  aim: number;
  alive: boolean;
  shield: number;
  health: number;
  overdrive: number;
  boosting: boolean;
}

export interface ViewProjectile {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  overdrive: boolean;
  owner: string;
}

export interface ViewCrate {
  id: number;
  x: number;
  z: number;
  rot: number;
  size: number;
}

export interface ViewPickup {
  id: number;
  kind: PickupKind;
  x: number;
  z: number;
  born: number;
}

export interface ViewState {
  time: number;
  localId: string | null;
  players: ViewPlayer[];
  projectiles: ViewProjectile[];
  crates: ViewCrate[];
  pickups: ViewPickup[];
  localBoosting: boolean;
}

const PICKUP_COLORS: Record<PickupKind, number> = {
  health: 0x5cff9d,
  energy: 0x3ef0ff,
  overdrive: 0xff4d9d,
};

export type Quality = 'high' | 'low';

export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly effects: Effects;
  camYaw = 0;
  quality: Quality;
  cameraMode: 'chase' | 'fixed' = 'chase';
  shakeScale = 1;

  private arena: ArenaHandles;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private ships = new Map<string, ShipHandles>();
  private crateMeshes = new Map<number, THREE.Mesh>();
  private pickupMeshes = new Map<number, THREE.Group>();
  private tracers: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private raycaster = new THREE.Raycaster();
  private camPos = new THREE.Vector3(0, 24, -58);
  private lookAt = new THREE.Vector3(0, 2, 0);
  private shake = 0;
  private time = 0;
  private width = 1;
  private height = 1;
  private disposed = false;
  private orbit = 0;
  private shadowLight: THREE.DirectionalLight;

  constructor(
    private canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === 'high',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x04060d);
    this.scene.fog = new THREE.FogExp2(0x04060d, 0.0072);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 600);
    this.camera.position.copy(this.camPos);

    // --- lighting
    this.scene.add(new THREE.HemisphereLight(0x3f6f9f, 0x05070f, 0.85));
    this.scene.add(new THREE.AmbientLight(0x1a2b3d, 0.6));

    const key = new THREE.DirectionalLight(0xbfe6ff, 2.1);
    key.position.set(38, 62, 24);
    key.castShadow = quality === 'high';
    if (quality === 'high') {
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -70;
      key.shadow.camera.right = 70;
      key.shadow.camera.top = 70;
      key.shadow.camera.bottom = -70;
      key.shadow.camera.near = 5;
      key.shadow.camera.far = 180;
      key.shadow.bias = -0.0007;
      key.shadow.normalBias = 0.03;
    }
    this.shadowLight = key;
    this.scene.add(key);

    const rimLight = new THREE.DirectionalLight(0x2bd6ff, 1.1);
    rimLight.position.set(-45, 22, -40);
    this.scene.add(rimLight);

    const warm = new THREE.PointLight(0xff3d7f, 90, 120, 2);
    warm.position.set(0, 14, 0);
    this.scene.add(warm);

    // --- world
    this.arena = createArena(quality);
    this.scene.add(this.arena.group);
    this.effects = new Effects(this.scene, quality);

    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.16, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      192,
    );
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.scene.add(this.tracers);

    this.buildComposer();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
  }

  private buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.72, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(this.width, this.height);
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = q === 'high';
    this.shadowLight.castShadow = q === 'high';
    this.resize();
  }

  setPrefs(prefs: { camera: 'chase' | 'fixed'; shake: number }) {
    this.cameraMode = prefs.camera;
    this.shakeScale = prefs.shake;
  }

  addShake(amount: number) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  resize = () => {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /** Convert a screen-space pointer into a world aim angle from the ship. */
  screenToAim(px: number, py: number, shipX: number, shipZ: number, fallback: number): number {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    if (direction.y > -0.02) return fallback;
    const t = (1.15 - origin.y) / direction.y;
    if (t <= 0 || t > 500) return fallback;
    const wx = origin.x + direction.x * t;
    const wz = origin.z + direction.z * t;
    return Math.atan2(wx - shipX, wz - shipZ);
  }

  sync(view: ViewState, dt: number) {
    this.time = view.time;

    // --- ships
    const alive = new Set<string>();
    for (const p of view.players) {
      alive.add(p.id);
      let ship = this.ships.get(p.id);
      if (!ship) {
        ship = createShip(p.color, p.id === view.localId);
        this.ships.set(p.id, ship);
        this.scene.add(ship.group);
        this.effects.ring(p.x, p.z, p.color, 6, 0.6);
      }
      const g = ship.group;
      g.visible = p.alive;
      g.position.x = p.x;
      g.position.z = p.z;
      g.rotation.y = p.heading;

      const speed = Math.hypot(p.vx, p.vz);
      const throttle = Math.min(1, speed / 34) + (p.boosting ? 0.45 : 0);
      ship.hull.position.y = 0.62 + Math.sin(this.time * 2.4 + ship.phase) * 0.07;
      const rightX = Math.cos(p.heading);
      const rightZ = -Math.sin(p.heading);
      const lateral = p.vx * rightX + p.vz * rightZ;
      ship.hull.rotation.z = THREE.MathUtils.lerp(ship.hull.rotation.z, -lateral * 0.012, 0.15);
      ship.hull.rotation.x = THREE.MathUtils.lerp(ship.hull.rotation.x, -0.06 + (p.boosting ? 0.05 : 0), 0.1);

      for (const flame of ship.flames) {
        flame.scale.set(0.8 + throttle * 0.5, 0.4 + throttle * 1.6, 0.8 + throttle * 0.5);
        flame.visible = throttle > 0.05;
      }
      for (const s of ship.flameSprites) {
        s.scale.setScalar(1.1 + throttle * 1.5);
      }
      ship.turret.rotation.y = p.aim - p.heading;

      const shieldFrac = Math.max(0, Math.min(1, p.shield / 50));
      const mat = ship.shield.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, p.alive ? 0.03 + shieldFrac * 0.09 : 0, 0.12);
      ship.shield.rotation.y += dt * 0.35;
      ship.shield.scale.set(1 + Math.sin(this.time * 2 + ship.phase) * 0.02, 0.62, 1);

      if (ship.selfRing) {
        ship.selfRing.rotation.z += dt * 0.9;
        ship.selfRing.visible = p.alive;
      }

      if (p.boosting && p.alive) {
        const bx = p.x - Math.sin(p.heading) * 1.6;
        const bz = p.z - Math.cos(p.heading) * 1.6;
        this.effects.trail(bx, 0.9, bz, p.color, 2.1);
      }
      ship.accent.emissiveIntensity = p.overdrive > 0 ? 2.6 + Math.sin(this.time * 18) * 0.9 : 1.9;
    }
    for (const [id, ship] of this.ships) {
      if (alive.has(id)) continue;
      this.scene.remove(ship.group);
      this.ships.delete(id);
    }

    // --- crates
    const crates = new Set<number>();
    for (const c of view.crates) {
      crates.add(c.id);
      let mesh = this.crateMeshes.get(c.id);
      if (!mesh) {
        const geo = new THREE.BoxGeometry(c.size, c.size, c.size);
        const body = new THREE.MeshStandardMaterial({
          color: 0x1d2a3a,
          metalness: 0.7,
          roughness: 0.45,
        });
        mesh = new THREE.Mesh(geo, body);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x5ad9ff, transparent: true, opacity: 0.65 }),
        );
        mesh.add(edges);
        this.crateMeshes.set(c.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, c.x, Math.min(1, dt * 16));
      mesh.position.y = c.size / 2;
      mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, c.z, Math.min(1, dt * 16));
      mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, c.rot, Math.min(1, dt * 16));
    }
    for (const [id, mesh] of this.crateMeshes) {
      if (crates.has(id)) continue;
      this.scene.remove(mesh);
      this.crateMeshes.delete(id);
    }

    // --- pickups
    const pickups = new Set<number>();
    for (const pk of view.pickups) {
      pickups.add(pk.id);
      let group = this.pickupMeshes.get(pk.id);
      if (!group) {
        group = new THREE.Group();
        const color = PICKUP_COLORS[pk.kind];
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.62, 0),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 2.4,
            metalness: 0.4,
            roughness: 0.2,
          }),
        );
        group.add(core);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.05, 0.05, 6, 28),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }),
        );
        group.add(ring);
        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: createHaloMap(),
            color,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 0.65,
          }),
        );
        halo.scale.setScalar(4.2);
        group.add(halo);
        group.position.set(pk.x, 1.4, pk.z);
        this.scene.add(group);
        this.pickupMeshes.set(pk.id, group);
      }
      group.position.y = 1.5 + Math.sin(this.time * 2 + pk.id) * 0.22;
      group.rotation.y += dt * 1.7;
      const ring = group.children[1];
      if (ring) ring.rotation.x += dt * 2.4;
    }
    for (const [id, group] of this.pickupMeshes) {
      if (pickups.has(id)) continue;
      this.scene.remove(group);
      this.pickupMeshes.delete(id);
    }

    // --- tracers
    const count = Math.min(view.projectiles.length, 192);
    for (let i = 0; i < count; i++) {
      const pr = view.projectiles[i];
      this.tmp.position.set(pr.x, 1.25, pr.z);
      this.tmp.rotation.set(0, Math.atan2(pr.vx, pr.vz), 0);
      this.tmp.scale.set(1, 1, 2.6);
      this.tmp.updateMatrix();
      this.tracers.setMatrixAt(i, this.tmp.matrix);
      const owner = view.players.find((p) => p.id === pr.owner);
      this.tmpColor.set(pr.overdrive ? '#ffd0f0' : owner?.color ?? '#9ff6ff');
      this.tracers.setColorAt(i, this.tmpColor);
    }
    this.tracers.count = count;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;

    this.updateCamera(view, dt);
  }

  private updateCamera(view: ViewState, dt: number) {
    const self = view.players.find((p) => p.id === view.localId);
    this.orbit += dt * 0.12;

    if (!self) {
      const r = 66;
      const desired = new THREE.Vector3(Math.sin(this.orbit) * r, 30, Math.cos(this.orbit) * r);
      this.camera.position.lerp(desired, Math.min(1, dt * 1.6));
      this.camera.lookAt(0, 2, 0);
      this.camYaw = Math.atan2(-this.camera.position.x, -this.camera.position.z);
      return;
    }

    const speed = Math.hypot(self.vx, self.vz);
    const targetYaw =
      this.cameraMode === 'fixed'
        ? 0
        : speed > 1.6
          ? Math.atan2(self.vx, self.vz)
          : Math.atan2(self.x, self.z) + Math.PI;
    this.camYaw = lerpAngle(this.camYaw, targetYaw, 1 - Math.exp(-2.8 * dt));

    const fwdX = Math.sin(this.camYaw);
    const fwdZ = Math.cos(this.camYaw);
    const dist = 25 + Math.min(speed, 42) * 0.11;
    const desired = new THREE.Vector3(self.x - fwdX * dist, 15.5, self.z - fwdZ * dist);

    // Keep the camera inside the arena shell.
    const d = Math.hypot(desired.x, desired.z);
    const maxD = ARENA_RADIUS - 3;
    if (d > maxD) {
      desired.x *= maxD / d;
      desired.z *= maxD / d;
      desired.y += 3;
    }

    this.camera.position.lerp(desired, 1 - Math.exp(-8 * dt));

    const lookTarget = new THREE.Vector3(self.x + fwdX * 6, 2.2, self.z + fwdZ * 6);
    this.lookAt.lerp(lookTarget, 1 - Math.exp(-11 * dt));
    this.camera.lookAt(this.lookAt);

    const targetFov = 62 + (view.localBoosting ? 9 : 0) + Math.min(speed, 40) * 0.05;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
      this.camera.updateProjectionMatrix();
    }

    // --- screen shake (trauma model)
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * this.shakeScale;
      const t = this.time * 42;
      this.camera.position.x += Math.sin(t * 1.7) * s * 0.7;
      this.camera.position.y += Math.sin(t * 2.3 + 1.7) * s * 0.55;
      this.camera.position.z += Math.cos(t * 1.9 + 0.4) * s * 0.7;
      this.camera.rotation.z += Math.sin(t * 1.3) * s * 0.012;
      this.shake = Math.max(0, this.shake - dt * 1.9);
    }
  }

  /** Instant muzzle flash for the local player (no round-trip latency). */
  muzzle(x: number, z: number, aim: number, color: string) {
    const mx = x + Math.sin(aim) * 2.0;
    const mz = z + Math.cos(aim) * 2.0;
    this.effects.flash(mx, 1.1, mz, color, 2.6, 0.09);
    this.effects.burst(mx, 1.1, mz, color, 5, 7, 0.9);
  }

  render(dt: number) {
    this.arena.update(this.time || performance.now() / 1000);
    this.effects.update(dt);
    if (this.composer && this.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  get canvasSize() {
    return { width: this.width, height: this.height };
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.arena.dispose();
    this.effects.dispose();
    for (const s of this.ships.values()) this.scene.remove(s.group);
    for (const [id] of this.crateMeshes) this.crateMeshes.delete(id);
    this.tracers.geometry.dispose();
    (this.tracers.material as THREE.Material).dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

// Small radial texture for pickup halos (cached across engine instances).
let halo: THREE.CanvasTexture | null = null;
function createHaloMap(): THREE.CanvasTexture {
  if (halo) return halo;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  halo = new THREE.CanvasTexture(c);
  halo.colorSpace = THREE.SRGBColorSpace;
  return halo;
}

export const colorForIndex = (i: number) => TEAM_COLORS[i % TEAM_COLORS.length];
