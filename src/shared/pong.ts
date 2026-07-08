export const ROUNDS_TO_WIN = 2
export const MAX_ROUNDS = 3

export const FIELD_W = 1000
export const FIELD_H = 1500
export const PADDLE_W = 150
export const PADDLE_H = 18
export const BALL_R = 22
export const POWER_R = 54
export const POWER_PICKUP_PAD = 22
export const PLAYER_Y = 1380
export const OPP_Y = 102
export const WALL_PAD = 8

export type PowerKind = 'grow' | 'shrink' | 'fast' | 'slow' | 'split' | 'blaze' | 'curve'
export type PowerCategory = 'paddle' | 'ball' | 'chaos'

export interface PowerDef {
  kind: PowerKind
  color: string
  glow: string
  label: string
  desc: string
  icon: string
  dur: number
  category: PowerCategory
}

export const POWER_CATALOG: PowerDef[] = [
  {
    kind: 'grow',
    color: '#4ade80',
    glow: 'rgba(74,222,128,0.55)',
    label: 'Шире',
    desc: 'Ракетка расширяется',
    icon: '↔',
    dur: 6,
    category: 'paddle',
  },
  {
    kind: 'shrink',
    color: '#f472b6',
    glow: 'rgba(244,114,182,0.55)',
    label: 'Сужение',
    desc: 'Сужает ракетку соперника',
    icon: '⊖',
    dur: 6,
    category: 'paddle',
  },
  {
    kind: 'fast',
    color: '#facc15',
    glow: 'rgba(250,204,21,0.55)',
    label: 'Разгон',
    desc: 'Мяч летит быстрее',
    icon: '⚡',
    dur: 5,
    category: 'ball',
  },
  {
    kind: 'slow',
    color: '#60a5fa',
    glow: 'rgba(96,165,250,0.55)',
    label: 'Замедление',
    desc: 'Мяч замедляется',
    icon: '❄',
    dur: 5,
    category: 'ball',
  },
  {
    kind: 'blaze',
    color: '#fb923c',
    glow: 'rgba(251,146,60,0.6)',
    label: 'Пламя',
    desc: 'Огненный разгон мяча',
    icon: '🔥',
    dur: 4,
    category: 'ball',
  },
  {
    kind: 'curve',
    color: '#a78bfa',
    glow: 'rgba(167,139,250,0.55)',
    label: 'Закрутка',
    desc: 'Мяч уходит по дуге',
    icon: '↻',
    dur: 5,
    category: 'ball',
  },
  {
    kind: 'split',
    color: '#c084fc',
    glow: 'rgba(192,132,252,0.55)',
    label: 'Рикошет+',
    desc: 'Случайные отскоки от стен',
    icon: '✦',
    dur: 4,
    category: 'chaos',
  },
]

const POWER_META = Object.fromEntries(POWER_CATALOG.map((p) => [p.kind, p])) as Record<PowerKind, PowerDef>

export const ALL_POWER_KINDS: PowerKind[] = POWER_CATALOG.map((p) => p.kind)

export interface PowerUp {
  id: number
  kind: PowerKind
  x: number
  y: number
  r: number
  ttl: number
  phase: number
}

export interface ActiveBuff {
  kind: PowerKind
  until: number
}

