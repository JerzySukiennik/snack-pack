# Snack Pack part library generator. Run headless:
#   Blender -b -P tools/build_parts.py
# Writes assets/parts.glb (bodies + attachable parts) and assets/garage.glb.
# Conventions: part origin = attach point, +Z = outward surface normal, -Y = front.
# Limb ends (foot_*, hand_*) have origin at the ankle/wrist and extend along -Z.
# Material names are colour roles resolved at runtime: primary, secondary, accent, white, black, pink.

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')

ROLES = {
    'primary': (0.95, 0.62, 0.35, 1),
    'secondary': (0.99, 0.90, 0.75, 1),
    'accent': (0.98, 0.45, 0.40, 1),
    'white': (1, 1, 1, 1),
    'black': (0.04, 0.04, 0.05, 1),
    'pink': (0.98, 0.55, 0.62, 1),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color=None, rough=0.55, emit=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    c = color or ROLES.get(name, (0.8, 0.8, 0.8, 1))
    bsdf.inputs['Base Color'].default_value = c
    bsdf.inputs['Roughness'].default_value = rough
    if emit > 0:
        bsdf.inputs['Emission Color'].default_value = c
        bsdf.inputs['Emission Strength'].default_value = emit
    return m


def _finish_prim(mat, scale, rot, smooth=True):
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = rot
    o.data.materials.append(material(mat) if isinstance(mat, str) else mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    return o


def sph(loc, scale, mat='primary', rot=(0, 0, 0), seg=32):
    if not isinstance(scale, (tuple, list)):
        scale = (scale, scale, scale)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=loc)
    return _finish_prim(mat, scale, rot)


def cone(loc, r1, r2, depth, mat='primary', rot=(0, 0, 0), scale=(1, 1, 1), seg=28, smooth=True):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = _finish_prim(mat, scale, rot, smooth)
    if smooth:
        mod = o.modifiers.new('ws', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    return o


def cyl(loc, r, depth, mat='primary', rot=(0, 0, 0), scale=(1, 1, 1), seg=28):
    return cone(loc, r, r, depth, mat, rot, scale, seg)


def torus(loc, R, r, mat='black', rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=32, minor_segments=12, location=loc)
    return _finish_prim(mat, scale, rot)


def box(loc, scale, mat='black', rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = _finish_prim(mat, scale, rot, smooth=False)
    if bevel > 0:
        b = o.modifiers.new('bv', 'BEVEL')
        b.width = bevel
        b.segments = 3
        bpy.ops.object.shade_smooth()
        w = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    return o


def hemi(loc, scale, mat='primary', rot=(0, 0, 0)):
    o = sph(loc, scale, mat, rot)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    return o


def chain(points, radii, mat='primary'):
    objs = []
    n = len(points)
    for i in range(n):
        objs.append(sph(points[i], radii[i], mat, seg=20))
    return objs


def part(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    o.name = name
    o.data.name = name
    return o


def body(name, profile, flat=1.0, belly=0.0):
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=0.5, calc_uvs=True)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    for v in bm.verts:
        t = min(max(v.co.y + 0.5, 0.0), 1.0)
        base = math.sqrt(max(1.0 - (2.0 * t - 1.0) ** 2, 0.0))
        target = profile(t)
        k = target / base if base > 1e-3 else 0.0
        v.co.x *= k
        v.co.z *= k * flat
        if belly and v.co.z < 0:
            v.co.z *= 1.0 + belly * math.sin(math.pi * t)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(material('primary'))
    for p in me.polygons:
        p.use_smooth = True
    return o


def superell(t, n):
    x = abs(2 * t - 1)
    return max(1 - x ** n, 0) ** (1.0 / n)


def build_bodies():
    body('body_bean', lambda t: 0.62 * superell(t, 2.4), flat=0.95, belly=0.12)
    body('body_pear', lambda t: superell(t, 2.2) * (0.45 + 0.5 * t), flat=1.0, belly=0.1)
    body('body_egg', lambda t: superell(t, 2.2) * (0.92 - 0.42 * t), flat=1.0)
    body('body_sausage', lambda t: 0.42 * superell(t, 5.0), flat=1.0)
    body('body_ball', lambda t: 1.0 * superell(t, 2.0), flat=1.0)
    body('body_chonk', lambda t: 0.95 * superell(t, 3.2), flat=0.62, belly=0.2)


def eye_base(r=0.07, pupil=0.5, mat_pupil='black', hl=True):
    o = [sph((0, 0, r * 0.25), (r, r, r * 0.8), 'white')]
    o.append(sph((0, 0, r * 0.72), (r * pupil, r * pupil, r * 0.34), mat_pupil))
    if hl:
        o.append(sph((r * 0.2, 0, r * 1.02), (r * 0.16, r * 0.16, r * 0.08), 'white', seg=16))
    return o


def build_eyes():
    part('eye_round', eye_base(0.07, 0.5))
    o = eye_base(0.11, 0.68)
    o.append(sph((-0.035, 0.03, 0.105), (0.012, 0.012, 0.006), 'white', seg=12))
    part('eye_big', o)
    o = eye_base(0.075, 0.5, hl=False)
    o.append(hemi((0, 0, 0.02), (0.08, 0.08, 0.068), 'primary', rot=(math.radians(-62), 0, 0)))
    part('eye_sleepy', o)
    o = eye_base(0.07, 0.45)
    o.append(box((0, 0.055, 0.075), (0.17, 0.035, 0.03), 'black', rot=(0, math.radians(18), 0), bevel=0.01))
    part('eye_angry', o)
    part('eye_button', [sph((0, 0, 0.012), (0.04, 0.04, 0.03), 'black'), sph((0.012, 0.012, 0.036), (0.009, 0.009, 0.005), 'white', seg=12)])
    o = [cone((0, 0, 0.09), 0.03, 0.02, 0.2, 'primary')]
    o.append(sph((0, 0, 0.22), 0.065, 'white'))
    o.append(sph((0, -0.05, 0.225), (0.032, 0.02, 0.032), 'black'))
    o.append(sph((0.012, -0.066, 0.24), (0.009, 0.005, 0.009), 'white', seg=12))
    part('eye_stalk', o)


def build_mouths():
    part('mouth_smile', [sph((0, 0, 0.004), (0.09, 0.05, 0.022), 'black'), sph((0, -0.018, 0.012), (0.05, 0.026, 0.018), 'pink')])
    part('mouth_beak', [cone((0, 0, 0.07), 0.06, 0.004, 0.16, 'accent', scale=(1, 0.75, 1)), sph((0, 0, 0), (0.062, 0.048, 0.02), 'accent')])
    part('mouth_snout', [sph((0, 0, 0.03), (0.1, 0.075, 0.07), 'secondary'), sph((0, 0.035, 0.092), (0.032, 0.022, 0.02), 'black'), sph((0, -0.028, 0.078), (0.04, 0.012, 0.02), 'black')])
    part('mouth_fangs', [sph((0, 0, 0.004), (0.1, 0.045, 0.025), 'black'), cone((-0.045, -0.012, 0.03), 0.018, 0.001, 0.07, 'white', rot=(math.radians(100), 0, 0)), cone((0.045, -0.012, 0.03), 0.018, 0.001, 0.07, 'white', rot=(math.radians(100), 0, 0))])
    part('mouth_bill', [sph((0, 0.012, 0.07), (0.085, 0.022, 0.1), 'accent'), sph((0, -0.016, 0.06), (0.075, 0.018, 0.085), 'accent')])
    pts, rad = [], []
    for i in range(9):
        a = i / 8.0
        pts.append((0, -0.1 * a * a * 1.6, 0.04 + 0.22 * a - 0.12 * a * a))
        rad.append(0.06 - 0.03 * a)
    o = chain(pts, rad, 'primary')
    o.append(torus(pts[-1], 0.03, 0.012, 'secondary', rot=(math.radians(70), 0, 0)))
    part('mouth_trunk', o)


def build_ears():
    part('ear_bear', [sph((0, 0, 0.05), (0.085, 0.035, 0.085), 'primary'), sph((0, -0.022, 0.055), (0.052, 0.02, 0.052), 'secondary')])
    part('ear_cat', [cone((0, 0, 0.085), 0.08, 0.006, 0.2, 'primary', scale=(1, 0.42, 1)), cone((0, -0.02, 0.075), 0.05, 0.004, 0.14, 'pink', scale=(1, 0.3, 1))])
    part('ear_bunny', [sph((0, 0, 0.2), (0.06, 0.03, 0.22), 'primary'), sph((0, -0.02, 0.2), (0.035, 0.016, 0.17), 'pink')])
    part('ear_floppy', [sph((0.05, 0, 0.0), (0.06, 0.035, 0.17), 'secondary', rot=(0, math.radians(150), 0)), sph((0, 0, 0.02), 0.05, 'secondary')])
    part('ear_fin', [cone((0, 0.03, 0.08), 0.09, 0.005, 0.2, 'accent', rot=(math.radians(-25), 0, 0), scale=(0.16, 1, 1))])


def build_tails():
    part('tail_fluffy', chain([(0, 0, 0.04), (0, 0.01, 0.13), (0, 0.04, 0.23), (0, 0.06, 0.32)], [0.06, 0.085, 0.1, 0.07], 'secondary'))
    pts = [(0, 0.12 * math.sin(i / 10 * 2.2), 0.04 * i) for i in range(10)]
    o = chain(pts, [0.02] * 10, 'primary')
    o.append(sph((pts[-1][0], pts[-1][1], pts[-1][2] + 0.04), (0.05, 0.05, 0.07), 'secondary'))
    part('tail_tuft', o)
    part('tail_stub', [sph((0, 0, 0.03), 0.07, 'secondary')])
    part('tail_fish', [cone((0, 0, 0.06), 0.045, 0.02, 0.14, 'primary'), cone((0, 0, 0.2), 0.02, 0.13, 0.18, 'accent', scale=(0.14, 1, 1))])
    pts = []
    for i in range(16):
        a = i / 15 * math.pi * 3.2
        pts.append((0.05 * math.cos(a) - 0.05, 0.05 * math.sin(a), 0.02 + 0.013 * i))
    part('tail_curly', chain(pts, [0.024 - 0.0008 * i for i in range(16)], 'pink'))


def build_feet():
    o = [sph((0, -0.04, -0.06), (0.085, 0.12, 0.06), 'primary')]
    for x in (-0.05, 0, 0.05):
        o.append(sph((x, -0.145, -0.075), (0.03, 0.035, 0.035), 'secondary', seg=16))
    part('foot_paw', o)
    part('foot_hoof', [cone((0, 0, -0.06), 0.085, 0.06, 0.12, 'black'), sph((0, 0, 0), 0.06, 'primary')])
    o = [sph((0, 0, -0.03), 0.045, 'accent')]
    for a in (-32, 0, 32):
        r = math.radians(a)
        o.append(sph((0.09 * math.sin(r), -0.09 * math.cos(r) - 0.02, -0.105), (0.035, 0.11, 0.014), 'accent', rot=(0, 0, -r), seg=16))
    o.append(sph((0, -0.07, -0.108), (0.085, 0.08, 0.008), 'accent'))
    part('foot_webbed', o)
    part('foot_stump', [sph((0, -0.01, -0.06), (0.09, 0.1, 0.065), 'secondary'), cyl((0, 0, -0.02), 0.07, 0.06, 'primary')])
    o = [sph((0, 0, -0.04), 0.035, 'accent')]
    for a in (-35, 0, 35, 180):
        r = math.radians(a)
        L = 0.13 if a != 180 else 0.07
        o.append(cone((0.5 * L * math.sin(r), -0.5 * L * math.cos(r), -0.1), 0.02, 0.003, L, 'accent', rot=(math.radians(90), 0, -r)))
    part('foot_bird', o)


def build_hands():
    part('hand_mitten', [sph((0, 0, -0.07), (0.075, 0.06, 0.085), 'primary'), sph((0.075, -0.01, -0.055), (0.03, 0.03, 0.045), 'primary', rot=(0, math.radians(-35), 0))])
    o = [sph((0, 0, -0.05), (0.07, 0.05, 0.06), 'primary')]
    for x in (-0.045, 0, 0.045):
        o.append(sph((x, 0, -0.125), (0.022, 0.024, 0.055), 'secondary', seg=16))
    o.append(sph((0.085, 0, -0.06), (0.022, 0.024, 0.045), 'secondary', rot=(0, math.radians(-50), 0), seg=16))
    part('hand_three', o)
    o = [sph((0, 0, -0.04), 0.055, 'accent')]
    for s in (-1, 1):
        o.append(cone((s * 0.05, 0, -0.13), 0.035, 0.004, 0.17, 'accent', rot=(0, math.radians(180 - s * 14), 0), scale=(1, 0.6, 1)))
    part('hand_pincer', o)
    pts = [(0.02 * math.sin(i * 0.7), 0, -0.035 * i) for i in range(7)]
    o = chain(pts, [0.06 - 0.006 * i for i in range(7)], 'primary')
    for i in (2, 4, 6):
        o.append(torus((pts[i][0], -0.045 + 0.004 * i, pts[i][2]), 0.016, 0.007, 'pink', rot=(math.radians(90), 0, 0)))
    part('hand_tentacle', o)


def build_extras():
    part('extra_horn', [cone((0, 0, 0.09), 0.045, 0.003, 0.2, 'secondary', rot=(math.radians(-12), 0, 0))])
    o = [cyl((0, 0, 0.1), 0.018, 0.2, 'secondary')]
    o.append(cyl((0.05, 0, 0.17), 0.013, 0.13, 'secondary', rot=(0, math.radians(50), 0)))
    o.append(cyl((-0.04, 0, 0.11), 0.013, 0.1, 'secondary', rot=(0, math.radians(-55), 0)))
    o.append(sph((0, 0, 0.2), 0.02, 'secondary', seg=16))
    o.append(sph((0.1, 0, 0.212), 0.015, 'secondary', seg=16))
    o.append(sph((-0.082, 0, 0.14), 0.015, 'secondary', seg=16))
    part('extra_antler', o)
    part('extra_spike', [cone((0, 0, 0.06), 0.05, 0.002, 0.14, 'accent')])
    part('extra_antenna', [cyl((0, 0, 0.11), 0.008, 0.22, 'black'), sph((0, 0, 0.235), 0.03, 'accent')])
    o = []
    for i, a in enumerate((-25, 5, 35)):
        r = math.radians(a)
        L = 0.3 - 0.05 * i
        o.append(sph((0, 0.5 * L * math.sin(r), 0.5 * L * math.cos(r) + 0.02), (0.02, 0.07, L * 0.55), 'secondary' if i else 'primary', rot=(-r, 0, 0)))
    part('extra_wing', o)
    o = [cyl((0, 0, 0.06), 0.09, 0.12, 'white')]
    for a in range(6):
        r = a / 6 * math.tau
        o.append(sph((0.075 * math.cos(r), 0.075 * math.sin(r), 0.16), 0.065, 'white'))
    o.append(sph((0, 0, 0.19), 0.075, 'white'))
    part('extra_chefhat', o)
    part('extra_bowtie', [cone((-0.06, 0, 0.025), 0.05, 0.012, 0.11, 'accent', rot=(0, math.radians(-90), 0), scale=(1, 0.5, 1)), cone((0.06, 0, 0.025), 0.05, 0.012, 0.11, 'accent', rot=(0, math.radians(90), 0), scale=(1, 0.5, 1)), sph((0, 0, 0.028), 0.024, 'accent')])
    o = []
    for i in range(5):
        y = -0.1 + 0.05 * i
        o.append(cone((0, y, 0.06 + 0.015 * math.sin(i / 4 * math.pi)), 0.04, 0.002, 0.14 + 0.03 * math.sin(i / 4 * math.pi), 'accent', scale=(0.35, 1, 1)))
    part('extra_mohawk', o)
    o = [hemi((0, 0, -0.01), (0.2, 0.24, 0.12), 'secondary')]
    for x, y in ((0, 0), (0.09, 0.08), (-0.09, 0.08), (0.09, -0.08), (-0.09, -0.08), (0, 0.15), (0, -0.15)):
        o.append(sph((x, y, 0.1 - 0.35 * (x * x + y * y) * 4), (0.045, 0.05, 0.02), 'accent', seg=16))
    part('extra_shell', o)
    part('extra_clownnose', [sph((0, 0, 0.03), 0.05, 'accent')])
    o = []
    for s in (-1, 1):
        for a in (-18, 0, 18):
            o.append(cyl((s * 0.09, 0, 0.012 + 0.0), 0.0035, 0.15, 'black', rot=(math.radians(a), math.radians(90), 0), seg=8))
    part('extra_whiskers', o)
    part('extra_glasses', [torus((-0.075, 0, 0.03), 0.055, 0.009, 'black'), torus((0.075, 0, 0.03), 0.055, 0.009, 'black'), cyl((0, 0, 0.03), 0.007, 0.05, 'black', rot=(0, math.radians(90), 0), seg=10)])


def export(path, use_selection=False):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=use_selection, export_materials='EXPORT')


def build_garage():
    reset()
    wall = material('g_wall', (0.93, 0.80, 0.66, 1), 0.9)
    floor = material('g_floor', (0.55, 0.50, 0.52, 1), 0.75)
    trim = material('g_trim', (0.30, 0.55, 0.56, 1), 0.6)
    door = material('g_door', (0.96, 0.93, 0.86, 1), 0.5)
    wood = material('g_wood', (0.72, 0.50, 0.33, 1), 0.7)
    red = material('g_red', (0.93, 0.36, 0.30, 1), 0.5)
    yellow = material('g_yellow', (0.99, 0.78, 0.30, 1), 0.5)
    dark = material('g_dark', (0.16, 0.17, 0.2, 1), 0.6)
    lamp = material('g_lamp', (1.0, 0.86, 0.6, 1), 0.4, emit=6.0)
    W, D, H = 14.0, 10.0, 5.0
    objs = []
    objs.append(box((0, -8.0, -0.1), (W + 30, D + 16, 0.2), floor))
    objs.append(box((0, D / 2, H / 2), (W, 0.3, H), wall))
    objs.append(box((-W / 2, 0, H / 2), (0.3, D, H), wall))
    objs.append(box((W / 2, 0, H / 2), (0.3, D, H), wall))
    objs.append(box((0, D / 2 - 0.16, 0.25), (W, 0.06, 0.5), trim))
    objs.append(box((-W / 2 + 0.16, 0, 0.25), (0.06, D, 0.5), trim))
    objs.append(box((W / 2 - 0.16, 0, 0.25), (0.06, D, 0.5), trim))
    door_objs = []
    for i in range(8):
        door_objs.append(box((0, D / 2 - 0.2, 0.28 + i * 0.5), (6.0, 0.12, 0.46), door, bevel=0.03))
    part('garage_door', door_objs)
    objs.append(box((0, D / 2 - 0.2, 4.2), (6.5, 0.2, 0.3), trim, bevel=0.04))
    objs.append(box((-3.2, D / 2 - 0.2, 2.1), (0.25, 0.2, 4.2), trim, bevel=0.04))
    objs.append(box((3.2, D / 2 - 0.2, 2.1), (0.25, 0.2, 4.2), trim, bevel=0.04))
    for sx in (-1, 1):
        for z in (1.2, 2.2, 3.2):
            objs.append(box((sx * (W / 2 - 0.5), 1.0, z), (0.6, 4.0, 0.08), wood, bevel=0.02))
        cols = [red, yellow, trim, door, wood]
        k = 0
        for z in (1.24, 2.24, 3.24):
            for y in (-0.5, 0.4, 1.3, 2.3):
                k += 1
                s = 0.3 + 0.12 * ((k * 7) % 3)
                objs.append(box((sx * (W / 2 - 0.5), y, z + s / 2), (0.42, 0.5, s), cols[k % 5], bevel=0.03))
    for x in (-5, -2.5, 2.5, 5):
        objs.append(box((x, D / 2 - 0.35, 2.9), (0.9, 0.06, 1.2), dark, bevel=0.02))
    for x in (-4.5, -1.5, 1.5, 4.5):
        objs.append(cyl((x, -0.5, H - 0.45), 0.015, 0.9, dark, seg=8))
        objs.append(cone((x, -0.5, H - 1.0), 0.32, 0.08, 0.28, red))
        objs.append(sph((x, -0.5, H - 1.12), 0.12, lamp, seg=16))
    for i in range(15):
        x = -W / 2 + 0.5 + i * (W - 1) / 14
        sag = 0.35 * math.sin(i / 14 * math.pi * 3) ** 2
        objs.append(sph((x, D / 2 - 0.4, 4.6 - sag), 0.07, lamp if i % 2 else red, seg=12))
    part('garage', objs)
    pods = []
    for i, x in enumerate((-4.5, -1.5, 1.5, 4.5)):
        o = [cyl((x, -0.5, 0.12), 1.25, 0.24, door, seg=48), cyl((x, -0.5, 0.27), 1.1, 0.06, [red, yellow, trim, wood][i], seg=48)]
        pods.append(part('podium_%d' % i, o))
    export(os.path.join(OUT, 'garage.glb'))


def main():
    os.makedirs(OUT, exist_ok=True)
    reset()
    for r in ROLES:
        material(r)
    build_bodies()
    build_eyes()
    build_mouths()
    build_ears()
    build_tails()
    build_feet()
    build_hands()
    build_extras()
    names = sorted(o.name for o in bpy.data.objects)
    export(os.path.join(OUT, 'parts.glb'))
    print('PARTS', len(names), names)
    build_garage()
    print('DONE')


if __name__ == '__main__':
    main()
