// Rapier bootstrap and shared static world. The host simulation and every client's
// local character controller each build their own world from the same layout.

import RAPIER from '@dimforge/rapier3d-compat';

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export const GROUP = {
  STATIC: 0x0001,
  ITEM: 0x0002,
  PLAYER: 0x0004,
  HELD: 0x0008,
};

export function groups(member, filter) {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export function buildStaticWorld(R, layout) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  for (const c of layout.colliders) {
    const desc = R.ColliderDesc.cuboid(c.h[0], c.h[1], c.h[2])
      .setTranslation(c.c[0], c.c[1], c.c[2])
      .setFriction(0.9)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    world.createCollider(desc);
  }
  return world;
}

export function inBox(p, box, pad = 0) {
  return Math.abs(p.x - box.c[0]) <= box.h[0] + pad && Math.abs(p.y - box.c[1]) <= box.h[1] + pad && Math.abs(p.z - box.c[2]) <= box.h[2] + pad;
}
