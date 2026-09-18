// Pointer-driven creature editing: placing, dragging and selecting parts on the body
// surface, plus freehand painting straight onto the model.

import * as THREE from 'three';
import { newId, PART_RANGES, LIMITS } from '../creature/spec.js';

const GHOST = '__ghost';

export class Editor {
  constructor(stage, creature, onChange) {
    this.stage = stage;
    this.creature = creature;
    this.onChange = onChange;
    this.mode = 'build';
    this.enabled = true;
    this.selectedId = null;
    this.pending = null;
    this.drag = null;
    this.brush = { color: '#3b2a2a', size: 0.05, mirror: true, erase: false, role: 'primary' };
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this._lastUV = null;
    this._lastUVm = null;
    const el = stage.canvas;
    el.addEventListener('pointerdown', (e) => this._down(e), true);
    el.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointerleave', () => this._clearGhost());
    window.addEventListener('keydown', (e) => this._key(e));
  }

  get spec() {
    return this.creature.spec;
  }

  setMode(mode) {
    this.mode = mode;
    this.cancelPending();
    if (mode !== 'build') this.select(null);
  }

  select(id) {
    this.selectedId = id;
    this.stage.outline.selectedObjects = id ? this.creature.instances.filter((i) => i.part.id === id).map((i) => i.obj) : [];
    this.onChange('select');
  }

  selected() {
    return this.spec.parts.find((p) => p.id === this.selectedId) || null;
  }

  beginPlace(kind) {
    this.cancelPending();
    this.select(null);
    this.pending = kind;
    this.stage.canvas.style.cursor = 'copy';
  }

  cancelPending() {
    this._clearGhost();
    this.pending = null;
    this.stage.canvas.style.cursor = '';
  }

  removeSelected() {
    if (!this.selectedId) return;
    this.spec.parts = this.spec.parts.filter((p) => p.id !== this.selectedId);
    this.select(null);
    this.commit();
  }

  duplicateSelected() {
    const p = this.selected();
    if (!p || this.spec.parts.length >= LIMITS.parts) return;
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = newId();
    copy.p = [p.p[0], p.p[1], p.p[2] - 0.25];
    this.spec.parts.push(copy);
    this.commit();
    this.select(copy.id);
  }

  commit(kind = 'spec') {
    this.creature.rebuild();
    if (this.selectedId) this.stage.outline.selectedObjects = this.creature.instances.filter((i) => i.part.id === this.selectedId).map((i) => i.obj);
    this.onChange(kind);
  }

  _setRay(e) {
    const r = this.stage.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
  }

