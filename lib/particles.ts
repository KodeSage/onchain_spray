"use client";

import { PARTICLE_POOL_SIZE } from "./constants";

/**
 * Canvas 2D note particles.
 *
 * A preallocated pool, never DOM nodes — the browser dies somewhere around 200
 * elements and the demo dies with it. Nothing is allocated per spray: spawn
 * takes the next dead slot and overwrites it, so a 90-second run does zero
 * garbage collection on the hot path.
 */

type Note = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** phase of the flutter, so notes do not fall in lockstep */
  phase: number;
  life: number;
  maxLife: number;
  /** 0 = far/background, 1 = near/foreground */
  depth: number;
  w: number;
  h: number;
};

const GRAVITY = 620;
const DRAG = 0.995;

export type ParticleField = {
  spawn: (count: number, opts?: { big?: boolean }) => void;
  resize: (w: number, h: number, dpr: number) => void;
  render: (dt: number) => void;
  alive: () => number;
  clear: () => void;
};

export function createParticleField(ctx: CanvasRenderingContext2D): ParticleField {
  const pool: Note[] = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
    alive: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vr: 0,
    phase: 0,
    life: 0,
    maxLife: 0,
    depth: 0,
    w: 0,
    h: 0,
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

  function spawn(count: number, opts: { big?: boolean } = {}) {
    const big = opts.big ?? false;
    for (let i = 0; i < count; i++) {
      // walk the ring for the next reusable slot; if the pool is saturated we
      // overwrite the oldest, which is the right call — dropping the newest
      // spray would make the screen lag behind the room
      const note = pool[cursor];
      cursor = (cursor + 1) % pool.length;
      if (!note.alive) aliveCount += 1;

      const depth = Math.random();
      const scale = 0.55 + depth * 0.75;

      note.alive = true;
      // thrown up from the lower third, spread across the stage
      note.x = width * (0.12 + Math.random() * 0.76);
      note.y = height * (0.72 + Math.random() * 0.2);
      note.vx = (Math.random() - 0.5) * (big ? 520 : 300);
      note.vy = -(big ? 900 : 620) - Math.random() * (big ? 620 : 380);
      note.rot = Math.random() * Math.PI * 2;
      note.vr = (Math.random() - 0.5) * 9;
      note.phase = Math.random() * Math.PI * 2;
      note.maxLife = 2.6 + Math.random() * 2.0;
      note.life = note.maxLife;
      note.depth = depth;
      note.w = 58 * scale;
      note.h = 30 * scale;
    }
  }

  function render(dt: number) {
    ctx.clearRect(0, 0, width, height);

    // 1. integrate every live note exactly once
    for (let i = 0; i < pool.length; i++) {
      const n = pool[i];
      if (!n.alive) continue;

      n.life -= dt;
      if (n.life <= 0) {
        n.alive = false;
        aliveCount -= 1;
        continue;
      }

      n.phase += dt * 5.5;
      n.vy += GRAVITY * dt;
      n.vx *= DRAG;
      // paper does not fall straight — it slips sideways as it turns
      n.x += (n.vx + Math.sin(n.phase) * 46) * dt;
      n.y += n.vy * dt;
      n.rot += n.vr * dt;

      if (n.y > height + 80) {
        n.alive = false;
        aliveCount -= 1;
      }
    }

    // 2. draw far notes first, so near ones overlap them
    for (let pass = 0; pass < 2; pass++) {
      const wantNear = pass === 1;
      for (let i = 0; i < pool.length; i++) {
        const n = pool[i];
        if (!n.alive) continue;
        if (n.depth >= 0.5 !== wantNear) continue;
        drawNote(n, n.life < 0.7 ? n.life / 0.7 : 1);
      }
    }
  }

  function drawNote(n: Note, fade: number) {
    const near = n.depth >= 0.5;
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.rot);
    // a note seen edge-on is thin; this is what reads as tumbling at 15 metres
    const squash = Math.abs(Math.cos(n.phase * 0.6)) * 0.85 + 0.15;
    ctx.scale(1, squash);
    ctx.globalAlpha = fade * (0.55 + n.depth * 0.45);

    const w = n.w;
    const h = n.h;

    ctx.fillStyle = near ? "#1B4A28" : n.depth < 0.25 ? "#173B21" : "#14361E";
    ctx.fillRect(-w / 2, -h / 2, w, h);

    ctx.lineWidth = near ? 2 : 1.25;
    ctx.strokeStyle = near ? "#20613A" : "#1F6438";
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // the inner rule is what makes a green rectangle read as a banknote
    if (w > 34) {
      ctx.globalAlpha = fade * 0.5 * (0.4 + n.depth);
      ctx.strokeStyle = "#E8B33A";
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 4, -h / 2 + 3.5, w - 8, h - 7);
    }

    ctx.restore();
  }

  function clear() {
    for (const n of pool) n.alive = false;
    aliveCount = 0;
    ctx.clearRect(0, 0, width, height);
  }

  return { spawn, resize, render, alive: () => aliveCount, clear };
}
