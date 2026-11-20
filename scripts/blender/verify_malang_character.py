"""
MALANG MAYHEM 크리처 캐릭터 검증 (Blender headless)

  blender --background --factory-startup --python scripts/blender/verify_malang_character.py

GLB를 새로 불러와 다음을 수치로 확인한다.
 1. 직립/접지: 캐릭터 최저점 z≈0, 높이, 머리가 위
 2. 좌우 대칭: L/R 메시의 정점 분포가 X축 기준 대칭
 3. 정면: 눈이 -Y(Blender 기준 정면)
 4. 팔다리 분리: 팔/손/다리/신발이 몸통 실루엣 밖으로 나와 있는지 (높이별 간격)
 5. 리깅: 본 이름/계층
 6. 애니메이션 5종의 실제 동작 폭(관절 회전각, 손·발 이동거리, 골반 상하)
"""

import os
import bpy
import math
import sys
from mathutils import Vector

GLB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets", "models", "malang_mayhem.glb")
DEG = math.degrees

problems = []
notes = []


def fail(msg):
    problems.append(msg)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
rig = bpy.data.objects.get("HumanoidRig")
if not rig:
    print("RESULT FAIL: HumanoidRig 없음")
    sys.exit(1)

scene = bpy.context.scene
if rig.animation_data:
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.rotation_euler = (0, 0, 0)
    pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

meshes = {ob.name: ob for ob in bpy.data.objects if ob.type == 'MESH' and ob.parent == rig}
for name, ob in meshes.items():
    print("char mesh", name, len(ob.data.vertices))


def world_verts(ob):
    mw = ob.matrix_world
    return [mw @ v.co for v in ob.data.vertices]


def bbox(ob):
    vs = world_verts(ob)
    return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
            Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))


# ---------- 1. 접지 / 높이
all_v = []
for ob in meshes.values():
    all_v += world_verts(ob)
zmin = min(v.z for v in all_v)
zmax = max(v.z for v in all_v)
xspan = max(v.x for v in all_v) - min(v.x for v in all_v)
notes.append(f"height z: {zmin:.4f} .. {zmax:.4f} (h={zmax-zmin:.3f}), width x={xspan:.3f}")
if abs(zmin) > 0.01:
    fail(f"발이 바닥에 닿지 않음 (zmin={zmin:.4f})")
feet_z = bbox(meshes["ShoeL"])[0].z
if abs(feet_z) > 0.01:
    fail(f"신발 최저점 {feet_z:.4f} != 0")

# ---------- 2. 대칭 (정점 단위, 미러 대응점 최근접 거리)
from mathutils import kdtree

pairs = [("EyeWhiteL", "EyeWhiteR"), ("PupilL", "PupilR"), ("ArmL", "ArmR"),
         ("HandL", "HandR"), ("LegL", "LegR"), ("ShoeL", "ShoeR")]
for l, r in pairs:
    vl, vr = world_verts(meshes[l]), world_verts(meshes[r])
    if len(vl) != len(vr):
        fail(f"{l}/{r} 정점 수 다름 {len(vl)} vs {len(vr)}")
        continue
    kd = kdtree.KDTree(len(vr))
    for i, v in enumerate(vr):
        kd.insert(v, i)
    kd.balance()
    dev = 0.0
    for a in vl:
        _, _, d = kd.find(Vector((-a.x, a.y, a.z)))
        dev = max(dev, d)
    notes.append(f"symmetry {l}/{r}: verts={len(vl)} maxdev={dev:.2e}")
    if dev > 1e-4:
        fail(f"{l}/{r} 정점 비대칭 {dev:.6f}")

# ---------- 3. 정면 (-Y)
eye_c = (sum(v.y for v in world_verts(meshes["EyeWhiteL"]) + world_verts(meshes["EyeWhiteR"]))
         / (len(meshes["EyeWhiteL"].data.vertices) * 2))
body_y_center = (bbox(meshes["Body"])[0].y + bbox(meshes["Body"])[1].y) / 2
notes.append(f"eyes mean y={eye_c:.3f}, body y-center={body_y_center:.3f}")
if eye_c >= body_y_center:
    fail("눈이 몸통 뒤쪽에 있음 (정면이 -Y 가 아님)")

# ---------- 4. 팔다리 분리
def body_radius_at(z, tol=0.04):
    vals = [abs(v.x) for v in world_verts(meshes["Body"]) if abs(v.z - z) < tol]
    return max(vals) if vals else None


def limb_inner_x(ob, z, tol=0.04):
    vals = [abs(v.x) for v in world_verts(ob) if abs(v.z - z) < tol]
    return min(vals) if vals else None


