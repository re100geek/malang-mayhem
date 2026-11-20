import * as THREE from 'three'

type Location = { x: number; z: number }
type Goal = Location & { id: string; seat: number; color: string; radius: number }
type Critter = Location & { id: number; generation: number }
type Pad = Location & { id: string; down: boolean }
export type Gate = Location & { id: number; color: string; pads: Pad[]; progress: number; opened: boolean }
type Hazard = Location & { id: number; radius: number }
export type NewRoundObjects =
  | { type: 'herd'; goals: Goal[]; critters: Critter[] }
  | { type: 'switch'; gates: Gate[]; total: number; delivered: number; padRadius: number }
  | { type: 'vault'; hazards: Hazard[]; delivered: number; total: number }

type RoundMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
type Visual = { root: THREE.Group; target: THREE.Vector3; animate?: (time: number, dx: number, dz: number) => void }

function mesh(geometry: THREE.BufferGeometry, color: string, y = 0) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }))
  object.position.y = y
  return object
}

function flatRing(radius: number, color: string) {
  const ring = mesh(new THREE.TorusGeometry(radius, 0.075, 6, 28), color, 0.08)
  ring.rotation.x = -Math.PI / 2
  return ring
}

function critterVisual(root: THREE.Group, variant: number) {
  const body = mesh(new THREE.SphereGeometry(0.32, 12, 8), ['#e5ffad', '#ffd2a0', '#fff0aa'][variant % 3], 0.33)
  body.scale.set(1, 0.91, 0.84)
  root.add(body)
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.055, 8, 6), '#26213f', 0.39)
    eye.position.set(side * 0.12, 0.39, 0.245)
    root.add(eye)
  }
}

export class RoundObjects {
  private readonly visuals = new Map<string, Visual>()

  constructor(private readonly scene: THREE.Object3D) {}

  private place(key: string, at: Location, keep: Set<string>, build: (root: THREE.Group) => void) {
    keep.add(key)
    let visual = this.visuals.get(key)
    if (!visual) {
      const root = new THREE.Group()
      root.position.set(at.x, 0, at.z)
      build(root)
      this.scene.add(root)
      visual = { root, target: root.position.clone() }
      this.visuals.set(key, visual)
    }
    visual.target.set(at.x, 0, at.z)
    return visual
  }

  sync(round: NewRoundObjects | undefined, me: string) {
    const keep = new Set<string>()
    if (round?.type === 'herd') {
      for (const goal of round.goals) {
        const mine = goal.id === me
        this.place(`goal:${goal.seat}:${mine}`, goal, keep, root => {
          root.add(flatRing(goal.radius, goal.color))
          if (mine) root.add(flatRing(goal.radius + 0.18, '#fff9e8'))
          const beacon = mesh(new THREE.OctahedronGeometry(mine ? 0.4 : 0.21), goal.color, 0.75)
          beacon.position.z = -goal.radius
          root.add(beacon)
        })
      }
      for (const critter of round.critters) {
        const visual = this.place(`critter:${critter.id}:${critter.generation}`, critter, keep, root => critterVisual(root, critter.id))
        visual.animate = (time, dx, dz) => {
          visual.root.position.y = Math.abs(Math.sin(time * 7 + critter.id)) * 0.12
          if (Math.hypot(dx, dz) > 0.02) visual.root.rotation.y = Math.atan2(dx, dz)
        }
      }
    }
    if (round?.type === 'switch') {
      for (const gate of round.gates) this.switchGate(gate, round.padRadius, me, keep)
    }
    if (round?.type === 'vault') {
      for (const hazard of round.hazards) {
        const visual = this.place(`hazard:${hazard.id}`, hazard, keep, root => {
          root.add(flatRing(hazard.radius, '#ff694d'))
          root.add(mesh(new THREE.CylinderGeometry(0.65, 0.73, 1.1, 10), '#a72d33', 0.55))
          for (let i = 0; i < 4; i++) root.add(mesh(new THREE.CylinderGeometry(0.66, 0.68, 0.11, 10), '#ffd35c', 0.18 + i * 0.25))
        })
        visual.animate = time => { visual.root.rotation.y = time * 1.3 }
      }
    }
    for (const key of this.visuals.keys()) if (!keep.has(key)) this.remove(key)
  }

  private switchGate(gate: Gate, radius: number, me: string, keep: Set<string>) {
    const visual = this.place(`gate:${gate.id}`, gate, keep, root => {
      for (const x of [-1.12, 1.12]) {
        const post = mesh(new THREE.BoxGeometry(0.2, 2.5, 0.26), gate.color, 1.25)
        post.position.x = x
        root.add(post)
      }
      root.add(mesh(new THREE.BoxGeometry(2, 1.15, 0.19), '#413657', 0.65))
      root.add(mesh(new THREE.BoxGeometry(2, 0.12, 0.24), '#62e8aa', 1.35))
    })
    const door = visual.root.children[2]
    door.position.y = gate.opened ? 1.96 : 0.65
    const meter = visual.root.children[3]
    meter.visible = gate.progress > 0
    meter.scale.x = Math.max(0.01, gate.progress)
    for (const [index, pad] of gate.pads.entries()) {
      const mine = pad.id === me
      const plate = this.place(`pad:${gate.id}:${index}:${mine}`, pad, keep, root => {
        root.add(flatRing(radius, mine ? '#fff9e8' : gate.color))
        const shape = index === 0 ? new THREE.CylinderGeometry(0.64, 0.64, 0.14, 24) : new THREE.BoxGeometry(0.91, 0.14, 0.91)
        root.add(mesh(shape, gate.color, 0.15))
      }).root.children[1] as RoundMesh
      plate.position.y = pad.down ? 0.075 : 0.15
      plate.material.color.set(pad.down ? '#fff2b5' : gate.color)
    }
  }

  update(dt: number, time: number) {
    const blend = 1 - Math.exp(-18 * dt)
    for (const { root, target, animate } of this.visuals.values()) {
      const dx = target.x - root.position.x
      const dz = target.z - root.position.z
      root.position.lerp(target, blend)
      animate?.(time, dx, dz)
    }
  }

  clear() {
    for (const key of this.visuals.keys()) this.remove(key)
  }

  private remove(key: string) {
    const visual = this.visuals.get(key)
    if (!visual) return
    for (const child of visual.root.children as RoundMesh[]) {
      child.geometry.dispose()
      child.material.dispose()
    }
    visual.root.removeFromParent()
    this.visuals.delete(key)
  }
}
