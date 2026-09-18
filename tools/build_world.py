# Snack Pack world generator. Run headless:
#   Blender -b -P tools/build_world.py
# Writes assets/world.glb (truck, plaza, props, food, customer parts) and assets/world.json
# (static collider boxes and station anchors). All coordinates below are authored in
# three.js space (Y up, +Z towards the customers) and converted on the way into Blender.

import bpy
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_parts as bp

OUT = bp.OUT
colliders = []
WALL_H = 2.3


def M(name, color, rough=0.6, emit=0.0):
    return bp.material(name, color + (1,), rough, emit)


def P(x, y, z):
    return (x, -z, y)


def S(sx, sy, sz):
    return (sx, sz, sy)


def bx(c, size, mat, bevel=0.03, solid=False, rot_y=0.0):
    o = bp.box(P(*c), S(*size), mat, rot=(0, 0, rot_y), bevel=bevel)
    if solid:
        colliders.append({'c': list(c), 'h': [size[0] / 2, size[1] / 2, size[2] / 2]})
    return o


def cy(c, r, h, mat, seg=28, r2=None):
    return bp.cone(P(*c), r, r if r2 is None else r2, h, mat, seg=seg)


def sp(c, scale, mat, seg=24):
    if isinstance(scale, (tuple, list)):
        scale = S(*scale)
    return bp.sph(P(*c), scale, mat, seg=seg)


def build_truck(mats):
    body, trim, steel, dark, wood, glass, tyre = (mats[k] for k in ('body', 'trim', 'steel', 'dark', 'wood', 'cream', 'tyre'))
    fixed = []
    fixed.append(bx((0, 0.05, 0), (6.4, 0.1, 2.6), steel, solid=True))
    fixed.append(bx((0.8, 0.5, 1.25), (6.0 + 1.6, 1.0, 0.1), body))
    fixed.append(bx((-2.35, 1.65, 1.25), (1.3, 1.3, 0.1), body))
    fixed.append(bx((2.35, 1.65, 1.25), (1.3, 1.3, 0.1), body))
    fixed.append(bx((0, 2.2, 1.25), (3.4, 0.2, 0.1), body))
    colliders.append({'c': [0, 0.5, 1.25], 'h': [3.05, 0.5, 0.06]})
    colliders.append({'c': [-2.35, 1.65, 1.25], 'h': [0.66, 0.66, 0.06]})
    colliders.append({'c': [2.35, 1.65, 1.25], 'h': [0.66, 0.66, 0.06]})
    fixed.append(bx((0, 0.62, 1.25), (7.62, 0.16, 0.12), trim))
    fixed.append(bx((0, 1.03, 1.3), (3.5, 0.07, 0.75), wood, solid=True))
    fixed.append(bx((0, 2.62, 1.75), (3.9, 0.06, 1.1), trim, rot_y=0))
    for i in range(7):
        fixed.append(bx((-1.62 + i * 0.54, 2.6, 1.78), (0.27, 0.07, 1.12), glass))
    for x in (-1.9, 1.9):
        fixed.append(cy((x, 2.1, 2.2), 0.025, 1.05, steel, seg=10))
    bp.part('truck_front', fixed)

    left = [bx((-3.05, WALL_H / 2, 0), (0.1, WALL_H, 2.6), body, solid=True), bx((-3.05, 0.62, 0), (0.12, 0.16, 2.62), trim)]
    bp.part('truck_left', left)
    right = [bx((3.05, WALL_H / 2, 0), (0.1, WALL_H, 2.6), body, solid=True), bx((3.05, 0.62, 0), (0.12, 0.16, 2.62), trim)]
    bp.part('truck_right', right)

    cab = [bx((3.95, 0.95, 0), (1.7, 1.7, 2.5), body, bevel=0.18, solid=True)]
    cab.append(bx((4.35, 1.45, 0), (0.95, 0.62, 2.2), dark, bevel=0.08))
    cab.append(bx((4.82, 0.45, 0), (0.12, 0.3, 2.3), steel, bevel=0.04))
    for z in (-0.85, 0.85):
        cab.append(sp((4.84, 0.72, z), (0.06, 0.13, 0.13), mats['lamp'], seg=16))
    for x in (-2.0, 3.9):
        for z in (-1.32, 1.32):
            w = bp.cone(P(x, 0.36, z), 0.42, 0.42, 0.3, tyre, rot=(math.radians(90), 0, 0), seg=32)
            cab.append(w)
            cab.append(bp.cone(P(x, 0.36, z + (0.16 if z > 0 else -0.16)), 0.2, 0.2, 0.04, steel, rot=(math.radians(90), 0, 0), seg=20))
    bp.part('truck_cab', cab)

    counter = []
    counter.append(bx((-2.3, 0.5, 0.85), (1.4, 0.8, 0.7), steel, solid=True))
    counter.append(bx((-2.3, 0.93, 0.85), (1.3, 0.08, 0.6), dark))
    for i in range(9):
        counter.append(bx((-2.86 + i * 0.14, 0.985, 0.85), (0.035, 0.03, 0.56), steel, bevel=0.01))
    counter.append(bx((2.3, 0.5, 0.85), (1.4, 0.8, 0.7), steel, solid=True))
    counter.append(bx((2.3, 0.94, 0.85), (1.2, 0.07, 0.56), wood))
    counter.append(bx((0, 0.5, 0.95), (3.2, 0.8, 0.5), steel, solid=True))
    bp.part('truck_counters', counter)

    crates = []
    for x, tint in ((-2.5, mats['bun']), (2.5, mats['sausage'])):
        crates.append(bx((x, 0.45, -0.7), (0.9, 0.7, 0.8), wood, solid=True))
        crates.append(bx((x, 0.82, -0.7), (0.78, 0.06, 0.68), tint))
    bp.part('truck_crates', crates)

    rail = [bx((0, 2.05, 1.12), (3.2, 0.05, 0.05), steel, bevel=0.01)]
    bp.part('truck_rail', rail)

    sign = []
    bpy.ops.object.text_add(location=P(0, 2.95, 1.32), rotation=(math.radians(90), 0, 0))
    t = bpy.context.active_object
    t.data.body = 'SNACK PACK'
    t.data.align_x = 'CENTER'
    t.data.size = 0.62
    t.data.extrude = 0.04
    t.data.bevel_depth = 0.012
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.active_object
    t.data.materials.append(mats['neon'])
    sign.append(t)
    sign.append(bx((0, 3.15, 1.26), (4.3, 0.95, 0.08), dark, bevel=0.06))
    for x in (-1.7, 1.7):
        sign.append(cy((x, 2.55, 1.26), 0.03, 0.45, steel, seg=10))
    bp.part('truck_sign', sign)


