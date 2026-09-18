// Renderer, post-processing chain and the garage set.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const PODIUM_X = [-4.5, -1.5, 1.5, 4.5];
export const PODIUM_Z = 0.5;
export const PODIUM_Y = 0.3;
export const FLOOR = { minX: -6.2, maxX: 6.2, minZ: -3.6, maxZ: 4.6 };

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#2a2430');
    scene.fog = new THREE.Fog('#2a2430', 18, 34);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
    this.camera.position.set(0, 2.2, 7);

    const hemi = new THREE.HemisphereLight('#fff1dc', '#5b4a5e', 0.4);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff0d6', 1.7);
    sun.position.set(4, 9, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 30;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 6;
    scene.add(sun);
    this.garageGroup = new THREE.Group();
    scene.add(this.garageGroup);
    this.hemi = hemi;
    for (const x of PODIUM_X) {
      const lamp = new THREE.PointLight('#ffd9a0', 5, 7, 1.8);
      lamp.position.set(x, 3.7, PODIUM_Z);
      this.garageGroup.add(lamp);
    }

    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controls.maxPolarAngle = Math.PI * 0.54;
    controls.zoomSpeed = 0.7;
    this.controls = controls;

    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, 2, 2);
    this.gtao.blendIntensity = 0.9;
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16 });
    composer.addPass(this.gtao);
    this.outline = new OutlinePass(new THREE.Vector2(2, 2), scene, this.camera);
    this.outline.edgeStrength = 5;
    this.outline.edgeThickness = 1.4;
    this.outline.edgeGlow = 0;
    this.outline.visibleEdgeColor.set('#ffffff');
    this.outline.hiddenEdgeColor.set('#ffffff');
    composer.addPass(this.outline);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.32, 0.7, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;

    const daylight = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.15), new THREE.MeshBasicMaterial({ color: '#fff4d8', toneMapped: false }));
    daylight.position.set(0, 2.08, -4.835);
    this.garageGroup.add(daylight);

    this.quality = 0;
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this._acc = 0;
    this._frames = 0;
    this.sun = sun;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _govern(dt) {
    if (document.hidden) return;
    this._acc += dt;
    this._frames += 1;
    if (this._acc < 2.5) return;
    const fps = this._frames / this._acc;
    this._acc = 0;
    this._frames = 0;
    if (fps > 42 || this.quality >= 5) return;
    this.quality += 1;
    if (this.quality <= 3) this.pixelRatio = Math.max(1, this.pixelRatio - 0.34);
    else if (this.quality === 4) this.gtao.updateGtaoMaterial({ samples: 8 });
    else {
      this.sun.shadow.mapSize.set(2048, 2048);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.resize();
  }

  async loadGarage(url = './assets/garage.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.podiums = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.castShadow = !o.material.name.startsWith('g_floor') && !o.material.name.startsWith('g_wall');
      if (o.material.emissiveIntensity > 1) o.castShadow = false;
    });
    this.garageGroup.add(gltf.scene);
    this.garage = gltf.scene;
  }

  setEnv(env) {
    const truck = env === 'truck';
    this.garageGroup.visible = !truck;
    this.controls.enabled = !truck;
    this.scene.background.set(truck ? '#a9d8f0' : '#2a2430');
    this.scene.fog.color.set(truck ? '#c4e6f4' : '#2a2430');
    this.scene.fog.near = truck ? 55 : 18;
    this.scene.fog.far = truck ? 170 : 34;
    this.scene.environmentIntensity = truck ? 0.22 : 0.28;
    this.renderer.toneMappingExposure = truck ? 0.8 : 0.92;
    this.bloom.strength = truck ? 0.18 : 0.32;
    this.hemi.color.set(truck ? '#dff1ff' : '#fff1dc');
    this.hemi.groundColor.set(truck ? '#8aa86a' : '#5b4a5e');
    this.hemi.intensity = truck ? 0.5 : 0.4;
    this.sun.intensity = truck ? 2.0 : 1.7;
    this.sun.position.set(truck ? 9 : 4, truck ? 16 : 9, truck ? 8 : 7);
    const ext = truck ? 17 : 9;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: truck ? 50 : 30 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set(0, 0, truck ? 3 : 0);
    this.sun.target.updateMatrixWorld();
    this.camera.fov = truck ? 58 : 36;
    this.camera.near = truck ? 0.1 : 0.05;
    this.camera.far = truck ? 220 : 80;
    this.camera.updateProjectionMatrix();
    this.gtao.updateGtaoMaterial({ radius: truck ? 0.5 : 0.35 });
    this._focus = null;
  }

  resize() {
    const w = Math.max(window.innerWidth, 2);
    const h = Math.max(window.innerHeight, 2);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.renderer.setPixelRatio(this.pixelRatio || 1);
    this.composer.setPixelRatio(this.pixelRatio || 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  focus(target, distance, instant = false) {
    this._focus = { target: target.clone(), distance };
    if (instant) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, distance);
      this._focus = null;
    }
  }

  render(dt) {
    if (this._focus && this.controls.enabled) {
      const k = 1 - Math.exp(-dt * 6);
      const dir = this.camera.position.clone().sub(this.controls.target);
      const dist = THREE.MathUtils.lerp(dir.length(), this._focus.distance, k);
      this.controls.target.lerp(this._focus.target, k);
      this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), dist);
      if (this.controls.target.distanceTo(this._focus.target) < 0.01 && Math.abs(dist - this._focus.distance) < 0.02) this._focus = null;
    }
    if (this.controls.enabled) this.controls.update();
    this.composer.render(dt);
    this._govern(dt);
  }
}