for z in (1.35, 1.50, 1.65, 1.80):
    br = body_radius_at(z)
    for limb in ("HandL", "ArmL"):
        li = limb_inner_x(meshes[limb], z)
        if br is None or li is None:
            continue
        gap = li - br
        notes.append(f"gap z={z:.2f} {limb}: body r={br:.3f} limb inner={li:.3f} gap={gap:+.3f}")
        if limb == "HandL" and gap < 0.015:
            fail(f"손이 몸통에 묻힘 z={z} (gap={gap:.3f})")

# 신발/다리: 몸통 실루엣 아래로 내려와 있는지
shoe_top = bbox(meshes["ShoeL"])[1].z
body_bottom = bbox(meshes["Body"])[0].z
notes.append(f"body bottom z={body_bottom:.3f}, shoe top z={shoe_top:.3f}")
if shoe_top >= body_bottom:
    fail("신발이 몸통 아래로 분리되어 보이지 않음")

# 다리 좌우 간격
legL = bbox(meshes["LegL"])
legR = bbox(meshes["LegR"])
notes.append(f"leg gap x: {legL[1].x:.3f} | {legR[0].x:.3f}")

# ---------- 5. 본
bones = [(b.name, b.parent.name if b.parent else None) for b in rig.data.bones]
notes.append(f"bones: {bones}")
for must in ("Root", "Hips", "Spine", "Head", "Arm.L", "Arm.R", "Hand.L", "Hand.R",
             "Leg.L", "Leg.R", "Foot.L", "Foot.R"):
    if must not in [b[0] for b in bones]:
        fail(f"본 {must} 없음")

# ---------- 6. 애니메이션 동작 폭
acts = {a.name.replace("_HumanoidRig", ""): a for a in bpy.data.actions}
notes.append(f"actions: {sorted(acts)}")
if rig.animation_data is None:
    rig.animation_data_create()
for t in rig.animation_data.nla_tracks:
    t.mute = True

for clip in ("Idle", "Run", "Jump", "Bonk", "Hit"):
    act = acts.get(clip)
    if not act:
        fail(f"액션 {clip} 없음")
        continue
    rig.animation_data.action = act
    kf = [kp.co[0] for fc in act.fcurves for kp in fc.keyframe_points]
    start, end = int(min(kf)), int(max(kf))
    rest_dir = {}
    for bname in ("Arm.L", "Arm.R", "Leg.L", "Leg.R", "Head", "Spine", "Hips"):
        b = rig.data.bones[bname]
        rest_dir[bname] = (b.tail_local - b.head_local).normalized()
    samples = list(range(start, end + 1, max(1, (end - start) // 12))) + [end]
    maxrot = {}
    hand_travel = 0.0
    foot_travel = 0.0
    hip_range = [1e9, -1e9]
    prev = {}
    for f in samples:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        for bname in ("Arm.L", "Arm.R", "Leg.L", "Leg.R", "Head", "Spine", "Hips"):
            pb = rig.pose.bones[bname]
            d = (rig.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()
            ang = DEG(rest_dir[bname].angle(d))
            maxrot[bname] = max(maxrot.get(bname, 0.0), ang)
        hl = rig.matrix_world @ rig.pose.bones["Hand.L"].tail
        fl = rig.matrix_world @ rig.pose.bones["Foot.L"].tail
        hips = rig.matrix_world @ rig.pose.bones["Hips"].head
        hip_range[0] = min(hip_range[0], hips.z)
        hip_range[1] = max(hip_range[1], hips.z)
        if "h" in prev:
            hand_travel = max(hand_travel, (hl - prev["h"]).length)
            foot_travel = max(foot_travel, (fl - prev["f"]).length)
        prev = {"h": hl, "f": fl}
    notes.append(
        f"{clip} [{start}-{end}] maxrot=" + ", ".join(f"{k}:{v:.0f}°" for k, v in sorted(maxrot.items()))
        + f" | hand step {hand_travel:.2f}, foot step {foot_travel:.2f}, hip z {hip_range[0]:.2f}..{hip_range[1]:.2f}")
    if clip in ("Run", "Jump", "Bonk", "Hit"):
        if max(maxrot.get("Arm.L", 0), maxrot.get("Arm.R", 0)) < 25:
            fail(f"{clip}: 팔 동작이 너무 작음")
        if clip in ("Run", "Jump") and max(maxrot.get("Leg.L", 0), maxrot.get("Leg.R", 0)) < 15:
            fail(f"{clip}: 다리 동작이 너무 작음")

rig.animation_data.action = acts.get("Idle")

print("=== NOTES ===")
for n in notes:
    print(" ", n)
print("=== PROBLEMS ===")
for p in problems:
    print("  ✗", p)
print("RESULT", "PASS" if not problems else "FAIL", len(problems))
