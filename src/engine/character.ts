import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

/**
 * 캐릭터 리그와 모션.
 *
 * GLB(`public/assets/models/malang_mayhem.glb`)의 `HumanoidRig`를 그대로 복제해 쓰고,
 * 클립(Idle/Run/Jump/Bonk/Hit)만으로는 밋밋한 부분을 절차적 본 회전·스쿼시/스트레치로 덧입힌다.
 * 좌표 규칙: 정면 +Z, 위 +Y, 발바닥 y=0. 그래서 root.position.y = 점프 높이 그대로.
 */

export const CLIP_NAMES = ['Idle', 'Run', 'Jump', 'Bonk', 'Hit'] as const
export type ClipName = (typeof CLIP_NAMES)[number]

type BoneKey = 'Hips' | 'Spine' | 'Head' | 'Arm.L' | 'Arm.R' | 'Hand.L' | 'Hand.R' | 'Leg.L' | 'Leg.R' | 'Foot.L' | 'Foot.R'

const ONE_SHOT: ReadonlySet<ClipName> = new Set<ClipName>(['Bonk', 'Hit'])

/** 캐릭터 최종 키(발바닥→머리). 아레나 반지름 12 기준으로 화면에서 읽히는 크기. */
export const CHARACTER_HEIGHT = 3.498 * 0.82

export type MotionInput = {
  /** 수평 속도 (m/s) */
  speed: number
  /** 수직 위치 — 발바닥 기준 높이 */
  y: number
  /** 서버가 정한 모션 이름 (Idle/Run/Jump/Bonk/Hit, 그 외는 무시) */
  action: string
  /** 서버가 준 회전(라디안 누적) — 피격 스핀 */
  spin: number
  /** 바라볼 방향 (라디안, +Z가 0). 없으면 진행 방향을 쓴다. */
  heading?: number
}

type Pose = {
  /** 달리기 위상 */
  gait: number
  /** 남은 착지 스쿼시 (0~1) */
  land: number
  /** 피격/꿀밤 흔들림 (0~1) */
  impact: number
  /** 점프 수직 속도 */
  vy: number
}

const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let delta = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  return current + delta * (1 - Math.exp(-rate * dt))
}

