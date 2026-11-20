import * as THREE from 'three'

type Burst = { points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>; age: number }

export class ImpactEffects {
  private bursts: Burst[] = []
  private shake = 0
  private shakeAge = 0
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  constructor(private scene: THREE.Scene) {}

  add(x: number, z: number, explosion: boolean, shakeCamera: boolean) {
    if (this.bursts.length >= 8) this.remove(0)
    const count = explosion ? 10 : 6
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: explosion ? '#ffb350' : '#fff0a4',
      size: explosion ? .22 : .14,
      transparent: true,
      depthWrite: false,
    }))
    points.position.set(x, explosion ? .45 : 1.2, z)
    points.frustumCulled = false
    this.scene.add(points)
    this.bursts.push({ points, age: 0 })
    if (shakeCamera && !this.reducedMotion.matches) {
      this.shake = explosion ? .12 : .06
      this.shakeAge = 0
    }
  }

  update(dt: number) {
    this.shakeAge += dt
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]
      burst.age += dt
      const progress = burst.age / .36
      if (progress >= 1) { this.remove(i); continue }
      const positions = burst.points.geometry.getAttribute('position')
      for (let j = 0; j < positions.count; j++) {
        const angle = j * Math.PI * 2 / positions.count
        const distance = progress * (positions.count === 10 ? 2 : 1.2)
        positions.setXYZ(j, Math.cos(angle) * distance, Math.sin(progress * Math.PI) * (.3 + j % 3 * .15), Math.sin(angle) * distance)
      }
      positions.needsUpdate = true
      burst.points.material.opacity = 1 - progress
    }
  }

  cameraOffset() {
    if (this.reducedMotion.matches || this.shakeAge >= .23) return 0
    return Math.sin(this.shakeAge * 68) * (1 - this.shakeAge / .23) * this.shake
  }

  clear() {
    while (this.bursts.length) this.remove(this.bursts.length - 1)
    this.shake = 0
  }

  private remove(index: number) {
    const [{ points }] = this.bursts.splice(index, 1)
    points.removeFromParent()
    points.geometry.dispose()
    points.material.dispose()
  }
}
