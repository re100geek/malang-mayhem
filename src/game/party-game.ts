import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

export type Player = {
  id: string; seat: number; name: string; color: string; connected: boolean; host: boolean; ready: boolean
  x: number; z: number; vx: number; vz: number; jumpY: number; carried: string
  score: number; roundScore: number; falls: number; prankCount: number; prankSuccesses: number; action?: string; missionProgress?: number; secretMission?: { kind: string; text: string; target: number }; grabbedBy?: string
  prankCooldown: number; status: { slip: number; slow: number; ink: number; reverse: number; sticky?: number; stagger?: number; knockdown?: number; hug?: number; spin?: number; immune?: number }
}
export type PartyState = {
  code: string; hostId: string; phase: string; roundIndex: number; round: { title: string; short: string; mode: string; timeLeft: number; duration: number } | null
  players: Player[]; objects: any; platforms: any[]; targetColor: string; result: any; event?: any
}

type PlayerView = { root: THREE.Object3D; label: THREE.Sprite; mixer?: THREE.AnimationMixer; action?: THREE.AnimationAction; target: THREE.Vector3; color: string }

function makeLabel(name: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(19,18,50,.85)'; ctx.roundRect(16, 20, 480, 84, 28); ctx.fill()
  ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.stroke()
  ctx.fillStyle = '#fff9e8'; ctx.font = '700 44px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 62)
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  sprite.scale.set(2.5, 0.625, 1)
  return sprite
}

