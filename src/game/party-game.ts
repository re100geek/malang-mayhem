import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Character, CHARACTER_HEIGHT, type ClipName } from '../engine/character'
import { RoundObjects } from './round-objects'
import { placeIntroCamera, type CameraIntro } from './intro-camera'
import { landingHeight, type IntroTiming } from './round-intro'
import { ImpactEffects } from './impact-effects'
import type { MatchSettings } from './match-settings'
import { createProp, createTail, ingredientProp, prankItemProp } from '../engine/props'

export type Player = {
  id: string; seat: number; name: string; color: string; connected: boolean; host: boolean; ready: boolean
  x: number; z: number; vx: number; vz: number; jumpY: number; carried: string
  score: number; roundScore: number; falls: number; prankCount: number; prankSuccesses: number; action?: string; missionProgress?: number; secretMission?: { kind: string; text: string; target: number }; grabbedBy?: string
  partnerId?: string; respawning?: boolean; respawnIn?: number; respawns?: number; megaDeliveries?: number; megaDuo?: number; megaSolo?: number; tetherYanks?: number; cooldowns?: Record<string, number>
  prankCooldown: number; status: { slip: number; slow: number; ink: number; reverse: number; sticky?: number; stagger?: number; knockdown?: number; hug?: number; spin?: number; immune?: number }
}
export type TetherPair = { a: string; b: string; length: number; tension: number; rest: number; max: number }
export type MegaObject = { id: string; kind: string; name: string; x: number; z: number; carriers: string[]; delivered: boolean; zone: { x: number; z: number }; wobbleUntil: number }
export type BombObject = { holder: string; holderName: string; x: number; z: number; timer: number; fuse: number; passes: number }
export type SweeperObject = { angle: number; speed: number; radius: number; warn: number; reverseIn: number; direction: number }
export type TailObject = { id: string; color: string }
export type PartyState = {
  code: string; hostId: string; phase: string; roundIndex: number; round: { title: string; short: string; mode: string; timeLeft: number; duration: number; completed?: boolean } | null
  intro?: IntroTiming
  matchSettings?: MatchSettings
  plan?: { title: string; short?: string; mode: string; duration?: number }[]
  players: Player[]; objects: any; platforms: any[]; targetColor: string; result: any; event?: any; pairs?: TetherPair[]
}

type View = {
  character: Character
  target: THREE.Vector3
  speed: number
  y: number
  action: string
  spin: number
  vx: number
  vz: number
  color: string
  name: string
  ready: boolean
}

type Effect = { object: THREE.Object3D; life: number; ttl: number }

