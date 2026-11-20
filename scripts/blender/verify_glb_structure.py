"""
MALANG MAYHEM GLB 구조 검증 (Blender 없이 순수 Python, glTF 2.0 바이너리 직접 파싱)

  python3 scripts/blender/verify_glb_structure.py [new.glb] [old.glb]

검사 항목
 1. 캐릭터 루트 노드 HumanoidRig / 스킨(관절) 목록
 2. 캐릭터 메시 노드 이름과 머티리얼(Humanoid_Mint 등)
 3. 글리프트 좌표계: Y-up, 발바닥 y≈0, 정면 +Z (눈이 +Z 쪽)
 4. 좌우 대칭: L/R 노드의 POSITION 경계가 X축 기준 정확히 대칭
 5. 애니메이션 5종(Idle/Run/Jump/Bonk/Hit)과 실제 회전 폭
 6. 아레나·소품 노드가 기존 GLB와 동일하게 보존되었는지
"""

import json
import os
import struct
import sys
import math

REQUIRED_CLIPS = ["Idle", "Run", "Jump", "Bonk", "Hit"]
CHAR_NODES = ["Body", "BellyPanel", "EyeWhiteL", "EyeWhiteR", "PupilL", "PupilR",
              "ArmL", "ArmR", "HandL", "HandR", "LegL", "LegR", "ShoeL", "ShoeR"]
PROP_NODES = ["Arena", "AccentPad_0", "AccentPad_1", "AccentPad_2", "AccentPad_3",
              "Banana", "Pizza", "Balloon", "BananaPeel", "JellyPuddle", "Mallet",
              "ReverseArrow", "Platform", "BalloonTower"]


def load(path):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "glTF magic mismatch"
    off, chunks = 12, {}
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunks[ctype] = data[off + 8:off + 8 + clen]
        off += 8 + clen
    gltf = json.loads(chunks[0x4E4F534A])
    bin_chunk = chunks.get(0x004E4942, b"")
    return gltf, bin_chunk


def accessor_bounds(gltf, acc_idx):
    a = gltf["accessors"][acc_idx]
    return a.get("min"), a.get("max"), a["count"]


def nodes_by_name(gltf):
    return {n.get("name"): i for i, n in enumerate(gltf["nodes"])}


def mesh_bounds(gltf, node_idx):
    node = gltf["nodes"][node_idx]
    if "mesh" not in node:
        return None
    out = []
    for prim in gltf["meshes"][node["mesh"]]["primitives"]:
        mn, mx, cnt = accessor_bounds(gltf, prim["attributes"]["POSITION"])
        out.append((mn, mx, cnt))
    return out