export interface Paddle {
  x: number
  w: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export interface PongWorld {
  ball: Ball
  player: Paddle
  opponent: Paddle
  powerUps: PowerUp[]
  playerBuffs: ActiveBuff[]
  opponentBuffs: ActiveBuff[]
  elapsed: number
  lastTouch: 'player' | 'opponent' | null
  spawnTimer: number
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

export function createWorld(seed = Date.now()): PongWorld {
  const rand = seededRand(seed)
  const angle = (rand() > 0.5 ? 1 : -1) * (0.35 + rand() * 0.4)
  const dir = rand() > 0.5 ? 1 : -1
  const speed = 320
  return {
    ball: {
      x: FIELD_W / 2,
      y: FIELD_H / 2,
      vx: Math.sin(angle) * speed * 0.6,
      vy: Math.cos(angle) * speed * dir,
    },
    player: { x: FIELD_W / 2, w: PADDLE_W },
    opponent: { x: FIELD_W / 2, w: PADDLE_W },
    powerUps: [],
    playerBuffs: [],
    opponentBuffs: [],
    elapsed: 0,
    lastTouch: null,
    spawnTimer: 2.5 + rand() * 2,
  }
}

function paddleWidth(base: number, buffs: ActiveBuff[], now: number, kind: PowerKind): number {
  let w = base
  for (const b of buffs) {
    if (b.until < now) continue
    if (b.kind === 'grow' && kind === 'grow') w *= 1.45
    if (b.kind === 'shrink' && kind === 'shrink') w *= 0.72
  }
  return Math.min(FIELD_W * 0.42, Math.max(PADDLE_W * 0.65, w))
}

function speedMul(buffs: ActiveBuff[], now: number): number {
  let m = 1
  for (const b of buffs) {
    if (b.until < now) continue
    if (b.kind === 'fast') m *= 1.35
    if (b.kind === 'slow') m *= 0.75
    if (b.kind === 'blaze') m *= 1.28
  }
  return m
}

function hasBuff(buffs: ActiveBuff[], now: number, kind: PowerKind): boolean {
  return buffs.some((b) => b.kind === kind && b.until >= now)
}

function pruneBuffs(buffs: ActiveBuff[], now: number): ActiveBuff[] {
  return buffs.filter((b) => b.until >= now)
}

export function powerLabel(k: PowerKind): string {
  return POWER_META[k].label
}

export function powerColor(k: PowerKind): string {
  return POWER_META[k].color
}

export function powerGlow(k: PowerKind): string {
  return POWER_META[k].glow
}

export function powerIcon(k: PowerKind): string {
  return POWER_META[k].icon
}

export function powerDef(k: PowerKind): PowerDef {
  return POWER_META[k]
}

function spawnPower(world: PongWorld, now: number): PowerUp {
  const kind = ALL_POWER_KINDS[Math.floor(Math.random() * ALL_POWER_KINDS.length)]
  let x = FIELD_W / 2
  let y = FIELD_H / 2
  for (let i = 0; i < 12; i++) {
    x = 120 + Math.random() * (FIELD_W - 240)
    y = 280 + Math.random() * (FIELD_H - 560)
    const dx = x - world.ball.x
    const dy = y - world.ball.y
    if (dx * dx + dy * dy > 100 * 100) break
  }
  return {
    id: now + Math.random(),
    kind,
    x,
    y,
    r: POWER_R,
    ttl: 14,
    phase: Math.random() * Math.PI * 2,
  }
}

function applyPower(world: PongWorld, who: 'player' | 'opponent', kind: PowerKind, now: number) {
  const dur = POWER_META[kind].dur
  const buff: ActiveBuff = { kind, until: now + dur }
  if (who === 'player') {
    if (kind === 'shrink') world.opponentBuffs.push(buff)
    else world.playerBuffs.push(buff)
  } else {
    if (kind === 'shrink') world.playerBuffs.push(buff)
    else world.opponentBuffs.push(buff)
  }
}

function circleRectHit(cx: number, cy: number, cr: number, px: number, py: number, pw: number, ph: number): boolean {
  const nx = Math.max(px - pw / 2, Math.min(cx, px + pw / 2))
  const ny = Math.max(py - ph / 2, Math.min(cy, py + ph / 2))
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy < cr * cr
}

function hitPaddle(ball: Ball, paddle: Paddle, py: number, isPlayer: boolean): boolean {
  const left = paddle.x - paddle.w / 2
  const right = paddle.x + paddle.w / 2
  const top = py - PADDLE_H / 2
  const bottom = py + PADDLE_H / 2

  if (ball.x + BALL_R < left || ball.x - BALL_R > right) return false

  if (isPlayer && ball.vy > 0 && ball.y + BALL_R >= top && ball.y <= bottom + BALL_R * 2) {
    ball.y = top - BALL_R - 1
    ball.vy = -Math.abs(ball.vy) * 1.05
    const hit = (ball.x - paddle.x) / (paddle.w / 2)
    ball.vx += hit * 150
    return true
  }
  if (!isPlayer && ball.vy < 0 && ball.y - BALL_R <= bottom && ball.y >= top - BALL_R * 2) {
    ball.y = bottom + BALL_R + 1
    ball.vy = Math.abs(ball.vy) * 1.05
    const hit = (ball.x - paddle.x) / (paddle.w / 2)
    ball.vx += hit * 150
    return true
  }
  return false
}

export type RoundOutcome = 'playing' | 'player' | 'opponent'

export interface PickupEvent {
  who: 'player' | 'opponent'
  kind: PowerKind
  x: number
  y: number
}

export interface StepResult {
  outcome: RoundOutcome
  pickup?: PickupEvent
}

export function activeBuffKinds(buffs: ActiveBuff[], now: number): PowerKind[] {
  return [...new Set(buffs.filter((b) => b.until >= now).map((b) => b.kind))]
}

export function speedFactor(world: PongWorld, now: number): number {
  const accel = 1 + world.elapsed * 0.09
  const touchMul =
    world.lastTouch === 'player'
      ? speedMul(world.playerBuffs, now)
      : world.lastTouch === 'opponent'
        ? speedMul(world.opponentBuffs, now)
        : 1
  return accel * touchMul
}

function tryPickup(
  world: PongWorld,
  p: PowerUp,
  now: number,
): PickupEvent | null {
  const grabR = p.r + POWER_PICKUP_PAD

  if (circleRectHit(p.x, p.y, grabR, world.player.x, PLAYER_Y, world.player.w + 36, PADDLE_H + 48)) {
    applyPower(world, 'player', p.kind, now)
    return { who: 'player', kind: p.kind, x: p.x, y: p.y }
  }
  if (circleRectHit(p.x, p.y, grabR, world.opponent.x, OPP_Y, world.opponent.w + 36, PADDLE_H + 48)) {
    applyPower(world, 'opponent', p.kind, now)
    return { who: 'opponent', kind: p.kind, x: p.x, y: p.y }
  }
  if (Math.hypot(world.ball.x - p.x, world.ball.y - p.y) < BALL_R + grabR * 0.75) {
    const who = world.lastTouch ?? (Math.random() > 0.5 ? 'player' : 'opponent')
    applyPower(world, who, p.kind, now)
    return { who, kind: p.kind, x: p.x, y: p.y }
  }
  return null
}

export function stepWorld(world: PongWorld, dt: number, now: number): StepResult {
  world.elapsed += dt
  world.playerBuffs = pruneBuffs(world.playerBuffs, now)
  world.opponentBuffs = pruneBuffs(world.opponentBuffs, now)

  world.player.w = paddleWidth(PADDLE_W, world.playerBuffs, now, 'grow')
  world.opponent.w = paddleWidth(PADDLE_W, world.opponentBuffs, now, 'grow')
  world.player.w = paddleWidth(world.player.w, world.playerBuffs, now, 'shrink')
  world.opponent.w = paddleWidth(world.opponent.w, world.opponentBuffs, now, 'shrink')

  const accel = 1 + world.elapsed * 0.09
  const pMul = speedMul(world.playerBuffs, now)
  const oMul = speedMul(world.opponentBuffs, now)
  const touchMul = world.lastTouch === 'player' ? pMul : world.lastTouch === 'opponent' ? oMul : 1

  const { ball } = world
  const curve =
    (world.lastTouch === 'player' && hasBuff(world.playerBuffs, now, 'curve')) ||
    (world.lastTouch === 'opponent' && hasBuff(world.opponentBuffs, now, 'curve'))
  if (curve) ball.vx += Math.sin(world.elapsed * 9) * 95 * dt

  ball.x += ball.vx * dt * accel * touchMul
  ball.y += ball.vy * dt * accel * touchMul

  if (ball.x - BALL_R <= WALL_PAD) {
    ball.x = WALL_PAD + BALL_R
    ball.vx = Math.abs(ball.vx) * 1.02
  }
  if (ball.x + BALL_R >= FIELD_W - WALL_PAD) {
    ball.x = FIELD_W - WALL_PAD - BALL_R
    ball.vx = -Math.abs(ball.vx) * 1.02
  }

  if (hitPaddle(ball, world.player, PLAYER_Y, true)) world.lastTouch = 'player'
  if (hitPaddle(ball, world.opponent, OPP_Y, false)) world.lastTouch = 'opponent'

  const split =
    hasBuff(world.playerBuffs, now, 'split') || hasBuff(world.opponentBuffs, now, 'split')
  if (split && Math.random() < 0.025) ball.vx *= -1

  world.spawnTimer -= dt
  if (world.spawnTimer <= 0 && world.powerUps.length < 2) {
    world.powerUps.push(spawnPower(world, now))
    world.spawnTimer = 3 + Math.random() * 3
  }

  world.powerUps = world.powerUps
    .map((p) => ({ ...p, ttl: p.ttl - dt, phase: p.phase + dt * 1.4 }))
    .filter((p) => p.ttl > 0)

  let pickup: PickupEvent | undefined
  for (let i = world.powerUps.length - 1; i >= 0; i--) {
    const hit = tryPickup(world, world.powerUps[i], now)
    if (hit) {
      pickup = hit
      world.powerUps.splice(i, 1)
      break
    }
  }

  if (ball.y - BALL_R > FIELD_H) return { outcome: 'opponent', pickup }
  if (ball.y + BALL_R < 0) return { outcome: 'player', pickup }
  return { outcome: 'playing', pickup }
}

export function clampPaddleX(x: number, w: number): number {
  const half = w / 2 + 12
  return Math.max(half, Math.min(FIELD_W - half, x))
}