def build_plaza(mats):
    g = [bp.cone(P(0, -0.05, 2), 26, 26, 0.1, mats['ground'], seg=64, smooth=False)]
    g.append(bp.cone(P(0, -0.04, 4.5), 9.5, 9.5, 0.1, mats['paving'], seg=64, smooth=False))
    g.append(bp.cone(P(0, -0.15, 2), 60, 60, 0.1, mats['grass2'], seg=48, smooth=False))
    bp.part('plaza_ground', g)
    colliders.append({'c': [0, -0.5, 2], 'h': [60, 0.5, 60]})

    props = []
    for i, (x, z) in enumerate(((-4.5, 5.0), (4.5, 5.2), (-2.0, 8.0), (2.4, 8.2))):
        props.append(cy((x, 0.78, z), 0.75, 0.07, mats['wood'], seg=32))
        props.append(cy((x, 0.4, z), 0.06, 0.78, mats['steel'], seg=12))
        props.append(cy((x, 0.03, z), 0.3, 0.05, mats['steel'], seg=20))
        colliders.append({'c': [x, 0.4, z], 'h': [0.55, 0.42, 0.55]})
        props.append(cy((x, 1.6, z), 0.025, 1.7, mats['steel'], seg=8))
        props.append(bp.cone(P(x, 2.45, z), 1.15, 0.05, 0.5, mats['trim'] if i % 2 else mats['body'], seg=10))
        for k in range(3):
            a = k / 3 * math.tau + i
            sx, sz = x + math.cos(a) * 1.15, z + math.sin(a) * 1.15
            props.append(cy((sx, 0.45, sz), 0.2, 0.06, mats['cream'], seg=20))
            props.append(cy((sx, 0.22, sz), 0.03, 0.44, mats['steel'], seg=8))
    bp.part('plaza_tables', props)

    bin_ = [cy((-4.6, 0.45, -2.2), 0.42, 0.9, mats['dark'], seg=24, r2=0.48), cy((-4.6, 0.9, -2.2), 0.5, 0.06, mats['steel'], seg=24)]
    bp.part('plaza_bin', bin_)
    colliders.append({'c': [-4.6, 0.45, -2.2], 'h': [0.42, 0.45, 0.42], 'bin': True})

    trees = []
    for i in range(16):
        a = i / 16 * math.tau + 0.2
        r = 15 + (i * 37 % 7)
        x, z = math.cos(a) * r, 2 + math.sin(a) * r
        s = 1 + (i * 13 % 5) * 0.18
        trees.append(cy((x, 1.0 * s, z), 0.22 * s, 2.0 * s, mats['wood'], seg=10))
        trees.append(sp((x, 3.0 * s, z), (1.5 * s, 1.7 * s, 1.5 * s), mats['leaf'] if i % 3 else mats['leaf2'], seg=20))
        trees.append(sp((x + 0.7 * s, 2.5 * s, z + 0.3), 1.0 * s, mats['leaf2'] if i % 3 else mats['leaf'], seg=16))
        colliders.append({'c': [x, 1.0, z], 'h': [0.3 * s, 1.2, 0.3 * s]})
    bp.part('plaza_trees', trees)

    lamps = []
    bulbs = []
    for x, z in ((-6.5, 3.2), (6.5, 3.2), (-5.5, 9.5), (5.5, 9.5)):
        lamps.append(cy((x, 1.9, z), 0.06, 3.8, mats['dark'], seg=10))
        lamps.append(cy((x, 0.08, z), 0.22, 0.16, mats['dark'], seg=16))
        bulbs.append(sp((x, 3.9, z), 0.2, mats['lamp'], seg=16))
        colliders.append({'c': [x, 1.9, z], 'h': [0.1, 1.9, 0.1]})
    pts = [(-6.5, 3.85, 3.2), (-5.5, 3.85, 9.5), (5.5, 3.85, 9.5), (6.5, 3.85, 3.2), (-6.5, 3.85, 3.2)]
    k = 0
    for a, b in zip(pts, pts[1:]):
        for i in range(1, 12):
            t = i / 12
            sag = math.sin(t * math.pi) * 0.7
            k += 1
            bulbs.append(sp((a[0] + (b[0] - a[0]) * t, 3.85 - sag, a[2] + (b[2] - a[2]) * t), 0.075, mats['lamp'] if k % 2 else mats['neon'], seg=10))
    bp.part('plaza_lamps', lamps)
    bp.part('plaza_bulbs', bulbs)

    fence = []
    for i in range(40):
        a = i / 40 * math.tau
        fence.append(bx((math.cos(a) * 12.5, 0.35, 3.5 + math.sin(a) * 11), (0.12, 0.7, 0.12), mats['cream'], bevel=0.02))
    bp.part('plaza_fence', fence)


