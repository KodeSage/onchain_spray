"use client";

import { PARTICLE_POOL_SIZE } from "./constants";

/**
 * Canvas 2D droplet particles.
 *
 * A preallocated pool, never DOM nodes — the browser dies somewhere around 200
 * elements and the arena dies with it. Nothing is allocated per tap: spawn
 * takes the next slot in the ring and overwrites it, so a long session does
 * zero garbage collection on the hot path.
 *
 * Droplets are drawn as velocity-aligned ellipses rather than circles. A round
 * dot reads as a bubble; a dot stretched along the direction it is travelling
 * reads as water, and the stretch falls off as the droplet slows, which is what
 * makes the top of the arc look like it hangs.
 */

type Drop = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  /** 0 = far/background, 1 = near/foreground */
  depth: number;
  r: number;
  /** aqua droplets ride the combo; violet is the resting state */
  hot: boolean;
};

const GRAVITY = 1180;
const DRAG = 0.992;

export type ParticleField = {
  spawn: (count: number, opts?: SpawnOptions) => void;
  resize: (w: number, h: number, dpr: number) => void;
  render: (dt: number) => void;
  alive: () => number;
  clear: () => void;
};

export type SpawnOptions = {
  /** A bigger, hotter burst — a combo tier crossing or a personal record. */
  big?: boolean;
  /** Origin in CSS pixels. Defaults to the middle of the lower third. */
  x?: number;
  y?: number;
  /** Draw this burst in the combo colour. */
  hot?: boolean;
};

export function createParticleField(ctx: CanvasRenderingContext2D): ParticleField {
  const pool: Drop[] = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    depth: 0,
    r: 0,
    hot: false,
  }));

  let cursor = 0;
  let width = 0;
  let height = 0;
  let aliveCount = 0;

  function resize(w: number, h: number, dpr: number) {
    width = w;
    height = h;
    ctx.canvas.width = Math.floor(w * dpr);
    ctx.canvas.height = Math.floor(h * dpr);
    ctx.canvas.style.width = `${w}px`;
    ctx.canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(count: number, opts: SpawnOptions = {}) {
    const big = opts.big ?? false;
    const hot = opts.hot ?? false;
    const originX = opts.x ?? width * 0.5;
    const originY = opts.y ?? height * 0.68;

    for (let i = 0; i < count; i++) {
      // walk the ring for the next reusable slot; if the pool is saturated we
      // overwrite the oldest, which is the right call — dropping the newest tap
      // would make the screen lag behind the room
      const d = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      if (!d.alive) aliveCount += 1;

      const depth = Math.random();
      const scale = 0.5 + depth * 0.8;

      // A cone, biased upward. Straight up looks like a fountain; a wide cone
      // looks like an explosion. Water off a tap is somewhere between.
      const spread = big ? 1.5 : 1.05;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const speed = (big ? 760 : 460) + Math.random() * (big ? 620 : 380);

      d.alive = true;
      d.x = originX + (Math.random() - 0.5) * (big ? 90 : 54);
      d.y = originY + (Math.random() - 0.5) * 22;
      d.vx = Math.cos(angle) * speed;
      d.vy = Math.sin(angle) * speed;
      d.maxLife = 1.5 + Math.random() * 1.4;
      d.life = d.maxLife;
      d.depth = depth;
      d.r = (big ? 4.4 : 3.2) * scale;
      d.hot = hot || big;
    }
  }

  function render(dt: number) {
    ctx.clearRect(0, 0, width, height);

    // 1. integrate every live droplet exactly once
    for (let i = 0; i < pool.length; i++) {
      const d = pool[i];
      if (!d.alive) continue;

      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        aliveCount -= 1;
        continue;
      }

      // Parallax: far droplets feel lighter, which sells depth more cheaply
      // than drawing them smaller alone ever could.
      d.vy += GRAVITY * (0.6 + d.depth * 0.55) * dt;
      d.vx *= DRAG;
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      if (d.y > height + 60) {
        d.alive = false;
        aliveCount -= 1;
      }
    }

    // 2. draw far droplets first, so near ones overlap them
    ctx.globalCompositeOperation = "lighter";
    for (let pass = 0; pass < 2; pass++) {
      const wantNear = pass === 1;
      for (let i = 0; i < pool.length; i++) {
        const d = pool[i];
        if (!d.alive) continue;
        if (d.depth >= 0.5 !== wantNear) continue;
        drawDrop(d, d.life < 0.5 ? d.life / 0.5 : 1);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawDrop(d: Drop, fade: number) {
    const near = d.depth >= 0.5;
    const speed = Math.hypot(d.vx, d.vy);

    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(Math.atan2(d.vy, d.vx));

    // Stretch along the direction of travel, easing off as the droplet slows.
    // At the apex it is nearly round, which is what makes the arc hang.
    const stretch = 1 + Math.min(speed / 620, 2.4);
    ctx.scale(stretch, 1);

    ctx.globalAlpha = fade * (0.4 + d.depth * 0.6);
    ctx.fillStyle = d.hot
      ? near
        ? "#7FE9DC"
        : "#3FE0D0"
      : near
        ? "#9C8BFF"
        : d.depth < 0.25
          ? "#4A3E8F"
          : "#6B55E0";

    ctx.beginPath();
    ctx.arc(0, 0, d.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function clear() {
    for (const d of pool) d.alive = false;
    aliveCount = 0;
    ctx.clearRect(0, 0, width, height);
  }

  return { spawn, resize, render, alive: () => aliveCount, clear };
}
