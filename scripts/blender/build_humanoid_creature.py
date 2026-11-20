"""
MALANG MAYHEM — 크리처 휴머노이드 캐릭터 빌더 (Blender 4.2 LTS, headless)

기존 GLB(tmp/proj/public/assets/models/malang_mayhem.glb)에는 아레나/소품/캐릭터가
함께 들어 있다. 이 스크립트는 기존 GLB를 불러와 **깨진 휴머노이드만 삭제**하고,
폴가이즈 × R.E.P.O. 느낌의 매트 비닐 크리처를 새로 모델링·리깅·애니메이션한 뒤
같은 경로에 GLB로 다시 내보낸다. 아레나/소품 노드는 이름·위치 그대로 보존된다.

사용법:
  blender --background --factory-startup --python scripts/blender/build_humanoid_creature.py

좌표 규칙(Blender, Z-up): 캐릭터 정면 = -Y, 캐릭터 왼쪽 = +X.
glTF 내보내기(+Y up) 후에는 정면 = +Z, 위 = +Y, 발바닥 = y 0.
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector

PROJ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB_PATH = os.path.join(PROJ, "public", "assets", "models", "malang_mayhem.glb")
BLEND_OUT = os.path.join(PROJ, "build_malang_mayhem.blend")

FPS = 30
DEG = math.radians


# ----------------------------------------------------------------------------- utils
def smoothstep(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_modifiers(ob):
    select_only(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def apply_transforms(ob):
    select_only(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def shade_smooth(ob, angle_deg=None):
    select_only(ob)
    if angle_deg is None:
        bpy.ops.object.shade_smooth()
    else:
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
        except Exception:
            bpy.ops.object.shade_smooth()


def fix_normals(ob):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def set_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def sphere(name, loc, scale, mat, rot=None, seg=32, ring=18):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1.0, location=(0, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name + "_mesh"
    ob.scale = scale
    if rot is not None:
        ob.rotation_euler = rot
    ob.location = loc
    apply_transforms(ob)
    set_material(ob, mat)
    shade_smooth(ob)
    return ob


def capsule(name, p0, p1, radius, mat, seg=32, ring=18, bulge=0.0):
    """p0 -> p1 을 잇는 타원체(부드러운 캡슐). bulge>0 이면 가운데를 살짝 굵게."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    mid = (p0 + p1) * 0.5
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    ob = sphere(name, mid, (radius + bulge, radius + bulge, length * 0.5 + radius * 0.85), mat, rot=rot, seg=seg, ring=ring)
    return ob


def box(name, loc, size, mat, bevel=0.0, bevel_seg=3, subsurf=0):
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name + "_mesh"
    ob.scale = size
    ob.location = loc
    apply_transforms(ob)
    set_material(ob, mat)
    if bevel > 0:
        m = ob.modifiers.new("Bevel", 'BEVEL')
        m.width = bevel
        m.segments = bevel_seg
        m.limit_method = 'ANGLE'
    if subsurf > 0:
        m = ob.modifiers.new("Subdivision", 'SUBSURF')
        m.levels = subsurf
        m.render_levels = subsurf
    apply_modifiers(ob)
    shade_smooth(ob, angle_deg=55)
    return ob


# ----------------------------------------------------------------------------- scene reset / base import
def reset_and_import():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB_PATH)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    return scene


def delete_old_humanoid():
    """기존 캐릭터(아마추어 + 모든 자식 메시)와 잔여 액션/메시를 제거한다. 소품은 보존."""
    doomed = set()
    rig = bpy.data.objects.get("HumanoidRig")
    if rig:
        doomed.add(rig)
        for ob in bpy.data.objects:
            if ob.parent == rig:
                doomed.add(ob)
    for ob in list(bpy.data.objects):
        if ob.name.startswith("Icosphere"):
            doomed.add(ob)
        # 이름으로 남은 캐릭터 파편들
        base = ob.name.split('.')[0]
        if base in {"Ear_L", "Ear_R", "EyeWhitePair", "PupilPair", "Humanoid_Head", "Humanoid_Torso",
                    "Hand_L", "Hand_R", "UpperArm_L", "UpperArm_R", "Leg_L", "Leg_R",
                    "Shoe_L", "Shoe_R", "ShoeStripe_L", "ShoeStripe_R", "Neck", "BellyPanel",
                    "Crown"}:
            doomed.add(ob)
    for ob in doomed:
        bpy.data.objects.remove(ob, do_unlink=True)

    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    # 잔여 메시/아마추어 데이터 정리
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for ar in list(bpy.data.armatures):
        if ar.users == 0:
            bpy.data.armatures.remove(ar)