const tmpVec = new THREE.Vector3()
const tmpLook = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export class PartyGame {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  private readonly impacts = new ImpactEffects(this.scene)
  readonly camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 120)
  readonly root = new THREE.Group()
  private readonly roundObjects = new RoundObjects(this.root)
  private readonly loader = new GLTFLoader()
  private readonly views = new Map<string, View>()
  private readonly props = new Map<string, THREE.Object3D>()
  private readonly mats = new Map<string, THREE.Material>()
  private readonly bands = new Map<string, { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial }>()
  private readonly tails = new Map<string, THREE.Object3D>()
  private readonly effects: Effect[] = []
  private assetScene?: THREE.Group
  private rigSource?: THREE.Object3D
  private clips: THREE.AnimationClip[] = []
  private state: PartyState | null = null
  private me = ''
  private localInput = { x: 0, z: 0 }
  private localPosition = new THREE.Vector3()
  private lookTarget = new THREE.Vector3(0, 1.2, 0)
  private lastPhase = ''
  private orbit = 0
  private fallbackGround?: THREE.Mesh
  private debug = false
  private showcaseItems: { kind: string; label: string; position: THREE.Vector3 }[] = []
  private propsMode = false
  private readonly practiceBoundary = new THREE.Mesh(
    new THREE.RingGeometry(7.91, 8, 96),
    new THREE.MeshBasicMaterial({ color: '#fff2c4', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
  )

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8))
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.scene.background = new THREE.Color('#dbe5e1')
    this.scene.add(this.root)
    this.camera.position.set(0, 8.4, 15)
    this.camera.lookAt(0, 1.2, 0)
    this.createWorld()
    this.practiceBoundary.rotation.x = -Math.PI / 2
    this.practiceBoundary.position.y = 0.07
    this.practiceBoundary.visible = false
    this.root.add(this.practiceBoundary)
    this.resize()
    addEventListener('resize', () => this.resize())
    this.debug = new URLSearchParams(location.search).has('debug')
    if (this.debug) (window as unknown as Record<string, unknown>).__mm = this
  }

  async load(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync('/assets/models/malang_mayhem.glb')
      this.assetScene = gltf.scene
      this.clips = gltf.animations
      this.rigSource = this.assetScene.getObjectByName('HumanoidRig')
      const arena = this.assetScene.getObjectByName('Arena')
      if (arena) {
        const clone = arena.clone(true)
        // GLB 아레나는 상단면이 y≈0.39에 있다. 게임 판정면(y=0)과 맞춰 발이 파묻히지 않게 내린다.
        const box = new THREE.Box3().setFromObject(clone)
        clone.position.y -= box.max.y
        clone.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) { mesh.receiveShadow = true; mesh.castShadow = false }
        })
        this.root.add(clone)
        if (this.fallbackGround) { this.root.remove(this.fallbackGround); this.fallbackGround = undefined }
      }
    } catch (error) {
      console.warn('GLB load failed; procedural fallback remains active.', error)
    }
  }

  /**
   * 소품 구별 검수용 갤러리(`?props`). 모든 아이템을 한 화면에 늘어놓고 이름표 좌표를 돌려준다.
   */
  showcase(): { label: string; x: number; y: number }[] {
    this.propsMode = true
    this.clearProps()
    this.showcaseItems = []
    const entries: [string, string][] = [
      ['banana', '바나나'], ['pizza_dough', '피자 도우'], ['pizza_sauce', '소스 병'], ['pizza_cheese', '치즈 웨지'],
      ['pizza_pepperoni', '페퍼로니'], ['crown', '왕관'], ['balloon', '풍선'], ['banana_peel', '바나나 껍질'],
      ['jelly_pool', '젤리 웅덩이'], ['mallet', '뿅망치'], ['reverse_arrow', '방향 반전'], ['bomb', '시한폭탄'],
      ['sweeper_bar', '스위퍼 막대'], ['tail', '꼬리'], ['golden_pizza', '황금 피자'], ['golden_trophy', '황금 트로피'],
    ]
    entries.forEach(([kind, label], index) => {
      const column = index % 4
      const row = Math.floor(index / 4)
      const x = -5.4 + column * 3.6
      const z = -5.0 + row * 3.4
      const object = this.prop(kind, `showcase:${kind}`)
      object.position.set(x, kind === 'sweeper_bar' ? 0 : 0.05, z)
      if (kind === 'sweeper_bar') object.scale.setScalar(0.28)
      this.showcaseItems.push({ kind, label, position: new THREE.Vector3(x, kind === 'sweeper_bar' ? 0.6 : 1.5, z) })
    })
    return this.showcaseLabels()
  }

  showcaseLabels(): { label: string; x: number; y: number }[] {
    return this.showcaseItems.map(item => {
      const point = item.position.clone().project(this.camera)
      return { label: item.label, x: Math.round((point.x * 0.5 + 0.5) * innerWidth), y: Math.round((-point.y * 0.5 + 0.5) * innerHeight) }
    })
  }

  private createWorld(): void {
    this.scene.add(new THREE.HemisphereLight('#fff6e2', '#3f456e', 2.1))
    const sun = new THREE.DirectionalLight('#fff2cd', 3.1)
    sun.position.set(-7, 15, 9)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16
    sun.shadow.bias = -0.0012
    this.scene.add(sun)
    const rim = new THREE.DirectionalLight('#a8d8ff', 0.7)
    rim.position.set(6, 6, -10)
    this.scene.add(rim)

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(12, 64),
      new THREE.MeshStandardMaterial({ color: '#6c787d', roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.root.add(ground)
    this.fallbackGround = ground

    const ring = new THREE.Mesh(new THREE.RingGeometry(11.4, 12, 64), new THREE.MeshBasicMaterial({ color: '#e7b866', side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    this.root.add(ring)

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(0.6 + (i % 3) * 0.18, 10, 8),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#fff1c8' : '#ffd8e6', roughness: 0.96 }),
      )
      cloud.position.set(Math.cos(angle) * 13.4, 0.35 + (i % 2) * 0.2, Math.sin(angle) * 13.4)
      cloud.scale.y = 0.5
      cloud.receiveShadow = true
      this.root.add(cloud)
    }
  }

  private material(name: string, color: string): THREE.MeshStandardMaterial {
    const key = `${name}:${color}`
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.74 }))
    return this.mats.get(key) as THREE.MeshStandardMaterial
  }

  setPlayerId(id: string): void { this.me = id }
  setInput(x: number, z: number): void { this.localInput.x = x; this.localInput.z = z }
  get playerPosition(): { x: number; z: number } { return { x: this.localPosition.x, z: this.localPosition.z } }

  clearState(): void {
    this.state = null
    this.impacts.clear()
    this.me = ''
    this.lastPhase = ''
    this.practiceBoundary.visible = false
    this.clearProps()
    for (const view of this.views.values()) view.character.dispose()
    this.views.clear()
  }

  setState(state: PartyState): void {
    this.state = state
    const lobby = state.phase === 'lobby'
    this.practiceBoundary.visible = lobby
    if (state.phase !== this.lastPhase) {
      if (!(this.lastPhase === 'countdown' && state.phase === 'play')) this.clearProps()
      this.lastPhase = state.phase
    }
    const seen = new Set<string>()
    const dummy: Player | undefined = lobby ? state.objects?.practiceDummy : undefined
    const players = dummy ? [...state.players, dummy] : state.players
    for (const player of players) {
      seen.add(player.id)
      let view = this.views.get(player.id)
      if (!view) {
        view = this.createView(player)
        this.views.set(player.id, view)
      }
      view.target.set(player.x, player.jumpY, player.z)
      view.speed = Math.hypot(player.vx, player.vz)
      view.vx = player.vx
      view.vz = player.vz
      view.y = player.jumpY
      view.action = player.action ?? 'Idle'
      view.spin = player.status?.spin ?? 0
      const knock = (player.status.knockdown ?? 0) > 0 || (player.status.stagger ?? 0) > 0
      view.character.setKnocked(knock)
      const ready = lobby && player.ready
      if (view.name !== player.name || view.color !== player.color || view.ready !== ready) {
        view.character.setProfile(player.name, player.color, ready)
        Object.assign(view, { name: player.name, color: player.color, ready })
      }
      view.character.setLabelVisible(player.connected && (lobby || player.id !== this.me))
      if (player.id === this.me) {
        if (this.localPosition.lengthSq() === 0 || state.phase === 'lobby' || state.phase === 'countdown') this.localPosition.set(player.x, player.jumpY, player.z)
      }
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue
      view.character.dispose()
      this.views.delete(id)
    }
    this.syncWorld(state)
    this.syncBands(state)
  }

  private createView(player: Player): View {
    const character = this.rigSource
      ? new Character(this.rigSource, this.clips, player.color, player.name)
      : this.fallbackCharacter(player.color, player.name)
    character.root.position.set(player.x, player.jumpY, player.z)
    this.root.add(character.root)
    return { character, target: new THREE.Vector3(player.x, player.jumpY, player.z), speed: 0, y: player.jumpY, action: 'Idle', spin: 0, vx: 0, vz: 0, color: player.color, name: player.name, ready: false }
  }

  /** GLB를 못 읽었을 때만 쓰는 단순 대체 캐릭터. */
  private fallbackCharacter(color: string, name: string): Character {
    const group = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.material('body', color))
    body.scale.set(1, 1.1, 0.92)
    body.position.y = 1.1
    body.castShadow = true
    group.add(body)
    const eyeMat = this.material('eye', '#151333')
    for (const x of [-0.3, 0.3]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), eyeMat)
      eye.position.set(x, 1.45, 0.8)
      group.add(eye)
    }
    void name
    return new Character(group, [], color, name)
  }

  /** 서버 응답을 기다리지 않고 내 캐릭터의 장난 모션을 바로 보여 준다(표시 전용). */
  hintAction(name: 'Bonk' | 'Hit' | 'Jump'): void {
    this.views.get(this.me)?.character.hint(name as ClipName)
  }

  private clearProps(): void {
    this.roundObjects.clear()
    for (const [key, object] of this.props) {
      object.removeFromParent()
      if (object.userData.kind === 'golden_vault') {
        object.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            child.material.dispose()
          }
        })
      }
      if (object instanceof THREE.Mesh && ['delivery', 'station', 'tower', 'mega-zone'].includes(key)) {
        object.geometry.dispose()
        object.material.dispose()
      }
      if (key.startsWith('practice:')) {
        object.traverse(child => { if (child instanceof THREE.Mesh) child.geometry.dispose() })
      }
    }
    this.props.clear()
    for (const object of this.tails.values()) object.removeFromParent()
    this.tails.clear()
  }

  /** 아이템/함정 소품은 절차적 메시(engine/props)로 만들고, 키별로 재사용한다. */
  private prop(kind: string, key: string, scale = 1): THREE.Object3D {
    const object = createProp(kind)
    object.scale.multiplyScalar(scale)
    object.traverse((child: THREE.Object3D) => { const mesh = child as THREE.Mesh; if (mesh.isMesh) mesh.castShadow = true })
    object.userData.kind = kind
    object.userData.key = key
    this.root.add(object)
    this.props.set(key, object)
    return object
  }

  showImpact(x: number, z: number, explosion: boolean, shakeCamera: boolean): void {
    this.impacts.add(x, z, explosion, shakeCamera)
  }

  showPrankEffect(type: string, x = 0, z = 0): void {
    const roundColors: Record<string, string> = { herd_score: '#ffcf4b', switch_open: '#62e8aa', vault_hit: '#ff694d' }
    const color = roundColors[type] || (type === 'jelly_pool' ? '#b76cff' : type === 'banana_peel' ? '#ffd35c' : type === 'reverse' ? '#57c7ff' : type === 'bonk' ? '#ffd35c' : type === 'tackle' ? '#ff7b68' : type === 'hug' || type === 'grab' ? '#ff9dd0' : type === 'shatter' ? '#fff2c4' : type === 'mega' ? '#ffcf4b' : type === 'mega_grab' || type === 'tether' ? '#ff87bd' : type === 'mega_drop' ? '#ff9d5c' : type === 'respawn' ? '#62e8aa' : type === 'fall' ? '#ff5d6c' : type === 'bomb' || type === 'boom' ? '#ff9d2e' : type === 'sweeper' ? '#ff5d6c' : type === 'tail' || type === 'steal' ? '#ff5d8f' : '#ff5d8f')
    const radius = type === 'shockwave' || type === 'tackle' ? 1.8 : type === 'hug' ? 1.1 : type === 'mega' ? 2.3 : type === 'tether' ? 1.2 : type === 'boom' ? 2.8 : type === 'sweeper' ? 1.5 : 0.65
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 10, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, 0.06, z)
    this.scene.add(ring)
    this.effects.push({ object: ring, life: 0, ttl: 0.55 })
    if (type === 'bonk') {
      for (let i = 0; i < 5; i++) {
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: '#ffd35c', transparent: true, opacity: 0.95 }))
        const angle = (i * Math.PI * 2) / 5
        star.position.set(x + Math.cos(angle) * 0.7, 2.2 + Math.sin(angle) * 0.35, z + Math.sin(angle) * 0.7)
        this.scene.add(star)
        this.effects.push({ object: star, life: 0, ttl: 0.7 })
      }
    }
    if (type === 'shatter') {
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff8c76' : '#fff2c4', transparent: true, opacity: 0.95 }))
        const angle = (i * Math.PI * 2) / 6
        shard.position.set(x + Math.cos(angle) * 0.35, 0.7 + (i % 3) * 0.16, z + Math.sin(angle) * 0.35)
        this.scene.add(shard)
        this.effects.push({ object: shard, life: 0, ttl: 0.6 })
      }
    }
    if (type === 'land') {
      const dust = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 24), new THREE.MeshBasicMaterial({ color: '#fff6dd', transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
      dust.rotation.x = -Math.PI / 2
      dust.position.set(x, 0.05, z)
      this.scene.add(dust)
      this.effects.push({ object: dust, life: 0, ttl: 0.45 })
    }
  }

  private syncWorld(state: PartyState): void {
    const objects = state.objects || {}
    this.roundObjects.sync(objects, this.me)
    const keep = new Set<string>()
    const addItem = (item: any, kind: string, y = 0.8) => {
      const key = `${objects.type}:${item.id}`
      keep.add(key)
      let object = this.props.get(key)
      if (!object || object.userData.kind !== kind) {
        object?.removeFromParent()
        object = this.prop(kind, key)
      }
      const carrier = state.players.find(p => p.id === item.carriedBy)
      const x = carrier ? carrier.x : item.x
      const z = carrier ? carrier.z : item.z
      object.visible = true
      object.position.set(x, carrier ? 1.85 : y, z)
      object.rotation.y += 0.02
      return object
    }
    if (objects.type === 'banana') objects.items?.forEach((item: any) => addItem(item, 'banana', 0.55))
    if (objects.type === 'pizza') objects.items?.forEach((item: any) => addItem(item, ingredientProp(item.kind), 0.35))
    if (objects.type === 'balloon') objects.items?.forEach((item: any) => addItem(item, 'balloon', 1.5))
    objects.prankItems?.forEach((item: any) => addItem(item, prankItemProp(item.type), 0.55))
    if (objects.type === 'crown') {
      keep.add('crown')
      const crown = this.props.get('crown') || this.prop('crown', 'crown')
      const owner = state.players.find(p => p.id === objects.crown?.owner)
      crown.position.set(owner?.x ?? objects.crown?.x ?? 0, owner ? CHARACTER_HEIGHT + 0.1 : 1.1, owner?.z ?? objects.crown?.z ?? 0)
      crown.rotation.y += 0.03
    }
    if (objects.type === 'platform') {
      objects.platforms?.forEach((tile: any, index: number) => {
        const key = `platform:${index}`
        keep.add(key)
        let pad = this.props.get(key) as THREE.Mesh | undefined
        if (!pad) {
          pad = new THREE.Mesh(new THREE.BoxGeometry(3, 0.22, 3), this.material(key, tile.color))
          pad.receiveShadow = true
          this.root.add(pad)
          this.props.set(key, pad)
        }
        pad.position.set(tile.x, 0.11, tile.z)
        pad.material = this.material(key, tile.color)
        const active = tile.color === objects.targetColor
        pad.scale.y = active ? 1.35 : 0.7
      })
    }
    if (objects.type === 'bomb') this.syncBomb(state, objects.bomb as BombObject | null, keep)
    if (objects.type === 'sweeper') this.syncSweeper(objects.sweeper as SweeperObject | null, keep)
    this.syncTails(state, objects.tails as TailObject[] | null, keep)
    if (objects.delivery) this.marker('delivery', objects.delivery.x, objects.delivery.z, '#ffcf4b', keep)
    if (objects.station) this.marker('station', objects.station.x, objects.station.z, '#ef6b65', keep)
    if (objects.tower) this.marker('tower', objects.tower.x, objects.tower.z, '#a877ff', keep)
    if (objects.mega) this.syncMega(objects.mega as MegaObject, keep)
    for (const [key, object] of this.props) {
      if (keep.has(key)) continue
      if (objects.type === 'practice' && key.startsWith('practice:')) {
        object.visible = false
        continue
      }
      object.removeFromParent()
      this.props.delete(key)
    }
  }

  /** 시한폭탄 — 든 사람 머리 위에 붙이고, 심지 불꽃을 깜빡인다. */
  private syncBomb(state: PartyState, bomb: BombObject | null, keep: Set<string>): void {
    if (!bomb) return
    keep.add('bomb')
    const object = this.props.get('bomb') || this.prop('bomb', 'bomb')
    const holder = state.players.find(p => p.id === bomb.holder)
    const x = holder && !holder.respawning ? holder.x : bomb.x
    const z = holder && !holder.respawning ? holder.z : bomb.z
    const bob = Math.sin(performance.now() / 180) * 0.06
    object.position.set(x, holder && !holder.respawning ? CHARACTER_HEIGHT + 0.45 + bob : 0.35, z)
    object.rotation.y += 0.05
    const spark = object.userData.spark as THREE.Mesh | undefined
    if (spark) {
      const urgency = bomb.fuse <= 3 ? 0.5 + Math.abs(Math.sin(performance.now() / 90)) : 1
      spark.scale.setScalar(urgency)
      const sparkMaterial = spark.material as THREE.MeshStandardMaterial
      sparkMaterial.emissiveIntensity = 0.7 + Math.abs(Math.sin(performance.now() / (bomb.fuse <= 3 ? 90 : 220))) * 1.6
    }
  }

  /** 회전 스위퍼 막대 — 서버 각도를 그대로 그려서 판정과 그림이 어깃나지 않게 한다. */
  private syncSweeper(sweeper: SweeperObject | null, keep: Set<string>): void {
    if (!sweeper) return
    keep.add('sweeper')
    let object = this.props.get('sweeper')
    if (!object) object = this.prop('sweeper_bar', 'sweeper')
    // 소품 기본 길이(9)를 서버 판정 반지름에 맞춰 늘린다.
    object.scale.x = (sweeper.radius * 2) / 9
    object.position.set(0, 0, 0)
    object.rotation.y = sweeper.angle
    const warning = sweeper.warn > 0
    object.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (!material.emissive) return
      material.emissive.set(warning ? '#ff3f3f' : '#000000')
      material.emissiveIntensity = warning ? 0.45 + Math.abs(Math.sin(performance.now() / 110)) * 0.5 : 0
    })
  }

  /** 꼬리 뺏기 — 꼬리를 단 플레이어 허리 뒤에 컬러 꼬리를 붙인다. */
  private syncTails(state: PartyState, tails: TailObject[] | null, keep: Set<string>): void {
    const owners = new Map((tails || []).map(tail => [tail.id, tail.color]))
    for (const player of state.players) {
      const color = owners.get(player.id)
      const key = `tail:${player.id}`
      if (!color) continue
      keep.add(key)
      const cached = this.tails.get(player.id)
      if (!cached || cached.userData.color !== color) {
        cached?.removeFromParent()
        const object = createTail(color)
        object.userData.color = color
        object.traverse((child: THREE.Object3D) => { const mesh = child as THREE.Mesh; if (mesh.isMesh) mesh.castShadow = true })
        this.root.add(object)
        this.tails.set(player.id, object)
        this.props.set(key, object)
      }
    }
    for (const [id, object] of this.tails) {
      if (owners.has(id)) continue
      object.removeFromParent()
      this.tails.delete(id)
      this.props.delete(`tail:${id}`)
    }
  }

  /** 무거운 2인 합동 운반 오브젝트 — 황금 피자/트로피와 배달존. */
  private syncMega(mega: MegaObject, keep: Set<string>): void {
    keep.add('mega')
    let object = this.props.get('mega')
    if (!object || object.userData.kind !== mega.kind) {
      object?.removeFromParent()
      object = this.megaProp(mega.kind)
      object.userData.kind = mega.kind
      this.root.add(object)
      this.props.set('mega', object)
    }
    const carriers = mega.carriers.map(id => this.views.get(id)).filter((view): view is View => Boolean(view))
    let x = mega.x
    let z = mega.z
    let y = 0.45
    if (carriers.length && mega.kind !== 'golden_vault') {
      x = carriers.reduce((n, view) => n + view.character.root.position.x, 0) / carriers.length
      z = carriers.reduce((n, view) => n + view.character.root.position.z, 0) / carriers.length
      y = 1.15 + Math.sin(performance.now() / 220) * 0.06
    }
    if (mega.kind === 'golden_vault' && carriers.length === 2) y = 0.93
    if (mega.delivered) y = 1.7 + Math.sin(performance.now() / 260) * 0.18
    object.position.set(x, y, z)
    if (mega.kind !== 'golden_vault') object.rotation.y += 0.012
    if (mega.wobbleUntil > Date.now()) object.rotation.z = Math.sin(performance.now() / 40) * 0.28
    else object.rotation.z *= 0.9
    keep.add('mega-zone')
    let ring = this.props.get('mega-zone') as THREE.Mesh | undefined
    if (!ring) {
      ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.1, 10, 40), new THREE.MeshBasicMaterial({ color: '#ffcf4b', transparent: true, opacity: 0.85 }))
      ring.rotation.x = -Math.PI / 2
      this.root.add(ring)
      this.props.set('mega-zone', ring)
    }
    ring.position.set(mega.zone.x, 0.07, mega.zone.z)
    ring.rotation.z += 0.004
    ;(ring.material as THREE.MeshBasicMaterial).opacity = mega.delivered ? 0.25 : 0.85
  }

  private megaProp(kind: string): THREE.Object3D {
    return createProp(kind)
  }

  /** 고무줄 짝꿍 — 서버가 짝지어 준 두 캐릭터를 탄성 밴드로 잇는다. */
  private syncBands(state: PartyState): void {
    const wanted = new Set<string>()
    for (const pair of state.pairs ?? []) {
      const key = [pair.a, pair.b].sort().join('|')
      wanted.add(key)
      let band = this.bands.get(key)
      if (!band) {
        const material = new THREE.MeshStandardMaterial({ color: '#ff87bd', emissive: '#ff3f8a', emissiveIntensity: 0.35, roughness: 0.45 })
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 8, 1, true), material)
        this.root.add(mesh)
        band = { mesh, material }
        this.bands.set(key, band)
      }
      const playerA = state.players.find(player => player.id === pair.a)
      const playerB = state.players.find(player => player.id === pair.b)
      band.mesh.visible = playerA?.connected === true && playerB?.connected === true && !playerA.respawning && !playerB.respawning && Boolean(this.views.get(pair.a)) && Boolean(this.views.get(pair.b))
      band.material.color.set(pair.tension > 0.6 ? '#ff5d6c' : pair.tension > 0.25 ? '#ffbd4a' : '#ff87bd')
      band.material.emissiveIntensity = 0.25 + pair.tension * 0.55
    }
    for (const [key, band] of this.bands) {
      if (wanted.has(key)) continue
      band.mesh.removeFromParent()
      band.material.dispose()
      this.bands.delete(key)
    }
  }

  private updateBands(): void {
    for (const [key, band] of this.bands) {
      if (!band.mesh.visible) continue
      const [idA, idB] = key.split('|')
      const a = this.views.get(idA)
      const b = this.views.get(idB)
      if (!a || !b) { band.mesh.visible = false; continue }
      const pa = a.character.root.position
      const pb = b.character.root.position
      const ax = pa.x, ay = pa.y + 1.2, az = pa.z
      const bx = pb.x, by = pb.y + 1.2, bz = pb.z
      const dx = bx - ax, dy = by - ay, dz = bz - az
      const length = Math.hypot(dx, dy, dz) || 0.001
      const sag = Math.max(0, 3.4 - length) * 0.16
      band.mesh.position.set((ax + bx) / 2, (ay + by) / 2 - sag, (az + bz) / 2)
      band.mesh.scale.set(1, length, 1)
      tmpVec.set(dx, dy, dz).normalize()
      band.mesh.quaternion.setFromUnitVectors(UP, tmpVec)
    }
  }

  private marker(key: string, x: number, z: number, color: string, keep: Set<string>): void {
    keep.add(key)
    let object = this.props.get(key)
    if (!object) {
      object = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color }))
      object.rotation.x = -Math.PI / 2
      this.root.add(object)
      this.props.set(key, object)
    }
    object.position.set(x, 0.05, z)
    object.rotation.z += 0.01
  }

  /** 매 프레임: AI 봇과 내 캐릭터 모두 같은 경로로 애니메이션한다. */
  step(dt: number, intro?: CameraIntro): void {
    const state = this.state
    for (const [id, view] of this.views) {
      const player = state?.players.find(p => p.id === id)
      if (player?.respawning) { view.character.root.visible = false; continue }
      const immune = player?.status?.immune ?? 0
      view.character.root.visible = immune > 0 ? Math.sin(performance.now() / 70) > -0.15 : true
      const local = id === this.me && !!player
      let heading: number | undefined
      if (local && Math.hypot(this.localInput.x, this.localInput.z) > 0.12) {
        heading = Math.atan2(this.localInput.x, this.localInput.z)
      } else if (Math.hypot(view.vx, view.vz) > 1.0) {
        heading = Math.atan2(view.vx, view.vz)
      }

      // 서버 좌표 + 아주 짧은 외삽 → 뚝뚝 끊기지 않게.
      tmpVec.set(view.target.x, view.y, view.target.z)
      if (view.speed > 0.4) {
        tmpVec.x += view.vx * 0.03
        tmpVec.z += view.vz * 0.03
      }
      const rate = local ? 22 : 16
      const snap = view.character.root.position.distanceTo(tmpVec) > 3.2
      if (snap || intro) view.character.root.position.copy(tmpVec)
      else view.character.root.position.lerp(tmpVec, 1 - Math.exp(-rate * dt))

      const landing = intro?.kind === 'opening' && !intro.reducedMotion && player?.connected
      const lift = landing ? landingHeight(intro.progress, player.seat) : 0
      if (intro) view.character.root.position.y = view.y + lift

      const speed = local && heading !== undefined && Math.hypot(this.localInput.x, this.localInput.z) > 0.12
        ? Math.max(view.speed, Math.hypot(this.localInput.x, this.localInput.z) * 5.2)
        : view.speed
      view.character.update(dt, { speed, y: view.y + lift, action: lift > .06 ? 'Jump' : view.action, spin: view.spin, heading })
      if (local) this.localPosition.copy(view.character.root.position)
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]
      effect.life += dt
      const progress = effect.life / effect.ttl
      effect.object.scale.multiplyScalar(1 + dt * 2.2)
      const material = (effect.object as THREE.Mesh).material as THREE.MeshBasicMaterial
      if (material) material.opacity = Math.max(0, 1 - progress)
      if (progress >= 1) {
        effect.object.removeFromParent()
        if (effect.object instanceof THREE.Mesh) effect.object.geometry.dispose()
        material.dispose()
        this.effects.splice(i, 1)
      }
    }
    this.updateBands()
    this.updateTails()
    this.roundObjects.update(dt, performance.now() / 1000)
  }

  /** 꼬리는 캐릭터 허리 뒤에 붙어 같이 흔들린다. */
  private updateTails(): void {
    const state = this.state
    if (!state) return
    for (const [id, object] of this.tails) {
      const view = this.views.get(id)
      const player = state.players.find(p => p.id === id)
      if (!view || !player) { object.visible = false; continue }
      object.visible = !player.respawning
      const position = view.character.root.position
      object.position.set(position.x, position.y, position.z)
      object.rotation.y = view.character.root.rotation.y
      object.scale.setScalar(1 + Math.sin(performance.now() / 240 + id.length) * 0.04)
    }
  }

  private updateCamera(dt: number, intro?: CameraIntro): void {
    if (intro && this.state) {
      placeIntroCamera(this.camera, this.lookTarget, this.state, this.me, intro)
      return
    }
    if (this.propsMode) {
      this.camera.position.set(0, 12.5, 15.5)
      this.lookTarget.set(0, 0.6, 0)
      this.camera.lookAt(this.lookTarget)
      return
    }
    const phase = this.state?.phase
    const me = this.views.get(this.me)
    if (phase === 'lobby' && me) {
      const position = me.character.root.position
      const portrait = this.camera.aspect < 0.9
      tmpVec.set(position.x, 8.5, position.z + (portrait ? 10 : 11.5))
      tmpLook.set(position.x, 1, position.z - 1)
      this.camera.position.lerp(tmpVec, 1 - Math.exp(-9 * dt))
      this.lookTarget.lerp(tmpLook, 1 - Math.exp(-9 * dt))
      this.camera.lookAt(this.lookTarget)
      return
    }
    if (phase === 'play' && me) {
      const portrait = this.camera.aspect < 0.9
      const distance = portrait ? 9.2 : 9.8
      const height = portrait ? 5.4 : 5.4
      const position = me.character.root.position
      tmpVec.set(position.x, height + position.y * 0.3, position.z + distance)
      tmpLook.set(position.x, 1.15, position.z - 0.8)
      const k = 1 - Math.exp(-6.5 * dt)
      this.camera.position.lerp(tmpVec, k)
      this.lookTarget.lerp(tmpLook, 1 - Math.exp(-9 * dt))
      this.camera.lookAt(this.lookTarget)
      return
    }
    this.orbit += dt
    tmpVec.set(Math.sin(this.orbit * 0.12) * 13.5, 7.6, Math.cos(this.orbit * 0.12) * 13.5)
    this.camera.position.lerp(tmpVec, 1 - Math.exp(-1.6 * dt))
    this.lookTarget.lerp(tmpLook.set(0, 1.25, 0), 1 - Math.exp(-2.2 * dt))
    this.camera.lookAt(this.lookTarget)
  }

  render(dt: number, intro?: CameraIntro): void {
    if (this.state?.phase === 'play' && this.lastPhase === 'play' && !this.snapped) {
      this.snapped = true
      const me = this.views.get(this.me)
      if (me) {
        const portrait = this.camera.aspect < 0.9
        this.camera.position.set(me.character.root.position.x, 5.4, me.character.root.position.z + (portrait ? 9.2 : 9.8))
        this.lookTarget.set(me.character.root.position.x, 1.15, me.character.root.position.z - 0.8)
        this.camera.lookAt(this.lookTarget)
      }
    }
    if (this.state?.phase !== 'play') this.snapped = false
    this.step(dt, intro)
    this.updateCamera(dt, intro)
    this.impacts.update(dt)
    const shake = this.impacts.cameraOffset()
    this.camera.position.x += shake
    this.renderer.render(this.scene, this.camera)
    if (shake) {
      this.camera.position.x -= shake
      this.camera.updateMatrixWorld()
    }
  }

  private snapped = false

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight
    this.camera.fov = this.camera.aspect < 0.9 ? 56 : 48
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(innerWidth, innerHeight)
  }

  /** `?debug`에서만 노출되는 검수용 스냅숏. */
  debugSnapshot(): unknown {
    const characters = [...this.views.entries()].map(([id, view]) => {
      const p = view.character.root.position
      const screen = p.clone().project(this.camera)
      const bones = view.character.boneRotations()
      const fromServer = this.state?.players.find(player => player.id === id)
      return {
        id,
        ready: view.ready,
        pos: [p.x, p.y, p.z].map(v => Number(v.toFixed(2))),
        server: fromServer ? [fromServer.x, fromServer.jumpY, fromServer.z].map(v => Number(v.toFixed(2))) : null,
        screen: [Math.round((screen.x * 0.5 + 0.5) * innerWidth), Math.round((-screen.y * 0.5 + 0.5) * innerHeight)],
        clip: view.character.currentClip,
        bones,
        scaleY: Number(view.character.body.scale.y.toFixed(3)),
        heading: Number(view.character.root.rotation.y.toFixed(2)),
      }
    })
    const meshes = this.root.children
      .filter(child => (child as THREE.Mesh).isMesh)
      .map(child => {
        const box = new THREE.Box3().setFromObject(child)
        const size = box.getSize(new THREE.Vector3())
        return { name: child.name || child.type, size: [size.x, size.y, size.z].map(v => Number(v.toFixed(2))), y: [box.min.y, box.max.y].map(v => Number(v.toFixed(2))) }
      })
    const names: string[] = []
    const first = this.views.values().next().value as View | undefined
    first?.character.model.traverse((object: THREE.Object3D) => { if ((object as THREE.Bone).isBone) names.push(object.name) })
    return { me: this.me, phase: this.state?.phase, camera: this.camera.position.toArray().map(v => Number(v.toFixed(2))), characters, meshes, boneNames: names }
  }

  /** 화면 좌표에 무엇이 있는지 확인하는 검수용 레이캐스트. */
  debugPick(clientX: number, clientY: number): unknown {
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1), this.camera)
    return raycaster.intersectObjects(this.scene.children, true).slice(0, 4).map(hit => {
      const chain: string[] = []
      let node: THREE.Object3D | null = hit.object
      while (node && chain.length < 6) { chain.push(node.name || node.type); node = node.parent }
      return { chain, distance: Number(hit.distance.toFixed(2)), point: hit.point.toArray().map(v => Number(v.toFixed(2))) }
    })
  }

  /** 카메라·장면 요약 (검수 로그용). */
  clipNames(): ClipName[] { return this.clips.map(clip => clip.name as ClipName) }
}
