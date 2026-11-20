import * as THREE from 'three'

/**
 * MALANG MAYHEM 소품 팩토리.
 *
 * 캐릭터 GLB와 아레나 GLB는 그대로 두고, 아이템/함정/미니게임 소품만 절차적 메시로 만든다.
 * 목적은 "한눈에 구별"이다. 그래서 실루엣(초승달·삼각 웨지·뾰족 왕관·T자 망치·구형 폭탄)을
 * 종류마다 다르게 잡고, 색은 재질 캐시로 공유해 드로우콜을 아낀다.
 * 좌표 규칙은 캐릭터와 같다: 정면 +Z, 위 +Y, 바닥 y=0.
 */

export type PropKind =
  | 'banana' | 'pizza_dough' | 'pizza_sauce' | 'pizza_cheese' | 'pizza_pepperoni'
  | 'crown' | 'balloon' | 'banana_peel' | 'jelly_pool' | 'mallet' | 'reverse_arrow'
  | 'bomb' | 'sweeper_bar' | 'tail' | 'golden_pizza' | 'golden_trophy' | 'fallback'

type MatKey = string

const materials = new Map<MatKey, THREE.MeshStandardMaterial>()

function mat(color: string, roughness = 0.72, metalness = 0.04, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}|${extra.transparent ? 't' + (extra.opacity ?? 1) : ''}|${extra.emissive ?? ''}`
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }))
  return materials.get(key) as THREE.MeshStandardMaterial
}

function mesh<T extends THREE.BufferGeometry>(geometry: T, material: THREE.Material, position?: [number, number, number], rotation?: [number, number, number]): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material)
  if (position) item.position.set(...position)
  if (rotation) item.rotation.set(...rotation)
  item.castShadow = true
  return item
}

const group = (...children: THREE.Object3D[]): THREE.Group => {
  const root = new THREE.Group()
  for (const child of children) root.add(child)
  return root
}

/** 굽은 초승달 바나나 — 땅에 놓인 아치형 몸통 + 양끝 갈색 꼭지 + 초록 줄기. */
function banana(): THREE.Object3D {
  const radius = 0.82
  const tube = 0.21
  const arc = 2.25
  // 토러스 호를 XY 평면에 만들고, 그룹째 눕혀서(X축 -90도) 바닥에 놓인 초승달로 만든다.
  const body = mesh(new THREE.TorusGeometry(radius, tube, 14, 30, arc), mat('#ffd83f', 0.55))
  const ridge = mesh(new THREE.TorusGeometry(radius, 0.055, 8, 28, arc), mat('#ffe98a', 0.45), [0, 0, tube * 0.6])
  const tip = mat('#8a5a2b', 0.85)
  const tipA = mesh(new THREE.SphereGeometry(0.115, 10, 8), tip, [Math.cos(0.03) * radius, Math.sin(0.03) * radius, 0])
  const tipB = mesh(new THREE.SphereGeometry(0.105, 10, 8), tip, [Math.cos(arc - 0.03) * radius, Math.sin(arc - 0.03) * radius, 0])
  const stub = mesh(new THREE.CylinderGeometry(0.065, 0.09, 0.26, 8), mat('#5aa33f', 0.8), [Math.cos(0.22) * (radius + 0.12), Math.sin(0.22) * (radius + 0.12), 0], [0, 0, -0.7])
  const crescent = group(body, ridge, tipA, tipB, stub)
  crescent.rotation.x = -Math.PI / 2
  crescent.rotation.z = 0.35
  crescent.position.y = tube + 0.02
  const root = group(crescent)
  root.scale.setScalar(1.15)
  return root
}

/** 피자 도우 — 크림색 원판 + 가장자리 크러스트 링. */
function pizzaDough(): THREE.Object3D {
  const disc = mesh(new THREE.CylinderGeometry(0.46, 0.44, 0.12, 22), mat('#f6e6bd', 0.92))
  const crust = mesh(new THREE.TorusGeometry(0.44, 0.09, 8, 26), mat('#e8c98c', 0.9), [0, 0.02, 0], [Math.PI / 2, 0, 0])
  const root = group(disc, crust)
  root.scale.setScalar(1.5)
  return root
}

/** 피자 소스 — 빨간 병(몸통+목+뚜껑)과 흰 라벨 밴드. */
function pizzaSauce(): THREE.Object3D {
  const body = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 16), mat('#c92b2b', 0.55), [0, 0.3, 0])
  const neck = mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.16, 12), mat('#a51f1f', 0.6), [0, 0.62, 0])
  const cap = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), mat('#ffe9a8', 0.5), [0, 0.74, 0])
  const label = mesh(new THREE.CylinderGeometry(0.207, 0.212, 0.16, 16, 1, true), mat('#fff6e0', 0.9), [0, 0.32, 0])
  const root = group(body, neck, cap, label)
  root.scale.setScalar(1.45)
  return root
}

/** 피자 치즈 — 노란 삼각 웨지 + 구멍 몇 개. */
function pizzaCheese(): THREE.Object3D {
  const wedge = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 3), mat('#ffd95e', 0.65), [0, 0.14, 0], [0, 0, 0])
  wedge.rotation.y = Math.PI / 6
  const hole = mat('#f0bf35', 0.8)
  const holes = [mesh(new THREE.SphereGeometry(0.06, 8, 6), hole, [0.16, 0.25, 0.02]), mesh(new THREE.SphereGeometry(0.045, 8, 6), hole, [-0.1, 0.25, 0.14]), mesh(new THREE.SphereGeometry(0.05, 8, 6), hole, [0.02, 0.25, -0.16])]
  const root = group(wedge, ...holes)
  root.scale.setScalar(1.45)
  return root
}

/** 페퍼로니 — 진빨강 얇은 조각을 살짝 어긋나게 포갠 스택. */
function pizzaPepperoni(): THREE.Object3D {
  const slice = mat('#8e1b1b', 0.55)
  const fleck = mat('#c93b3b', 0.6)
  const parts: THREE.Object3D[] = []
  const offsets: [number, number, number][] = [[0, 0.06, 0], [0.12, 0.18, 0.06], [-0.1, 0.3, -0.05], [0.02, 0.42, 0.08]]
  offsets.forEach((offset, index) => {
    parts.push(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), index % 2 ? fleck : slice, offset))
  })
  const root = group(...parts)
  root.scale.setScalar(1.5)
  return root
}

/** 금색 왕관 — 띠 + 5개 뾰족 스파이크 + 보석 3개. */
function crown(): THREE.Object3D {
  const gold = mat('#ffcf4b', 0.32, 0.55, { emissive: new THREE.Color('#7a5100'), emissiveIntensity: 0.18 })
  const band = mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.26, 18, 1, true), gold, [0, 0.16, 0])
  ;(band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
  const parts: THREE.Object3D[] = [band]
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2
    const spike = mesh(new THREE.ConeGeometry(0.13, 0.42, 8), gold, [Math.cos(angle) * 0.42, 0.5, Math.sin(angle) * 0.42])
    const bead = mesh(new THREE.SphereGeometry(0.06, 8, 6), gold, [Math.cos(angle) * 0.42, 0.74, Math.sin(angle) * 0.42])
    parts.push(spike, bead)
  }
  const gemColors = ['#ff5d8f', '#57c7ff', '#62e8aa']
  gemColors.forEach((color, index) => {
    const angle = (index / 3) * Math.PI * 2 + 0.4
    parts.push(mesh(new THREE.OctahedronGeometry(0.1), mat(color, 0.25, 0.3, { emissive: new THREE.Color(color), emissiveIntensity: 0.35 }), [Math.cos(angle) * 0.5, 0.2, Math.sin(angle) * 0.5]))
  })
  return group(...parts)
}

/** 풍선 — 물방울형 몸통 + 매듭 + 흰 끈. */
function balloon(): THREE.Object3D {
  const body = mesh(new THREE.SphereGeometry(0.44, 18, 14), mat('#ff8fb8', 0.35), [0, 0.66, 0])
  body.scale.set(0.95, 1.12, 0.95)
  const taper = mesh(new THREE.ConeGeometry(0.24, 0.3, 14), mat('#ff8fb8', 0.35), [0, 0.34, 0], [Math.PI, 0, 0])
  const knot = mesh(new THREE.ConeGeometry(0.09, 0.14, 8), mat('#e0648f', 0.4), [0, 0.18, 0], [Math.PI, 0, 0])
  const shine = mesh(new THREE.SphereGeometry(0.1, 8, 6), mat('#ffffff', 0.2, 0.1, { transparent: true, opacity: 0.6 }), [-0.15, 0.82, 0.22])
  const string = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 6), mat('#fffdf2', 0.9), [0.04, -0.12, 0], [0, 0, 0.16])
  const root = group(body, taper, knot, shine, string)
  root.scale.setScalar(1.25)
  return root
}

/** 바나나 껍질 — 3갈래로 벌어진 껍질 + 바닥 경고 링. */
function bananaPeel(): THREE.Object3D {
  const peel = mat('#ffd83f', 0.55)
  const tip = mat('#8a5a2b', 0.85)
  const parts: THREE.Object3D[] = []
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2
    const flap = mesh(new THREE.SphereGeometry(0.3, 12, 8), peel)
    flap.scale.set(0.42, 0.16, 1.05)
    flap.position.set(Math.cos(angle) * 0.28, 0.1 + Math.sin(angle) * 0.02, Math.sin(angle) * 0.28)
    flap.rotation.y = -angle
    flap.rotation.x = 0.28
    const head = mesh(new THREE.SphereGeometry(0.07, 8, 6), tip, [Math.cos(angle) * 0.62, 0.16, Math.sin(angle) * 0.62])
    parts.push(flap, head)
  }
  parts.push(mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.16, 8), mat('#e8b92f', 0.7), [0, 0.1, 0]))
  // 바닥 경고 링: 노란 점선 8개로 "밟으면 미끄러진다"를 즉시 읽히게 한다.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    const dash = mesh(new THREE.BoxGeometry(0.18, 0.02, 0.06), mat('#ffd35c', 0.6, 0, { emissive: new THREE.Color('#6b5200'), emissiveIntensity: 0.3 }), [Math.cos(angle) * 0.85, 0.02, Math.sin(angle) * 0.85], [0, -angle, 0])
    parts.push(dash)
  }
  const root = group(...parts)
  root.scale.setScalar(1.25)
  return root
}

/** 끈적 젤리 웅덩이 — 볼록한 반투명 덩어리 + 주변 방울. */
function jellyPool(): THREE.Object3D {
  const jelly = mat('#b76cff', 0.18, 0.05, { transparent: true, opacity: 0.82, emissive: new THREE.Color('#4a1a7a'), emissiveIntensity: 0.25 })
  const blob = mesh(new THREE.SphereGeometry(0.62, 18, 12), jelly, [0, 0.06, 0])
  blob.scale.set(1.05, 0.34, 1.05)
  const dome = mesh(new THREE.SphereGeometry(0.34, 14, 10), mat('#8be6d2', 0.15, 0.05, { transparent: true, opacity: 0.7 }), [0.16, 0.2, -0.1])
  dome.scale.set(1, 0.7, 1)
  const parts: THREE.Object3D[] = [blob, dome]
  const drops: [number, number][] = [[0.42, 0.3], [-0.36, 0.38], [0.1, -0.46], [-0.24, -0.32]]
  for (const [x, z] of drops) parts.push(mesh(new THREE.SphereGeometry(0.11, 10, 8), jelly, [x, 0.09, z]))
  parts.push(mesh(new THREE.TorusGeometry(0.72, 0.035, 6, 30), mat('#d6a4ff', 0.4, 0, { transparent: true, opacity: 0.7 }), [0, 0.02, 0], [Math.PI / 2, 0, 0]))
  return group(...parts)
}

/** 뿅망치 — T자형 손잡이 + 빨간 머리 + 노란 끝 캡. */
function mallet(): THREE.Object3D {
  const handle = mesh(new THREE.CylinderGeometry(0.075, 0.085, 1.15, 10), mat('#e6c78b', 0.85), [0, 0.62, 0])
  const head = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.86, 16), mat('#ff5d6c', 0.45), [0, 1.22, 0], [0, 0, Math.PI / 2])
  const capA = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 16), mat('#ffd35c', 0.5), [0.46, 1.22, 0], [0, 0, Math.PI / 2])
  const capB = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 16), mat('#ffd35c', 0.5), [-0.46, 1.22, 0], [0, 0, Math.PI / 2])
  const grip = mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 14), mat('#8a5a2b', 0.8), [0, 0.16, 0], [Math.PI / 2, 0, 0])
  const root = group(handle, head, capA, capB, grip)
  root.scale.setScalar(0.95)
  return root
}

/** 방향 반전 — 서로 반대로 도는 입체 화살표 두 개 + 회전 링. */
function reverseArrow(): THREE.Object3D {
  const shaftColor = mat('#57c7ff', 0.28, 0.25, { emissive: new THREE.Color('#0d4c73'), emissiveIntensity: 0.35 })
  const headColor = mat('#a877ff', 0.28, 0.25, { emissive: new THREE.Color('#3a1f6b'), emissiveIntensity: 0.35 })
  const arrow = (direction: number) => {
    const shaft = mesh(new THREE.BoxGeometry(0.92, 0.16, 0.16), shaftColor, [direction * 0.5, 0, 0])
    const head = mesh(new THREE.ConeGeometry(0.3, 0.46, 4), headColor, [direction * 1.12, 0, 0], [0, 0, direction * -Math.PI / 2])
    const root = group(shaft, head)
    root.rotation.y = direction > 0 ? 0.42 : Math.PI + 0.42
    return root
  }
  const first = arrow(1)
  first.position.y = 0.34
  const second = arrow(-1)
  second.position.y = 0.34
  const ring = mesh(new THREE.TorusGeometry(0.66, 0.07, 8, 28), mat('#c9f0ff', 0.4, 0.1, { emissive: new THREE.Color('#2b6b8a'), emissiveIntensity: 0.25 }), [0, 0.34, 0], [Math.PI / 2, 0, 0])
  const root = group(first, second, ring)
  root.scale.setScalar(1.15)
  return root
}

/** 시한폭탄 — 검은 구체 + 빨간 띠 + 심지와 불꽃. */
function bomb(): THREE.Object3D {
  const body = mesh(new THREE.SphereGeometry(0.46, 20, 16), mat('#23212e', 0.42, 0.25), [0, 0.5, 0])
  const band = mesh(new THREE.TorusGeometry(0.46, 0.06, 8, 24), mat('#ff5d5d', 0.4, 0.1, { emissive: new THREE.Color('#651111'), emissiveIntensity: 0.5 }), [0, 0.5, 0], [Math.PI / 2, 0, 0])
  const neck = mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.16, 10), mat('#3d3a4a', 0.6), [0, 0.98, 0])
  const fuse = mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14, Math.PI * 0.9), mat('#c9a86a', 0.9), [0.1, 1.1, 0], [Math.PI / 2, 0, 0.3])
  const spark = mesh(new THREE.IcosahedronGeometry(0.13, 0), mat('#fff0a8', 0.2, 0, { emissive: new THREE.Color('#ff9d2e'), emissiveIntensity: 1.4, transparent: true, opacity: 0.95 }), [0.24, 1.22, 0])
  const root = group(body, band, neck, fuse, spark)
  root.userData.spark = spark
  root.scale.setScalar(1.05)
  return root
}

/** 회전 스위퍼 막대 — 고대비 줄무늬 긴 막대 + 중앙 축. */
function sweeperBar(length = 9): THREE.Object3D {
  const parts: THREE.Object3D[] = []
  const segments = 12
  const segmentLength = length / segments
  for (let i = 0; i < segments; i++) {
    const color = i % 2 ? '#fff2c8' : '#ff5d6c'
    const segment = mesh(new THREE.BoxGeometry(segmentLength, 0.34, 0.42), mat(color, 0.45, 0.08), [-length / 2 + segmentLength * (i + 0.5), 0.42, 0])
    parts.push(segment)
  }
  parts.push(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.9, 14), mat('#3d3a4a', 0.5, 0.2), [0, 0.45, 0]))
  parts.push(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), mat('#ffd35c', 0.4, 0.2), [0, 0.92, 0]))
  const root = group(...parts)
  root.userData.length = length
  return root
}

/** 꼬리 — 허리 뒤로 흐르는 3마디 곡선 + 밝은 끝. */
function tail(color = '#ff5d8f'): THREE.Object3D {
  const parts: THREE.Object3D[] = []
  const tint = new THREE.Color(color)
  const bright = tint.clone().offsetHSL(0.02, 0.06, 0.1).getStyle()
  const glow = mat(color, 0.45, 0.05, { emissive: new THREE.Color(color), emissiveIntensity: 0.35 })
  // 허리에서 시작해 위로 솟는 곡선 꼬리 — 뒤에서 보는 카메라에서도 실루엣이 크게 보인다.
  for (let i = 0; i < 6; i++) {
    const t = i / 5
    const radius = 0.32 - i * 0.038
    const x = Math.sin(t * Math.PI * 1.15) * 0.3
    const y = 1.0 + Math.sin(t * Math.PI * 0.85) * 0.95
    const z = -(0.4 + t * 1.15)
    const segment = mesh(new THREE.SphereGeometry(radius, 12, 10), i === 5 ? mat('#fff2c8', 0.35, 0, { emissive: new THREE.Color('#ffe9a8'), emissiveIntensity: 0.55 }) : glow, [x, y, z])
    segment.scale.set(1, 1.05, 1.35)
    parts.push(segment)
  }
  const band = mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16), mat(bright, 0.5), [0, 1.0, -0.34], [Math.PI / 2, 0, 0])
  parts.push(band)
  return group(...parts)
}

/** 초대형 황금 피자 — 큰 크러스트 링 + 토핑. */
function goldenPizza(): THREE.Object3D {
  const gold = mat('#ffcf4b', 0.32, 0.5, { emissive: new THREE.Color('#6a4700'), emissiveIntensity: 0.2 })
  const base = mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.16, 30), mat('#ffd777', 0.5, 0.25), [0, 0, 0])
  const crust = mesh(new THREE.TorusGeometry(1.32, 0.16, 8, 32), gold, [0, 0.04, 0], [Math.PI / 2, 0, 0])
  const parts: THREE.Object3D[] = [base, crust]
  const toppings: [number, number, string][] = [[0.55, 0.3, '#b32b2b'], [-0.5, 0.45, '#b32b2b'], [0.1, -0.55, '#b32b2b'], [-0.6, -0.3, '#b32b2b'], [0.7, -0.4, '#b32b2b'], [0, 0.05, '#ffef9f']]
  for (const [x, z, color] of toppings) parts.push(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 14), mat(color, 0.6), [x, 0.12, z]))
  return group(...parts)
}

/** 황금 트로피 — 손잡이·받침대가 있는 컵 + 별. */
function goldenTrophy(): THREE.Object3D {
  const gold = mat('#ffcf4b', 0.3, 0.55, { emissive: new THREE.Color('#6a4700'), emissiveIntensity: 0.22 })
  const base = mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.24, 18), gold, [0, 0.12, 0])
  const plinth = mesh(new THREE.BoxGeometry(0.9, 0.16, 0.9), mat('#8a5a2b', 0.7, 0.15), [0, 0.02, 0])
  const stem = mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.5, 12), gold, [0, 0.5, 0])
  const cup = mesh(new THREE.CylinderGeometry(0.66, 0.32, 0.72, 18), gold, [0, 1.06, 0])
  const rim = mesh(new THREE.TorusGeometry(0.66, 0.06, 8, 24), gold, [0, 1.42, 0], [Math.PI / 2, 0, 0])
  const parts: THREE.Object3D[] = [plinth, base, stem, cup, rim]
  for (const side of [-1, 1]) {
    const handle = mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 18, Math.PI * 1.2), gold, [side * 0.66, 1.06, 0], [0, 0, side * 0.4])
    parts.push(handle)
  }
  parts.push(mesh(new THREE.OctahedronGeometry(0.16), mat('#fff2b0', 0.2, 0.4, { emissive: new THREE.Color('#8a6b00'), emissiveIntensity: 0.5 }), [0, 1.6, 0]))
  return group(...parts)
}

const BUILDERS: Record<PropKind, () => THREE.Object3D> = {
  banana,
  pizza_dough: pizzaDough,
  pizza_sauce: pizzaSauce,
  pizza_cheese: pizzaCheese,
  pizza_pepperoni: pizzaPepperoni,
  crown,
  balloon,
  banana_peel: bananaPeel,
  jelly_pool: jellyPool,
  mallet,
  reverse_arrow: reverseArrow,
  bomb,
  sweeper_bar: sweeperBar,
  tail: () => tail('#ff5d8f'),
  golden_pizza: goldenPizza,
  golden_trophy: goldenTrophy,
  fallback: () => group(mesh(new THREE.SphereGeometry(0.34, 12, 10), mat('#ffd35c', 0.7))),
}

export function createProp(kind: string): THREE.Object3D {
  const build = BUILDERS[kind as PropKind] || BUILDERS.fallback
  return build()
}

/** 꼬리 색은 플레이어 색을 쓰되, 어두운 색은 밝게 보정한다. */
export function createTail(color: string): THREE.Object3D {
  const tint = new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  tint.getHSL(hsl)
  tint.setHSL(hsl.h, Math.max(0.55, hsl.s), Math.max(0.58, hsl.l))
  return tail(`#${tint.getHexString()}`)
}

/** 피자 재료 kind → 소품 키. */
export function ingredientProp(kind: string): PropKind {
  if (kind === 'dough') return 'pizza_dough'
  if (kind === 'sauce') return 'pizza_sauce'
  if (kind === 'cheese') return 'pizza_cheese'
  return 'pizza_pepperoni'
}

export function prankItemProp(type: string): PropKind {
  if (type === 'banana_peel') return 'banana_peel'
  if (type === 'jelly_pool') return 'jelly_pool'
  if (type === 'shockwave') return 'mallet'
  return 'reverse_arrow'
}