def build_food(mats):
    bun = [sp((0, 0.035, -0.035), (0.17, 0.045, 0.05), mats['bun'], seg=20), sp((0, 0.035, 0.035), (0.17, 0.045, 0.05), mats['bun'], seg=20), sp((0, 0.012, 0), (0.16, 0.02, 0.06), mats['bun_in'], seg=16)]
    bp.part('food_bun', bun)
    saus = [bp.cone(P(0, 0, 0), 0.028, 0.028, 0.3, mats['white'], rot=(0, math.radians(90), 0), seg=16), sp((-0.15, 0, 0), 0.028, mats['white'], seg=14), sp((0.15, 0, 0), 0.028, mats['white'], seg=14)]
    bp.part('food_sausage', saus)


def build_props(mats):
    k = [cy((0, 0.1, 0), 0.05, 0.2, mats['ketchup'], seg=18), bp.cone(P(0, 0.235, 0), 0.05, 0.012, 0.07, mats['ketchup'], seg=18), cy((0, 0.285, 0), 0.012, 0.04, mats['white'], seg=10)]
    bp.part('prop_ketchup', k)
    m = [cy((0, 0.1, 0), 0.05, 0.2, mats['mustard'], seg=18), bp.cone(P(0, 0.235, 0), 0.05, 0.012, 0.07, mats['mustard'], seg=18), cy((0, 0.285, 0), 0.012, 0.04, mats['white'], seg=10)]
    bp.part('prop_mustard', m)
    bp.part('prop_spatula', [bx((0.17, 0.01, 0), (0.16, 0.012, 0.11), mats['steel'], bevel=0.005), bx((-0.05, 0.015, 0), (0.3, 0.025, 0.03), mats['dark'], bevel=0.01)])
    bp.part('prop_plate', [cy((0, 0.012, 0), 0.15, 0.024, mats['white'], seg=28, r2=0.11)])
    bp.part('prop_cup', [cy((0, 0.07, 0), 0.05, 0.14, mats['trim'], seg=20, r2=0.04), cy((0, 0.145, 0), 0.054, 0.012, mats['white'], seg=20)])
    bp.part('prop_tomato', [sp((0, 0.06, 0), (0.07, 0.06, 0.07), mats['ketchup'], seg=18), bp.cone(P(0, 0.12, 0), 0.025, 0.004, 0.02, mats['leaf'], seg=6)])
    bp.part('prop_onion', [sp((0, 0.06, 0), (0.06, 0.065, 0.06), mats['onion'], seg=18), bp.cone(P(0, 0.135, 0), 0.015, 0.002, 0.04, mats['onion'], seg=8)])
    bp.part('prop_crate', [bx((0, 0.15, 0), (0.4, 0.3, 0.3), mats['wood'], bevel=0.02), bx((0, 0.15, 0.152), (0.3, 0.06, 0.01), mats['cream'], bevel=0.003)])
    bp.part('prop_cone', [bp.cone(P(0, 0.2, 0), 0.13, 0.03, 0.4, mats['neon'], seg=20), bx((0, 0.015, 0), (0.34, 0.03, 0.34), mats['neon'], bevel=0.01), cy((0, 0.24, 0), 0.085, 0.07, mats['white'], seg=20, r2=0.068)])
    bp.part('prop_duck', [sp((0, 0.07, 0), (0.1, 0.07, 0.075), mats['mustard'], seg=18), sp((0.07, 0.15, 0), 0.055, mats['mustard'], seg=16), bp.cone(P(0.135, 0.145, 0), 0.025, 0.006, 0.05, mats['neon'], rot=(0, math.radians(90), 0), seg=10), sp((0.095, 0.17, 0.04), 0.01, mats['dark'], seg=8), sp((0.095, 0.17, -0.04), 0.01, mats['dark'], seg=8)])


