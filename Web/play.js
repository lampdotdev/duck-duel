// The duel itself: ducks, squirts, bots, bubbles to pick up, and who has popped whom.
import * as THREE from 'three';
import { random, sound } from './lamp-game.js';
import { STAGES, LEVEL, DRAFT, MAXD, seaAt } from './water.js';
import { makeDuck, DUCKS } from './duck.js';
import { S } from './audio.js';

export const KILLS_TO_WIN = 7, MAX_HP = 6;
const SPEED = 1.5, DASH_SPEED = 3.6, R_DUCK = 0.2;
const HIT_GRACE = 0.5, HEAL_AFTER = 4, HEAL_EVERY = 2.5;   // a moment's safety after a hit; lives come back after a while out of the fight
const BULLET_SPEED = 4.4, BULLET_LIFE = 0.85, MAX_BULLETS = 64, MAX_PARTS = 192;
const SPAWNS = [[-2.2, -1.1], [2.2, 1.1], [2.2, -1.1], [-2.2, 1.1], [0, -1.5], [0, 1.5]];
const POWERS = [
  { id: 'triple', label: 'Triple squirt!', color: 0xff7ac8 },
  { id: 'rapid', label: 'Rapid fire!', color: 0xffd23f },
  { id: 'speed', label: 'Turbo paddle!', color: 0x5dffa0 },
  { id: 'heal', label: 'Fresh bubbles: +1 life', color: 0xff5a5a },
];
const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const rnd = (a, b) => a + (b - a) * random();

