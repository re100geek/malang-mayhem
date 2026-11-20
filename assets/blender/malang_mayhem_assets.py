import bpy
import math
import os
from mathutils import Vector, Quaternion

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODEL_DIR = os.path.join(ROOT, 'models')
SHARE_DIR = os.path.join(ROOT, 'share')
SHOT_DIR = os.path.abspath(os.path.join(ROOT, '..', 'shots'))
for path in (MODEL_DIR, SHARE_DIR, SHOT_DIR): os.makedirs(path, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def mat(name, color, roughness=0.78, metallic=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if bsdf.inputs.get('Transmission Weight'): bsdf.inputs['Transmission Weight'].default_value = 0.0
    if bsdf.inputs.get('Coat Weight'): bsdf.inputs['Coat Weight'].default_value = 0.08
    return m

MINT = mat('Humanoid_Mint', (0.42, 0.78, 0.66), 0.72)
MINT_DARK = mat('Humanoid_Mint_Dark', (0.25, 0.57, 0.49), 0.76)
CREAM = mat('Humanoid_Cream', (0.96, 0.91, 0.74), 0.82)
CORAL = mat('Humanoid_Coral', (0.95, 0.39, 0.32), 0.70)
DARK = mat('Humanoid_Visor', (0.075, 0.07, 0.06), 0.58)
WHITE = mat('Humanoid_White', (1.0, 0.98, 0.88), 0.48)
YELLOW = mat('Banana_Yellow', (1.0, 0.72, 0.08), 0.72)
GOLD = mat('Crown_Gold', (1.0, 0.58, 0.06), 0.48, 0.18)
RED = mat('Pizza_Red', (0.90, 0.16, 0.13), 0.78)
CREAM_PROP = mat('Pizza_Crust', (1.0, 0.70, 0.31), 0.82)
GREEN = mat('Platform_Mint', (0.24, 0.68, 0.53), 0.82)
CYAN = mat('Balloon_Cyan', (0.24, 0.70, 0.82), 0.68)
PURPLE = mat('Jelly_Purple_Matte', (0.55, 0.37, 0.78), 0.76)
GROUND = mat('Arena_Ground', (0.28, 0.34, 0.42), 0.92)


def smooth(obj):
    if hasattr(obj.data, 'polygons'):
        for p in obj.data.polygons: p.use_smooth = True
    return obj

def polish(obj, bevel=0.06, subdivision=1):
    if bevel:
        b = obj.modifiers.new('Bevel_Polish', 'BEVEL'); b.width = bevel; b.segments = 3
    if subdivision:
        s = obj.modifiers.new('Subdivision_Soften', 'SUBSURF'); s.levels = subdivision; s.render_levels = subdivision
    return smooth(obj)

def uv(name, loc, scale, material, segments=20, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material); return polish(o, 0.025, 1)

def cube(name, loc, scale, material, bevel=0.1):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if bevel:
        b = o.modifiers.new('Bevel_Polish', 'BEVEL'); b.width = bevel; b.segments = 3
    return o

def cyl(name, loc, radius, depth, material, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = bpy.context.object; o.name = name; o.data.materials.append(material); return polish(o, 0.025, 1)

def parent_bone(obj, arm, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone_name
    obj.matrix_world = world
    return obj

# Humanoid armature: explicit toy-human hierarchy for independent limb actions.
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
arm = bpy.context.object; arm.name = 'HumanoidRig'; arm.data.name = 'HumanoidRig'
edit = arm.data.edit_bones
root = edit[0]; root.name = 'Hips'; root.head = (0, 0.72, 0); root.tail = (0, 1.25, 0)
def bone(name, parent, head, tail):
    b = edit.new(name); b.parent = edit[parent]; b.head = head; b.tail = tail; b.use_connect = False; return b
bone('Spine', 'Hips', (0, 1.15, 0), (0, 2.0, 0))
bone('Head', 'Spine', (0, 1.95, 0), (0, 3.2, 0))
bone('L_Arm', 'Spine', (-0.65, 1.82, 0), (-1.12, 1.15, 0))
bone('L_Hand', 'L_Arm', (-1.12, 1.15, 0), (-1.22, 0.88, 0))
bone('R_Arm', 'Spine', (0.65, 1.82, 0), (1.12, 1.15, 0))
bone('R_Hand', 'R_Arm', (1.12, 1.15, 0), (1.22, 0.88, 0))
bone('L_Leg', 'Hips', (-0.38, 0.78, 0), (-0.42, 0.18, 0))
bone('L_Foot', 'L_Leg', (-0.42, 0.18, 0), (-0.42, 0.02, 0.24))
bone('R_Leg', 'Hips', (0.38, 0.78, 0), (0.42, 0.18, 0))
bone('R_Foot', 'R_Leg', (0.42, 0.18, 0), (0.42, 0.02, 0.24))
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
bpy.ops.object.mode_set(mode='OBJECT')

# Separate head/neck/torso/limbs/shoes pieces, each attached to a meaningful bone.
parts = []
def P(obj, bone_name): parts.append(parent_bone(obj, arm, bone_name)); return parts[-1]
P(uv('Humanoid_Head', (0, 2.62, 0), (1.08, 0.96, 0.98), MINT), 'Head')
def mirrored_pair(name, location, scale, material):
    obj = uv(name, location, scale, material, 24, 16)
    mirror = obj.modifiers.new('Mirror_Symmetric_Eyes', 'MIRROR'); mirror.use_axis[0] = True; mirror.use_clip = True
    return obj
P(mirrored_pair('EyeWhitePair', (-0.31, 2.70, 0.94), (0.26, 0.31, 0.10), WHITE), 'Head')
P(mirrored_pair('PupilPair', (-0.31, 2.70, 1.045), (0.105, 0.14, 0.045), DARK), 'Head')
for x, name in [(-0.58, 'Ear_L'), (0.58, 'Ear_R')]: P(uv(name, (x, 2.62, 0), (0.15, 0.22, 0.16), MINT), 'Head')
P(cyl('Neck', (0, 1.92, 0), .28, .28, CREAM), 'Spine')
P(uv('Humanoid_Torso', (0, 1.35, 0), (.82, .78, .55), MINT), 'Spine')
P(uv('BellyPanel', (0, 1.05, .54), (.42, .28, .06), CREAM), 'Hips')
for x, side, arm_name, hand_name in [(-.92, 'L', 'L_Arm', 'L_Hand'), (.92, 'R', 'R_Arm', 'R_Hand')]:
    P(uv(f'UpperArm_{side}', (x, 1.52, 0), (.23, .54, .23), CREAM), arm_name)
    P(uv(f'Hand_{side}', (x * 1.13, .93, 0), (.28, .32, .28), CREAM), hand_name)
for x, side, leg_name, foot_name in [(-.38, 'L', 'L_Leg', 'L_Foot'), (.38, 'R', 'R_Leg', 'R_Foot')]:
    P(cyl(f'Leg_{side}', (x, .55, 0), .24, .65, CREAM), leg_name)
    P(uv(f'Shoe_{side}', (x, .16, .18), (.42, .24, .60), CORAL), foot_name)
    stripe = P(cube(f'ShoeStripe_{side}', (x, .25, .62), (.26, .045, .06), CREAM, .03), foot_name)

# Action authoring: all actions are stored in the GLB and driven later by Three.js AnimationMixer.
def pose(bone_name, frame, rot=(0, 0, 0), loc=None, scale=None):
    pb = arm.pose.bones[bone_name]; pb.rotation_euler = rot
    if loc is not None: pb.location = loc
    if scale is not None: pb.scale = scale
    pb.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None: pb.keyframe_insert('location', frame=frame)
    if scale is not None: pb.keyframe_insert('scale', frame=frame)

def action(name, frames, loop=False):
    a = bpy.data.actions.new(name); a.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = a
    for frame, poses in frames:
        for bone_name, values in poses.items(): pose(bone_name, frame, **values)
    for fc in a.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'BEZIER'
        if loop: fc.modifiers.new('CYCLES')
    return a

idle = action('Idle', [(1, {'Spine': {'rot': (0,0,0)} }), (24, {'Spine': {'rot': (0,0.03,0)}}), (48, {'Spine': {'rot': (0,0,0)}})], True)
run = action('Run', [(1, {'L_Leg': {'rot': (.45,0,0)}, 'R_Leg': {'rot': (-.45,0,0)}, 'L_Arm': {'rot': (-.35,0,0)}, 'R_Arm': {'rot': (.35,0,0)}}), (8, {'L_Leg': {'rot': (-.45,0,0)}, 'R_Leg': {'rot': (.45,0,0)}, 'L_Arm': {'rot': (.35,0,0)}, 'R_Arm': {'rot': (-.35,0,0)}})], True)
jump = action('Jump', [(1, {'L_Leg': {'rot': (-.35,0,0)}, 'R_Leg': {'rot': (-.35,0,0)}, 'L_Arm': {'rot': (-1.0,0,0)}, 'R_Arm': {'rot': (-1.0,0,0)}}), (12, {'L_Leg': {'rot': (.15,0,0)}, 'R_Leg': {'rot': (.15,0,0)}, 'L_Arm': {'rot': (-1.25,0,0)}, 'R_Arm': {'rot': (-1.25,0,0)}})])
bonk = action('Bonk', [(1, {'R_Arm': {'rot': (0,0,-.2)}, 'Spine': {'rot': (0,0,.08)}}), (8, {'R_Arm': {'rot': (0,0,-1.45)}, 'Spine': {'rot': (0,0,-.10)}}), (16, {'R_Arm': {'rot': (0,0,.1)}, 'Spine': {'rot': (0,0,0)}})])
hit = action('Hit', [(1, {'Spine': {'rot': (0,0,.25)}, 'Head': {'rot': (0,0,-.25)}, 'L_Arm': {'rot': (0,0,.6)}, 'R_Arm': {'rot': (0,0,-.6)}}), (14, {'Spine': {'rot': (0,0,0)}, 'Head': {'rot': (0,0,0)}, 'L_Arm': {'rot': (0,0,0)}, 'R_Arm': {'rot': (0,0,0)}})])
arm.animation_data.action = idle
arm['malang_rig'] = 'HumanoidToy_2.5Head'
arm['malang_actions'] = 'Idle,Run,Jump,Bonk,Hit'

# Collectible props remain available to gameplay.
banana = P if False else uv('Banana', (-3.0, 0.7, 0), (.28, .85, .28), YELLOW); banana.rotation_euler[2] = -.55
banana2 = uv('BananaTip', (-2.72, 1.25, 0), (.18, .28, .18), GREEN); banana2.parent = banana
pizza = cyl('Pizza', (0, .72, 0), .9, .18, CREAM_PROP, 20)
for x, z in [(-.3,.2),(.35,.3),(-.05,-.25),(.25,-.3)]: uv('Pepperoni', (x,.86,z), (.16,.06,.16), RED, 10, 6).parent = pizza
balloon = uv('Balloon', (0,2.2,0), (.52,.72,.52), CYAN, 14, 10); string = cyl('BalloonString',(0,1.2,0),.018,1.6,WHITE,6); string.parent=balloon
platform = cube('Platform',(0,.1,0),(1.55,.12,1.55),GREEN,.14); tower = cyl('BalloonTower',(0,1.2,0),.55,2.1,PURPLE,12); tower.hide_render = True
peel = uv('BananaPeel',(2.6,.18,0),(.48,.08,.25),YELLOW,14,8); puddle=uv('JellyPuddle',(4,.09,0),(.95,.08,.72),PURPLE,18,8)
mallet_head=cyl('Mallet',(-2.5,1.15,0),.42,.32,CORAL,16); mallet_head.rotation_euler[1]=math.pi/2; mallet_handle=cyl('MalletHandle',(-2.5,.55,0),.09,1.2,GOLD,10); mallet_handle.parent=mallet_head
arrow=cube('ReverseArrow',(2.3,.3,0),(.45,.06,.14),CYAN,.08); arrow.rotation_euler[1]=math.pi/2; uv('ReverseArrowTip',(2,.3,0),(.22,.07,.18),CYAN,10,6)
arena=cyl('Arena',(0,-.22,0),12,.35,GROUND,32)
for i,(x,z,material) in enumerate([(-7,-5,CORAL),(7,-5,YELLOW),(-7,5,CYAN),(7,5,PURPLE)]): cube(f'AccentPad_{i}',(x,.05,z),(1.2,.12,1.2),material,.2)

# Clean studio lighting and comparison renders.
bpy.ops.object.camera_add(location=(9.2,7.8,10.5)); cam=bpy.context.object; cam.name='RenderCamera'
def track(obj,target,roll=math.pi):
    q = (Vector(target)-obj.location).to_track_quat('-Z','Y'); q = q @ Quaternion((0,0,1), roll)
    obj.rotation_mode = 'QUATERNION'; obj.rotation_quaternion = q
track(cam,(0,1.8,0)); bpy.context.scene.camera=cam
bpy.ops.object.light_add(type='AREA', location=(4,8,6)); key=bpy.context.object; key.data.energy=900; key.data.size=5; track(key,(0,1.5,0))
bpy.ops.object.light_add(type='AREA', location=(-5,4,3)); fill=bpy.context.object; fill.data.energy=500; fill.data.size=4; track(fill,(0,1.5,0))
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'; scene.world.color=(0.72,0.72,0.72); scene.render.film_transparent=False

def render_view(label, location, target=(0,1.8,0), width=640, height=500, roll=math.pi):
    scene.frame_set(1); bpy.context.view_layer.update(); cam.location=location; track(cam,target,roll); scene.render.resolution_x=width; scene.render.resolution_y=height; scene.render.filepath=os.path.join(SHOT_DIR,f'humanoid-{label}.png'); bpy.ops.render.render(write_still=True)
render_view('front',(0,2.0,10.5)); render_view('side',(10.5,2.0,0)); render_view('back',(0,2.0,-10.5)); render_view('top',(0,12.5,0),target=(0,0,0)); render_view('three-quarter',(3.8,2.0,10.5),roll=math.pi*1.5)
scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.filepath=os.path.join(SHARE_DIR,'favicon.png'); bpy.ops.render.render(write_still=True)
scene.render.resolution_x=1200; scene.render.resolution_y=630; scene.render.filepath=os.path.join(SHARE_DIR,'og.png'); bpy.ops.render.render(write_still=True)

bpy.ops.export_scene.gltf(filepath=os.path.join(MODEL_DIR,'malang_mayhem.glb'), export_format='GLB', use_selection=False, export_apply=True, export_animations=True, export_animation_mode='ACTIONS', export_lights=False, export_cameras=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(__file__),'malang_mayhem_assets.blend'))
print('MALANG MAYHEM humanoid Blender assets exported:', MODEL_DIR, SHARE_DIR)