export class PartyGame {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 100)
  private readonly clock = new THREE.Clock()
  private readonly loader = new GLTFLoader()
  private readonly players = new Map<string, PlayerView>()
  private readonly props = new Map<string, THREE.Object3D>()
  private readonly mats = new Map<string, THREE.Material>()
  private assetScene?: THREE.Group
  private animations: THREE.AnimationClip[] = []
  private readonly clips = new Map<string, THREE.AnimationClip>()
  private state: PartyState | null = null
  private me = ''
  private localInput = { x: 0, z: 0 }
  private localPosition = new THREE.Vector3()
  private cameraTarget = new THREE.Vector3(0, 0, 0)
  private lastPhase = ''
  private effects: THREE.Object3D[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8))
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.scene.background = new THREE.Color('#dbe5e1')
    this.camera.position.set(0, 10.5, 14)
    this.camera.lookAt(0, 0, 0)
    this.createWorld()
    addEventListener('resize', () => this.resize())
  }

  async load(): Promise<void> {
    try {
      const gltf = await this.loader.loadAsync('/assets/models/malang_mayhem.glb')
      this.assetScene = gltf.scene
      this.animations = gltf.animations
      this.clips.clear(); for (const clip of this.animations) this.clips.set(clip.name, clip)
      const arena = this.assetScene.getObjectByName('Arena')
      if (arena) this.scene.add(arena.clone(true))
      for (const name of ['AccentPad_0', 'AccentPad_1', 'AccentPad_2', 'AccentPad_3']) {
        const o = this.assetScene.getObjectByName(name)
        if (o) this.scene.add(o.clone(true))
      }
    } catch (err) {
      console.warn('GLB load failed; procedural fallback remains active.', err)
    }
  }

  private createWorld(): void {
    const hemi = new THREE.HemisphereLight('#fff8e7', '#40477e', 2.4)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff3cf', 3.4)
    sun.position.set(-6, 14, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15; sun.shadow.camera.top = 15; sun.shadow.camera.bottom = -15
    this.scene.add(sun)
    const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: '#64747a', roughness: 0.94 }))
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground)
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.5, 12, 48), new THREE.MeshBasicMaterial({ color: '#e7b866', side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; this.scene.add(ring)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(0.65 + (i % 3) * .2, 10, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? '#fff1c8' : '#ffd8e6', roughness: .95 }))
      cloud.position.set(Math.cos(a) * 13.2, 0.4 + (i % 2) * .25, Math.sin(a) * 13.2); cloud.scale.y = .5; this.scene.add(cloud)
    }
  }

  private material(name: string, color: string): THREE.MeshStandardMaterial {
    const key = `${name}:${color}`
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: .72 }))
    return this.mats.get(key) as THREE.MeshStandardMaterial
  }

  private fallbackPlayer(color: string): THREE.Group {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.material('body', color)); body.scale.set(1, 1.12, .9); body.position.y = 1.1; body.castShadow = true; g.add(body)
    const eyeMat = this.material('eye', '#151333')
    for (const x of [-.3, .3]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), eyeMat); eye.position.set(x, 1.45, .78); g.add(eye) }
    return g
  }

  private playerRoot(color: string): THREE.Object3D {
    const source = this.assetScene?.getObjectByName('HumanoidRig')
    const root = source ? SkeletonUtils.clone(source) : this.fallbackPlayer(color)
    root.scale.setScalar(.72)
    root.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true; mesh.receiveShadow = true
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      if (material && (material as THREE.MeshStandardMaterial).name?.includes('Humanoid_Mint')) {
        const cloned = (material as THREE.MeshStandardMaterial).clone()
        cloned.color.set(color)
        mesh.material = cloned
      }
    })
    return root
  }

  setPlayerId(id: string): void { this.me = id }
  setInput(x: number, z: number): void { this.localInput.x = x; this.localInput.z = z }
  get playerPosition(): { x: number; z: number } { return { x: this.localPosition.x, z: this.localPosition.z } }

  setState(state: PartyState): void {
    this.state = state
    if (state.phase !== this.lastPhase) { this.lastPhase = state.phase; this.clearProps() }
    const seen = new Set<string>()
    for (const player of state.players) {
      seen.add(player.id)
      let view = this.players.get(player.id)
      if (!view) {
        const root = this.playerRoot(player.color)
        const label = makeLabel(player.name, player.color)
        root.add(label); label.position.set(0, 4.5, 0)
        this.scene.add(root)
        const mixer = this.animations.length ? new THREE.AnimationMixer(root) : undefined
        const action = mixer && (this.clips.get('Idle') || this.animations[0]) ? mixer.clipAction(this.clips.get('Idle') || this.animations[0]) : undefined
        action?.play()
        view = { root, label, mixer, action, target: new THREE.Vector3(player.x, 0, player.z), color: player.color }
        this.players.set(player.id, view)
      }
      view.target.set(player.x, player.jumpY, player.z)
      view.root.userData.player = player
      const desired = player.action && player.action !== 'Idle' ? player.action : player.jumpY > .12 ? 'Jump' : Math.hypot(player.vx, player.vz) > .45 ? 'Run' : 'Idle'
      const clip = this.clips.get(desired) || this.clips.get('Idle')
      if (view.mixer && clip && view.action?.getClip().name !== clip.name) { const next = view.mixer.clipAction(clip); next.reset().setLoop(desired === 'Run' || desired === 'Idle' ? THREE.LoopRepeat : THREE.LoopOnce, desired === 'Run' || desired === 'Idle' ? Infinity : 1).play(); view.action?.fadeOut(.08); next.fadeIn(.08); view.action = next }
      view.root.rotation.z = player.status.spin || 0
      const squash = (player.status.stagger || 0) > 0 || (player.status.knockdown || 0) > 0
      const base = .72
      view.root.scale.set(base * (squash ? 1.18 : 1), base * (squash ? .72 : 1), base * (squash ? 1.08 : 1))
      view.label.visible = player.connected
      if (player.id === this.me) {
        if (this.localPosition.lengthSq() === 0 || state.phase === 'countdown' || state.phase === 'lobby') this.localPosition.set(player.x, player.jumpY, player.z)
      }
    }
    for (const [id, view] of this.players) if (!seen.has(id)) { this.scene.remove(view.root); view.mixer?.stopAllAction(); this.players.delete(id) }
    this.syncWorld(state)
  }

  private clearProps(): void {
    for (const obj of this.props.values()) this.scene.remove(obj)
    this.props.clear()
  }
  private source(name: string): THREE.Object3D | undefined { return this.assetScene?.getObjectByName(name) }
  private prop(name: string, key: string, scale = .7): THREE.Object3D {
    const source = this.source(name)
    const obj = source ? SkeletonUtils.clone(source) : new THREE.Mesh(new THREE.SphereGeometry(.35, 12, 8), this.material('fallback', '#ffd35c'))
    obj.scale.setScalar(scale); obj.castShadow = true; obj.userData.key = key; this.scene.add(obj); this.props.set(key, obj); return obj
  }
  showPrankEffect(type: string, x = 0, z = 0): void {
    const color = type === 'jelly_pool' ? '#b76cff' : type === 'banana_peel' ? '#ffd35c' : type === 'reverse' ? '#57c7ff' : type === 'bonk' ? '#ffd35c' : type === 'tackle' ? '#ff7b68' : type === 'hug' || type === 'grab' ? '#ff9dd0' : type === 'shatter' ? '#fff2c4' : '#ff5d8f'
    const radius = type === 'shockwave' || type === 'tackle' ? 1.8 : type === 'hug' ? 1.1 : .65
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .09, 10, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .92 }))
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, .35, z); ring.userData.life = 0; this.scene.add(ring); this.effects.push(ring)
    if (type === 'bonk') for (let i = 0; i < 5; i++) { const star = new THREE.Mesh(new THREE.OctahedronGeometry(.18), new THREE.MeshBasicMaterial({ color: '#ffd35c', transparent: true, opacity: .95 })); const a = i * Math.PI * 2 / 5; star.position.set(x + Math.cos(a) * .7, 1.9 + Math.sin(a) * .35, z + Math.sin(a) * .7); star.userData.life = 0; this.scene.add(star); this.effects.push(star) }
    if (type === 'shatter') for (let i = 0; i < 6; i++) { const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(.12), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff8c76' : '#fff2c4', transparent: true, opacity: .95 })); const a = i * Math.PI * 2 / 6; shard.position.set(x + Math.cos(a) * .35, .65 + (i % 3) * .16, z + Math.sin(a) * .35); shard.userData.life = 0; this.scene.add(shard); this.effects.push(shard) }
  }
  private syncWorld(state: PartyState): void {
    const objects = state.objects || {}
    const keep = new Set<string>()
    const addItem = (item: any, name: string) => {
      const key = `${objects.type}:${item.id}`; keep.add(key)
      let obj = this.props.get(key) || this.prop(name, key, name === 'Balloon' ? .7 : .55)
      let x = item.x, z = item.z, y = name === 'Balloon' ? 1.7 : .8
      const carrier = state.players.find(p => p.id === item.carriedBy)
      if (carrier) { x = carrier.x; z = carrier.z; y = 1.8 }
      obj.position.set(x, y, z); obj.rotation.y += .02
    }
    if (objects.type === 'banana') objects.items?.forEach((i: any) => addItem(i, 'Banana'))
    if (objects.type === 'pizza') objects.items?.forEach((i: any) => addItem(i, 'Pizza'))
    if (objects.type === 'balloon') objects.items?.forEach((i: any) => addItem(i, 'Balloon'))
    objects.prankItems?.forEach((i: any) => addItem(i, i.type === 'banana_peel' ? 'BananaPeel' : i.type === 'jelly_pool' ? 'JellyPuddle' : i.type === 'shockwave' ? 'Mallet' : 'ReverseArrow'))
    if (objects.type === 'crown') {
      keep.add('crown')
      let crown = this.props.get('crown') || this.prop('Crown', 'crown', .9)
      const owner = state.players.find(p => p.id === objects.crown?.owner)
      crown.position.set(owner?.x ?? objects.crown?.x ?? 0, owner ? 3 : 1.1, owner?.z ?? objects.crown?.z ?? 0)
      crown.rotation.y += .03
    }
    if (objects.type === 'platform') {
      objects.platforms?.forEach((tile: any, i: number) => {
        const key = `platform:${i}`; keep.add(key)
        let pad = this.props.get(key)
        if (!pad) {
          pad = new THREE.Mesh(new THREE.BoxGeometry(3, .25, 3), this.material(key, tile.color))
          pad.castShadow = true; pad.receiveShadow = true; this.scene.add(pad); this.props.set(key, pad)
        }
        pad.position.set(tile.x, .28, tile.z); (pad as THREE.Mesh).material = this.material(key, tile.color)
        const active = tile.color === objects.targetColor; pad.scale.y = active ? 1.2 : .75
      })
    }
    for (const [key, obj] of this.props) if (!keep.has(key)) { this.scene.remove(obj); this.props.delete(key) }
    if (objects.delivery) this.marker('delivery', objects.delivery.x, objects.delivery.z, '#ffcf4b', keep)
    if (objects.station) this.marker('station', objects.station.x, objects.station.z, '#ef6b65', keep)
    if (objects.tower) this.marker('tower', objects.tower.x, objects.tower.z, '#a877ff', keep)
  }
  private marker(key: string, x: number, z: number, color: string, keep: Set<string>): void {
    keep.add(key)
    let o = this.props.get(key)
    if (!o) { o = new THREE.Mesh(new THREE.TorusGeometry(1.6, .08, 8, 32), new THREE.MeshBasicMaterial({ color })); o.rotation.x = -Math.PI / 2; this.scene.add(o); this.props.set(key, o) }
    o.position.set(x, .2, z); o.rotation.z += .01
  }

  step(dt: number): void {
    const current = this.state
    const me = current?.players.find(p => p.id === this.me)
    if (me && current?.phase === 'play') {
      const target = new THREE.Vector3(me.x, me.jumpY, me.z)
      // Prediction is small and corrected toward the authoritative server state.
      this.localPosition.x += this.localInput.x * 5.2 * dt
      this.localPosition.z += this.localInput.z * 5.2 * dt
      this.localPosition.x = THREE.MathUtils.lerp(this.localPosition.x, target.x, Math.min(1, dt * 5))
      this.localPosition.z = THREE.MathUtils.lerp(this.localPosition.z, target.z, Math.min(1, dt * 5))
      this.localPosition.y = target.y
    }
    for (const view of this.players.values()) { view.mixer?.update(dt); if (view.root.position.distanceTo(view.target) > 2.5) view.root.position.copy(view.target); else view.root.position.lerp(view.target, Math.min(1, dt * 16)) }
    for (const effect of this.effects) { effect.userData.life += dt; effect.scale.multiplyScalar(1 + dt * 1.8); const material = (effect as THREE.Mesh).material as THREE.MeshBasicMaterial; material.opacity = Math.max(0, 1 - effect.userData.life * 1.8) }
    this.effects = this.effects.filter(effect => { if (effect.userData.life > .56) { this.scene.remove(effect); return false } return true })
  }

  render(dt: number): void {
    this.step(dt)
    const me = this.players.get(this.me)
    if (this.state?.phase === 'play' && me) {
      this.cameraTarget.lerp(new THREE.Vector3(me.root.position.x, 0, me.root.position.z), .08)
      const desired = new THREE.Vector3(this.cameraTarget.x, 9.4, this.cameraTarget.z + 13.5)
      this.camera.position.lerp(desired, .055)
      this.camera.lookAt(this.cameraTarget.x, .8, this.cameraTarget.z)
    } else {
      const t = this.clock.getElapsedTime()
      const desired = new THREE.Vector3(Math.sin(t * .12) * 13, 9, Math.cos(t * .12) * 13)
      this.camera.position.lerp(desired, .015); this.camera.lookAt(0, .7, 0)
    }
    this.renderer.render(this.scene, this.camera)
  }
  resize(): void { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight) }
}