def build_customers(mats):
    bp.part('cust_torso', [sp((0, 0.0, 0), (0.24, 0.34, 0.19), mats['shirt'], seg=24)])
    bp.part('cust_hips', [sp((0, 0, 0), (0.21, 0.16, 0.17), mats['pants'], seg=20)])
    head = [sp((0, 0, 0), (0.2, 0.22, 0.2), mats['skin'], seg=24), sp((-0.07, 0.03, 0.18), 0.024, mats['dark'], seg=10), sp((0.07, 0.03, 0.18), 0.024, mats['dark'], seg=10), sp((0, -0.02, 0.2), (0.03, 0.025, 0.03), mats['skin'], seg=10)]
    bp.part('cust_head', head)
    bp.part('cust_hair_a', [bp.hemi(P(0, 0.03, -0.01), S(0.215, 0.22, 0.215), mats['hair'])])
    bp.part('cust_hair_b', [bp.hemi(P(0, 0.03, -0.01), S(0.215, 0.22, 0.215), mats['hair']), sp((0, 0.26, -0.02), 0.1, mats['hair'], seg=14)])
    bp.part('cust_hair_c', [bp.hemi(P(0, 0.05, 0), S(0.22, 0.16, 0.22), mats['shirt']), bx((0, 0.06, 0.2), (0.26, 0.025, 0.2), mats['shirt'], bevel=0.01)])
    bp.part('cust_arm', [cy((0, -0.2, 0), 0.055, 0.4, mats['shirt'], seg=14), sp((0, 0, 0), 0.06, mats['shirt'], seg=12), sp((0, -0.42, 0), 0.06, mats['skin'], seg=12)])
    bp.part('cust_leg', [cy((0, -0.22, 0), 0.07, 0.44, mats['pants'], seg=14), sp((0, -0.46, 0.04), (0.08, 0.05, 0.13), mats['dark'], seg=12)])


