// ---------------------------------------------------------------------------
// VFX: GPU point-sprite particles, expanding shockwave rings, debris shards and
// muzzle flashes. All pooled — nothing is allocated during combat.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { glowMap } from './arena';

const MAX_PARTICLES_HIGH = 2600;
const MAX_PARTICLES_LOW = 900;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
}

const particleVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.08, d) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

export class Effects {
  private particles: Particle[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private sizeAttr: Float32Array;
  private alphaAttr: Float32Array;
  private points: THREE.Points;
  private capacity: number;

  private rings: {
    mesh: THREE.Mesh;
    life: number;
    maxLife: number;
    maxScale: number;
    flat: boolean;
  }[] = [];
  private flashes: { sprite: THREE.Sprite; life: number; max: number; scale: number }[] = [];
  private shards: {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    ax: number;
    az: number;
    life: number;
  }[] = [];
  private ringCursor = 0;
  private flashCursor = 0;
  private tmpColor = new THREE.Color();
  private tmpObj = new THREE.Object3D();

  constructor(private scene: THREE.Scene, quality: 'high' | 'low') {
    this.capacity = quality === 'high' ? MAX_PARTICLES_HIGH : MAX_PARTICLES_LOW;
    this.pos = new Float32Array(this.capacity * 3);
    this.col = new Float32Array(this.capacity * 3);
    this.sizeAttr = new Float32Array(this.capacity);
    this.alphaAttr = new Float32Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) this.alphaAttr[i] = 0;

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1));
    this.geo.setDrawRange(0, this.capacity);

    const mat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Pre-allocate shockwave rings.
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, maxScale: 10, flat: true });
    }

    for (let i = 0; i < 12; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap(),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0,
        }),
      );
      sprite.visible = false;
      this.scene.add(sprite);
      this.flashes.push({ sprite, life: 0, max: 1, scale: 6 });
    }
  }

  private alloc(): Particle | null {
    if (this.particles.length >= this.capacity) return null;
    const p: Particle = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 1,
      size: 6,
      gravity: 0,
      drag: 1.5,
      r: 1,
      g: 1,
      b: 1,
    };
    this.particles.push(p);
    return p;
  }

  burst(
    x: number,
    y: number,
    z: number,
    color: THREE.ColorRepresentation,
    count = 14,
    speed = 10,
    size = 1.4,
    spread = Math.PI * 2,
  ): void {
    this.tmpColor.set(color);
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      const a = Math.random() * spread;
      const up = (Math.random() - 0.2) * 0.9;
      const s = speed * (0.35 + Math.random() * 0.9);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.sin(a) * s;
      p.vz = Math.cos(a) * s;
      p.vy = up * s * 0.6 + Math.random() * 2;
      p.life = 0.35 + Math.random() * 0.75;
      p.max = p.life;
      p.size = size * (0.6 + Math.random() * 0.9);
      p.gravity = 9;
      p.drag = 2.2;
      p.r = this.tmpColor.r;
      p.g = this.tmpColor.g;
      p.b = this.tmpColor.b;
    }
  }

  spark(x: number, y: number, z: number, color: THREE.ColorRepresentation, vx: number, vz: number): void {
    this.tmpColor.set(color);
    const p = this.alloc();
    if (!p) return;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx * 0.25 + (Math.random() - 0.5) * 7;
    p.vz = vz * 0.25 + (Math.random() - 0.5) * 7;
    p.vy = Math.random() * 5 + 1;
    p.life = 0.35 + Math.random() * 0.35;
    p.max = p.life;
    p.size = 1.1;
    p.gravity = 14;
    p.drag = 2.5;
    p.r = this.tmpColor.r;
    p.g = this.tmpColor.g;
    p.b = this.tmpColor.b;
  }

  trail(x: number, y: number, z: number, color: THREE.ColorRepresentation, size = 1.6): void {
    this.tmpColor.set(color);
    const p = this.alloc();
    if (!p) return;
    p.x = x + (Math.random() - 0.5) * 0.4;
    p.y = y + (Math.random() - 0.5) * 0.4;
    p.z = z + (Math.random() - 0.5) * 0.4;
    p.vx = (Math.random() - 0.5) * 1.4;
    p.vy = 0.6 + Math.random();
    p.vz = (Math.random() - 0.5) * 1.4;
    p.life = 0.22 + Math.random() * 0.18;
    p.max = p.life;
    p.size = size;
    p.gravity = -1;
    p.drag = 3;
    p.r = this.tmpColor.r;
    p.g = this.tmpColor.g;
    p.b = this.tmpColor.b;
  }

  ring(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    maxScale = 14,
    duration = 0.55,
    flat = true,
    y = 0.25,
  ): void {
    const r = this.rings[this.ringCursor++ % this.rings.length];
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    mat.color.set(color);
    mat.opacity = 0.9;
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    r.mesh.scale.setScalar(1);
    r.mesh.visible = true;
    r.life = duration;
    r.maxLife = duration;
    r.maxScale = maxScale;
    r.flat = flat;
  }

  flash(x: number, y: number, z: number, color: THREE.ColorRepresentation, scale = 8, duration = 0.22): void {
    const f = this.flashes[this.flashCursor++ % this.flashes.length];
    const mat = f.sprite.material as THREE.SpriteMaterial;
    mat.color.set(color);
    mat.opacity = 1;
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(scale);
    f.sprite.visible = true;
    f.life = duration;
    f.max = duration;
    f.scale = scale;
  }

  debris(x: number, y: number, z: number, color: THREE.Color, count = 9): void {
    for (let i = 0; i < count; i++) {
      if (this.shards.length > 48) break;
      const geo = new THREE.TetrahedronGeometry(0.22 + Math.random() * 0.4);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x121a26,
        emissive: color,
        emissiveIntensity: 1.5,
        metalness: 0.7,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.shards.push({
        mesh,
        vx: (Math.random() - 0.5) * 26,
        vy: 6 + Math.random() * 12,
        vz: (Math.random() - 0.5) * 26,
        ax: (Math.random() - 0.5) * 10,
        az: (Math.random() - 0.5) * 10,
        life: 1.6 + Math.random() * 0.7,
      });
    }
  }

  update(dt: number): void {
    // --- particles
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.08) {
        p.y = 0.08;
        p.vy *= -0.35;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      this.particles[w++] = p;
    }
    this.particles.length = w;

    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p) {
        this.alphaAttr[i] = 0;
        this.pos[i * 3] = 0;
        this.pos[i * 3 + 1] = -9999;
        this.pos[i * 3 + 2] = 0;
        continue;
      }
      const t = p.life / p.max;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r;
      this.col[i * 3 + 1] = p.g;
      this.col[i * 3 + 2] = p.b;
      this.sizeAttr[i] = p.size;
      this.alphaAttr[i] = Math.min(1, t * 1.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;

    // --- rings
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = Math.max(0, 1 - r.life / r.maxLife);
      const mat = r.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.85;
      r.mesh.scale.setScalar(1 + t * r.maxScale);
      if (r.life <= 0) r.mesh.visible = false;
    }

    // --- flashes
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      const mat = f.sprite.material as THREE.SpriteMaterial;
      mat.opacity = t;
      f.sprite.scale.setScalar(f.scale * (1 + (1 - t) * 0.9));
      if (f.life <= 0) f.sprite.visible = false;
    }

    // --- shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      s.vy -= 26 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += s.ax * dt;
      s.mesh.rotation.z += s.az * dt;
      const floorY = 0.3;
      if (s.mesh.position.y < floorY) {
        s.mesh.position.y = floorY;
        s.vy *= -0.42;
        s.vx *= 0.72;
        s.vz *= 0.72;
        s.ax *= 0.7;
        s.az *= 0.7;
      }
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.shards.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
    }
    for (const f of this.flashes) {
      this.scene.remove(f.sprite);
      (f.sprite.material as THREE.Material).dispose();
    }
    for (const s of this.shards) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
  }
}