export class Match {
  constructor(water) {
    this.water = water;
    this.stage = STAGES[0];
    this.TX = this.stage.x; this.TZ = this.stage.z; this.BX = this.TX - 0.3; this.BZ = this.TZ - 0.24;
    this.t = 0;
    this.ducks = [];
    this.drops = [];
    this.events = [];
    this.over = -1;            // the winner's slot, once someone has won
    this.frozen = false;       // the countdown: nobody moves or shoots
    this.shake = 0;
    this.sea = new Float32Array(5);
    this.before = new Array(MAXD).fill(null); this.after = new Array(MAXD).fill(null);
    this.shadows = new Array(MAXD).fill(null).map(() => [0, 0, 0, 0]);
    this.pickups = [];
    this.pickupT = 4;
    this.gust = 0;
    for (let i = 0; i < MAXD; i++) {
      const mesh = makeDuck(DUCKS[i].rgb);
      mesh.visible = false;
      water.scene.add(mesh);
      this.ducks.push({ i, active: false, bot: true, src: null, tag: '', name: DUCKS[i].name, mesh,
        x: 0, z: 0, vx: 0, vz: 0, head: 0, spin: 0, y: 0, vy: 0, pitch: 0, roll: 0, draft: 0,
        hp: MAX_HP, kills: 0, deaths: 0, dead: false, deadT: 0, invuln: 0, cool: 0, safeT: 0, dashT: 0, dashCd: 0, power: null, powerT: 0, flash: 0, pop: 1,
        in: { mx: 0, mz: 0, ax: 0, az: 0, fire: false, dash: false },
        ai: { target: -1, think: 0, strafe: 1, strafeT: 0, err: 0, errT: 0, skill: 0.6 + 0.3 * random() } });
    }
    // squirts and splashes: one instanced draw each
    const wet = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x2a86b8, roughness: 0.1 });
    this.bullets = Array.from({ length: MAX_BULLETS }, () => ({ on: false, x: 0, z: 0, vx: 0, vz: 0, life: 0, owner: 0, bounces: 0, y: 0 }));
    this.bMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 14, 10), wet, MAX_BULLETS);
    this.parts = Array.from({ length: MAX_PARTS }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, s: 1 }));
    this.pMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 8, 6), wet, MAX_PARTS);
    for (const m of [this.bMesh, this.pMesh]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); water.scene.add(m); }
    // bubbles to pick up
    const bub = new THREE.SphereGeometry(0.17, 24, 16);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(bub, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.6, emissive: 0x335577 }));
      m.visible = false; water.scene.add(m);
      this.pickups.push({ on: false, x: 0, z: 0, kind: 0, mesh: m, t: 0 });
    }
    this.dummy = new THREE.Object3D();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.dw = new Float32Array(5);
  }

  // ---------------------------------------------------------------- who is in
  activate(i, { bot, src = null, tag = '' }) {
    const d = this.ducks[i];
    const was = d.active;
    Object.assign(d, { active: true, bot, src, tag });
    d.mesh.visible = true;
    if (!was) { d.kills = 0; d.deaths = 0; this.spawn(d, true); }
    return d;
  }
  deactivate(i) { const d = this.ducks[i]; d.active = false; d.mesh.visible = false; d.src = null; }
  count() { let n = 0; for (const d of this.ducks) if (d.active) n++; return n; }

  setStage(S) {
    this.stage = S; this.TX = S.x; this.TZ = S.z; this.BX = S.x - 0.3; this.BZ = S.z - 0.24;
    this.water.setStage(S);
  }
  inside(x, z) { return !this.stage.oval || (x / this.BX) ** 2 + (z / this.BZ) ** 2 <= 1; }

  reset() {   // a fresh round: scores at zero, everyone back at their corner
    this.over = -1;
    for (const d of this.ducks) if (d.active) { d.kills = 0; d.deaths = 0; this.spawn(d, true); }
    for (const b of this.bullets) b.on = false;
    for (const p of this.pickups) { p.on = false; p.mesh.visible = false; }
    this.pickupT = 5;
  }

  spawn(d, corner) {
    let x, z;
    if (corner) { [x, z] = SPAWNS[d.i]; }
    else {   // a free spot, clear of everyone but not across the whole stage from the fight
      let best = -1;
      x = 0; z = 0;
      for (let k = 0; k < 14; k++) {
        const cx = rnd(-this.BX, this.BX), cz = rnd(-this.BZ, this.BZ);
        if (!this.inside(cx, cz)) continue;
        let near = 3.5;
        for (const o of this.ducks) if (o !== d && o.active && !o.dead) near = Math.min(near, Math.hypot(o.x - cx, o.z - cz));
        const score = near - 0.04 * Math.hypot(cx, cz);
        if (score > best) { best = score; x = cx; z = cz; }
      }
    }
    Object.assign(d, { x, z, vx: 0, vz: 0, head: Math.atan2(-z, -x), spin: 0, y: 0, vy: 0, hp: MAX_HP, dead: false, deadT: 0,
      invuln: corner ? 0.5 : 2.5, safeT: 0, cool: 0.3, dashT: 0, dashCd: 0, power: null, powerT: 0, flash: 0, pop: 0 });
    this.syncMesh(d);
  }

  // ---------------------------------------------------------------- one step of 1/60 s
  step(h) {
    this.t += h;
    const { ducks } = this;
    // the bots decide what to press
    for (const d of ducks) if (d.active && d.bot) this.think(d, h);
    for (const d of ducks) if (d.active) { const hs = this.before[d.i] = this.before[d.i] || [0, 0, 0, 0]; hs[0] = d.x; hs[1] = d.z; hs[2] = d.head; hs[3] = d.dead ? 0 : d.draft; }
    for (const d of ducks) if (d.active) this.moveDuck(d, h);
    this.collide();
    for (const d of ducks) if (d.active) this.shoot(d, h);
    this.moveBullets(h);
    this.moveParts(h);
    this.pickupStep(h);
    // gusts of wind ruffle the water now and then
    this.gust += h;
    if (this.gust > 0.25) { this.gust = 0; this.ripple(rnd(-this.TX, this.TX) * 0.95, rnd(-this.TZ, this.TZ) * 0.95, (random() < 0.5 ? -1 : 1) * rnd(0.4, 1) * 0.5, 0.03 + 0.05 * random()); }
    for (const d of ducks) {
      if (d.active) { const hs = this.after[d.i] = this.after[d.i] || [0, 0, 0, 0]; hs[0] = d.x; hs[1] = d.z; hs[2] = d.head; hs[3] = d.dead ? 0 : d.draft; }
      else { this.before[d.i] = this.after[d.i] = null; }
    }
    this.shake = Math.max(0, this.shake - h * 2.5);
    // the water takes this step, with up to eight waiting splashes
    this.water.step(this.drops.splice(0, 8), this.before, this.after);
    if (this.drops.length > 24) this.drops.length = 24;
  }

  ripple(x, z, h = 6, r = 0.06) { if (this.drops.length < 24) this.drops.push([x, z, r, h]); }

  moveDuck(d, h) {
    const I = d.in, dw = this.dw;
    d.invuln = Math.max(0, d.invuln - h); d.flash = Math.max(0, d.flash - h); d.cool = Math.max(0, d.cool - h);
    d.dashCd = Math.max(0, d.dashCd - h); d.dashT = Math.max(0, d.dashT - h); d.pop = Math.min(1, d.pop + h * 4);
    if (d.powerT > 0) { d.powerT -= h; if (d.powerT <= 0) d.power = null; }
    seaAt(d.x, d.z, dw);
    if (!d.dead && d.hp < MAX_HP && !this.frozen && this.over < 0) {
      d.safeT += h;
      if (d.safeT >= HEAL_AFTER) { d.hp++; d.safeT = HEAL_AFTER - HEAL_EVERY; }
    }
    if (d.dead) {   // sunk: it bubbles under the water for a moment, then comes back
      d.deadT -= h; d.vx *= 0.95; d.vz *= 0.95;
      if (d.deadT <= 0) { this.spawn(d, false); sound.play(S.quack, { volume: 0.6, pitch: 1.4 }); this.ripple(d.x, d.z, 8, 0.12); }
      return;
    }
    const frozen = this.frozen || this.over >= 0;
    let mx = frozen ? 0 : I.mx, mz = frozen ? 0 : I.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const top = SPEED * (d.power === 'speed' ? 1.5 : 1);
    if (!frozen && I.dash && d.dashCd <= 0) {   // a burst of speed
      const dl = ml > 0.2 ? Math.atan2(mz, mx) : d.head;
      d.vx = Math.cos(dl) * DASH_SPEED; d.vz = Math.sin(dl) * DASH_SPEED; d.dashT = 0.22; d.dashCd = 1.4;
      this.ripple(d.x, d.z, 10, 0.1); this.puff(d.x, d.z, 6, 1.2);
      sound.play(S.dash, { volume: 0.7, pitch: rnd(0.9, 1.1) }); d.dashed = true;
    }
    I.dash = false;
    if (d.dashT <= 0) { const k = Math.min(1, 6 * h); d.vx += (mx * top - d.vx) * k; d.vz += (mz * top - d.vz) * k; }
    // the water carries it a little, and the glass pushes it back
    d.x += (d.vx + 0.5 * dw[3]) * h; d.z += (d.vz + 0.5 * dw[4]) * h;
    this.keepIn(d);
    // it faces where it aims, where it paddles, or at the nearest rival when it's squirting
    let want = null;
    const al = Math.hypot(I.ax, I.az);
    if (al > 0.3) want = Math.atan2(I.az, I.ax);
    else if (ml > 0.15 && !I.fire) want = Math.atan2(mz, mx);
    else if (I.fire || al > 0) { const t = this.nearest(d, Math.PI); if (t) want = Math.atan2(t.z - d.z, t.x - d.x); }
    if (want == null && ml > 0.15) want = Math.atan2(mz, mx);
    if (want != null && !frozen) d.head += wrap(want - d.head) * Math.min(1, 12 * h);
    // it bobs on a spring toward the water's height, and leans with the slope
    d.vy += (-45 * (d.y - dw[0]) - 3.5 * d.vy) * h;
    d.y += d.vy * h;
    d.draft = Math.max(0, DRAFT + dw[0] - d.y);
    const c = Math.cos(d.head), s = Math.sin(d.head), k = Math.min(1, 5 * h);
    d.pitch += (Math.atan(dw[1] * c + dw[2] * s) - d.pitch) * k;
    d.roll += (-Math.atan(dw[2] * c - dw[1] * s) - d.roll) * k;
  }

  // the walls or the shore push a duck back
  keepIn(d) {
    const { BX, BZ } = this;
    const bonk = (v) => { if (Math.abs(v) > 0.8) { sound.play(S.bonk, { volume: 0.4 }); this.ripple(d.x, d.z, 6, 0.1); } };
    if (this.stage.oval) {
      const r = Math.hypot(d.x / BX, d.z / BZ);
      if (r <= 1) return;
      d.x /= r; d.z /= r;
      const nx = d.x / (BX * BX), nz = d.z / (BZ * BZ), l = Math.hypot(nx, nz), vn = (d.vx * nx + d.vz * nz) / l;
      if (vn > 0) { bonk(vn); d.vx -= 1.4 * vn * nx / l; d.vz -= 1.4 * vn * nz / l; }
      return;
    }
    if (d.x < -BX || d.x > BX) { d.x = Math.max(-BX, Math.min(BX, d.x)); bonk(d.vx); d.vx *= -0.4; }
    if (d.z < -BZ || d.z > BZ) { d.z = Math.max(-BZ, Math.min(BZ, d.z)); bonk(d.vz); d.vz *= -0.4; }
  }

  collide() {
    const ds = this.ducks;
    for (let a = 0; a < MAXD; a++) {
      const A = ds[a]; if (!A.active || A.dead) continue;
      for (let b = a + 1; b < MAXD; b++) {
        const B = ds[b]; if (!B.active || B.dead) continue;
        const dx = B.x - A.x, dz = B.z - A.z, dist = Math.hypot(dx, dz), min = 2 * R_DUCK * 0.9;
        if (dist < min && dist > 1e-4) {
          const nx = dx / dist, nz = dz / dist, o = (min - dist) / 2;
          A.x -= nx * o; A.z -= nz * o; B.x += nx * o; B.z += nz * o;
          // a dash rams the other duck away
          const rel = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
          if (A.dashT > 0 && rel > 1) { B.vx += nx * 2.4; B.vz += nz * 2.4; A.vx *= 0.3; A.vz *= 0.3; this.bump(B); }
          else if (B.dashT > 0 && rel < -1) { A.vx -= nx * 2.4; A.vz -= nz * 2.4; B.vx *= 0.3; B.vz *= 0.3; this.bump(A); }
        }
      }
    }
  }
  bump(d) { this.ripple(d.x, d.z, 12, 0.12); this.puff(d.x, d.z, 8, 1.5); sound.play(S.splat, { volume: 0.7 }); d.vy -= 0.4; this.shake = Math.max(this.shake, 0.3); }

  nearest(d, cone, maxDist = 30) {
    let best = null, score = 1e9;
    for (const o of this.ducks) {
      if (o === d || !o.active || o.dead) continue;
      const dx = o.x - d.x, dz = o.z - d.z, dist = Math.hypot(dx, dz), a = Math.abs(wrap(Math.atan2(dz, dx) - d.head));
      if (a > cone || dist > maxDist) continue;
      const sc = a * 1.5 + dist * 0.3;
      if (sc < score) { score = sc; best = o; }
    }
    return best;
  }

  // ---------------------------------------------------------------- squirting
  shoot(d, h) {
    if (d.dead || this.frozen || this.over >= 0 || !d.in.fire || d.cool > 0) return;
    d.cool = d.power === 'rapid' ? 0.15 : d.bot ? rnd(1.7, 2.7) : 0.36;
    let a = d.head;
    if (!d.bot) { const t = this.nearest(d, 0.5, 3.4); if (t) a += wrap(Math.atan2(t.z - d.z, t.x - d.x) - a) * 0.75; }   // a little help aiming
    const n = d.power === 'triple' ? 3 : 1;
    for (let k = 0; k < n; k++) this.spawnBullet(d, a + (k - (n - 1) / 2) * 0.22);
    sound.play(S.squirt, { volume: 0.7, pitch: rnd(0.9, 1.15), pan: Math.max(-1, Math.min(1, d.x / this.TX)) });
    d.vx -= Math.cos(a) * 0.12; d.vz -= Math.sin(a) * 0.12;
  }
  spawnBullet(d, a) {
    const b = this.bullets.find((q) => !q.on); if (!b) return;
    b.on = true; b.owner = d.i; b.life = BULLET_LIFE; b.bounces = 1;
    b.x = d.x + Math.cos(a) * 0.26; b.z = d.z + Math.sin(a) * 0.26; b.y = LEVEL + 0.26;
    b.vx = Math.cos(a) * BULLET_SPEED + d.vx * 0.3; b.vz = Math.sin(a) * BULLET_SPEED + d.vz * 0.3;
  }
  moveBullets(h) {
    for (const b of this.bullets) {
      if (!b.on) continue;
      b.life -= h; b.x += b.vx * h; b.z += b.vz * h;
      if (b.life <= 0) { this.splash(b.x, b.z, 0.5); b.on = false; continue; }
      if (!this.bounce(b)) { this.splash(b.x, b.z, 0.8); b.on = false; continue; }
      for (const d of this.ducks) {
        if (!d.active || d.dead || d.i === b.owner || d.invuln > 0) continue;
        if (Math.hypot(d.x - b.x, d.z - b.z) < R_DUCK + 0.05) { this.hit(d, b); b.on = false; break; }
      }
    }
  }
  // a squirt at a wall or the shore bounces once; false when it's spent
  bounce(b) {
    const A = this.TX - 0.04, B = this.TZ - 0.04;
    if (this.stage.oval) {
      const r = Math.hypot(b.x / A, b.z / B);
      if (r <= 1) return true;
      if (b.bounces-- <= 0) return false;
      b.x /= r; b.z /= r;
      const nx = b.x / (A * A), nz = b.z / (B * B), l = Math.hypot(nx, nz), vn = (b.vx * nx + b.vz * nz) / l;
      b.vx -= 2 * vn * nx / l; b.vz -= 2 * vn * nz / l;
      return true;
    }
    if (Math.abs(b.x) > A) { b.x = Math.sign(b.x) * A; if (b.bounces-- <= 0) return false; b.vx *= -1; }
    if (Math.abs(b.z) > B) { b.z = Math.sign(b.z) * B; if (b.bounces-- <= 0) return false; b.vz *= -1; }
    return true;
  }
  hit(d, b) {
    const sp = Math.hypot(b.vx, b.vz) || 1, nx = b.vx / sp, nz = b.vz / sp;
    d.hp -= 1; d.invuln = Math.max(d.invuln, HIT_GRACE); d.safeT = 0; d.flash = 0.3; d.vx += nx * 1.1; d.vz += nz * 1.1; d.vy -= 0.35; d.dashT = 0;
    this.ripple(d.x, d.z, 14, 0.1); this.puff(d.x, d.z, 12, 1.8);
    sound.play(S.hit, { volume: 0.8, pitch: rnd(0.9, 1.1), pan: Math.max(-1, Math.min(1, d.x / this.TX)) });
    sound.play(S.squeak, { volume: 0.35, pitch: rnd(0.9, 1.2) });
    this.shake = Math.max(this.shake, 0.25);
    if (d.hp <= 0) this.pop(d, this.ducks[b.owner]);
    else this.events.push({ type: 'hit', victim: d.i });
  }
  pop(d, killer) {
    d.dead = true; d.deadT = 2.6; d.deaths++; d.power = null; d.powerT = 0;
    this.ripple(d.x, d.z, 26, 0.16); this.puff(d.x, d.z, 18, 2.4); this.shake = 0.6;
    sound.play(S.pop, { volume: 0.9 });
    if (killer && killer !== d) killer.kills++;
    this.events.push({ type: 'kill', victim: d.i, killer: killer ? killer.i : -1 });
    if (killer && killer !== d && killer.kills >= KILLS_TO_WIN && this.over < 0) { this.over = killer.i; this.events.push({ type: 'win', winner: killer.i }); }
  }
  splash(x, z, s) { this.ripple(x, z, 5 * s, 0.07); this.puff(x, z, 3, 0.8); if (random() < 0.5) sound.play(S.splat, { volume: 0.2 * s, pitch: rnd(1.1, 1.6) }); }
  // droplets thrown up from the water
  puff(x, z, n, power) {
    for (let k = 0; k < n; k++) {
      const p = this.parts.find((q) => !q.on); if (!p) return;
      const a = random() * TAU, sp = rnd(0.2, 0.9) * power;
      p.on = true; p.x = x + Math.cos(a) * 0.08; p.z = z + Math.sin(a) * 0.08; p.y = LEVEL + 0.1;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = rnd(0.8, 2.2) * Math.min(1.6, power); p.life = rnd(0.5, 0.9); p.s = rnd(0.45, 1.1);
    }
  }
  moveParts(h) {
    for (const p of this.parts) {
      if (!p.on) continue;
      p.vy -= 7 * h; p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h; p.life -= h;
      if (p.y < LEVEL + 0.01 && p.vy < 0) { p.on = false; if (random() < 0.12) this.ripple(p.x, p.z, 1.5, 0.04); }
      else if (p.life <= 0) p.on = false;
    }
  }

  // ---------------------------------------------------------------- bubbles to pick up
  pickupStep(h) {
    if (this.frozen || this.over >= 0) return;
    this.pickupT -= h;
    const live = this.pickups.filter((p) => p.on).length;
    if (this.pickupT <= 0 && live < this.stage.pickups) {
      this.pickupT = rnd(6, 10);
      const p = this.pickups.find((q) => !q.on);
      if (p) {
        p.on = true; p.x = rnd(-this.BX * 0.7, this.BX * 0.7); p.z = rnd(-this.BZ * 0.7, this.BZ * 0.7); p.t = 0; p.kind = Math.floor(random() * POWERS.length);
        p.mesh.material.emissive.set(POWERS[p.kind].color).multiplyScalar(0.5); p.mesh.material.color.set(POWERS[p.kind].color).lerp(new THREE.Color(1, 1, 1), 0.55); p.mesh.visible = true; p.mesh.scale.setScalar(0.01);
        this.ripple(p.x, p.z, 8, 0.1);
      }
    }
    for (const p of this.pickups) {
      if (!p.on) continue;
      p.t += h;
      for (const d of this.ducks) {
        if (!d.active || d.dead || Math.hypot(d.x - p.x, d.z - p.z) > 0.34) continue;
        const pw = POWERS[p.kind];
        if (pw.id === 'heal') d.hp = Math.min(MAX_HP, d.hp + 1); else { d.power = pw.id; d.powerT = 9; }
        p.on = false; p.mesh.visible = false;
        this.ripple(p.x, p.z, 10, 0.12); this.puff(p.x, p.z, 10, 1.2);
        sound.play(S.pickup, { volume: 0.8 });
        this.events.push({ type: 'pickup', duck: d.i, text: pw.label });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- bots
  think(d, h) {
    const I = d.in, A = d.ai;
    if (d.dead || this.frozen || this.over >= 0) { I.mx = I.mz = I.ax = I.az = 0; I.fire = false; return; }
    A.think -= h; A.strafeT -= h; A.errT -= h;
    if (A.strafeT <= 0) { A.strafeT = rnd(0.8, 2.2); A.strafe = random() < 0.5 ? -1 : 1; }
    if (A.errT <= 0) { A.errT = rnd(0.3, 0.7); A.err = (random() - 0.5) * (1.2 - A.skill) * 1.6; }
    if (A.think <= 0) {
      A.think = 0.1 + 0.1 * (1 - A.skill);
      const cur = A.target >= 0 ? this.ducks[A.target] : null;
      if (!cur || !cur.active || cur.dead || random() < 0.08) { const t = this.pickTarget(d); A.target = t ? t.i : -1; }
    }
    const t = A.target >= 0 ? this.ducks[A.target] : null;
    let mx = 0, mz = 0;
    if (t && t.active && !t.dead) {
      const dx = t.x - d.x, dz = t.z - d.z, dist = Math.hypot(dx, dz) || 1, ux = dx / dist, uz = dz / dist;
      const want = 1.2, push = Math.max(-1, Math.min(1, (dist - want) * 1.5));
      mx = ux * push + -uz * A.strafe * 0.7; mz = uz * push + ux * A.strafe * 0.7;
      const ang = Math.atan2(dz, dx) + A.err;
      I.ax = Math.cos(ang); I.az = Math.sin(ang);
      I.fire = dist < 2.7 && Math.abs(wrap(ang - d.head)) < 0.22 && random() < 0.06 + 0.1 * A.skill;
    } else { I.ax = I.az = 0; I.fire = false; }
    // dodge a squirt that's coming straight at it
    for (const b of this.bullets) {
      if (!b.on || b.owner === d.i) continue;
      const rx = d.x - b.x, rz = d.z - b.z, along = (rx * b.vx + rz * b.vz) / BULLET_SPEED, side = (rx * -b.vz + rz * b.vx) / BULLET_SPEED;
      if (along > 0 && along < 0.9 && Math.abs(side) < 0.3 && random() < 0.05 * A.skill) { const s = side > 0 ? 1 : -1; mx += -b.vz / BULLET_SPEED * s * 2; mz += b.vx / BULLET_SPEED * s * 2; if (random() < 0.15) I.dash = true; }
    }
    // keep off the glass
    const { BX, BZ } = this;
    if (this.stage.oval) { const r = Math.hypot(d.x / BX, d.z / BZ); if (r > 0.88) { mx -= d.x / (BX * r); mz -= d.z / (BZ * r); } }
    else { if (d.x > BX - 0.3) mx -= 1; if (d.x < -BX + 0.3) mx += 1; if (d.z > BZ - 0.25) mz -= 1; if (d.z < -BZ + 0.25) mz += 1; }
    const l = Math.hypot(mx, mz) || 1;
    I.mx = mx / Math.max(1, l) * 0.9; I.mz = mz / Math.max(1, l) * 0.9;
    for (const q of this.pickups) if (q.on && random() < 0.003) { I.mx += Math.sign(q.x - d.x) * 0.5; I.mz += Math.sign(q.z - d.z) * 0.5; }
  }

  // the nearest rival, but one nobody else is after yet if it can: bots don't all gang up on one duck
  pickTarget(d) {
    let best = null, score = 1e9;
    for (const o of this.ducks) {
      if (o === d || !o.active || o.dead) continue;
      let after = 0;
      for (const q of this.ducks) if (q !== d && q.active && q.bot && !q.dead && q.ai.target === o.i) after++;
      const sc = Math.hypot(o.x - d.x, o.z - d.z) + after * 3;
      if (sc < score) { score = sc; best = o; }
    }
    return best;
  }

  // ---------------------------------------------------------------- showing it, once a frame
  syncMesh(d) {
    const m = d.mesh;
    if (!d.active) return;
    const sinkT = d.dead ? Math.max(0, 1 - (2.6 - d.deadT) * 3) : 1;   // sinks away in a third of a second
    const grow = d.pop;
    m.visible = !(d.dead && sinkT <= 0) && !(d.invuln > 0.3 && Math.floor(this.t * 12) % 2 === 0);
    m.position.set(d.x, LEVEL + d.y - DRAFT - (1 - sinkT) * 0.25, d.z);
    m.rotation.set(d.roll, -d.head + (d.dead ? (1 - sinkT) * 5 : 0), d.pitch, 'YZX');
    m.scale.setScalar(Math.max(0.01, sinkT * (0.3 + 0.7 * grow) * (d.dashT > 0 ? 1.05 : 1)));
    // flash white when hit; a glow while invulnerable or powered up
    const f = d.flash > 0 ? d.flash / 0.3 : 0, glow = 0;
    m.body.emissive.copy(m.baseEmissive).addScalar(f * 0.8 + Math.max(0, glow));
    if (d.power && d.powerT > 0) m.body.emissive.addScalar(0.12 + 0.08 * Math.sin(this.t * 9));
  }

  draw() {
    for (const d of this.ducks) {
      this.syncMesh(d);
      const s = this.shadows[d.i];
      if (d.active && !d.dead) { s[0] = d.x; s[1] = d.z; s[2] = d.head; s[3] = 1; } else s[3] = 0;
    }
    const D = this.dummy;
    this.bullets.forEach((b, i) => {
      if (!b.on) { this.bMesh.setMatrixAt(i, this.zero); return; }
      D.position.set(b.x, b.y, b.z); D.scale.setScalar(0.8 + 0.4 * (b.life / BULLET_LIFE)); D.rotation.set(0, 0, 0); D.updateMatrix(); this.bMesh.setMatrixAt(i, D.matrix);
    });
    this.parts.forEach((p, i) => {
      if (!p.on) { this.pMesh.setMatrixAt(i, this.zero); return; }
      D.position.set(p.x, p.y, p.z); D.scale.setScalar(p.s * Math.min(1, p.life * 3)); D.rotation.set(0, 0, 0); D.updateMatrix(); this.pMesh.setMatrixAt(i, D.matrix);
    });
    this.bMesh.instanceMatrix.needsUpdate = this.pMesh.instanceMatrix.needsUpdate = true;
    for (const p of this.pickups) {
      if (!p.on) continue;
      const g = Math.min(1, p.t * 3);
      p.mesh.position.set(p.x, LEVEL + 0.25 + 0.04 * Math.sin(this.t * 3 + p.x * 4), p.z);
      p.mesh.scale.setScalar(g * (1 + 0.05 * Math.sin(this.t * 6)));
    }
    this.water.draw(this.t, this.shadows);
  }

  // what the pause or a change of code needs to keep
  snapshot() {
    return { t: this.t, over: this.over, stage: this.stage.id, ducks: this.ducks.map((d) => ({ a: d.active, b: d.bot, s: d.src, tag: d.tag, x: d.x, z: d.z, h: d.head, hp: d.hp, k: d.kills, dd: d.deaths, dead: d.dead })) };
  }
  restore(s) {
    if (!s) return;
    this.t = s.t || 0; this.over = s.over == null ? -1 : s.over;
    (s.ducks || []).forEach((q, i) => {
      if (!q || !q.a) return;
      const d = this.activate(i, q.s ? { bot: false, src: q.s, tag: q.tag || '' } : { bot: true });
      Object.assign(d, { x: q.x, z: q.z, head: q.h, hp: q.hp, kills: q.k, deaths: q.dd || 0, dead: !!q.dead, deadT: q.dead ? 1 : 0, pop: 1 });
      this.syncMesh(d);
    });
  }
}

export { POWERS };
