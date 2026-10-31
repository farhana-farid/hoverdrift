import { useEffect, useRef } from 'react';
import { ARENA_RADIUS, OBSTACLES } from '../../shared/constants';
import type { RadarBlip, RadarPickup } from '../store';

const SIZE = 152;

const PICKUP_COLORS = {
  health: '#5cff9d',
  energy: '#3ef0ff',
  overdrive: '#ff4d9d',
} as const;

export function Radar({ blips, pickups }: { blips: RadarBlip[]; pickups: RadarPickup[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== SIZE * dpr) {
      canvas.width = SIZE * dpr;
      canvas.height = SIZE * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const r = SIZE / 2 - 6;
    const scale = r / ARENA_RADIUS;

    // dial
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    bg.addColorStop(0, 'rgba(20, 52, 72, 0.55)');
    bg.addColorStop(1, 'rgba(4, 12, 22, 0.72)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = 'rgba(80, 200, 235, 0.16)';
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    // cover blocks
    ctx.fillStyle = 'rgba(120, 190, 225, 0.22)';
    for (const o of OBSTACLES) {
      ctx.fillRect(cx + o.x * scale - (o.w * scale) / 2, cy + o.z * scale - (o.d * scale) / 2, o.w * scale, o.d * scale);
    }

    // pickups
    for (const p of pickups) {
      ctx.beginPath();
      ctx.fillStyle = PICKUP_COLORS[p.kind];
      ctx.globalAlpha = 0.9;
      ctx.arc(cx + p.x * scale, cy + p.z * scale, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // pilots
    for (const b of blips) {
      const x = cx + b.x * scale;
      const y = cy + b.z * scale;
      if (b.you) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-b.heading);
        ctx.beginPath();
        ctx.moveTo(0, -5.5);
        ctx.lineTo(4.2, 4.5);
        ctx.lineTo(0, 2.2);
        ctx.lineTo(-4.2, 4.5);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, b.alive ? 3 : 2, 0, Math.PI * 2);
      ctx.fillStyle = b.alive ? b.color : 'rgba(150,170,190,0.35)';
      ctx.shadowColor = b.color;
      ctx.shadowBlur = b.alive ? 8 : 0;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();

    // bezel
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3.5, -0.5, 0.5);
    ctx.strokeStyle = 'rgba(140, 250, 255, 0.8)';
    ctx.stroke();
  }, [blips, pickups]);

  return (
    <div className="radar">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} />
      <div className="radar-sweep" aria-hidden />
      <span className="radar-label">TAC-SCAN</span>
    </div>
  );
}