def main():
    os.makedirs(OUT, exist_ok=True)
    bp.reset()
    mats = {
        'body': M('w_body', (0.96, 0.43, 0.36), 0.45), 'trim': M('w_trim', (0.22, 0.58, 0.58), 0.5),
        'steel': M('w_steel', (0.72, 0.74, 0.78), 0.32), 'dark': M('w_dark', (0.13, 0.13, 0.16), 0.5),
        'wood': M('w_wood', (0.70, 0.48, 0.30), 0.7), 'cream': M('w_cream', (0.98, 0.94, 0.84), 0.6),
        'tyre': M('w_tyre', (0.07, 0.07, 0.08), 0.85), 'lamp': M('w_lamp', (1.0, 0.85, 0.55), 0.4, 5.0),
        'neon': M('w_neon', (1.0, 0.42, 0.22), 0.4, 3.2), 'ground': M('w_ground', (0.46, 0.66, 0.38), 0.95),
        'grass2': M('w_grass2', (0.36, 0.56, 0.33), 0.95), 'paving': M('w_paving', (0.80, 0.74, 0.66), 0.85),
        'leaf': M('w_leaf', (0.30, 0.62, 0.36), 0.8), 'leaf2': M('w_leaf2', (0.45, 0.72, 0.38), 0.8),
        'bun': M('w_bun', (0.90, 0.64, 0.33), 0.7), 'bun_in': M('w_bun_in', (0.98, 0.88, 0.66), 0.8),
        'sausage': M('w_sausage', (0.85, 0.42, 0.36), 0.5), 'white': M('w_white', (1, 1, 1), 0.5),
        'ketchup': M('w_ketchup', (0.85, 0.12, 0.10), 0.35), 'mustard': M('w_mustard', (0.98, 0.78, 0.12), 0.35),
        'onion': M('w_onion', (0.80, 0.62, 0.78), 0.5),
        'shirt': M('c_shirt', (0.3, 0.5, 0.9), 0.7), 'pants': M('c_pants', (0.25, 0.27, 0.4), 0.75),
        'skin': M('c_skin', (0.96, 0.78, 0.64), 0.65), 'hair': M('c_hair', (0.3, 0.2, 0.12), 0.8),
    }
    build_truck(mats)
    build_plaza(mats)
    build_food(mats)
    build_props(mats)
    build_customers(mats)
    bp.export(os.path.join(OUT, 'world.glb'))
    layout = {
        'colliders': colliders,
        'stations': {
            'buns': {'p': [-2.5, 0.9, -0.7], 'r': 0.75},
            'sausages': {'p': [2.5, 0.9, -0.7], 'r': 0.75},
            'grill': {'c': [-2.3, 1.0, 0.85], 'h': [0.65, 0.18, 0.3]},
            'board': {'c': [2.3, 1.0, 0.85], 'h': [0.6, 0.2, 0.28]},
            'window': {'c': [0, 1.12, 1.35], 'h': [1.7, 0.22, 0.42]},
            'bin': {'c': [-4.6, 1.0, -2.2], 'h': [0.42, 0.3, 0.42]},
        },
        'spots': [[-1.1, 0, 2.15], [0, 0, 2.15], [1.1, 0, 2.15]],
        'spawns': [[-1.5, 0.12, -0.3], [-0.5, 0.12, -0.3], [0.5, 0.12, -0.3], [1.5, 0.12, -0.3]],
        'entries': [[-14, 0, 7], [14, 0, 7], [0, 0, 16]],
    }
    json.dump(layout, open(os.path.join(OUT, 'world.json'), 'w'), indent=1)
    print('WORLD', sorted(o.name for o in bpy.data.objects))


if __name__ == '__main__':
    main()
