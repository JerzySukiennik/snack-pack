// Analytic body deformation. Base bodies are unit-length meshes with the spine on Z
// (head at +Z). The same function moves mesh vertices and attachment points, so parts
// stay glued to the surface whatever the sliders do.

import * as THREE from 'three';

export function deformPoint(p, b, out = p) {
  const u = p.z;
  const s = 1 + b.taper * u * 1.2;
  let x = p.x * b.width * s;
  let y = p.y * b.height * s;
  let z = u * b.length;
  if (Math.abs(b.bend) > 1e-3) {
    const a = b.bend * u;
    const R = b.length / b.bend;
    const ny = R - (R - y) * Math.cos(a);
    const nz = (R - y) * Math.sin(a);
    y = ny;
    z = nz;
  }
  if (b.pitch > 1e-3) {
    const c = Math.cos(b.pitch);
    const sn = Math.sin(b.pitch);
    const ny = y * c + z * sn;
    const nz = -y * sn + z * c;
    y = ny;
    z = nz;
  }
  return out.set(x, y, z);
}

export function deformGeometry(baseGeo, geo, b) {
  const src = baseGeo.attributes.position;
  const dst = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i);
    deformPoint(v, b);
    dst.setXYZ(i, v.x, v.y, v.z);
  }
  dst.needsUpdate = true;
  geo.computeVertexNormals();
  fixSeamNormals(geo);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function fixSeamNormals(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 2000) + '_' + Math.round(pos.getY(i) * 2000) + '_' + Math.round(pos.getZ(i) * 2000);
    let e = map.get(k);
    if (!e) map.set(k, (e = []));
    e.push(i);
  }
  const n = new THREE.Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.x += nor.getX(i), n.y += nor.getY(i), n.z += nor.getZ(i);
    n.normalize();
    for (const i of list) nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
}