function makeLabelTexture(name: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(19,18,50,.82)'
  ctx.beginPath(); ctx.roundRect(16, 22, 480, 84, 30); ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.fillStyle = '#fff9e8'
  ctx.font = '800 46px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, 256, 66)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** 발밑 접지 그림자 — 캐릭터가 땅에 서 있다는 걸 화면에서 바로 읽히게 한다. */
function makeContactShadow(): THREE.Mesh {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(20,18,40,.55)')
  gradient.addColorStop(0.55, 'rgba(20,18,40,.26)')
  gradient.addColorStop(1, 'rgba(20,18,40,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.012
  mesh.renderOrder = -1
  return mesh
}

export class Character {
  /** 월드 위치·바라보는 방향. */
  readonly root = new THREE.Group()
  /** 스쿼시/스트레치·스핀이 걸리는 몸통. 발바닥이 원점. */
  readonly body = new THREE.Group()
  readonly model: THREE.Object3D
  readonly label: THREE.Sprite
  private readonly shadow = makeContactShadow()
  private readonly bones = new Map<BoneKey, THREE.Object3D>()
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<ClipName, THREE.AnimationAction>()
  private current: ClipName | null = null
  private oneShot: ClipName | null = null
  private pose: Pose = { gait: 0, land: 0, impact: 0, vy: 0 }
  private time = Math.random() * 10
  private heading = Math.PI
  private knock = 0
  private knocked = false
  private lastY = 0
  private lastAction = ''
  private showLabel = true

  constructor(source: THREE.Object3D, clips: THREE.AnimationClip[], color: string, name: string) {
    this.model = SkeletonUtils.clone(source)
    this.model.scale.setScalar(0.82)
    this.tint(color)
    this.body.add(this.model)
    this.root.add(this.body, this.shadow)

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(name, color), transparent: true, depthTest: false }))
    this.label.scale.set(2.1, 0.525, 1)
    this.label.position.set(0, CHARACTER_HEIGHT + 0.62, 0)
    this.root.add(this.label)

    this.collectBones()

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of clips) {
      const name = clip.name as ClipName
      if (!CLIP_NAMES.includes(name)) continue
      const action = this.mixer.clipAction(clip)
      const once = name !== 'Idle' && name !== 'Run'
      action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity)
      action.clampWhenFinished = once
      this.actions.set(name, action)
    }
    this.play('Idle', 0)
  }

  /**
   * glTF 로더는 본 이름을 정리하면서 'Arm.L'을 'ArmL_1'처럼 바꿔 버린다.
   * 이름 표기 차이에 흔들리지 않도록 본만 모아 두고 글자만 남겨 비교한다.
   */
  private collectBones(): void {
    const wanted: Record<string, BoneKey> = {
      hips: 'Hips', spine: 'Spine', head: 'Head',
      arml: 'Arm.L', armr: 'Arm.R', handl: 'Hand.L', handr: 'Hand.R',
      legl: 'Leg.L', legr: 'Leg.R', footl: 'Foot.L', footr: 'Foot.R',
    }
    this.model.traverse((object: THREE.Object3D) => {
      const bone = object as THREE.Bone
      if (!bone.isBone) return
      const key = wanted[bone.name.toLowerCase().replace(/[^a-z]/g, '')]
      if (key) this.bones.set(key, bone)
    })
  }

  /** 검수용: 의미 있는 본들의 현재 회전값. */
  boneRotations(): Record<string, number[]> {
    const out: Record<string, number[]> = {}
    for (const [key, bone] of this.bones) out[key] = bone.quaternion.toArray().map(value => Number(value.toFixed(3)))
    return out
  }

  private tint(color: string): void {
    this.model.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
      const mapped = materials.map(material => {
        if (!material || !material.name?.includes('Humanoid_Mint')) return material
        const cloned = material.clone()
        cloned.color.set(color)
        cloned.roughness = Math.min(1, (cloned.roughness ?? 0.5) + 0.06)
        return cloned
      })
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0]
    })
  }

  setLabelVisible(visible: boolean): void {
    this.showLabel = visible
    this.label.visible = visible
  }

  /** 넘어짐/휘청 상태 — 몸을 뒤로 젖혀 접지력을 잃은 느낌을 준다. */
  setKnocked(knocked: boolean): void { this.knocked = knocked }

  /** 클립 전환. 같은 클립이면 (force 없이는) 다시 시작하지 않는다. */
  play(name: ClipName, fade = 0.14, force = false): void {
    const next = this.actions.get(name)
    if (!next) return
    if (this.current === name && !force) return
    const previous = this.current ? this.actions.get(this.current) : undefined
    next.reset()
    next.enabled = true
    next.setEffectiveTimeScale(1)
    next.setEffectiveWeight(1)
    if (previous && previous !== next) {
      next.crossFadeFrom(previous, fade, false)
    } else if (previous === next) {
      next.fadeIn(fade)
    }
    next.play()
    this.current = name
  }

  /** 서버 응답 전에 로컬에서 바로 재생하는 표시용 모션. */
  hint(name: ClipName): void {
    if (!ONE_SHOT.has(name)) return
    this.oneShot = name
    this.pose.impact = 1
    this.play(name, 0.06, true)
  }

  get currentClip(): ClipName | null { return this.current }

  update(dt: number, input: MotionInput): void {
    const step = Math.min(dt, 0.05)
    this.time += step

    const vy = step > 0 ? (input.y - this.lastY) / step : 0
    this.pose.vy = damp(this.pose.vy, THREE.MathUtils.clamp(vy, -14, 14), 16, step)
    // 착지: 발이 땅에 닿는 순간 살짝 눌렀다가 튕긴다.
    if (this.lastY > 0.2 && input.y <= 0.02 && this.pose.vy < 1) this.pose.land = 1
    this.pose.land = Math.max(0, this.pose.land - step * 4.2)
    this.lastY = input.y

    // 서버가 알려 준 모션(Bonk/Hit)은 한 번만 재생하고, 끝나면 이동 상태로 돌아간다.
    const action = input.action as ClipName
    if (action && action !== this.lastAction) {
      this.lastAction = action
      if (ONE_SHOT.has(action)) {
        this.pose.impact = 1
        this.oneShot = action
        this.play(action, 0.06, true)
      }
    }
    if (this.oneShot) {
      const playing = this.actions.get(this.oneShot)
      const duration = playing?.getClip().duration ?? 0
      if (!playing || playing.time >= duration - 0.06) {
        this.oneShot = null
        this.current = null
      }
    }

    const airborne = input.y > 0.14
    if (!this.oneShot) {
      const wanted: ClipName = airborne ? 'Jump' : input.speed > 0.55 ? 'Run' : 'Idle'
      this.play(wanted, wanted === 'Jump' ? 0.1 : 0.16)
      if (airborne) this.pose.impact = Math.max(0, this.pose.impact)
    }

    this.pose.impact = Math.max(0, this.pose.impact - step * 2.6)
    this.mixer.update(step)
    this.applyProcedural(step, input, airborne)
    this.applyTransform(step, input)
  }

  /** 클립 위에 덧입히는 절차적 본 회전. */
  private applyProcedural(dt: number, input: MotionInput, airborne: boolean): void {
    const running = !airborne && input.speed > 0.55
    const targetGait = running ? 9.4 + Math.min(input.speed, 8) * 0.85 : 0
    this.pose.gait += dt * (running ? targetGait : 4.2)

    const swing = Math.sin(this.pose.gait)
    const bounce = Math.sin(this.pose.gait * 2)
    const breath = Math.sin(this.time * 2.1)
    const blend = running ? Math.min(1, input.speed / 3.2) : 0
    const landing = this.pose.land
    const impact = this.pose.impact
    const shake = Math.sin(this.time * 36) * impact

    // 달리기: 다리·팔 스윙을 클립보다 크게, 몸통은 앞으로.
    this.rotate('Leg.L', swing * 0.5 * blend, 0, 0)
    this.rotate('Leg.R', -swing * 0.5 * blend, 0, 0)
    this.rotate('Foot.L', Math.max(0, -swing) * 0.35 * blend, 0, 0)
    this.rotate('Foot.R', Math.max(0, swing) * 0.35 * blend, 0, 0)
    this.rotate('Arm.L', -swing * 0.55 * blend, 0, -swing * 0.08 * blend)
    this.rotate('Arm.R', swing * 0.55 * blend, 0, swing * 0.08 * blend)
    this.rotate('Hand.L', -swing * 0.2 * blend, 0, 0)
    this.rotate('Hand.R', swing * 0.2 * blend, 0, 0)
    this.rotate('Spine', 0.1 * blend + bounce * 0.03 * blend, 0, swing * 0.06 * blend)
    this.rotate('Head', -0.12 * blend - bounce * 0.04 * blend, swing * 0.07 * blend, 0)
    this.rotate('Hips', 0, 0, -swing * 0.05 * blend)

    // 대기: 숨쉬기 + 좌우로 살짝.
    const idle = 1 - blend
    this.rotate('Spine', breath * 0.022 * idle, 0, breath * 0.02 * idle)
    this.rotate('Head', breath * -0.02 * idle, Math.sin(this.time * 0.7) * 0.09 * idle, 0)
    this.rotate('Arm.L', breath * 0.05 * idle, 0, 0)
    this.rotate('Arm.R', breath * 0.05 * idle, 0, 0)

    // 공중: 상승은 쭉 뻗고, 하강은 다리를 앞으로 모은다.
    if (airborne) {
      const climb = THREE.MathUtils.clamp(this.pose.vy / 6, -1, 1)
      this.rotate('Leg.L', -0.4 - climb * 0.3, 0, 0)
      this.rotate('Leg.R', -0.55 - climb * 0.35, 0, 0)
      this.rotate('Foot.L', 0.35, 0, 0)
      this.rotate('Foot.R', 0.4, 0, 0)
      this.rotate('Arm.L', -0.3 - climb * 0.5, 0, -0.9 - climb * 0.5)
      this.rotate('Arm.R', -0.3 - climb * 0.5, 0, 0.9 + climb * 0.5)
      this.rotate('Spine', -climb * 0.12, 0, 0)
    }

    // 피격/꿀밤: 머리부터 부르르 떨리고 몸이 뒤로 젖혀진다.
    if (impact > 0) {
      this.rotate('Head', -0.5 * impact + shake * 0.5, shake * 0.7, shake * 0.4)
      this.rotate('Spine', -0.16 * impact, shake * 0.18, shake * 0.2)
      this.rotate('Hips', 0, shake * 0.25, 0)
      this.rotate('Arm.L', -0.5 * impact, 0, -0.7 * impact)
      this.rotate('Arm.R', -0.42 * impact, 0, 0.66 * impact)
    }

    // 착지: 무릎을 접었다 펴며 몸을 눌러 준다.
    if (landing > 0) {
      this.rotate('Leg.L', -0.45 * landing, 0, 0)
      this.rotate('Leg.R', -0.45 * landing, 0, 0)
      this.rotate('Foot.L', 0.4 * landing, 0, 0)
      this.rotate('Foot.R', 0.4 * landing, 0, 0)
      this.rotate('Spine', -0.12 * landing, 0, 0)
    }
  }

  private applyTransform(dt: number, input: MotionInput): void {
    const airborne = input.y > 0.14
    const running = !airborne && input.speed > 0.55
    const blend = running ? Math.min(1, input.speed / 3.2) : 0
    const climb = THREE.MathUtils.clamp(this.pose.vy / 6, -1, 1)
    const landing = this.pose.land
    const bounce = Math.abs(Math.sin(this.pose.gait)) * blend

    // 스쿼시 & 스트레치
    let sy = 1 + Math.sin(this.pose.gait * 2) * 0.035 * blend
    let sxz = 1 - Math.sin(this.pose.gait * 2) * 0.02 * blend
    if (airborne) {
      sy = 1 + 0.16 * Math.max(0, climb)
      sxz = 1 - 0.09 * Math.max(0, climb)
    }
    if (landing > 0) {
      sy -= 0.3 * landing
      sxz += 0.22 * landing
    }
    this.knock = damp(this.knock, this.knocked ? 1 : 0, 9, dt)
    this.body.scale.set(sxz, sy, sxz)
    this.body.position.y = bounce * 0.09
    this.body.rotation.y = input.spin
    this.body.rotation.x = -0.55 * this.knock
    this.body.rotation.z = Math.sin(this.time * 7) * 0.12 * this.knock

    // 위치·바라보는 방향
    this.root.position.y = input.y
    const target = input.heading ?? this.heading
    this.heading = dampAngle(this.heading, target, 15, dt)
    this.root.rotation.y = this.heading

    // 접지 그림자: 떠 있는 만큼 작고 옅게.
    const lift = THREE.MathUtils.clamp(input.y / 3, 0, 1)
    this.shadow.position.y = 0.012 - input.y
    this.shadow.scale.setScalar(1 - lift * 0.45)
    const material = this.shadow.material as THREE.MeshBasicMaterial
    material.opacity = 1 - lift * 0.6

    this.label.visible = this.showLabel
  }

  private rotate(bone: BoneKey, x: number, y: number, z: number): void {
    if (!x && !y && !z) return
    const target = this.bones.get(bone)
    if (!target) return
    tmpE.set(x, y, z)
    tmpQ.setFromEuler(tmpE)
    target.quaternion.multiply(tmpQ)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.root.removeFromParent()
    this.label.material.map?.dispose()
    this.label.material.dispose()
  }
}
