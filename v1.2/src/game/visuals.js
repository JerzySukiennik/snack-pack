// World asset loading and the visual factories for items, hot dogs and customers.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COOK } from './sim.js';

const PROP_NODE = { ketchup: 'prop_ketchup', mustard: 'prop_mustard', spatula: 'prop_spatula', plate: 'prop_plate', cup: 'prop_cup', tomato: 'prop_tomato', onion: 'prop_onion', crate: 'prop_crate', cone: 'prop_cone', duck: 'prop_duck' };
const PROP_Y = { ketchup: 0.15, mustard: 0.15, plate: 0.012, cup: 0.075, tomato: 0.06, onion: 0.06, crate: 0.15, cone: 0.2, duck: 0.08, spatula: 0.012 };
const RAW = new THREE.Color('#f3a9a2');
const DONE = new THREE.Color('#a9522c');
const BURNT = new THREE.Color('#2b1a15');
const SHIRTS = ['#4a78d6', '#f4685c', '#ffc64a', '#3fa37a', '#8a62d9', '#f78fc0', '#57c4d8', '#ffffff', '#3b2a2a'];
const PANTS = ['#2f3350', '#5b4636', '#3d5a80', '#444444', '#7a8aa0'];
const SKINS = ['#f6c9a4', '#e8b088', '#c68a5e', '#8d5a3c', '#ffdcc2'];
const HAIRS = ['#3b2414', '#15110f', '#c9a227', '#a3552a', '#d8d2c8', '#e0604a'];