# ----------------------------------------------------------------------------- materials
def tune_materials():
    """기존 이름을 유지해 Three.js 코드(Humanoid_Mint 틴팅)와 호환시킨다."""
    def principled(mat):
        if not mat.use_nodes:
            mat.use_nodes = True
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                return n
        return None

    def conf(name, rough, spec=0.30):
        mat = bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name)
            mat.use_nodes = True
        node = principled(mat)
        if node:
            node.inputs["Roughness"].default_value = rough
            node.inputs["Metallic"].default_value = 0.0
            if "Specular IOR Level" in node.inputs:
                node.inputs["Specular IOR Level"].default_value = spec
            # glTF 매끈한 매트 비닐: 약한 클리어코트 없음
            if "Coat Weight" in node.inputs:
                node.inputs["Coat Weight"].default_value = 0.0
        mat.roughness = rough
        mat.metallic = 0.0
        return mat

    mint = conf("Humanoid_Mint", 0.52, 0.28)
    cream = conf("Humanoid_Cream", 0.55, 0.25)
    white = conf("Humanoid_White", 0.42, 0.30)
    coral = conf("Humanoid_Coral", 0.50, 0.30)
    pupil = conf("Humanoid_Pupil", 0.34, 0.35)

    # 색 (Principled 는 linear 값을 받는다)
    def color(mat, rgba):
        node = principled(mat)
        node.inputs["Base Color"].default_value = rgba
        mat.diffuse_color = rgba

    color(mint, (0.157, 0.596, 0.383, 1.0))      # #6FCCA6
    color(cream, (0.878, 0.771, 0.552, 1.0))     # #F2E4C4
    color(white, (1.0, 0.945, 0.845, 1.0))       # #FFF8F0
    color(coral, (0.870, 0.150, 0.110, 1.0))     # #F0654F
    color(pupil, (0.006, 0.005, 0.008, 1.0))     # #1A171C

    # 기존 'Humanoid_Visor' 는 더 이상 쓰지 않는다.
    visor = bpy.data.materials.get("Humanoid_Visor")
    if visor and visor.users == 0:
        bpy.data.materials.remove(visor)
    return mint, cream, white, coral, pupil


# ----------------------------------------------------------------------------- body
# (z, radius) — 배가 가장 넓고, 2.3 근처에서 살짝 잘록한 머리/몸통 일체형 크리처
BODY_PROFILE = [
    (0.900, 0.250),
    (0.950, 0.400),
    (1.010, 0.520),
    (1.090, 0.620),
    (1.180, 0.685),
    (1.300, 0.705),
    (1.450, 0.715),
    (1.600, 0.720),
    (1.750, 0.715),
    (1.880, 0.695),
    (2.000, 0.665),
    (2.120, 0.635),
    (2.240, 0.620),
    (2.360, 0.620),
    (2.480, 0.635),
    (2.600, 0.665),
    (2.720, 0.690),
    (2.830, 0.700),
    (2.940, 0.695),
    (3.040, 0.675),
    (3.130, 0.640),
    (3.220, 0.590),
    (3.300, 0.515),
    (3.370, 0.420),
    (3.430, 0.300),
    (3.470, 0.170),
    (3.490, 0.070),
]
BODY_BOTTOM = 0.875
BODY_TOP = 3.500
DEPTH = 0.90          # 앞뒤로 살짝 납작하게
RING_SEG = 20         # 반원(0~180도) 분할 수


