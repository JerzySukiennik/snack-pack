// Builds a live creature from a spec: deformed painted body, surface-attached parts,
// two-bone IK limbs and a procedural gait that works for any number of legs.

import * as THREE from 'three';
import { deformPoint, deformGeometry } from './deform.js';
import { FIXED_ROLES } from './library.js';

const TEX_SIZE = 1024;
const UNIT_CYL = new THREE.CylinderGeometry(0.82, 1, 1, 20, 1, true).translate(0, 0.5, 0);
const UNIT_SPH = new THREE.SphereGeometry(1, 20, 14);
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();

export class Creature {
  constructor(lib, spec) {
    this.lib = lib;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.limbLayer = new THREE.Group();
    this.root.add(this.pivot, this.limbLayer);
    this.instances = [];
    this.legs = [];
    this.arms = [];
    this.paint = document.createElement('canvas');
    this.paint.width = this.paint.height = TEX_SIZE;
    this.composite = document.createElement('canvas');
    this.composite.width = this.composite.height = TEX_SIZE;
    this.texture = new THREE.CanvasTexture(this.composite);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.anisotropy = 8;
    this.bodyMat = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.66 });
    this.bodyMesh = null;
    this.bodyType = null;
    this.rideY = 0.5;
    this.phase = 0;
    this.time = Math.random() * 10;
    this.talkT = 0;
    this.speed = 0;
    this.lastPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this._texLoaded = null;
    this.frozen = false;
    this.reach = null;
    this.setSpec(spec);
  }

  setSpec(spec) {
    this.spec = spec;
    if (spec.tex !== this._texLoaded) this._loadTex(spec.tex);
    this.rebuild();
  }

  _loadTex(tex) {
    this._texLoaded = tex;
    const ctx = this.paint.getContext('2d');
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
    if (!tex) return this.refreshTexture();
    const img = new Image();
    img.onload = () => {
      if (this._texLoaded !== tex) return;
      ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      this.refreshTexture();
    };
    img.src = tex;
  }

  exportTex(size = 512) {
    const data = this.paint.getContext('2d').getImageData(0, 0, TEX_SIZE, TEX_SIZE).data;
    let any = false;
    for (let i = 3; i < data.length; i += 64) if (data[i]) { any = true; break; }
    if (!any) return null;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(this.paint, 0, 0, size, size);
    let url = c.toDataURL('image/webp', 0.9);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    this._texLoaded = url;
    return url;
  }

  refreshTexture() {
    const ctx = this.composite.getContext('2d');
    ctx.fillStyle = this.spec.colors.primary;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ctx.drawImage(this.paint, 0, 0);
    this.texture.needsUpdate = true;
  }

  frame(part, side) {
    const b = this.spec.body;
    const dir = v1.set(part.p[0] * side, part.p[1], part.p[2]).normalize().clone();
    const t1 = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(dir).normalize() : new THREE.Vector3(1, 0, 0).cross(dir).normalize();
    const t2 = dir.clone().cross(t1).normalize();
    const e = 0.06;
    const pos = deformPoint(this.lib.surfacePoint(b.type, dir), b);
    const pa = deformPoint(this.lib.surfacePoint(b.type, dir.clone().addScaledVector(t1, e)), b);
    const pb = deformPoint(this.lib.surfacePoint(b.type, dir.clone().addScaledVector(t2, e)), b);
    const n = pa.sub(pos).cross(pb.sub(pos)).normalize();
    const centre = deformPoint(new THREE.Vector3(0, 0, part.p[2] * 0.3), b);
    if (n.dot(v2.copy(pos).sub(centre)) < 0) n.negate();
    return { pos, n };
  }

  orientation(n, orient, twist, out) {
    let z;
    if (orient === 'up') {
      z = v2.set(0, 1, 0).addScaledVector(n, -n.y);
      if (z.lengthSq() < 0.03) z.set(0, 0, -1).addScaledVector(n, n.z);
      z.normalize().negate();
    } else {
      z = v2.set(0, 0, 1).addScaledVector(n, -n.z);
      if (z.lengthSq() < 0.03) z.set(0, -1, 0).addScaledVector(n, n.y);
      z.normalize();
    }
    const x = v3.copy(n).cross(z).normalize();
    const m = new THREE.Matrix4().makeBasis(x, n, z.clone());
    out.setFromRotationMatrix(m);
    if (twist) out.multiply(q1.setFromAxisAngle(UP, twist));
    return out;
  }

  rebuild() {
    const { spec, lib } = this;
    const b = spec.body;
    for (const inst of this.instances) this._disposeObj(inst.obj);
    this.pivot.clear();
    this.limbLayer.clear();
    this.instances = [];
    this.legs = [];
    this.arms = [];

    if (this.bodyType !== b.type || !this.bodyMesh) {
      if (this.bodyMesh) this.bodyMesh.geometry.dispose();
      this.bodyBase = lib.bodies.get(b.type);
      this.bodyMesh = new THREE.Mesh(this.bodyBase.clone(), this.bodyMat);
      this.bodyMesh.castShadow = true;
      this.bodyMesh.receiveShadow = true;
      this.bodyMesh.userData.isBody = true;
      this.bodyType = b.type;
      this._bodyKey = null;
    }
    const key = JSON.stringify(b);
    if (key !== this._bodyKey) deformGeometry(this.bodyBase, this.bodyMesh.geometry, b);
    this._bodyKey = key;
    this.pivot.add(this.bodyMesh);
    this.refreshTexture();
    this.root.scale.setScalar(b.size);

    for (const part of spec.parts) {
      const sides = part.mirror && Math.abs(part.p[0]) > 0.05 ? [1, -1] : [1];
      for (const side of sides) this._addInstance(part, side);
    }
    this._computeRide();
    this._resetFeet();
  }

  _colors(part) {
    return { ...this.spec.colors, ...(part.colors || {}) };
  }

  _addInstance(part, side) {
    const { pos, n } = this.frame(part, side);
    const colors = this._colors(part);
    if (part.kind !== 'limb') {
      const def = this.lib.parts.get(part.kind);
      const obj = this.lib.instantiate(part.kind, colors);
      this.orientation(n, def.orient, part.twist * side, obj.quaternion);
      obj.position.copy(pos).addScaledVector(n, -0.004);
      obj.scale.set(part.scale * side, part.scale, part.scale);
      obj.userData.partId = part.id;
      obj.traverse((o) => { o.userData.partId = part.id; o.userData.side = side; });
      this.pivot.add(obj);
      this.instances.push({ part, side, obj });
      return;
    }
    const def = this.lib.parts.get(part.end);
    const obj = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: colors.primary, roughness: 0.66 });
    mat.userData.role = 'primary';
    const mk = (geo) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      obj.add(m);
      return m;
    };
    const limb = {
      part, side, obj, n: n.clone(),
      hip: pos.clone().addScaledVector(n, -part.thick * 0.5),
      upper: mk(UNIT_CYL), lower: mk(UNIT_CYL),
      j0: mk(UNIT_SPH), j1: mk(UNIT_SPH), j2: mk(UNIT_SPH),
      end: this.lib.instantiate(part.end, colors),
      isLeg: part.end.startsWith('foot_'),
      l1: part.len * 0.5, l2: part.len * 0.5,
      footH: -def.box.min.y * part.scale,
      foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(),
      stepT: -1, hand: new THREE.Vector3(), group: 0,
    };
    limb.end.scale.set(part.scale * side, part.scale, part.scale);
    obj.add(limb.end);
    obj.traverse((o) => { o.userData.partId = part.id; o.userData.side = side; });
    this.limbLayer.add(obj);
    this.instances.push({ part, side, obj, limb });
    (limb.isLeg ? this.legs : this.arms).push(limb);
  }

  _computeRide() {
    this.bodyMesh.geometry.computeBoundingBox();
    const minY = this.bodyMesh.geometry.boundingBox.min.y;
    let ride = Infinity;
    for (const l of this.legs) ride = Math.min(ride, l.part.len * 0.9 + l.footH - l.hip.y);
    if (!this.legs.length) ride = -minY;
    this.rideY = Math.max(ride, -minY * 0.9);
    this.pivot.position.y = this.rideY;
    const rows = [...this.legs].sort((a, c) => c.hip.z - a.hip.z);
    rows.forEach((l, i) => {
      const row = Math.floor(i / 2);
      l.group = (row + (l.hip.x >= 0 ? 0 : 1)) % 2;
    });
    if (this.legs.length === 2) { rows[0].group = 0; rows[1].group = 1; }
  }

  _home(l, out) {
    const sx = Math.sign(l.hip.x) || 0;
    return out.set(l.hip.x + sx * (0.05 + l.part.thick), l.footH, l.hip.z + l.n.z * 0.08);
  }

  _resetFeet() {
    this.root.updateMatrixWorld(true);
    for (const l of this.legs) {
      this.root.localToWorld(this._home(l, l.foot));
      l.stepT = -1;
    }
    for (const a of this.arms) this._armRest(a, a.hand, 0);
    this.lastPos.copy(this.root.position);
    this._solveAll();
  }

  _armRest(a, out, swing) {
    const hipY = a.hip.y + this.rideY;
    out.set(
      a.hip.x + a.n.x * a.part.len * 0.35,
      Math.max(hipY - a.part.len * 0.78, 0.08),
      a.hip.z + a.part.len * 0.22 + swing * a.part.len * 0.3,
    );
    return out;
  }

  talk() {
    this.talkT = 0.45;
  }

  update(dt) {
    if (this.frozen) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const size = this.spec.body.size;
    v1.copy(this.root.position).sub(this.lastPos).divideScalar(Math.max(dt, 1e-4));
    this.lastPos.copy(this.root.position);
    this.vel.lerp(v1, 1 - Math.exp(-dt * 12));
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const rel = this.speed / size;
    this.phase += rel * dt * 3.2;
    this.root.updateMatrixWorld(true);

    const moving = rel > 0.05;
    const hop = !this.legs.length && moving ? Math.abs(Math.sin(this.phase * 2.2)) : 0;
    const bob = this.legs.length ? Math.sin(this.phase * 4) * 0.018 * Math.min(rel, 1.5) : hop * 0.16;
    const breathe = Math.sin(this.time * 2.1) * 0.012;
    let sq = breathe - hop * 0.05;
    if (this.talkT > 0) {
      this.talkT -= dt;
      sq += Math.sin((0.45 - this.talkT) * 28) * 0.07 * (this.talkT / 0.45);
    }
    this.pivot.position.y = this.rideY + bob;
    this.pivot.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    this.pivot.rotation.x = Math.min(rel, 2) * 0.05;
    this.pivot.rotation.z = this.legs.length ? Math.sin(this.phase * 2) * 0.025 * Math.min(rel, 1.5) : 0;

    const busy = [0, 0];
    for (const l of this.legs) if (l.stepT >= 0) busy[l.group]++;
    for (const l of this.legs) {
      const len = l.part.len;
      const home = this.root.localToWorld(this._home(l, v2));
      home.addScaledVector(this.vel, 0.14);
      home.y = this.root.position.y + l.footH * size;
      if (l.stepT < 0) {
        const d = v3.copy(home).sub(l.foot).setY(0).length() / size;
        const limit = moving ? 0.16 + len * 0.22 : 0.05;
        if ((d > limit && busy[1 - l.group] === 0) || d > limit * 2.6) {
          l.stepT = 0;
          l.from.copy(l.foot);
          busy[l.group]++;
        }
      }
      if (l.stepT >= 0) {
        const dur = THREE.MathUtils.clamp(0.24 - rel * 0.04, 0.11, 0.24);
        l.stepT += dt / dur;
        l.to.copy(home);
        const t = Math.min(l.stepT, 1);
        const e = t * t * (3 - 2 * t);
        l.foot.lerpVectors(l.from, l.to, e);
        l.foot.y += Math.sin(t * Math.PI) * len * 0.22 * size;
        if (l.stepT >= 1) { l.stepT = -1; l.foot.copy(l.to); }
      }
    }
    for (const a of this.arms) {
      const swing = Math.sin(this.phase * 2 + (a.side > 0 ? 0 : Math.PI)) * Math.min(rel, 1.2);
      const idle = Math.sin(this.time * 1.3 + a.hip.z * 3) * 0.015;
      if (this.reach) {
        this.root.worldToLocal(v2.copy(this.reach));
        v2.x += a.side * 0.09 / size;
      } else {
        this._armRest(a, v2, swing);
        v2.y += idle;
      }
      a.hand.lerp(v2, 1 - Math.exp(-dt * (this.reach ? 22 : 14)));
    }
    this._solveAll();
  }

  _solveAll() {
    this.pivot.updateMatrix();
    for (const l of this.legs) {
      const target = this.root.worldToLocal(v1.copy(l.foot));
      this._solve(l, target, v2.set(Math.sign(l.hip.x) * 0.35, 0.25, 1));
      l.end.quaternion.identity();
      if (l.stepT >= 0) l.end.rotation.x = Math.sin(Math.min(l.stepT, 1) * Math.PI) * 0.5;
    }
    for (const a of this.arms) {
      this._solve(a, a.hand, v2.set(Math.sign(a.hip.x) * 0.4, -0.1, -1));
    }
  }

  _solve(l, target, pole) {
    const H = v3.copy(l.hip).applyMatrix4(this.pivot.matrix);
    const T = target;
    const dir = new THREE.Vector3().subVectors(T, H);
    const max = l.l1 + l.l2 - 1e-3;
    const d = THREE.MathUtils.clamp(dir.length(), 0.02, max);
    dir.normalize();
    const cosA = THREE.MathUtils.clamp((l.l1 * l.l1 + d * d - l.l2 * l.l2) / (2 * l.l1 * d), -1, 1);
    const a = Math.acos(cosA);
    const pp = pole.addScaledVector(dir, -pole.dot(dir));
    if (pp.lengthSq() < 1e-5) pp.set(0, 0, 1);
    pp.normalize();
    const K = new THREE.Vector3().copy(H).addScaledVector(dir, Math.cos(a) * l.l1).addScaledVector(pp, Math.sin(a) * l.l1);
    const E = new THREE.Vector3().copy(H).addScaledVector(dir, d);
    const r = l.part.thick;
    this._seg(l.upper, H, K, r);
    this._seg(l.lower, K, E, r * 0.82);
    l.j0.position.copy(H); l.j0.scale.setScalar(r);
    l.j1.position.copy(K); l.j1.scale.setScalar(r * 0.84);
    l.j2.position.copy(E); l.j2.scale.setScalar(r * 0.7);
    l.end.position.copy(E);
    if (!l.isLeg) {
      const f = new THREE.Vector3().subVectors(E, K).normalize();
      l.end.quaternion.setFromUnitVectors(v1.set(0, -1, 0), f);
    }
  }

  _seg(mesh, A, B, r) {
    const d = new THREE.Vector3().subVectors(B, A);
    const len = d.length() || 1e-4;
    mesh.position.copy(A);
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    mesh.scale.set(r, len, r);
  }

  recolor() {
    for (const inst of this.instances) {
      const colors = this._colors(inst.part);
      inst.obj.traverse((o) => {
        if (o.isMesh && o.material.userData.role) {
          const role = o.material.userData.role;
          o.material.color.set(FIXED_ROLES[role] || colors[role]);
        }
      });
    }
    this.refreshTexture();
  }

  _disposeObj(obj) {
    const seen = new Set();
    obj.traverse((o) => {
      if (o.isMesh && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); }
    });
  }

  dispose() {
    for (const inst of this.instances) this._disposeObj(inst.obj);
    if (this.bodyMesh) this.bodyMesh.geometry.dispose();
    this.bodyMat.dispose();
    this.texture.dispose();
  }
}
