// ---------------------------------------------------------------------------
// Procedural hover craft. A single extruded silhouette + greebles + emissive
// accents, shared by the player and every remote/bot ship.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { glowMap } from './arena';

export interface ShipHandles {
  group: THREE.Group;
  turret: THREE.Group;
  flames: THREE.Mesh[];
  flameSprites: THREE.Sprite[];
  shield: THREE.Mesh;
  underglow: THREE.Mesh;
  accent: THREE.MeshStandardMaterial;
  hull: THREE.Group;
  selfRing: THREE.Mesh | null;
  phase: number;
}

const HOVER_HEIGHT = 0.62;

function silhouette(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 2.25);
  s.lineTo(0.42, 1.35);
  s.lineTo(0.95, 0.55);
  s.lineTo(1.5, -0.5);
  s.lineTo(1.32, -1.5);
  s.lineTo(0.5, -1.78);
  s.lineTo(-0.5, -1.78);
  s.lineTo(-1.32, -1.5);
  s.lineTo(-1.5, -0.5);
  s.lineTo(-0.95, 0.55);
  s.lineTo(-0.42, 1.35);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.46,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.11,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 6,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.46, 0);
  geo.computeVertexNormals();
  return geo;
}

let sharedHull: THREE.ExtrudeGeometry | null = null;
const getHull = () => (sharedHull ??= silhouette());

export function createShip(colorHex: string, isLocal: boolean): ShipHandles {
  const color = new THREE.Color(colorHex);
  const group = new THREE.Group();

  const hullGroup = new THREE.Group();
  hullGroup.position.y = HOVER_HEIGHT;
  group.add(hullGroup);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1a2331,
    metalness: 0.9,
    roughness: 0.3,
    envMapIntensity: 1,
  });
  const accent = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.9,
    metalness: 0.45,
    roughness: 0.25,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x080d15, metalness: 0.8, roughness: 0.45 });

  const hull = new THREE.Mesh(getHull(), bodyMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  hullGroup.add(hull);

  // Wing stripes
  const stripeGeo = new THREE.BoxGeometry(0.08, 0.05, 1.5);
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeo, accent);
    stripe.position.set(side * 0.95, 0.32, -0.55);
    stripe.rotation.y = side * 0.14;
    hullGroup.add(stripe);
  }

  // Canopy
  const canopyGeo = new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x08222b,
    metalness: 0.9,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    emissive: color,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.92,
  });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.scale.set(0.72, 0.62, 1.25);
  canopy.position.set(0, 0.5, 0.15);
  hullGroup.add(canopy);

  // Nose intake
  const intakeGeo = new THREE.ConeGeometry(0.34, 0.9, 4);
  const intake = new THREE.Mesh(intakeGeo, accent);
  intake.rotation.x = Math.PI / 2;
  intake.rotation.y = Math.PI / 4;
  intake.scale.set(1, 1, 0.55);
  intake.position.set(0, 0.22, 1.5);
  hullGroup.add(intake);

  // Engine pods + flames
  const flames: THREE.Mesh[] = [];
  const flameSprites: THREE.Sprite[] = [];
  const podGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.85, 14);
  const nozzleGeo = new THREE.TorusGeometry(0.26, 0.055, 8, 18);
  const flameGeo = new THREE.ConeGeometry(0.24, 1.25, 12, 1, true);
  flameGeo.translate(0, 0.62, 0);

  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(podGeo, darkMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.58, 0.05, -1.28);
    hullGroup.add(pod);

    const nozzle = new THREE.Mesh(nozzleGeo, accent);
    nozzle.position.set(side * 0.58, 0.05, -1.68);
    hullGroup.add(nozzle);

    const flame = new THREE.Mesh(
      flameGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.position.set(side * 0.58, 0.05, -1.72);
    flame.rotation.x = -Math.PI / 2;
    hullGroup.add(flame);
    flames.push(flame);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    sprite.position.set(side * 0.58, 0.05, -1.95);
    sprite.scale.setScalar(1.6);
    hullGroup.add(sprite);
    flameSprites.push(sprite);
  }

  // Turret
  const turret = new THREE.Group();
  turret.position.set(0, 0.42, -0.15);
  hullGroup.add(turret);

  const baseGeo = new THREE.CylinderGeometry(0.3, 0.36, 0.18, 16);
  const base = new THREE.Mesh(baseGeo, darkMat);
  base.position.y = 0.15;
  turret.add(base);

  const barrelGeo = new THREE.BoxGeometry(0.17, 0.17, 1.25);
  const barrel = new THREE.Mesh(barrelGeo, bodyMat);
  barrel.position.set(0, 0.3, 0.58);
  turret.add(barrel);

  const railGeo = new THREE.BoxGeometry(0.09, 0.045, 1.05);
  const rail = new THREE.Mesh(railGeo, accent);
  rail.position.set(0, 0.39, 0.62);
  turret.add(rail);

  const muzzleGeo = new THREE.TorusGeometry(0.13, 0.035, 6, 12);
  const muzzle = new THREE.Mesh(muzzleGeo, accent);
  muzzle.position.set(0, 0.3, 1.2);
  turret.add(muzzle);

  // Shield bubble
  const shieldGeo = new THREE.IcosahedronGeometry(2.35, 2);
  const shieldMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: false,
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.position.y = HOVER_HEIGHT + 0.2;
  shield.scale.set(1, 0.62, 1);
  group.add(shield);

  // Under-glow projected on the deck
  const glowGeo = new THREE.PlaneGeometry(4.4, 4.4);
  const underglow = new THREE.Mesh(
    glowGeo,
    new THREE.MeshBasicMaterial({
      map: glowMap(),
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.06;
  group.add(underglow);

  let selfRing: THREE.Mesh | null = null;
  if (isLocal) {
    const ringGeo = new THREE.RingGeometry(1.85, 2.12, 48);
    selfRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    selfRing.rotation.x = -Math.PI / 2;
    selfRing.position.y = 0.07;
    group.add(selfRing);
  }

  return {
    group,
    turret,
    flames,
    flameSprites,
    shield,
    underglow,
    accent,
    hull: hullGroup,
    selfRing,
    phase: Math.random() * Math.PI * 2,
  };
}

/** Cheap fake explosion debris used on death: a burst of small shards. */
export function createShard(color: THREE.Color): THREE.Mesh {
  const geo = new THREE.TetrahedronGeometry(0.35 + Math.random() * 0.4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x141c28,
    emissive: color,
    emissiveIntensity: 1.4,
    metalness: 0.7,
    roughness: 0.4,
  });
  return new THREE.Mesh(geo, mat);
}
