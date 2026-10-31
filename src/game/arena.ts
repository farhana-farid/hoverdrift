// ---------------------------------------------------------------------------
// Arena construction: procedurally textured floor, energy wall, cover blocks,
// spawn pads and a floating hologram over the centre. All textures are drawn
// on a canvas at runtime — no external art to download.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { ARENA_RADIUS, OBSTACLES, SPAWNS, WALL_HEIGHT } from '../../shared/constants';

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function gridTexture(): THREE.CanvasTexture {
  const tex = canvasTexture((ctx, s) => {
    ctx.fillStyle = '#070b13';
    ctx.fillRect(0, 0, s, s);

    // Panel noise
    for (let i = 0; i < 900; i++) {
      const v = Math.random();
      ctx.fillStyle = `rgba(${30 + v * 40}, ${44 + v * 50}, ${60 + v * 60}, 0.25)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 1);
    }

    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += s / 8) {
      ctx.strokeStyle = 'rgba(60, 120, 150, 0.16)';
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(62, 240, 255, 0.18)';
    ctx.strokeRect(3, 3, s - 6, s - 6);
    ctx.strokeStyle = 'rgba(62, 240, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(70, 6);
    ctx.moveTo(6, 6);
    ctx.lineTo(6, 70);
    ctx.moveTo(s - 6, s - 6);
    ctx.lineTo(s - 70, s - 6);
    ctx.moveTo(s - 6, s - 6);
    ctx.lineTo(s - 6, s - 70);
    ctx.stroke();
  });
  tex.repeat.set(9, 9);
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const glowMap = /* lazy */ (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => (tex ??= glowTexture());
})();

function wallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 256, 0, 0);
    g.addColorStop(0, 'rgba(20, 120, 160, 0)');
    g.addColorStop(0.55, 'rgba(50, 190, 230, 0.20)');
    g.addColorStop(1, 'rgba(120, 245, 255, 0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    ctx.strokeStyle = 'rgba(150, 250, 255, 0.6)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * 64;
      ctx.beginPath();
      ctx.moveTo(x, 256);
      ctx.lineTo(x, 256 - (i % 3 === 0 ? 70 : 34));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 64, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(24, 1);
  return tex;
}

export interface ArenaHandles {
  group: THREE.Group;
  update: (time: number) => void;
  dispose: () => void;
}

export function createArena(quality: 'high' | 'low'): ArenaHandles {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // --- floor ---------------------------------------------------------------
  const floorTex = gridTexture();
  const floorGeo = new THREE.CircleGeometry(ARENA_RADIUS + 1, 96);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    color: 0x9fb6c8,
    metalness: 0.55,
    roughness: 0.55,
    envMapIntensity: 0.8,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = quality === 'high';
  group.add(floor);
  disposables.push(floorGeo, floorMat, floorTex);

  // radial wash so the centre reads as the hot zone
  const washGeo = new THREE.PlaneGeometry(ARENA_RADIUS * 2.3, ARENA_RADIUS * 2.3);
  const washMat = new THREE.MeshBasicMaterial({
    map: glowMap(),
    color: 0x1b6f8f,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const wash = new THREE.Mesh(washGeo, washMat);
  wash.rotation.x = -Math.PI / 2;
  wash.position.y = 0.02;
  group.add(wash);
  disposables.push(washGeo, washMat);

  // --- wall ----------------------------------------------------------------
  const wallTex = wallTexture();
  const wallGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, WALL_HEIGHT + 1, 128, 1, true);
  const wallMat = new THREE.MeshBasicMaterial({
    map: wallTex,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = (WALL_HEIGHT + 1) / 2;
  group.add(wall);
  disposables.push(wallGeo, wallMat, wallTex);

  const rimGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.18, 8, 160);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x6ff6ff, transparent: true, opacity: 0.9 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = WALL_HEIGHT + 1;
  group.add(rim);
  disposables.push(rimGeo, rimMat);

  const floorRimGeo = new THREE.TorusGeometry(ARENA_RADIUS, 0.12, 6, 160);
  const floorRimMat = new THREE.MeshBasicMaterial({ color: 0x2bd6ff, transparent: true, opacity: 0.8 });
  const floorRim = new THREE.Mesh(floorRimGeo, floorRimMat);
  floorRim.rotation.x = Math.PI / 2;
  floorRim.position.y = 0.08;
  group.add(floorRim);
  disposables.push(floorRimGeo, floorRimMat);

  // --- cover ---------------------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x121b29,
    metalness: 0.72,
    roughness: 0.4,
    envMapIntensity: 0.9,
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x2f9fbf,
    transparent: true,
    opacity: 0.7,
  });
  const capMat = new THREE.MeshBasicMaterial({ color: 0x3ef0ff, transparent: true, opacity: 0.65 });
  disposables.push(boxGeo, coverMat, edgeMat, capMat);

  for (const o of OBSTACLES) {
    const mesh = new THREE.Mesh(boxGeo, coverMat);
    mesh.scale.set(o.w, o.h, o.d);
    mesh.position.set(o.x, o.h / 2, o.z);
    mesh.castShadow = quality === 'high';
    mesh.receiveShadow = quality === 'high';
    group.add(mesh);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo, 30), edgeMat);
    edges.scale.copy(mesh.scale);
    edges.position.copy(mesh.position);
    group.add(edges);

    const capGeo = new THREE.BoxGeometry(o.w * 0.92, 0.08, o.d * 0.92);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(o.x, o.h + 0.02, o.z);
    group.add(cap);
    disposables.push(capGeo);
  }

  // --- spawn pads ----------------------------------------------------------
  const padGeo = new THREE.RingGeometry(2.1, 2.6, 32);
  const padMat = new THREE.MeshBasicMaterial({
    color: 0x3ef0ff,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const s of SPAWNS) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.x, 0.04, s.z);
    group.add(pad);
  }
  disposables.push(padGeo, padMat);

  // --- centre hologram -----------------------------------------------------
  const holo = new THREE.Group();
  holo.position.y = 9.5;
  const ringGeo = new THREE.TorusGeometry(6.5, 0.09, 6, 96);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x3ef0ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringA = new THREE.Mesh(ringGeo, ringMat);
  ringA.rotation.x = Math.PI / 2;
  holo.add(ringA);
  const ringB = new THREE.Mesh(ringGeo, ringMat);
  ringB.rotation.set(Math.PI / 2, 0, 0.6);
  ringB.scale.setScalar(0.72);
  holo.add(ringB);
  group.add(holo);
  disposables.push(ringGeo, ringMat);

  const beamGeo = new THREE.CylinderGeometry(0.1, 0.8, 9.5, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x2bd6ff,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 4.75, 0);
  group.add(beam);
  disposables.push(beamGeo, beamMat);

  // --- starfield -----------------------------------------------------------
  const starCount = quality === 'high' ? 900 : 400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 240 + Math.random() * 90;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.55;
    starPos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    starPos[i * 3 + 1] = Math.cos(phi) * r * 0.7 + 10;
    starPos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xa8d8ff,
    size: 1.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  group.add(new THREE.Points(starGeo, starMat));
  disposables.push(starGeo, starMat);

  return {
    group,
    update(time: number) {
      holo.rotation.y = time * 0.18;
      ringB.rotation.z = Math.PI / 2 + Math.sin(time * 0.35) * 0.5;
      rimMat.opacity = 0.65 + Math.sin(time * 1.6) * 0.12;
      holo.position.y = 9.5 + Math.sin(time * 0.8) * 0.35;
      wallMat.opacity = 0.8 + Math.sin(time * 0.9) * 0.06;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