def build_body(mint):
    """회전체 절반 + Mirror 모디파이어로 좌우 완벽 대칭 몸통."""
    verts = []
    rings = []
    for z, r in BODY_PROFILE:
        ring = []
        for k in range(RING_SEG + 1):
            th = -math.pi / 2 + math.pi * k / RING_SEG
            x = r * math.cos(th)
            y = r * math.sin(th) * DEPTH
            ring.append(len(verts))
            verts.append((x, y, z))
        rings.append(ring)

    bottom = len(verts)
    verts.append((0.0, 0.0, BODY_BOTTOM))
    top = len(verts)
    verts.append((0.0, 0.0, BODY_TOP))

    faces = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(RING_SEG):
            faces.append((a[k], a[k + 1], b[k + 1], b[k]))
    for k in range(RING_SEG):
        faces.append((bottom, rings[0][k + 1], rings[0][k]))
        faces.append((top, rings[-1][k], rings[-1][k + 1]))

    me = bpy.data.meshes.new("Body_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new("Body", me)
    bpy.context.collection.objects.link(ob)
    set_material(ob, mint)
    fix_normals(ob)

    mir = ob.modifiers.new("Mirror", 'MIRROR')
    mir.use_axis[0] = True
    mir.use_clip = True
    mir.merge_threshold = 0.0005
    sub = ob.modifiers.new("Subdivision", 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    apply_modifiers(ob)
    shade_smooth(ob)

    # 옆면 작은 둥근 귀 — 몸통에 병합
    ears = []
    for s in (1, -1):
        ears.append(sphere("Ear" + ("L" if s > 0 else "R"), (s * 0.700, 0.015, 2.720),
                           (0.105, 0.160, 0.190), mint, seg=24, ring=14))
    select_only(ob)
    for e in ears:
        e.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    ob.name = "Body"
    ob.data.name = "Body_mesh"
    return ob


def build_belly(body, cream):
    """몸통 표면을 그대로 따라가는 크림색 배 패널(레이는 표면에 밀착)."""
    Z0, ZH = 1.660, 0.540        # 중심 높이, 반높이
    TH = 0.68                     # 정면 기준 반각(rad)
    OFFSET = 0.022                # 표면에서 살짝 띄우기
    RINGS, SEG = 12, 54

    def surface(th, z):
        """몸통 중심에서 바깥으로 광선을 쏴 실제(서브디비전 적용된) 표면점을 얻는다."""
        d = Vector((math.cos(th), math.sin(th), 0.0)).normalized()
        origin = Vector((0.0, 0.0, z))
        ok, loc, nor, idx = body.ray_cast(origin, d, distance=6.0)
        if not ok:
            return Vector((math.cos(th) * 0.4, math.sin(th) * 0.4 * DEPTH, z))
        return loc + nor * OFFSET

    verts = []
    ring_idx = []
    verts.append(surface(-math.pi / 2, Z0))

    for i in range(1, RINGS + 1):
        t = i / RINGS
        ring = []
        for k in range(SEG):
            phi = 2.0 * math.pi * k / SEG
            u = t * math.cos(phi)
            v = t * math.sin(phi)
            th = -math.pi / 2 + u * TH
            z = Z0 + v * ZH
            ring.append(len(verts))
            verts.append(surface(th, z))
        ring_idx.append(ring)

    faces = []
    for k in range(SEG):
        faces.append((0, ring_idx[0][k], ring_idx[0][(k + 1) % SEG]))
    for i in range(len(ring_idx) - 1):
        a, b = ring_idx[i], ring_idx[i + 1]
        for k in range(SEG):
            k2 = (k + 1) % SEG
            faces.append((a[k], b[k], b[k2], a[k2]))

    me = bpy.data.meshes.new("BellyPanel_mesh")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new("BellyPanel", me)
    bpy.context.collection.objects.link(ob)
    set_material(ob, cream)

    # 법선이 앞(-Y)을 향하도록 정렬
    me.calc_loop_triangles()
    avg = Vector((0, 0, 0))
    for poly in me.polygons:
        avg += poly.normal
    if avg.dot(Vector((0, -1, 0))) < 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
    me.update()
    shade_smooth(ob)
    return ob


def build_eyes(white, pupil):
    eyes, pupils = [], []
    for s in (1, -1):
        tag = "L" if s > 0 else "R"
        eyes.append(sphere("EyeWhite" + tag, (s * 0.300, -0.552, 2.815),
                           (0.258, 0.130, 0.292), white, seg=40, ring=26))
        pupils.append(sphere("Pupil" + tag, (s * 0.300, -0.648, 2.792),
                             (0.098, 0.048, 0.104), pupil, seg=32, ring=20))
    return eyes, pupils


def build_arms(mint):
    arms, hands = [], []
    for s in (1, -1):
        tag = "L" if s > 0 else "R"
        shoulder = (s * 0.500, 0.000, 2.430)
        wrist = (s * 1.000, 0.030, 1.505)
        arms.append(capsule("Arm" + tag, shoulder, wrist, 0.170, mint, bulge=0.010))
        hand_c = Vector((s * 1.032, 0.020, 1.380))
        hands.append(sphere("Hand" + tag, hand_c, (0.225, 0.205, 0.255), mint, seg=32, ring=20))
        # 엄지 — 안쪽으로 작은 혹
        hands[-1] = (hands[-1], (s * 0.868, -0.085, 1.375), (0.095, 0.125, 0.145))
    # 엄지를 손에 병합
    out = []
    for name, parts, s in (("L", hands[0], 1), ("R", hands[1], -1)):
        main = parts[0]
        thumb = sphere("ThumbTemp", parts[1], parts[2], mint, seg=24, ring=14)
        select_only(main)
        thumb.select_set(True)
        bpy.context.view_layer.objects.active = main
        bpy.ops.object.join()
        out.append(main)
    return arms + out


def build_legs(mint):
    legs = []
    for s in (1, -1):
        tag = "L" if s > 0 else "R"
        legs.append(capsule("Leg" + tag, (s * 0.375, 0.010, 1.080), (s * 0.405, 0.010, 0.330),
                            0.220, mint))
    return legs


def build_shoes(coral, cream):
    shoes = []
    for s in (1, -1):
        tag = "L" if s > 0 else "R"
        shell = box("Shoe" + tag, (s * 0.425, -0.075, 0.240), (0.255, 0.395, 0.215), coral,
                    bevel=0.150, bevel_seg=4, subsurf=1)
        sole = box("SoleTemp", (s * 0.425, -0.075, 0.0605), (0.268, 0.415, 0.060), cream,
                   bevel=0.055, bevel_seg=3, subsurf=1)
        s1 = sphere("StripeTemp1", (s * 0.425, -0.285, 0.400), (0.190, 0.028, 0.032), cream,
                    rot=(DEG(-16), 0, 0), seg=24, ring=12)
        s2 = sphere("StripeTemp2", (s * 0.425, -0.160, 0.425), (0.205, 0.028, 0.032), cream,
                    rot=(DEG(-12), 0, 0), seg=24, ring=12)
        select_only(shell)
        for o in (sole, s1, s2):
            o.select_set(True)
        bpy.context.view_layer.objects.active = shell
        bpy.ops.object.join()
        shell.name = "Shoe" + tag
        shell.data.name = "Shoe" + tag + "_mesh"
        shoes.append(shell)
    return shoes


# ----------------------------------------------------------------------------- rig
BONES = [
    # name,     head,                 tail,                  parent,   connected
    ("Root",    (0.0, 0.0, 0.010),     (0.0, 0.0, 0.420),     None,     False),
    ("Hips",    (0.0, 0.0, 1.060),     (0.0, 0.0, 1.560),     "Root",   False),
    ("Spine",   (0.0, 0.0, 1.560),     (0.0, 0.0, 2.330),     "Hips",   True),
    ("Head",    (0.0, 0.0, 2.330),     (0.0, 0.0, 3.400),     "Spine",  True),
    ("Arm.L",   (0.500, 0.0, 2.430),   (1.000, 0.030, 1.505), "Spine",  False),
    ("Hand.L",  (1.000, 0.030, 1.505), (1.032, 0.020, 1.235), "Arm.L",  True),
    ("Arm.R",   (-0.500, 0.0, 2.430),  (-1.000, 0.030, 1.505), "Spine", False),
    ("Hand.R",  (-1.000, 0.030, 1.505), (-1.032, 0.020, 1.235), "Arm.R", True),
    ("Leg.L",   (0.375, 0.010, 1.080), (0.405, 0.010, 0.330), "Hips",   False),
    ("Foot.L",  (0.405, 0.010, 0.330), (0.425, -0.330, 0.140), "Leg.L", True),
    ("Leg.R",   (-0.375, 0.010, 1.080), (-0.405, 0.010, 0.330), "Hips",  False),
    ("Foot.R",  (-0.405, 0.010, 0.330), (-0.425, -0.330, 0.140), "Leg.R", True),
]


def build_rig():
    arm_data = bpy.data.armatures.new("HumanoidRig")
    arm = bpy.data.objects.new("HumanoidRig", arm_data)
    bpy.context.collection.objects.link(arm)
    arm.show_in_front = True
    select_only(arm)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent, connected in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
    for name, head, tail, parent, connected in BONES:
        eb = arm_data.edit_bones[name]
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = connected
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.display_type = 'OCTAHEDRAL'
    return arm


def assign_weights(ob, weight_fn):
    """weight_fn(Vector) -> {bone: w}"""
    groups = {}
    for v in ob.data.vertices:
        w = weight_fn(v.co.copy())
        total = sum(w.values())
        if total <= 0:
            continue
        for bone, val in w.items():
            if val <= 0:
                continue
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([v.index], val / total, 'REPLACE')


def body_weights(co):
    z = co.z
    if z < 1.35:
        return {"Hips": 1.0}
    if z < 1.80:
        t = smoothstep(1.35, 1.80, z)
        return {"Hips": 1.0 - t, "Spine": t}
    if z < 2.22:
        return {"Spine": 1.0}
    t = smoothstep(2.22, 2.60, z)
    return {"Spine": 1.0 - t, "Head": t}


def skin(arm, meshes):
    for ob in meshes:
        name = ob.name
        if name in ("Body", "BellyPanel"):
            fn = body_weights
        elif name.startswith(("EyeWhite", "Pupil", "Ear")):
            fn = lambda co: {"Head": 1.0}
        elif name.startswith("Arm"):
            side = "L" if name.endswith("L") else "R"
            fn = (lambda s: (lambda co: {
                "Arm." + s: 1.0 - 0.45 * smoothstep(2.10, 2.38, co.z),
                "Spine": 0.45 * smoothstep(2.10, 2.38, co.z),
            }))(side)
        elif name.startswith("Hand"):
            side = "L" if name.endswith("L") else "R"
            fn = (lambda s: (lambda co: {"Hand." + s: 1.0}))(side)
        elif name.startswith("Leg"):
            side = "L" if name.endswith("L") else "R"
            fn = (lambda s: (lambda co: {
                "Leg." + s: 1.0 - 0.55 * smoothstep(0.92, 1.08, co.z),
                "Hips": 0.55 * smoothstep(0.92, 1.08, co.z),
            }))(side)
        elif name.startswith("Shoe"):
            side = "L" if name.endswith("L") else "R"
            fn = (lambda s: (lambda co: {"Foot." + s: 1.0}))(side)
        else:
            fn = lambda co: {"Hips": 1.0}

        assign_weights(ob, fn)
        ob.parent = arm
        ob.matrix_parent_inverse = arm.matrix_world.inverted()
        mod = ob.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm
        mod.use_vertex_groups = True


# ----------------------------------------------------------------------------- animation
def rest_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def new_action(arm, name):
    if arm.animation_data is None:
        arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    rest_pose(arm)
    return act


def key(arm, frame, bone, rot=None, loc=None, scale=None):
    pb = arm.pose.bones[bone]
    if rot is not None:
        pb.rotation_euler = tuple(DEG(v) for v in rot)
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)


def finish(act, start, end):
    act.use_frame_range = True
    act.frame_start = start
    act.frame_end = end
    act.use_cyclic = False
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'


def anim_idle(arm):
    """숨쉬기 + 좌우 흔들림. 60프레임 루프 (발은 바닥 고정)."""
    act = new_action(arm, "Idle")
    frames = [
        (1,  (0, 0, 0),      (0, 0, 0),      (0, 0, 0),     (0, -3),  (0, 3),  (0, 0, 0),     (1, 1, 1)),
        (16, (1.5, 0, 1.5),  (2.5, 0, -1.5), (-2, 0, 4),    (-6, -7), (-4, 6), (0, 0.02, 0),  (1, 1.022, 1)),
        (31, (-1, 0, 0),     (-1.2, 0, 0),   (2.5, 0, 0),   (4, -2),  (3, 2),  (0, 0.0, 0),   (1, 0.995, 1)),
        (46, (1.5, 0, -1.5), (2.5, 0, 1.5),  (-2, 0, -4),   (-6, -7), (-4, 6), (0, 0.02, 0),  (1, 1.022, 1)),
        (60, (0, 0, 0),      (0, 0, 0),      (0, 0, 0),     (0, -3),  (0, 3),  (0, 0, 0),     (1, 1, 1)),
    ]
    for f, hrot, srot, hd, aL, aR, loc, ssc in frames:
        key(arm, f, "Hips", rot=hrot, loc=loc)
        key(arm, f, "Spine", rot=srot, scale=ssc)
        key(arm, f, "Head", rot=hd)
        key(arm, f, "Arm.L", rot=(aL[0], 0, aL[1]))
        key(arm, f, "Arm.R", rot=(aR[0], 0, aR[1]))
    finish(act, 1, 60)
    return act


def anim_run(arm):
    """큰 보폭 달리기. 21프레임 루프 = 0.7초에 두 걸음."""
    act = new_action(arm, "Run")
    frames = [
        (1,  dict(hrot=(6, 0, 0), loc=(0, -0.090, 0), srot=(8, 0, 0), hd=(-6, 0, 0),
                  legL=-30, legR=24, footL=14, footR=-10, aL=(44, -8), aR=(-46, 8))),
        (6,  dict(hrot=(7, 0, 0), loc=(0, 0.050, 0), srot=(7, 0, 0), hd=(-6, 0, 0),
                  legL=6, legR=-8, footL=0, footR=0, aL=(8, -6), aR=(-10, 6))),
        (11, dict(hrot=(6, 0, 0), loc=(0, -0.090, 0), srot=(8, 0, 0), hd=(-6, 0, 0),
                  legL=24, legR=-30, footL=-10, footR=14, aL=(-46, -8), aR=(44, 8))),
        (16, dict(hrot=(7, 0, 0), loc=(0, 0.050, 0), srot=(7, 0, 0), hd=(-6, 0, 0),
                  legL=-8, legR=6, footL=0, footR=0, aL=(-10, -6), aR=(8, 6))),
        (21, dict(hrot=(6, 0, 0), loc=(0, -0.090, 0), srot=(8, 0, 0), hd=(-6, 0, 0),
                  legL=-30, legR=24, footL=14, footR=-10, aL=(44, -8), aR=(-46, 8))),
    ]
    for f, d in frames:
        key(arm, f, "Hips", rot=d["hrot"], loc=d["loc"])
        key(arm, f, "Spine", rot=d["srot"])
        key(arm, f, "Head", rot=d["hd"])
        key(arm, f, "Leg.L", rot=(d["legL"], 0, 0))
        key(arm, f, "Leg.R", rot=(d["legR"], 0, 0))
        key(arm, f, "Foot.L", rot=(d["footL"], 0, 0))
        key(arm, f, "Foot.R", rot=(d["footR"], 0, 0))
        key(arm, f, "Arm.L", rot=(d["aL"][0], 0, d["aL"][1]))
        key(arm, f, "Arm.R", rot=(d["aR"][0], 0, d["aR"][1]))
    finish(act, 1, 21)
    return act


def anim_jump(arm):
    """움츠림 → 도약 → 공중 → 착지 스쿼시 → 복귀. 36프레임 1회."""
    act = new_action(arm, "Jump")
    frames = [
        (1,  dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
        (6,  dict(hrot=(8, 0, 0), loc=(0, -0.150, 0), srot=(10, 0, 0), hd=(-6, 0, 0),
                  legL=-36, legR=-36, footL=36, footR=36, aL=(40, -10), aR=(40, 10))),
        (11, dict(hrot=(-4, 0, 0), loc=(0, 0.300, 0), srot=(-4, 0, 0), hd=(4, 0, 0),
                  legL=4, legR=4, footL=-4, footR=-4, aL=(-24, -106), aR=(-24, 106))),
        (18, dict(hrot=(2, 0, 0), loc=(0, 0.420, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=-26, legR=-22, footL=26, footR=22, aL=(-30, -112), aR=(-30, 112))),
        (24, dict(hrot=(4, 0, 0), loc=(0, 0.220, 0), srot=(2, 0, 0), hd=(-2, 0, 0),
                  legL=-8, legR=-10, footL=8, footR=10, aL=(-24, -88), aR=(-24, 88))),
        (29, dict(hrot=(9, 0, 0), loc=(0, -0.180, 0), srot=(12, 0, 0), hd=(-9, 0, 0),
                  legL=-40, legR=-40, footL=40, footR=40, aL=(-28, -46), aR=(-28, 46))),
        (33, dict(hrot=(3, 0, 0), loc=(0, -0.040, 0), srot=(4, 0, 0), hd=(-3, 0, 0),
                  legL=-12, legR=-12, footL=12, footR=12, aL=(-12, -18), aR=(-12, 18))),
        (36, dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
    ]
    for f, d in frames:
        key(arm, f, "Hips", rot=d["hrot"], loc=d["loc"])
        key(arm, f, "Spine", rot=d["srot"])
        key(arm, f, "Head", rot=d["hd"])
        key(arm, f, "Leg.L", rot=(d["legL"], 0, 0))
        key(arm, f, "Leg.R", rot=(d["legR"], 0, 0))
        key(arm, f, "Foot.L", rot=(d["footL"], 0, 0))
        key(arm, f, "Foot.R", rot=(d["footR"], 0, 0))
        key(arm, f, "Arm.L", rot=(d["aL"][0], 0, d["aL"][1]))
        key(arm, f, "Arm.R", rot=(d["aR"][0], 0, d["aR"][1]))
    finish(act, 1, 36)
    return act


def anim_bonk(arm):
    """머리를 얻어맞고 뒤로 젖혀졌다가 부르르 떠는 30프레임."""
    act = new_action(arm, "Bonk")
    frames = [
        (1,  dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
        (4,  dict(hrot=(5, 0, 0), loc=(0, -0.060, 0), srot=(10, 0, 0), hd=(16, 0, 0),
                  legL=-14, legR=-14, footL=14, footR=14, aL=(26, -14), aR=(26, 14))),
        (9,  dict(hrot=(-8, 0, 4), loc=(0, -0.100, 0), srot=(-16, 0, -4), hd=(-34, 0, 7),
                  legL=6, legR=18, footL=-6, footR=-18, aL=(-10, -104), aR=(-14, 108))),
        (14, dict(hrot=(4, 0, -5), loc=(0, -0.070, 0), srot=(9, 0, 5), hd=(14, 0, -10),
                  legL=-10, legR=-16, footL=10, footR=16, aL=(-6, -78), aR=(-4, 72))),
        (19, dict(hrot=(-3, 0, 3), loc=(0, -0.050, 0), srot=(-6, 0, -3), hd=(-12, 0, 6),
                  legL=4, legR=8, footL=-4, footR=-8, aL=(0, -40), aR=(0, 34))),
        (24, dict(hrot=(2, 0, -1), loc=(0, -0.020, 0), srot=(3, 0, 1), hd=(5, 0, -3),
                  legL=-4, legR=-6, footL=4, footR=6, aL=(2, -20), aR=(1, 18))),
        (30, dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
    ]
    for f, d in frames:
        key(arm, f, "Hips", rot=d["hrot"], loc=d["loc"])
        key(arm, f, "Spine", rot=d["srot"])
        key(arm, f, "Head", rot=d["hd"])
        key(arm, f, "Leg.L", rot=(d["legL"], 0, 0))
        key(arm, f, "Leg.R", rot=(d["legR"], 0, 0))
        key(arm, f, "Foot.L", rot=(d["footL"], 0, 0))
        key(arm, f, "Foot.R", rot=(d["footR"], 0, 0))
        key(arm, f, "Arm.L", rot=(d["aL"][0], 0, d["aL"][1]))
        key(arm, f, "Arm.R", rot=(d["aR"][0], 0, d["aR"][1]))
    finish(act, 1, 30)
    return act


def anim_hit(arm):
    """뒤로 밀려나 휘청이며 팔을 휘젓는 32프레임."""
    act = new_action(arm, "Hit")
    frames = [
        (1,  dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
        (5,  dict(hrot=(-8, 0, 6), loc=(0, -0.090, 0), srot=(-20, 0, 5), hd=(-24, 0, 9),
                  legL=-24, legR=10, footL=24, footR=-10, aL=(-26, -86), aR=(-14, 64))),
        (11, dict(hrot=(-10, 0, -8), loc=(0, -0.110, 0), srot=(-14, 0, -7), hd=(-12, 0, -13),
                  legL=-14, legR=26, footL=14, footR=-26, aL=(-22, -60), aR=(-30, 98))),
        (17, dict(hrot=(-4, 0, 5), loc=(0, -0.070, 0), srot=(-6, 0, 4), hd=(-4, 0, 8),
                  legL=-18, legR=6, footL=18, footR=-6, aL=(-14, -44), aR=(-18, 54))),
        (23, dict(hrot=(-1, 0, -2), loc=(0, -0.030, 0), srot=(2, 0, -2), hd=(4, 0, -4),
                  legL=-4, legR=-2, footL=4, footR=2, aL=(-8, -22), aR=(-10, 26))),
        (32, dict(hrot=(0, 0, 0), loc=(0, 0, 0), srot=(0, 0, 0), hd=(0, 0, 0),
                  legL=0, legR=0, footL=0, footR=0, aL=(0, -3), aR=(0, 3))),
    ]
    for f, d in frames:
        key(arm, f, "Hips", rot=d["hrot"], loc=d["loc"])
        key(arm, f, "Spine", rot=d["srot"])
        key(arm, f, "Head", rot=d["hd"])
        key(arm, f, "Leg.L", rot=(d["legL"], 0, 0))
        key(arm, f, "Leg.R", rot=(d["legR"], 0, 0))
        key(arm, f, "Foot.L", rot=(d["footL"], 0, 0))
        key(arm, f, "Foot.R", rot=(d["footR"], 0, 0))
        key(arm, f, "Arm.L", rot=(d["aL"][0], 0, d["aL"][1]))
        key(arm, f, "Arm.R", rot=(d["aR"][0], 0, d["aR"][1]))
    finish(act, 1, 32)
    return act


def export_glb():
    bpy.ops.object.select_all(action='DESELECT')
    kwargs = dict(
        filepath=GLB_PATH,
        export_format='GLB',
        use_selection=False,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_bake_animation=False,
        export_optimize_animation_size=False,
        export_anim_single_armature=True,
        export_skins=True,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = {k: v for k, v in kwargs.items() if k in props}
    bpy.ops.export_scene.gltf(**kwargs)


def main():
    scene = reset_and_import()
    delete_old_humanoid()
    mint, cream, white, coral, pupil = tune_materials()

    body = build_body(mint)
    belly = build_belly(body, cream)
    eyes, pupils = build_eyes(white, pupil)
    arms = build_arms(mint)
    legs = build_legs(mint)
    shoes = build_shoes(coral, cream)

    meshes = [body, belly] + eyes + pupils + arms + legs + shoes
    for ob in meshes:
        print("MESH", ob.name, len(ob.data.vertices))

    arm = build_rig()
    skin(arm, meshes)

    anim_idle(arm)
    anim_run(arm)
    anim_jump(arm)
    anim_bonk(arm)
    anim_hit(arm)

    # 액션 5개만 남기고 정리
    keep = {"Idle", "Run", "Jump", "Bonk", "Hit"}
    for act in list(bpy.data.actions):
        if act.name not in keep:
            bpy.data.actions.remove(act)

    arm.animation_data.action = bpy.data.actions["Idle"]
    scene.frame_start = 1
    scene.frame_end = 60
    scene.frame_set(1)
    rest_pose(arm)

    os.makedirs(os.path.dirname(BLEND_OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    export_glb()
    print("BUILD_DONE", GLB_PATH, os.path.getsize(GLB_PATH))


main()
