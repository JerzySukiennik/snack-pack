// Host-side simulation: physics items, grabbing, the grill, hot dog assembly, customers,
// tickets and money. Clients only ever see its snapshots and events.

import { buildStaticWorld, GROUP, groups, inBox } from './physics.js';

export const DAY_SECONDS = 300;
export const COOK = { done: 6, perfect: 9, burnt: 13 };
const MAX_ITEMS = 90;

export const ITEM_TYPES = {
  bun: { shape: 'box', h: [0.17, 0.045, 0.085], mass: 0.12 },
  sausage: { shape: 'capsuleX', hh: 0.12, r: 0.03, mass: 0.1 },
  hotdog: { shape: 'box', h: [0.17, 0.055, 0.085], mass: 0.25 },
  ketchup: { shape: 'cyl', hh: 0.15, r: 0.05, mass: 0.3, y: 0.15 },
  mustard: { shape: 'cyl', hh: 0.15, r: 0.05, mass: 0.3, y: 0.15 },
  spatula: { shape: 'box', h: [0.2, 0.015, 0.055], mass: 0.15 },
  plate: { shape: 'cyl', hh: 0.014, r: 0.15, mass: 0.2, y: 0.012 },
  cup: { shape: 'cyl', hh: 0.075, r: 0.05, mass: 0.06, y: 0.075 },
  tomato: { shape: 'ball', r: 0.065, mass: 0.12, y: 0.06 },
  onion: { shape: 'ball', r: 0.062, mass: 0.12, y: 0.06 },
  crate: { shape: 'box', h: [0.2, 0.15, 0.15], mass: 0.9, y: 0.15 },
  cone: { shape: 'cyl', hh: 0.2, r: 0.13, mass: 0.5, y: 0.2 },
  duck: { shape: 'ball', r: 0.085, mass: 0.08, y: 0.08 },
};

const PROPS = [
  ['ketchup', 1.2, 1.12, 1.0], ['mustard', 1.45, 1.12, 1.0], ['spatula', -1.4, 1.1, 0.95], ['plate', -0.6, 1.1, 1.3],
  ['plate', -0.6, 1.14, 1.3], ['cup', 0.5, 1.12, 1.45], ['cup', 0.7, 1.12, 1.45], ['tomato', 2.2, 1.05, -0.4],
  ['tomato', 2.0, 1.05, -0.3], ['onion', -2.0, 1.05, -0.3], ['crate', -1.2, 0.3, -2.6], ['crate', -0.7, 0.3, -2.7],
  ['crate', -0.95, 0.62, -2.65], ['cone', 5.6, 0.25, 2.0], ['cone', -5.4, 0.25, 2.2], ['duck', 0, 1.2, 1.2],
];

export class Sim {
  constructor(R, layout, playerIds, emit) {
    this.R = R;
    this.layout = layout;
    this.emit = emit;
    this.world = buildStaticWorld(R, layout);
    this.world.timestep = 1 / 60;
    this.items = new Map();
    this.players = new Map();
    this.customers = [];
    this.tickets = [];
    this.nextId = 1;
    this.time = 0;
    this.money = 0;
    this.served = 0;
    this.lost = 0;
    this.qualitySum = 0;
    this.spawnT = 4;
    this.over = false;
    this.assembling = new Map();
    for (const id of playerIds) this.addPlayer(id);
    for (const [type, x, y, z] of PROPS) this.spawn(type, [x, y, z]);
  }