def main(new_path, old_path=None):
    gltf, _ = load(new_path)
    names = nodes_by_name(gltf)
    problems, notes = [], []

    # --- 1. 캐릭터 루트 & 스킨
    if "HumanoidRig" not in names:
        problems.append("HumanoidRig 노드 없음")
    skins = gltf.get("skins", [])
    if not skins:
        problems.append("스킨 없음")
    joints = [gltf["nodes"][j].get("name") for j in skins[0]["joints"]] if skins else []
    notes.append(f"skin joints({len(joints)}): {joints}")
    for must in ("Root", "Hips", "Spine", "Head", "Arm.L", "Arm.R", "Leg.L", "Leg.R"):
        if must not in joints:
            problems.append(f"관절 {must} 없음")

    # --- 2. 캐릭터 메시 & 머티리얼
    mats = [m.get("name") for m in gltf.get("materials", [])]
    for n in CHAR_NODES:
        if n not in names:
            problems.append(f"캐릭터 노드 {n} 없음")
    if "Humanoid_Mint" not in mats:
        problems.append("머티리얼 Humanoid_Mint 없음 (게임이 플레이어 색으로 틴팅하는 데 사용)")
    notes.append(f"materials: {mats}")

    used_mats = {}
    for n in CHAR_NODES:
        if n not in names:
            continue
        node = gltf["nodes"][names[n]]
        if "mesh" not in node:
            continue
        prim_mats = [mats[p.get("material")] if p.get("material") is not None else None
                     for p in gltf["meshes"][node["mesh"]]["primitives"]]
        used_mats[n] = prim_mats
    notes.append(f"character mesh materials: {used_mats}")

    # --- 3. 좌표계 / 자세 / 정면
    total_min = [1e9] * 3
    total_max = [-1e9] * 3
    for n in CHAR_NODES:
        b = mesh_bounds(gltf, names[n]) if n in names else None
        if not b:
            continue
        for mn, mx, _ in b:
            for i in range(3):
                total_min[i] = min(total_min[i], mn[i])
                total_max[i] = max(total_max[i], mx[i])
    height = total_max[1] - total_min[1]
    notes.append(f"character bounds glTF: min={[round(v,3) for v in total_min]} max={[round(v,3) for v in total_max]}")
    notes.append(f"height(y)={height:.3f} width(x)={total_max[0]-total_min[0]:.3f} depth(z)={total_max[2]-total_min[2]:.3f}")
    if abs(total_min[1]) > 0.05:
        problems.append(f"발바닥이 y=0 이 아님 (min y={total_min[1]:.3f}) — Y-up/접지 확인 필요")
    if height < 2.0 or height > 6.0:
        problems.append(f"캐릭터 높이 {height:.2f} 가 예상 범위(2~6) 밖")

    eye_bounds = {}
    for n in ("EyeWhiteL", "EyeWhiteR", "PupilL", "PupilR"):
        b = mesh_bounds(gltf, names[n]) if n in names else None
        if b:
            eye_bounds[n] = b[0]
    if len(eye_bounds) == 4:
        ez = sum((b[0][2] + b[1][2]) / 2 for b in eye_bounds.values()) / 4
        notes.append(f"눈 중앙 z={ez:.3f} (정면 +Z 이면 양수)")
        if ez <= 0:
            problems.append("눈이 +Z 가 아니라 -Z(뒤)에 있음 — 캐릭터가 뒤를 보고 있음")
    else:
        problems.append("눈 노드/메시를 찾지 못함")

    # --- 4. 좌우 대칭 (POSITION 경계 기준)
    pairs = [("EyeWhiteL", "EyeWhiteR"), ("PupilL", "PupilR"), ("ArmL", "ArmR"),
             ("HandL", "HandR"), ("LegL", "LegR"), ("ShoeL", "ShoeR"),
             ("Arm.L", "Arm.R"), ("Leg.L", "Leg.R")]
    sym_rows = []
    for l, r in pairs:
        if l not in names or r not in names:
            continue
        if "mesh" in gltf["nodes"][names[l]] and "mesh" in gltf["nodes"][names[r]]:
            bl = mesh_bounds(gltf, names[l])[0]
            br = mesh_bounds(gltf, names[r])[0]
            if not bl or not br:
                continue
            dev = max(abs(bl[0][0] + br[1][0]), abs(bl[1][0] + br[0][0]),
                      abs(bl[0][1] - br[0][1]), abs(bl[0][2] - br[0][2]),
                      abs(bl[1][1] - br[1][1]), abs(bl[1][2] - br[1][2]))
            sym_rows.append((l, r, dev))
            if dev > 1e-4:
                problems.append(f"{l}/{r} 비대칭 (max dev {dev:.6f})")
    notes.append("symmetry: " + "; ".join(f"{l}/{r} dev={d:.2e}" for l, r, d in sym_rows))

    # --- 5. 애니메이션
    anims = gltf.get("animations", [])
    anim_names = [a.get("name") for a in anims]
    notes.append(f"animations: {anim_names}")
    for clip in REQUIRED_CLIPS:
        if clip not in anim_names:
            problems.append(f"애니메이션 '{clip}' 없음")
        else:
            a = anims[anim_names.index(clip)]
            chans = a["channels"]
            targets = {gltf["nodes"][c["target"]["node"]].get("name") for c in chans}
            dur = 0.0
            for s in a["samplers"]:
                acc = gltf["accessors"][s["input"]]
                dur = max(dur, acc["max"][0])
            rot_tracks = sum(1 for c in chans if c["target"]["path"] == "rotation")
            notes.append(f"  {clip}: {len(chans)} channels ({rot_tracks} rotation), {len(targets)} nodes, {dur:.2f}s, bones={sorted(targets)}")
            if len(chans) < 8:
                problems.append(f"{clip} 채널 수가 너무 적음({len(chans)})")

    # --- 6. 소품 보존
    if old_path:
        old, _ = load(old_path)
        old_names = nodes_by_name(old)
        for n in PROP_NODES:
            if n not in names:
                problems.append(f"기존 소품 노드 {n} 유실")
                continue
            if n not in old_names:
                continue
            on = old["nodes"][old_names[n]]
            nn = gltf["nodes"][names[n]]
            ot = [round(v, 4) for v in on.get("translation", [0, 0, 0])]
            nt = [round(v, 4) for v in nn.get("translation", [0, 0, 0])]
            if ot != nt:
                problems.append(f"소품 {n} 위치 변경 {ot} -> {nt}")
            if "mesh" in on and "mesh" in nn:
                ob = mesh_bounds(old, old_names[n])[0]
                nb = mesh_bounds(gltf, names[n])[0]
                dev = max(abs(a - b) for a, b in zip(ob[0] + ob[1], nb[0] + nb[1]))
                if dev > 1e-3:
                    problems.append(f"소품 {n} 형상 변경 dev={dev:.4f}")
        notes.append(f"props checked against original: {PROP_NODES}")

    print("=== NOTES ===")
    for n in notes:
        print(" ", n)
    print("=== PROBLEMS ===")
    if problems:
        for p in problems:
            print("  ✗", p)
    else:
        print("  (없음)")
    print("RESULT", "PASS" if not problems else "FAIL", len(problems))
    return 0 if not problems else 1


if __name__ == "__main__":
    new = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets", "models", "malang_mayhem.glb")
    old = sys.argv[2] if len(sys.argv) > 2 else None
    sys.exit(main(new, old))