export class World {
  async load() {
    const [gltf, layout] = await Promise.all([
      new GLTFLoader().loadAsync('./assets/world.glb'),
      fetch('./assets/world.json').then((r) => r.json()),
    ]);
    this.layout = layout;
    this.nodes = new Map();
    this.scene = new THREE.Group();
    this.walls = [];
    gltf.scene.updateMatrixWorld(true);
    for (const node of gltf.scene.children.slice()) {
      const name = node.name;
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = !/ground|bulbs/.test(name);
        o.receiveShadow = true;
      });
      if (name.startsWith('truck_') || name.startsWith('plaza_')) {
        this.scene.add(node);
        if (/truck_(front|left|right|cab|sign)/.test(name)) {
          node.traverse((o) => {
            if (!o.isMesh) return;
            o.material = o.material.clone();
            o.material.transparent = true;
            o.userData.wall = node;
          });
          node.userData.fade = 1;
          this.walls.push(node);
        }
      } else this.nodes.set(name, node);
    }
    return this;
  }

  clone(name) {
    const src = this.nodes.get(name);
    const out = src.clone(true);
    out.position.set(0, 0, 0);
    return out;
  }

  fadeWalls(camera, target, dt) {
    const dir = target.clone().sub(camera.position);
    const dist = dir.length();
    const ray = new THREE.Raycaster(camera.position, dir.normalize(), 0, dist - 0.3);
    const hit = new Set();
    for (const h of ray.intersectObjects(this.walls, true)) if (h.object.userData.wall) hit.add(h.object.userData.wall);
    for (const w of this.walls) {
      const goal = hit.has(w) ? 0.16 : 1;
      w.userData.fade += (goal - w.userData.fade) * (1 - Math.exp(-dt * 10));
      const f = w.userData.fade;
      w.traverse((o) => {
        if (!o.isMesh) return;
        o.material.opacity = f;
        o.material.depthWrite = f > 0.95;
        o.castShadow = f > 0.5;
      });
    }
  }

  makeItem(type) {
    const g = new THREE.Group();
    g.userData.type = type;
    if (type === 'bun') { const b = this.clone('food_bun'); b.position.y = -0.04; g.add(b); }
    else if (type === 'sausage') g.add(tint(this.clone('food_sausage'), RAW));
    else if (type === 'hotdog') {
      const b = this.clone('food_bun');
      b.position.y = -0.04;
      g.add(b);
      const s = tint(this.clone('food_sausage'), DONE);
      s.position.y = 0.005;
      s.name = 'sausage';
      g.add(s);
    } else {
      const m = this.clone(PROP_NODE[type]);
      m.position.y = -(PROP_Y[type] || 0);
      g.add(m);
    }
    g.traverse((o) => { o.userData.itemRoot = g; });
    return g;
  }

  setCook(g, cook) {
    const c = cookColor(cook);
    g.traverse((o) => { if (o.isMesh && o.material.userData.tinted) o.material.color.copy(c); });
  }

  dressHotdog(g, meta) {
    const s = g.getObjectByName('sausage');
    if (s) {
      s.position.set(meta.off[0], 0.005, meta.off[1]);
      s.rotation.y = meta.ang;
      const c = cookColor(meta.cook);
      s.traverse((o) => { if (o.isMesh) o.material.color.copy(c); });
    }
    if (meta.path && meta.path.length > 2) {
      const pts = meta.path.map((p) => new THREE.Vector3(p[0], 0.042 + Math.random() * 0.004, p[1]));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.009, 6, false),
        new THREE.MeshStandardMaterial({ color: '#d2201a', roughness: 0.3 }),
      );
      tube.castShadow = true;
      tube.userData.itemRoot = g;
      g.add(tube);
    }
  }

  makeCustomer(seed) {
    const rnd = mulberry(seed);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const colors = { c_shirt: pick(SHIRTS), c_pants: pick(PANTS), c_skin: pick(SKINS), c_hair: pick(HAIRS) };
    const g = new THREE.Group();
    const scale = 0.92 + rnd() * 0.22;
    const part = (name, x, y, z) => {
      const o = this.clone(name);
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.material = m.material.clone();
        if (colors[m.material.name]) m.material.color.set(colors[m.material.name]);
      });
      o.position.set(x, y, z);
      g.add(o);
      return o;
    };
    part('cust_hips', 0, 0.78, 0);
    part('cust_torso', 0, 1.13, 0);
    const head = part('cust_head', 0, 1.62, 0);
    head.add((() => { const hr = this.clone(pick(['cust_hair_a', 'cust_hair_b', 'cust_hair_c'])); hr.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); if (colors[m.material.name]) m.material.color.set(colors[m.material.name]); } }); return hr; })());
    g.userData.limbs = [part('cust_leg', -0.1, 0.7, 0), part('cust_leg', 0.1, 0.7, 0), part('cust_arm', -0.29, 1.34, 0), part('cust_arm', 0.29, 1.34, 0)];
    g.userData.head = head;
    g.scale.setScalar(scale);
    g.userData.phase = rnd() * 6;
    return g;
  }

  animateCustomer(g, speed, dt, mood, waiting) {
    g.userData.phase += dt * (speed > 0.1 ? 9 : 2);
    const ph = g.userData.phase;
    const sw = speed > 0.1 ? Math.sin(ph) * 0.7 : 0;
    const [l1, l2, a1, a2] = g.userData.limbs;
    l1.rotation.x = sw; l2.rotation.x = -sw;
    a1.rotation.x = -sw * 0.8; a2.rotation.x = sw * 0.8;
    a1.rotation.z = a2.rotation.z = 0;
    if (mood > 0) { a1.rotation.z = -2.4 + Math.sin(ph * 2) * 0.3; a2.rotation.z = 2.4 - Math.sin(ph * 2) * 0.3; }
    if (waiting) g.userData.head.rotation.z = Math.sin(ph * 0.5) * 0.08;
    g.position.y = speed > 0.1 ? Math.abs(Math.sin(ph)) * 0.04 : 0;
  }
}

function cookColor(cook) {
  const c = new THREE.Color();
  if (cook < COOK.perfect) return c.copy(RAW).lerp(DONE, Math.min(cook / COOK.perfect, 1));
  return c.copy(DONE).lerp(BURNT, Math.min((cook - COOK.perfect) / (COOK.burnt + 2 - COOK.perfect), 1));
}

function tint(obj, color) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.color.copy(color);
    o.material.userData.tinted = true;
  });
  return obj;
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
