// Loads assets/parts.glb and exposes the part catalog, base body geometries,
// surface lookup by direction and rendered palette thumbnails.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CATEGORIES = [
  { id: 'body', label: 'Body' },
  { id: 'eye', label: 'Eyes' },
  { id: 'mouth', label: 'Mouths' },
  { id: 'ear', label: 'Ears' },
  { id: 'foot', label: 'Legs' },
  { id: 'hand', label: 'Arms' },
  { id: 'tail', label: 'Tails' },
  { id: 'extra', label: 'Extras' },
];

const UP_ORIENTED = new Set(['eye', 'mouth']);
const UP_EXTRAS = new Set(['extra_glasses', 'extra_whiskers', 'extra_bowtie', 'extra_clownnose']);

export const ROLE_NAMES = ['primary', 'secondary', 'accent', 'white', 'black', 'pink'];
export const FIXED_ROLES = { white: '#ffffff', black: '#15151a', pink: '#f78fa0' };

export class Library {
  constructor() {
    this.parts = new Map();
    this.bodies = new Map();
    this.thumbs = new Map();
    this._ray = new THREE.Raycaster();
    this._probe = new Map();
  }

  async load(url = './assets/parts.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    for (const node of gltf.scene.children.slice()) {
      const name = node.name;
      const cat = name.split('_')[0];
      if (cat === 'body') {
        let mesh = null;
        node.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        this.bodies.set(name.slice(5), geo);
        const probe = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        probe.updateMatrixWorld(true);
        this._probe.set(name.slice(5), probe);
        continue;
      }
      const meshes = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        meshes.push({ geo: g, role: ROLE_NAMES.includes(o.material.name) ? o.material.name : 'primary' });
      });
      const box = new THREE.Box3();
      for (const m of meshes) { m.geo.computeBoundingBox(); box.union(m.geo.boundingBox); }
      this.parts.set(name, {
        name,
        cat,
        label: name.slice(cat.length + 1),
        meshes,
        box,
        limbEnd: cat === 'foot' || cat === 'hand',
        orient: UP_ORIENTED.has(cat) || UP_EXTRAS.has(name) ? 'up' : 'front',
      });
    }
    return this;
  }

  has(kind) {
    return this.parts.has(kind);
  }

  byCategory(cat) {
    return [...this.parts.values()].filter((p) => p.cat === cat);
  }

  surfacePoint(bodyType, dir, out = new THREE.Vector3()) {
    const probe = this._probe.get(bodyType);
    this._ray.set(new THREE.Vector3(0, 0, 0), dir.clone().normalize());
    const hits = this._ray.intersectObject(probe, false);
    if (hits.length) return out.copy(hits[hits.length - 1].point);
    return out.copy(dir).normalize().multiplyScalar(0.3);
  }

  instantiate(kind, colors) {
    const def = this.parts.get(kind);
    const group = new THREE.Group();
    if (!def) return group;
    for (const m of def.meshes) {
      const mat = new THREE.MeshStandardMaterial({ roughness: m.role === 'black' ? 0.25 : 0.62, metalness: 0 });
      mat.userData.role = m.role;
      mat.color.set(FIXED_ROLES[m.role] || colors[m.role] || '#ffffff');
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  async renderThumbs(colors, size = 128) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(2);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b8a4, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(2, 3, 4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    const holder = new THREE.Group();
    scene.add(holder);
    const shoot = (obj, box) => {
      holder.clear();
      holder.add(obj);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 0.1;
      const dist = r / Math.sin((cam.fov * Math.PI) / 360) * 1.05;
      cam.position.copy(c).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(dist));
      cam.lookAt(c);
      renderer.render(scene, cam);
      return renderer.domElement.toDataURL('image/png');
    };
    for (const def of this.parts.values()) {
      const obj = this.instantiate(def.name, colors);
      if (def.orient === 'up') obj.rotation.x = Math.PI / 2;
      const box = new THREE.Box3().setFromObject(obj);
      this.thumbs.set(def.name, shoot(obj, box));
    }
    for (const [type, geo] of this.bodies) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors.primary, roughness: 0.62 }));
      mesh.rotation.y = -0.6;
      const box = new THREE.Box3().setFromObject(mesh);
      this.thumbs.set('body_' + type, shoot(mesh, box));
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
