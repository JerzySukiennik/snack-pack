// Truck game client. Runs on every player; on the host it also owns the Sim and the
// peer links. Own movement is local (character controller), everything else comes
// from host snapshots interpolated 100 ms in the past.

import * as THREE from 'three';
import { initPhysics, buildStaticWorld, GROUP, groups } from './physics.js';
import { Sim } from './sim.js';
import { Hud } from './hud.js';
import { hostLinks, joinHost } from '../net/peer.js';

const SNAP_HZ = 20;
const DELAY = 0.1;
const LABEL = { bun: 'bun', sausage: 'sausage', hotdog: 'hot dog', ketchup: 'ketchup', mustard: 'mustard', spatula: 'spatula', plate: 'plate', cup: 'cup', tomato: 'tomato', onion: 'onion', crate: 'crate', cone: 'cone', duck: 'duck' };
const BOARD_Y = 1.0;

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

export class Game {
  constructor(o) {
    Object.assign(this, o);
    this.isHost = o.hostId === o.room.selfId;
    this.active = false;
    this.items = new Map();
    this.customers = new Map();
    this.metas = new Map();
    this.snaps = [];
    this.keys = new Set();
    this.yaw = Math.PI;
    this.pitch = -0.18;
    this.vy = 0;
    this.heldId = 0;
    this.chargeT = -1;
    this.mini = null;
    this.over = false;
    this.group = new THREE.Group();
    this.itemLayer = new THREE.Group();
    this.group.add(this.itemLayer);
    this.rayc = new THREE.Raycaster();
    this.holdPoint = new THREE.Vector3();
    this.links = new Map();
    this._sendT = 0;
    this._listeners = [];
  }

