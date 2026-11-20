import type { PerspectiveCamera, Vector3 } from 'three'
import type { PartyState } from './party-game'
import { introShot } from './round-intro'

export type CameraIntro = { kind: 'opening' | 'ready' | 'round'; progress: number; reducedMotion: boolean }

export function placeIntroCamera(camera: PerspectiveCamera, look: Vector3, state: PartyState, viewer: string, intro: CameraIntro) {
  const portrait = camera.aspect < .9
  if (intro.kind !== 'round') {
    const still = intro.reducedMotion || intro.kind === 'ready'
    const angle = still ? 0 : -1 + intro.progress * 1.2
    const radius = (portrait ? 23 : 18) - (still ? 0 : intro.progress * 4)
    camera.position.set(Math.sin(angle) * radius, portrait ? 14 : 11, Math.cos(angle) * radius)
    look.set(0, .6, 0)
  } else {
    const { target, approach = target } = introShot(state, viewer)
    const t = intro.reducedMotion ? 1 : intro.progress ** 2 * (3 - 2 * intro.progress)
    const x = approach.x + (target.x - approach.x) * t
    const z = approach.z + (target.z - approach.z) * t
    camera.position.set(x + (1 - t) * 2.6, 5.3 + (1 - t) * 2.4, z + (portrait ? 9 : 8) + (1 - t) * 2.2)
    look.set(x, .85, z)
  }
  camera.lookAt(look)
}