  _hitBody() {
    const hit = this.ray.intersectObject(this.creature.bodyMesh, false)[0];
    if (!hit) return null;
    const mesh = this.creature.bodyMesh;
    const pos = mesh.geometry.attributes.position;
    const base = this.creature.bodyBase.attributes.position;
    const { a, b, c } = hit.face;
    const local = mesh.worldToLocal(hit.point.clone());
    const tri = new THREE.Triangle(
      new THREE.Vector3().fromBufferAttribute(pos, a),
      new THREE.Vector3().fromBufferAttribute(pos, b),
      new THREE.Vector3().fromBufferAttribute(pos, c),
    );
    const bc = tri.getBarycoord(local, new THREE.Vector3()) || new THREE.Vector3(1, 0, 0);
    const p = new THREE.Vector3()
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(base, a), bc.x)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(base, b), bc.y)
      .addScaledVector(new THREE.Vector3().fromBufferAttribute(base, c), bc.z);
    const dir = p.normalize();
    if (Math.abs(dir.x) < 0.07) dir.setX(0).normalize();
    return { dir, hit, local };
  }

  _hitPart() {
    const objs = this.creature.instances.filter((i) => i.part.id !== GHOST).map((i) => i.obj);
    const hit = this.ray.intersectObjects(objs, true)[0];
    if (!hit) return null;
    const bodyHit = this.ray.intersectObject(this.creature.bodyMesh, false)[0];
    if (bodyHit && bodyHit.distance < hit.distance - 0.02) return null;
    return { id: hit.object.userData.partId, side: hit.object.userData.side || 1 };
  }

  _makePart(kind, dir) {
    const lib = this.creature.lib;
    const def = lib.parts.get(kind);
    const part = { id: GHOST, p: [dir.x, dir.y, dir.z], scale: PART_RANGES.scale[2], twist: 0, mirror: true };
    if (def.limbEnd) Object.assign(part, { kind: 'limb', end: kind, len: PART_RANGES.len[2], thick: PART_RANGES.thick[2] });
    else part.kind = kind;
    return part;
  }

  _clearGhost() {
    const before = this.spec.parts.length;
    this.spec.parts = this.spec.parts.filter((p) => p.id !== GHOST);
    if (this.spec.parts.length !== before) this.creature.rebuild();
  }

  _down(e) {
    if (!this.enabled || e.button !== 0) return;
    this._setRay(e);
    if (this.mode === 'paint') return this._paintDown(e);
    if (this.mode !== 'build') return;
    if (this.pending) {
      const h = this._hitBody();
      if (!h) return;
      this._clearGhost();
      if (this.spec.parts.length >= LIMITS.parts) return this.cancelPending();
      const part = this._makePart(this.pending, h.dir);
      part.id = newId();
      this.spec.parts.push(part);
      const keep = e.shiftKey ? this.pending : null;
      this.cancelPending();
      this.commit();
      this.select(part.id);
      if (keep) this.beginPlace(keep);
      this._block(e);
      return;
    }
    const ph = this._hitPart();
    if (ph) {
      this.select(ph.id);
      this.drag = { id: ph.id, side: ph.side, moved: false };
      this._block(e);
      return;
    }
    this._downAt = [e.clientX, e.clientY];
  }

  _block(e) {
    this.stage.controls.enabled = false;
    e.stopPropagation();
    this.stage.canvas.setPointerCapture(e.pointerId);
  }

  _move(e) {
    if (!this.enabled) return;
    this._setRay(e);
    if (this.mode === 'paint') return this._paintMove(e);
    if (this.mode !== 'build') return;
    if (this.drag) {
      const h = this._hitBody();
      if (!h) return;
      const part = this.spec.parts.find((p) => p.id === this.drag.id);
      if (!part) return;
      part.p = [h.dir.x * this.drag.side, h.dir.y, h.dir.z];
      if (part.p[0] < 0 && part.mirror) { part.p[0] *= -1; this.drag.side *= -1; }
      this.drag.moved = true;
      this.commit('drag');
      return;
    }
    if (this.pending && e.buttons === 0) {
      const h = this._hitBody();
      if (!h) return this._clearGhost();
      let g = this.spec.parts.find((p) => p.id === GHOST);
      if (!g) {
        g = this._makePart(this.pending, h.dir);
        this.spec.parts.push(g);
      }
      g.p = [h.dir.x, h.dir.y, h.dir.z];
      this.creature.rebuild();
    }
  }

  _up(e) {
    if (this.mode === 'paint') this._paintUp();
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) this.commit();
    } else if (this._downAt && this.mode === 'build') {
      const d = Math.hypot(e.clientX - this._downAt[0], e.clientY - this._downAt[1]);
      if (d < 4 && e.target === this.stage.canvas) this.select(null);
    }
    this._downAt = null;
    this.stage.controls.enabled = true;
  }

  _key(e) {
    if (!this.enabled || this.mode !== 'build') return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.key === 'Escape') { this.cancelPending(); this.select(null); }
    if (e.key === 'Delete' || e.key === 'Backspace') this.removeSelected();
    if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.duplicateSelected(); }
  }

  _paintDown(e) {
    const ph = this._hitPart();
    if (ph) {
      const part = this.spec.parts.find((p) => p.id === ph.id);
      if (this.brush.erase) delete part.colors;
      else part.colors = { ...(part.colors || {}), [this.brush.role]: this.brush.color };
      this.creature.recolor();
      this.onChange('spec');
      this._block(e);
      return;
    }
    const h = this._hitBody();
    if (!h) return;
    this.painting = true;
    this._lastUV = null;
    this._lastUVm = null;
    this._block(e);
    this._paintAt(h);
  }

  _paintMove() {
    if (!this.painting) return;
    const h = this._hitBody();
    if (!h) { this._lastUV = null; this._lastUVm = null; return; }
    this._paintAt(h);
  }

  _paintUp() {
    if (!this.painting) return;
    this.painting = false;
    this.onChange('tex');
  }

  _paintAt(h) {
    const uv = h.hit.uv;
    if (!uv) return;
    this._lastUV = this._stroke(this._lastUV, uv);
    if (this.brush.mirror) {
      const mesh = this.creature.bodyMesh;
      const n = h.hit.face.normal.clone();
      const o = h.local.clone().addScaledVector(n, 0.25);
      o.x *= -1;
      n.x *= -1;
      const ray = new THREE.Raycaster(o.applyMatrix4(mesh.matrixWorld), n.negate().transformDirection(mesh.matrixWorld));
      const mh = ray.intersectObject(mesh, false)[0];
      this._lastUVm = mh && mh.uv ? this._stroke(this._lastUVm, mh.uv) : null;
    }
    this.creature.refreshTexture();
  }

  _stroke(last, uv) {
    const ctx = this.creature.paint.getContext('2d');
    const W = this.creature.paint.width;
    const r = this.brush.size;
    ctx.globalCompositeOperation = this.brush.erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = this.brush.color;
    const stamp = (u, v) => {
      const s = Math.max(Math.sin(Math.PI * v), 0.1);
      const rx = (W * r) / (2 * s);
      const ry = W * r;
      for (const du of [0, -1, 1]) {
        const cx = (u + du) * W;
        if (cx + rx < 0 || cx - rx > W) continue;
        ctx.beginPath();
        ctx.ellipse(cx, v * W, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (last && Math.abs(last.x - uv.x) < 0.35) {
      const steps = Math.ceil(Math.hypot(uv.x - last.x, uv.y - last.y) / (r * 0.25)) || 1;
      for (let i = 1; i <= steps; i++) stamp(last.x + ((uv.x - last.x) * i) / steps, last.y + ((uv.y - last.y) * i) / steps);
    } else stamp(uv.x, uv.y);
    ctx.globalCompositeOperation = 'source-over';
    return uv.clone();
  }

  clearPaint() {
    const c = this.creature.paint;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    this.creature.refreshTexture();
    this.onChange('tex');
  }
}