  async start() {
    const R = await initPhysics();
    this.R = R;
    const layout = this.world.layout;
    this.size = Math.max(this.me.spec.body.size, 0.4);
    const box = this.me.bodyMesh.geometry.boundingBox;
    const H = Math.max((this.me.rideY + box.max.y) * this.size, 0.5);
    this.r = Math.min(0.3 * this.size * Math.max(1, this.me.spec.body.width * 0.9), H * 0.48);
    this.hh = Math.max(0.05, H / 2 - this.r);
    this.H = H;

    this.phys = buildStaticWorld(R, layout);
    this.body = this.phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.col = this.phys.createCollider(R.ColliderDesc.capsule(this.hh, this.r).setCollisionGroups(groups(GROUP.PLAYER, GROUP.STATIC)), this.body);
    this.ctrl = this.phys.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.3, 0.1, true);
    this.ctrl.enableSnapToGround(0.25);
    this.ctrl.setMaxSlopeClimbAngle(0.9);
    const slot = Math.max(0, this.room.state.slot);
    const sp = layout.spawns[slot % layout.spawns.length];
    this.pos = new THREE.Vector3(sp[0], sp[1] + 0.05, sp[2]);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + this.hh + this.r, z: this.pos.z }, true);
    this.phys.step();
    this.thin = new Set();
    this.phys.colliders.forEach((c) => {
      const he = c.halfExtents && c.halfExtents();
      if (he && Math.min(he.x, he.z) < 0.08) this.thin.add(c.handle);
    });

    this.stage.setEnv('truck');
    this.stage.scene.add(this.world.scene, this.group);
    this.proxies = [];
    for (const s of ['buns', 'sausages']) {
      const st = layout.stations[s];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(st.p[0], st.p[1] - 0.05, st.p[2]);
      m.userData.station = s;
      this.group.add(m);
      this.proxies.push(m);
    }
    this.hud = new Hud(document.getElementById('hud'));
    this.hud.leave.addEventListener('click', () => this.onExit('left'));
    this._bind();
    this.me.root.position.copy(this.pos);
    this.me._resetFeet();

    if (this.isHost) {
      const ids = [...this.room.players.keys()];
      this.sim = new Sim(R, layout, ids, (k, d) => this._emit(k, d));
      this.hub = hostLinks(this.room, this.gen, (link) => this._hostLink(link));
      this._ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),1000/60)'], { type: 'text/javascript' })));
      this._last = performance.now();
      this._acc = 0;
      this._netT = 0;
      this._ticker.onmessage = () => this._hostTick();
    } else {
      this.link = await joinHost(this.room, this.hostId, this.gen);
      this.link.onmessage = (m) => this._recv(m);
      this.link.onclose = () => { if (this.active) this.onExit('host-left'); };
    }
    this.active = true;
  }

  _bind() {
    const on = (t, e, f, opt) => { t.addEventListener(e, f, opt); this._listeners.push([t, e, f, opt]); };
    const canvas = this.stage.canvas;
    on(canvas, 'click', () => { if (!document.pointerLockElement && !this.over && canvas.requestPointerLock) { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } });
    on(document, 'pointerlockchange', () => this.hud.lock.classList.toggle('hidden', !!document.pointerLockElement));
    on(document, 'mousemove', (e) => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && !(e.buttons & 2)) return;
      if (this.mini) return this._miniMove(e.movementX, e.movementY);
      this.yaw -= e.movementX * 0.0023;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0021, -1.15, 0.9);
    });
    on(canvas, 'mousedown', (e) => {
      if (document.pointerLockElement !== canvas && e.button === 0 && canvas.requestPointerLock) return;
      if (e.button === 0) this.primary(true);
      if (e.button === 2) this.chargeT = performance.now();
    });
    on(document, 'mouseup', (e) => {
      if (e.button === 0) this.primary(false);
      if (e.button === 2) this.throwNow();
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => {
      if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'e') this.interact();
      if (k === 'h') this.hud.toggleHelp();
      if (k === 'f') this.chargeT = performance.now();
      if (k === ' ') { e.preventDefault(); if (this.mini) this.interact(); }
      if (k === 'escape' && this.mini) this._miniEnd(true);
    });
    on(window, 'keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      if (k === 'f') this.throwNow();
    });
    on(window, 'blur', () => this.keys.clear());
  }

  _emit(kind, data) {
    const msg = { e: kind, d: data };
    if (kind === 'to') {
      if (data.id === this.room.selfId) this._event(kind, data);
      else { const l = this.links.get(data.id); if (l) l.send(msg); }
      return;
    }
    for (const l of this.links.values()) l.send(msg);
    this._event(kind, data);
  }

  _hostLink(link) {
    this.links.set(link.id, link);
    if (!this.sim.players.has(link.id)) this.sim.addPlayer(link.id);
    for (const m of this.sim.metas()) link.send({ e: 'meta', d: m });
    link.onmessage = (m) => {
      if (m.i) this.sim.input(link.id, m.i);
      else if (m.a) this.sim.action(link.id, m);
    };
    link.onclose = () => { this.links.delete(link.id); this.sim.removePlayer(link.id); };
  }

  _hostTick() {
    if (!this.active) return;
    const now = performance.now();
    this._acc = Math.min(this._acc + (now - this._last) / 1000, 0.25);
    this._last = now;
    let stepped = false;
    while (this._acc >= 1 / 60) { this.sim.step(1 / 60); this._acc -= 1 / 60; stepped = true; }
    if (!stepped) return;
    const snap = this.sim.snapshot();
    this._pushSnap(snap);
    this._netT += 1;
    if (this._netT >= 60 / SNAP_HZ) {
      this._netT = 0;
      for (const l of this.links.values()) l.send({ s: snap }, false);
    }
  }

  _recv(m) {
    if (m.s) this._pushSnap(m.s);
    else if (m.e) this._event(m.e, m.d);
  }

  _pushSnap(s) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return;
    s.at = performance.now() / 1000;
    this.snaps.push(s);
    if (this.snaps.length > 12) this.snaps.shift();
  }

  _send(msg, reliable = true) {
    if (this.isHost) {
      if (msg.i) this.sim.input(this.room.selfId, msg.i);
      else this.sim.action(this.room.selfId, msg);
    } else if (this.link) this.link.send(msg, reliable);
  }

  _event(kind, d) {
    if (kind === 'meta') {
      this.metas.set(d.id, d.meta);
      const v = this.items.get(d.id);
      if (v && !v.dressed) { this.world.dressHotdog(v.obj, d.meta); v.dressed = true; }
    } else if (kind === 'to' && d.k === 'assemble') this._miniStart(d.cook, d.pos);
    else if (kind === 'fx') {
      if (d.k === 'pay' || d.k === 'lost') {
        const c = this.customers.get(d.c);
        if (c) this.hud.pop(this._screen(tmp.copy(c.obj.position).setY(2.3)), d.k === 'lost' ? 'Left hungry' : `+$${d.pay}  ${'★'.repeat(d.stars)}`, d.k === 'pay' && d.match);
      }
    } else if (kind === 'over') {
      this.over = true;
      if (document.exitPointerLock) document.exitPointerLock();
      this.hud.showSummary(d, () => this.onExit('done'));
    }
  }

  primary(down) {
    if (!this.active || this.over) return;
    if (this.mini) return this._miniClick(down);
    if (!down) return;
    if (this.heldId) { this._send(this.target && this.target.combine ? { a: 'combine', id: this.target.combine } : { a: 'drop' }); return; }
    const t = this.target;
    if (!t) return;
    if (t.station) this._send({ a: 'dispense', s: t.station });
    else this._send({ a: 'grab', id: t.id });
  }

  throwNow() {
    if (this.chargeT < 0) return;
    const held = (performance.now() - this.chargeT) / 1000;
    this.chargeT = -1;
    if (!this.heldId || this.mini) return;
    const power = 4 + Math.min(held, 1.1) / 1.1 * 9;
    const dir = this._aim(tmp);
    this._send({ a: 'throw', v: [dir.x * power, dir.y * power + 1.2, dir.z * power] });
  }

  interact() {
    if (!this.active || this.over) return;
    if (this.mini) { if (this.mini.stage === 'sauce') this._miniEnd(false); return; }
    if (this.can === 'order') this._send({ a: 'order' });
    else if (this.can === 'assemble' && !this.heldId) this._send({ a: 'assemble' });
  }

  _aim(out) {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  _screen(p) {
    p.project(this.stage.camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, visible: p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2 };
  }

  _move(dt) {
    const k = this.keys;
    const x = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const z = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const move = tmp.set(0, 0, 0);
    if ((x || z) && !this.mini && !this.over) {
      move.set(fx * z - fz * x, 0, fz * z + fx * x).normalize().multiplyScalar((k.has('shift') ? 4.6 : 3.1) * Math.sqrt(this.size) * dt);
    }
    const grounded = this.ctrl.computedGrounded();
    if (grounded && k.has(' ') && !this.mini && !this.over) this.vy = 6.8 * Math.sqrt(Math.max(this.size, 0.6));
    else this.vy = grounded && this.vy <= 0 ? -1 : this.vy - 20 * dt;
    move.y = this.vy * dt;
    this.ctrl.computeColliderMovement(this.col, move, undefined, groups(GROUP.PLAYER, GROUP.STATIC));
    const m = this.ctrl.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    if (next.y < -10) { next.x = 0; next.y = 2; next.z = -0.3; }
    this.body.setNextKinematicTranslation(next);
    this.phys.step();
    this.pos.set(next.x, next.y - this.hh - this.r, next.z);
    this.me.root.position.copy(this.pos);
    if (!this.mini) {
      const goal = Math.atan2(fx, fz);
      let d = goal - this.me.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.me.root.rotation.y += d * (1 - Math.exp(-dt * 12));
    }
  }

  _camera(dt) {
    const cam = this.stage.camera;
    if (this.mini) {
      const c = this.mini.center;
      const side = tmp2.set(this.pos.x - c.x, 0, this.pos.z - c.z);
      if (side.lengthSq() < 0.01) side.set(0, 0, -1);
      side.normalize();
      cam.position.lerp(tmp.copy(c).addScaledVector(this.mini.side, 0.75).setY(c.y + 1.05), 1 - Math.exp(-dt * 7));
      tmp2.copy(c);
      const m = new THREE.Matrix4().lookAt(cam.position, tmp2, THREE.Object3D.DEFAULT_UP);
      cam.quaternion.slerp(qa.setFromRotationMatrix(m), 1 - Math.exp(-dt * 9));
      return;
    }
    const s = Math.max(1, Math.pow(this.size, 0.85));
    const aim = this._aim(tmp2);
    const pivot = tmp.copy(this.pos);
    pivot.y += this.H * 0.82;
    const right = new THREE.Vector3(-aim.z, 0, aim.x).normalize();
    const want = pivot.clone().addScaledVector(aim, -2.7 * s).addScaledVector(right, 0.22 * s + this.r * 0.55);
    want.y = Math.max(want.y + 0.55 * s, 0.35);
    const R = this.R;
    const back = want.clone().sub(pivot);
    const backLen = back.length();
    back.divideScalar(backLen);
    const block = this.phys.castRay(new R.Ray(pivot, back), backLen, true, undefined, undefined, this.col, undefined, (c) => !this.thin.has(c.handle));
    if (block) want.copy(pivot).addScaledVector(back, Math.max(block.timeOfImpact - 0.25, 0.9 * s));
    if (this._camSnap) cam.position.copy(want);
    else { cam.position.lerp(want, 1 - Math.exp(-dt * 10)); if (cam.position.distanceTo(want) < 0.05) this._camSnap = true; }
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    const chest = pivot.clone();
    chest.y -= this.H * 0.25;
    const reach = 1.75 * s + this.r;
    const toChest = chest.clone().sub(cam.position);
    const t0 = toChest.dot(aim);
    const perp = Math.sqrt(Math.max(toChest.lengthSq() - t0 * t0, 0));
    const tMax = t0 + Math.sqrt(Math.max(reach * reach - perp * perp, 0.01));
    const surf = this.phys.castRay(new R.Ray(cam.position, aim), tMax + 0.5, true, undefined, undefined, this.col);
    const t = Math.max(Math.min(surf ? surf.timeOfImpact - 0.1 : tMax, tMax), 0.35);
    this.holdPoint.copy(cam.position).addScaledVector(aim, t);
    if (surf && surf.timeOfImpact <= tMax + 0.1) this.holdPoint.y += 0.14;
    this.holdPoint.y = Math.max(this.holdPoint.y, 0.2);
  }

  _applySnap(dt) {
    if (!this.snaps.length) return null;
    const latest = this.snaps[this.snaps.length - 1];
    const now = performance.now() / 1000;
    const rt = this.isHost ? latest.t : latest.t + (now - latest.at) - DELAY;
    let a = this.snaps[0];
    let b = latest;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].t <= rt) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    const f = b.t > a.t ? THREE.MathUtils.clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const prev = new Map(a.items.map((it) => [it[0], it]));
    const alive = new Set();
    for (const it of b.items) {
      const id = it[0];
      alive.add(id);
      let v = this.items.get(id);
      if (!v) {
        v = { obj: this.world.makeItem(it[1]), type: it[1], cook: -1, dressed: false };
        v.obj.userData.id = id;
        v.obj.position.set(it[2], it[3], it[4]);
        this.itemLayer.add(v.obj);
        this.items.set(id, v);
        const meta = this.metas.get(id);
        if (meta) { this.world.dressHotdog(v.obj, meta); v.dressed = true; }
      }
      const p = prev.get(id) || it;
      if (id === this.heldId) {
        const real = tmp.set(it[2], it[3], it[4]);
        v.obj.position.lerp(real.distanceTo(this.holdPoint) > 0.45 ? real : this.holdPoint, 1 - Math.exp(-dt * 18));
        v.obj.quaternion.slerp(qa.set(it[5], it[6], it[7], it[8]), 0.3);
      } else {
        v.obj.position.set(p[2] + (it[2] - p[2]) * f, p[3] + (it[3] - p[3]) * f, p[4] + (it[4] - p[4]) * f);
        v.obj.quaternion.copy(qa.set(p[5], p[6], p[7], p[8])).slerp(qb.set(it[5], it[6], it[7], it[8]), f);
      }
      if (it[1] === 'sausage' && it[9] !== v.cook) { v.cook = it[9]; this.world.setCook(v.obj, it[9]); }
      v.obj.visible = !(this.mini && it[10]);
    }
    for (const [id, v] of this.items) {
      if (alive.has(id)) continue;
      this.itemLayer.remove(v.obj);
      this.items.delete(id);
      this.metas.delete(id);
    }

    const mine = b.players[this.room.selfId];
    this.heldId = mine ? mine[4] : 0;
    for (const [id, pb] of Object.entries(b.players)) {
      if (id === this.room.selfId) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      const pa = a.players[id] || pb;
      const root = r.creature.root;
      root.position.set(pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f);
      root.rotation.y = pb[3];
      const held = pb[4] && this.items.get(pb[4]);
      r.creature.reach = held ? held.obj.position : null;
    }

    const seen = new Set();
    const pc = new Map(a.cust.map((c) => [c[0], c]));
    for (const c of b.cust) {
      seen.add(c[0]);
      let v = this.customers.get(c[0]);
      if (!v) {
        v = { obj: this.world.makeCustomer(c[8]) };
        this.group.add(v.obj);
        this.customers.set(c[0], v);
      }
      const p = pc.get(c[0]) || c;
      const x = p[1] + (c[1] - p[1]) * f;
      const z = p[2] + (c[2] - p[2]) * f;
      const speed = Math.hypot(c[1] - p[1], c[2] - p[2]) / Math.max(b.t - a.t, 0.016);
      v.obj.position.x = x;
      v.obj.position.z = z;
      let dy = c[3] - v.obj.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      v.obj.rotation.y += dy * (1 - Math.exp(-dt * 8));
      this.world.animateCustomer(v.obj, speed, dt, c[9], c[4] === 1);
      const show = c[4] === 1 || (c[4] === 2 && c[9] !== 0 && Math.hypot(x, z - 2) < 6);
      this.hud.bubble(c[0], show ? this._screen(tmp.set(x, 2.25 * v.obj.scale.y, z)) : null, { ketchup: c[5], taken: c[6], patience: c[7], mood: c[9], state: c[4] });
    }
    for (const [id, v] of this.customers) {
      if (seen.has(id)) continue;
      this.group.remove(v.obj);
      this.customers.delete(id);
    }
    this.hud.pruneBubbles(seen);
    this.hud.setStats(b.g);
    this.hud.setTickets(b.tk);
    return b;
  }

  _target(snap) {
    this.target = null;
    this.can = null;
    const lines = [];
    const outline = [];
    if (this.mini || this.over) { this.stage.outline.selectedObjects = outline; return this.hud.setPrompt([]); }
    const s = Math.max(1, this.size);
    const cam = this.stage.camera.position;
    const dir = this._aim(tmp2).clone();
    const chest = tmp.copy(this.pos).setY(this.pos.y + this.H * 0.6).clone();
    const reach = 2.9 * s + this.r;
    const pick = (list) => {
      let best = null;
      let bestScore = Infinity;
      for (const [obj, station] of list) {
        const c = obj.position;
        if (c.distanceTo(chest) > reach) continue;
        const vx = c.x - cam.x, vy = c.y - cam.y, vz = c.z - cam.z;
        const along = vx * dir.x + vy * dir.y + vz * dir.z;
        if (along < 0.3) continue;
        const off = Math.sqrt(Math.max(vx * vx + vy * vy + vz * vz - along * along, 0));
        const ang = Math.atan2(off, along);
        if (ang > (station ? 0.2 : 0.17) && off > (station ? 0.5 : 0.3)) continue;
        const score = ang + along * 0.004;
        if (score < bestScore) { bestScore = score; best = { obj, station }; }
      }
      return best;
    };
    const heldV = this.heldId && this.items.get(this.heldId);
    if (heldV) {
      const want = heldV.type === 'sausage' ? 'bun' : heldV.type === 'bun' ? 'sausage' : null;
      const mate = want && pick([...this.items.values()].filter((v) => v.type === want && v.obj.visible && v.obj !== heldV.obj).map((v) => [v.obj, null]));
      if (mate) {
        this.target = { combine: mate.obj.userData.id };
        outline.push(mate.obj);
        lines.push(heldV.type === 'sausage' ? 'Click: put the sausage in the bun' : 'Click: wrap the bun around the sausage');
      } else {
        lines.push('Click: put down where you aim', 'Hold F or right-click: throw');
        if (heldV.type === 'sausage') lines.push(heldV.cook < 6 ? 'Raw! Put it on the grill first' : 'Aim at a bun to build a hot dog');
        if (heldV.type === 'bun') lines.push('Aim at a grilled sausage to build a hot dog');
        if (heldV.type === 'hotdog') lines.push('Put it on the window counter');
      }
    } else {
      const best = pick([...[...this.items.values()].filter((v) => v.obj.visible).map((v) => [v.obj, null]), ...this.proxies.map((pr) => [pr, pr.userData.station])]);
      if (best) {
        if (best.station) {
          this.target = { station: best.station };
          lines.push(`Click: take a ${best.station === 'buns' ? 'bun' : 'sausage'}`);
        } else {
          this.target = { id: best.obj.userData.id };
          outline.push(best.obj);
          lines.push(`Click: grab ${LABEL[best.obj.userData.type] || 'item'}`);
        }
      }
    }
    if (snap) {
      const dWin = Math.hypot(this.pos.x, this.pos.z - 1.0);
      const dBoard = Math.hypot(this.pos.x - 2.3, this.pos.z - 0.85);
      const order = dWin < 2.6 + this.r && snap.cust.some((c) => c[4] === 1 && !c[6]);
      const build = dBoard < 2.3 + this.r && snap.g[4] && !this.heldId;
      if (build && (!order || dBoard < dWin)) { this.can = 'assemble'; lines.push('E: build the hot dog'); }
      else if (order) { this.can = 'order'; lines.push('E: take order'); }
    }
    this.stage.outline.selectedObjects = outline;
    this.hud.setPrompt(lines);
  }

  _miniStart(cook, pos) {
    const b = pos || this.world.layout.stations.board.c;
    const g = new THREE.Group();
    const center = new THREE.Vector3(b[0], Math.max(b[1] - 0.03, 0.02), b[2]);
    const side = new THREE.Vector3(this.pos.x - center.x, 0, this.pos.z - center.z);
    if (side.lengthSq() < 0.01) side.set(0, 0, -1);
    side.normalize();
    g.position.copy(center);
    g.rotation.y = Math.atan2(-side.x, -side.z);
    const bun = this.world.makeItem('bun');
    bun.position.y = 0.045;
    const saus = this.world.makeItem('sausage');
    this.world.setCook(saus, cook);
    const bottle = this.world.makeItem('ketchup');
    bottle.visible = false;
    g.add(bun, saus, bottle);
    this.group.add(g);
    this.mini = { stage: 'press', g, bun, saus, bottle, center, side, cur: new THREE.Vector2(0.18, -0.12), t: 0, path: [], tube: null, down: false, off: [0, 0], ang: 0, press: 0, cook, drop: 0 };
    this.me.reach = center.clone().addScaledVector(side, 0.3).setY(center.y + 0.05);
  }

  _miniMove(mx, my) {
    const m = this.mini;
    m.cur.x = THREE.MathUtils.clamp(m.cur.x - mx * 0.0011, -0.32, 0.32);
    m.cur.y = THREE.MathUtils.clamp(m.cur.y - my * 0.0011, -0.22, 0.22);
  }

  _miniClick(down) {
    const m = this.mini;
    if (m.stage === 'press' && down) {
      m.off = [THREE.MathUtils.clamp(m.cur.x, -0.12, 0.12), THREE.MathUtils.clamp(m.cur.y, -0.06, 0.06)];
      m.ang = m.saus.rotation.y;
      const miss = Math.min(1, Math.abs(m.cur.y) / 0.07) * 0.5 + Math.min(1, Math.abs(m.cur.x) / 0.13) * 0.25 + Math.min(1, Math.abs(m.ang) / 0.5) * 0.35;
      m.press = Math.max(0, 1 - miss);
      m.stage = 'drop';
      m.drop = 0;
    } else if (m.stage === 'sauce') m.down = down;
  }

  _miniUpdate(dt) {
    const m = this.mini;
    m.t += dt;
    if (m.stage === 'press') {
      m.cur.x += Math.sin(m.t * 1.7) * 0.05 * dt;
      m.cur.y += Math.cos(m.t * 2.3) * 0.05 * dt;
      m.saus.position.set(m.cur.x, 0.2 + Math.sin(m.t * 5) * 0.008, m.cur.y);
      m.saus.rotation.y = Math.sin(m.t * 2.1) * 0.55;
      this.hud.setMini('Line the sausage up with the bun, then click to press it in');
    } else if (m.stage === 'drop') {
      m.drop = Math.min(1, m.drop + dt * 5);
      m.saus.position.set(m.off[0], 0.2 - 0.15 * m.drop, m.off[1]);
      if (m.drop >= 1) { m.stage = 'sauce'; m.bottle.visible = true; m.cur.set(-0.2, 0.1); }
    } else if (m.stage === 'sauce') {
      m.bottle.position.set(m.cur.x, 0.4, m.cur.y);
      m.bottle.rotation.set(Math.PI, 0, m.down ? Math.sin(m.t * 40) * 0.04 : 0);
      if (m.down) {
        const last = m.path[m.path.length - 1];
        if (!last || Math.hypot(last[0] - m.cur.x, last[1] - m.cur.y) > 0.014) {
          m.path.push([m.cur.x, m.cur.y]);
          if (m.path.length > 2) {
            if (m.tube) { m.g.remove(m.tube); m.tube.geometry.dispose(); }
            const pts = m.path.map((p) => new THREE.Vector3(p[0], 0.093, p[1]));
            m.tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.009, 6, false), new THREE.MeshStandardMaterial({ color: '#d2201a', roughness: 0.3 }));
            m.g.add(m.tube);
          }
          if (m.path.length >= 40) return this._miniEnd(false);
        }
      }
      this.hud.setMini('Hold the mouse to squeeze ketchup along the bun. Press E when done (or straight away for NO ketchup)');
    }
  }

  _miniEnd(cancel) {
    const m = this.mini;
    if (!m) return;
    let sauce = 0;
    if (m.path.length > 2) {
      const bins = new Set();
      let spill = 0;
      for (const [x, z] of m.path) {
        if (Math.abs(z) > 0.06 || Math.abs(x) > 0.17) spill++;
        else bins.add(Math.floor((x + 0.15) / 0.03));
      }
      sauce = THREE.MathUtils.clamp(bins.size / 10 - (spill / m.path.length) * 0.7, 0, 1);
    }
    const rel = m.path.map((p) => [p[0], p[1]]);
    this._send(cancel || m.stage === 'press' ? { a: 'assembled', cancel: true } : { a: 'assembled', press: m.press, sauce, off: m.off, ang: m.ang, path: rel });
    this.group.remove(m.g);
    this.mini = null;
    this._camSnap = false;
    this.me.reach = null;
    this.hud.setMini('');
    this._aim(tmp);
  }

  update(dt) {
    if (!this.active) return;
    this._move(dt);
    this._camera(dt);
    if (this.mini) this._miniUpdate(dt);
    const snap = this._applySnap(dt);
    if (!this.mini) {
      const held = this.heldId && this.items.get(this.heldId);
      this.me.reach = held ? held.obj.position : null;
    }
    this._target(snap);
    this.hud.setCharge(this.chargeT >= 0 && this.heldId ? Math.min((performance.now() - this.chargeT) / 1100, 1) : 0);
    this.world.fadeWalls(this.stage.camera, tmp.copy(this.pos).setY(this.pos.y + this.H * 0.6), dt);
    this._sendT += dt;
    if (this._sendT >= 1 / 30) {
      this._sendT = 0;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      this._send({ i: { p: [r3(this.pos.x), r3(this.pos.y), r3(this.pos.z)], y: r3(this.me.root.rotation.y), h: this.mini ? null : [r3(this.holdPoint.x), r3(this.holdPoint.y), r3(this.holdPoint.z)], r: r3(this.r), hh: r3(this.hh) } }, false);
    }
  }

  stop() {
    this.active = false;
    for (const [t, e, f, opt] of this._listeners) t.removeEventListener(e, f, opt);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    if (this._ticker) this._ticker.terminate();
    if (this.hub) this.hub.close();
    if (this.link) { this.link.onclose = null; this.link.close(); }
    for (const l of this.links.values()) l.close();
    this.stage.scene.remove(this.world.scene, this.group);
    this.stage.outline.selectedObjects = [];
    this.me.reach = null;
    for (const r of this.remotes.values()) r.creature.reach = null;
    this.hud.destroy();
    this.stage.setEnv('garage');
  }
}