  addPlayer(id) {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -20, 0));
    const col = this.world.createCollider(R.ColliderDesc.capsule(0.45, 0.32).setCollisionGroups(groups(GROUP.PLAYER, GROUP.ITEM)), body);
    this.players.set(id, { id, body, col, pos: [0, 0, 0], yaw: 0, hold: null, held: 0, r: 0.32, hh: 0.45, seen: 0 });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.release(p);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
  }

  spawn(type, pos, extra) {
    if (this.items.size >= MAX_ITEMS) return null;
    const R = this.R;
    const t = ITEM_TYPES[type];
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setLinearDamping(0.25).setAngularDamping(0.9).setCcdEnabled(true));
    let desc;
    if (t.shape === 'box') desc = R.ColliderDesc.cuboid(t.h[0], t.h[1], t.h[2]);
    else if (t.shape === 'ball') desc = R.ColliderDesc.ball(t.r);
    else if (t.shape === 'cyl') desc = R.ColliderDesc.cylinder(t.hh, t.r);
    else desc = R.ColliderDesc.capsule(t.hh, t.r).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
    desc.setMass(t.mass).setFriction(0.85).setRestitution(0.15).setCollisionGroups(groups(GROUP.ITEM, GROUP.STATIC | GROUP.ITEM | GROUP.PLAYER));
    const col = this.world.createCollider(desc, body);
    const item = { id: this.nextId++, type, body, col, cook: 0, holder: null, lock: null, meta: extra || null, rest: 0 };
    this.items.set(item.id, item);
    if (item.meta) this.emit('meta', { id: item.id, meta: item.meta });
    return item;
  }

  remove(item) {
    if (item.holder) { item.holder.held = 0; item.holder = null; }
    this.world.removeRigidBody(item.body);
    this.items.delete(item.id);
  }

  input(id, m) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(m.p)) return;
    p.pos = m.p.map(Number);
    p.yaw = +m.y || 0;
    p.hold = Array.isArray(m.h) ? m.h.map(Number) : null;
    if (m.r && m.hh) {
      const r = Math.min(Math.max(+m.r, 0.15), 3);
      const hh = Math.min(Math.max(+m.hh, 0.1), 6);
      if (Math.abs(r - p.r) > 0.01 || Math.abs(hh - p.hh) > 0.01) {
        p.r = r; p.hh = hh;
        p.col.setShape(new this.R.Capsule(hh, r));
      }
    }
    p.seen = this.time;
  }

  release(p, impulse) {
    const item = this.items.get(p.held);
    p.held = 0;
    if (!item) return;
    item.holder = null;
    item.body.setGravityScale(1, true);
    item.col.setCollisionGroups(groups(GROUP.ITEM, GROUP.STATIC | GROUP.ITEM | GROUP.PLAYER));
    if (impulse) {
      item.body.setLinvel({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
      item.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    }
  }

  hold(p, item) {
    if (item.holder || item.lock) return;
    item.holder = p;
    p.held = item.id;
    item.body.setGravityScale(0, true);
    item.col.setCollisionGroups(groups(GROUP.HELD, GROUP.STATIC | GROUP.ITEM));
  }

  action(id, m) {
    const p = this.players.get(id);
    if (!p || this.over) return;
    const near = (pt, d) => Math.hypot(pt[0] - p.pos[0], pt[2] - p.pos[2]) < d + p.r;
    if (m.a === 'grab' && !p.held) {
      const item = this.items.get(m.id);
      if (item) {
        const t = item.body.translation();
        if (near([t.x, t.y, t.z], 3.2)) this.hold(p, item);
      }
    } else if (m.a === 'dispense' && !p.held && p.hold) {
      const st = this.layout.stations[m.s];
      if (st && st.p && near(st.p, 2.6)) {
        const item = this.spawn(m.s === 'buns' ? 'bun' : 'sausage', p.hold);
        if (item) this.hold(p, item);
      }
    } else if (m.a === 'drop' && p.held) this.release(p);
    else if (m.a === 'throw' && p.held && Array.isArray(m.v)) {
      const v = m.v.map(Number);
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      const k = Math.min(len, 14) / len;
      this.release(p, [v[0] * k, v[1] * k, v[2] * k]);
    } else if (m.a === 'order') this.takeOrder(p);
    else if (m.a === 'assemble') this.beginAssemble(p);
    else if (m.a === 'assembled') this.endAssemble(p, m);
  }

  takeOrder(p) {
    if (Math.hypot(p.pos[0], p.pos[2] - 1.0) > 2.8 + p.r) return;
    const c = this.customers.filter((x) => x.state === 'waiting' && !x.taken).sort((a, b) => a.since - b.since)[0];
    if (!c) return;
    c.taken = true;
    this.tickets.push({ id: c.id, ketchup: c.ketchup, t: this.time });
    this.emit('fx', { k: 'order', c: c.id });
  }

  boardItems() {
    const box = this.layout.stations.board;
    let bun = null;
    let sausage = null;
    for (const it of this.items.values()) {
      if (it.holder || it.lock) continue;
      const t = it.body.translation();
      if (!inBox(t, box, 0.08)) continue;
      if (it.type === 'bun' && !bun) bun = it;
      if (it.type === 'sausage' && it.cook >= COOK.done && !sausage) sausage = it;
    }
    return { bun, sausage };
  }

  beginAssemble(p) {
    if (this.assembling.has(p.id)) return;
    const { bun, sausage } = this.boardItems();
    if (!bun || !sausage) return;
    bun.lock = sausage.lock = p.id;
    this.assembling.set(p.id, { bun, sausage, t: this.time });
    this.emit('to', { id: p.id, k: 'assemble', cook: sausage.cook });
  }

  endAssemble(p, m) {
    const job = this.assembling.get(p.id);
    if (!job) return;
    this.assembling.delete(p.id);
    job.bun.lock = job.sausage.lock = null;
    if (m.cancel || !this.items.has(job.bun.id) || !this.items.has(job.sausage.id)) return;
    const clamp01 = (v) => Math.min(1, Math.max(0, +v || 0));
    const cook = job.sausage.cook;
    const cookQ = cook >= COOK.burnt ? 0.1 : 1 - Math.min(Math.abs(cook - COOK.perfect) / 5, 0.6);
    const path = Array.isArray(m.path) ? m.path.slice(0, 40).map((q) => [Math.max(-0.3, Math.min(0.3, +q[0] || 0)), Math.max(-0.2, Math.min(0.2, +q[1] || 0))]) : [];
    const meta = { press: clamp01(m.press), sauce: clamp01(m.sauce), ketchup: path.length > 2, cookQ, cook, off: [+m.off?.[0] || 0, +m.off?.[1] || 0], ang: +m.ang || 0, path };
    const b = this.layout.stations.board;
    this.remove(job.bun);
    this.remove(job.sausage);
    this.spawn('hotdog', [b.c[0], b.c[1] + 0.08, b.c[2]], meta);
    this.emit('fx', { k: 'assembled', by: p.id });
  }

  spawnCustomer() {
    const free = this.layout.spots.map((_, i) => i).filter((i) => !this.customers.some((c) => c.spot === i && c.state !== 'leaving'));
    if (!free.length) return;
    const spot = free[Math.floor(Math.random() * free.length)];
    const e = this.layout.entries[Math.floor(Math.random() * this.layout.entries.length)];
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(e[0], 0.85, e[2]));
    this.world.createCollider(R.ColliderDesc.capsule(0.5, 0.26).setCollisionGroups(groups(GROUP.PLAYER, GROUP.ITEM)), body);
    this.customers.push({
      id: this.nextId++, x: e[0], z: e[2], yaw: 0, spot, state: 'walkIn', taken: false, ketchup: Math.random() < 0.7,
      patience: 1, since: 0, seed: Math.floor(Math.random() * 1e6), mood: 0, exit: e, body,
      kind: ['calm', 'hurry', 'gourmet'][Math.floor(Math.random() * 3)],
    });
  }

  serve(c, item) {
    const meta = item.meta || { press: 0.5, sauce: 0.5, ketchup: false, cookQ: 0.5 };
    const match = meta.ketchup === c.ketchup;
    const sauceQ = c.ketchup ? meta.sauce : 1;
    const q = match ? meta.press * 0.45 + sauceQ * 0.3 + meta.cookQ * 0.25 : 0.15;
    const stars = q > 0.8 ? 3 : q > 0.55 ? 2 : q > 0.3 ? 1 : 0;
    const weight = c.kind === 'gourmet' ? 1.5 : 1;
    const tip = match ? Math.round(9 * q * weight * (0.4 + 0.6 * c.patience)) : 0;
    const pay = (match ? 10 : 4) + tip;
    this.money += pay;
    this.served += 1;
    this.qualitySum += q;
    c.state = 'leaving';
    c.mood = match && stars >= 2 ? 1 : match ? 0 : -1;
    this.tickets = this.tickets.filter((t) => t.id !== c.id);
    this.emit('fx', { k: 'pay', c: c.id, pay, stars, match });
    this.remove(item);
  }

  step(dt) {
    this.time += dt;
    for (const p of this.players.values()) {
      p.body.setNextKinematicTranslation({ x: p.pos[0], y: p.pos[1] + p.hh + p.r, z: p.pos[2] });
      const item = this.items.get(p.held);
      if (!item) { p.held = 0; continue; }
      if (!p.hold) continue;
      const t = item.body.translation();
      const d = [p.hold[0] - t.x, p.hold[1] - t.y, p.hold[2] - t.z];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len > 4.5) { this.release(p); continue; }
      const k = 14;
      item.body.setLinvel({ x: d[0] * k, y: d[1] * k, z: d[2] * k }, true);
      const av = item.body.angvel();
      item.body.setAngvel({ x: av.x * 0.85, y: av.y * 0.85, z: av.z * 0.85 }, true);
    }
    for (const [pid, job] of this.assembling) {
      if (this.time - job.t > 45 || !this.players.has(pid)) {
        job.bun.lock = job.sausage.lock = null;
        this.assembling.delete(pid);
      }
    }

    const st = this.layout.stations;
    for (const it of [...this.items.values()]) {
      const t = it.body.translation();
      if (t.y < -6) { this.remove(it); continue; }
      if (it.holder) continue;
      const v = it.body.linvel();
      const slow = Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 0.6;
      if (it.type === 'sausage' && slow && inBox(t, st.grill, 0.05)) it.cook = Math.min(it.cook + dt, 30);
      if (inBox(t, st.bin, 0.1) && t.y < st.bin.c[1] + 0.2) { this.emit('fx', { k: 'bin', p: [t.x, t.y, t.z] }); this.remove(it); continue; }
      if (it.type === 'hotdog' && slow && inBox(t, st.window, 0.05)) {
        const c = this.customers.filter((x) => x.state === 'waiting' && x.taken).sort((a, b) => {
          const ma = (it.meta && it.meta.ketchup === a.ketchup) ? 0 : 1;
          const mb = (it.meta && it.meta.ketchup === b.ketchup) ? 0 : 1;
          return ma - mb || a.since - b.since;
        })[0];
        if (c) this.serve(c, it);
      }
    }

    if (!this.over) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnCustomer();
        const n = Math.max(1, this.players.size);
        const ramp = 1 - 0.35 * Math.min(this.time / DAY_SECONDS, 1);
        this.spawnT = Math.max(5, (19 - 3.5 * n) * ramp) * (0.75 + Math.random() * 0.5);
      }
    }
    for (const c of [...this.customers]) {
      const target = c.state === 'leaving' ? c.exit : this.layout.spots[c.spot];
      const dx = target[0] - c.x;
      const dz = target[2] - c.z;
      const dist = Math.hypot(dx, dz);
      if (c.state !== 'waiting' && dist > 0.05) {
        const s = Math.min(dist, (c.state === 'leaving' ? 1.9 : 1.6) * dt);
        c.x += (dx / dist) * s;
        c.z += (dz / dist) * s;
        c.yaw = Math.atan2(dx, dz);
      } else if (c.state === 'walkIn') {
        c.state = 'waiting';
        c.since = this.time;
        c.yaw = Math.PI;
      } else if (c.state === 'leaving') {
        this.world.removeRigidBody(c.body);
        this.customers.splice(this.customers.indexOf(c), 1);
        continue;
      }
      if (c.state === 'waiting') {
        const total = c.kind === 'hurry' ? 55 : 80;
        c.patience = Math.max(0, 1 - (this.time - c.since) / total);
        if (c.patience <= 0 || this.over) {
          c.state = 'leaving';
          c.mood = -1;
          if (!this.over) { this.lost += 1; this.emit('fx', { k: 'lost', c: c.id }); }
          this.tickets = this.tickets.filter((t) => t.id !== c.id);
        }
      }
      c.body.setNextKinematicTranslation({ x: c.x, y: 0.85, z: c.z });
    }

    if (!this.over && this.time >= DAY_SECONDS) {
      this.over = true;
      const avg = this.served ? this.qualitySum / this.served : 0;
      this.emit('over', { money: this.money, served: this.served, lost: this.lost, stars: this.served ? Math.max(1, Math.round(avg * 3 - this.lost * 0.25)) : 0 });
    }
    this.world.step();
  }

  snapshot() {
    const r = (v) => Math.round(v * 1000) / 1000;
    const items = [];
    for (const it of this.items.values()) {
      const t = it.body.translation();
      const q = it.body.rotation();
      items.push([it.id, it.type, r(t.x), r(t.y), r(t.z), r(q.x), r(q.y), r(q.z), r(q.w), Math.round(it.cook * 10) / 10, it.lock ? 1 : 0]);
    }
    const players = {};
    for (const p of this.players.values()) players[p.id] = [r(p.pos[0]), r(p.pos[1]), r(p.pos[2]), r(p.yaw), p.held, this.assembling.has(p.id) ? 1 : 0];
    const cust = this.customers.map((c) => [c.id, r(c.x), r(c.z), r(c.yaw), c.state === 'waiting' ? 1 : c.state === 'leaving' ? 2 : 0, c.ketchup ? 1 : 0, c.taken ? 1 : 0, Math.round(c.patience * 100), c.seed, c.mood]);
    const { bun, sausage } = this.boardItems();
    return {
      t: r(this.time), items, players, cust,
      g: [Math.max(0, Math.round(DAY_SECONDS - this.time)), this.money, this.served, this.lost, bun && sausage ? 1 : 0],
      tk: this.tickets.map((t) => [t.id, t.ketchup ? 1 : 0, Math.round(this.time - t.t)]),
    };
  }

  metas() {
    const out = [];
    for (const it of this.items.values()) if (it.meta) out.push({ id: it.id, meta: it.meta });
    return out;
  }
}
