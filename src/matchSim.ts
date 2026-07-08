import {
  FIELD_W,
  ROUNDS_TO_WIN,
  clampPaddleX,
  createWorld,
  stepWorld,
  type PongWorld,
} from './shared/pong.ts'
import { paddleLerp, type PvpRole } from './shared/pvpWire.ts'

export const TICK_MS = 16
export const ROUND_PAUSE_MS = 1800
export const COUNTDOWN_MS = 3200
export const JOIN_GRACE_MS = 2500
export const MAX_CATCHUP_TICKS = 12

export interface QueuePlayer {
  playerId: string
  playerName: string
  rating: number
}

export interface QueueEntry extends QueuePlayer {
  ticketId: string
  joinedAt: number
}

interface Slot {
  playerId: string
  playerName: string
  targetX: number
}

export interface StoredMatch {
  matchId: string
  player1: Slot
  player2: Slot
  world: PongWorld
  simTime: number
  p1Rounds: number
  p2Rounds: number
  pausedUntil: number
  lastWallMs: number
  startAt: number
  readyP1: boolean
  readyP2: boolean
  seenP1: boolean
  seenP2: boolean
  liveStarted: boolean
  roundSeed: number
  finished: boolean
}

export type SimEvent =
  | { type: 'state'; pickup: ReturnType<typeof stepWorld>['pickup'] }
  | { type: 'round_end'; winner: PvpRole; pickup: ReturnType<typeof stepWorld>['pickup'] }
  | { type: 'match_end'; winner: PvpRole; pickup: ReturnType<typeof stepWorld>['pickup'] }

export function createStoredMatch(a: QueueEntry, b: QueueEntry): StoredMatch {
  const seed = Date.now()
  const now = Date.now()
  return {
    matchId: crypto.randomUUID(),
    player1: { playerId: a.playerId, playerName: a.playerName, targetX: FIELD_W / 2 },
    player2: { playerId: b.playerId, playerName: b.playerName, targetX: FIELD_W / 2 },
    world: createWorld(seed),
    simTime: 0,
    p1Rounds: 0,
    p2Rounds: 0,
    pausedUntil: 0,
    lastWallMs: now,
    startAt: now + JOIN_GRACE_MS + COUNTDOWN_MS,
    readyP1: true,
    readyP2: true,
    seenP1: false,
    seenP2: false,
    liveStarted: false,
    roundSeed: seed,
    finished: false,
  }
}

export function roleFor(match: StoredMatch, playerId: string): PvpRole | null {
  if (match.player1.playerId === playerId) return 'player1'
  if (match.player2.playerId === playerId) return 'player2'
  return null
}

export function markPlayerSeen(match: StoredMatch, role: PvpRole) {
  if (role === 'player1') match.seenP1 = true
  else match.seenP2 = true
}

export function tryStartLive(match: StoredMatch, nowMs: number) {
  if (match.liveStarted || match.startAt === 0 || nowMs < match.startAt) return
  match.liveStarted = true
  match.lastWallMs = nowMs
}

export function applyPaddle(match: StoredMatch, playerId: string, x: number) {
  const w =
    match.player1.playerId === playerId ? match.world.player.w : match.world.opponent.w
  const clamped = clampPaddleX(x, w)
  if (match.player1.playerId === playerId) match.player1.targetX = clamped
  else if (match.player2.playerId === playerId) match.player2.targetX = clamped
}

export function advanceMatch(match: StoredMatch, nowMs: number): SimEvent {
  if (match.finished || match.startAt === 0 || nowMs < match.startAt) {
    return { type: 'state', pickup: undefined }
  }

  if (nowMs < match.pausedUntil) {
    return { type: 'state', pickup: undefined }
  }

  if (!match.liveStarted) {
    return { type: 'state', pickup: undefined }
  }

  const anchor = Math.max(match.lastWallMs, match.startAt, match.pausedUntil)
  const ticksToRun = Math.min(MAX_CATCHUP_TICKS, Math.floor((nowMs - anchor) / TICK_MS))
  if (ticksToRun <= 0) return { type: 'state', pickup: undefined }

  let lastPickup: SimEvent['pickup'] = undefined

  for (let i = 0; i < ticksToRun; i++) {
    const dt = TICK_MS / 1000
    match.simTime += dt
    const world = match.world

    world.player.x = paddleLerp(world.player.x, match.player1.targetX, world.player.w, dt)
    world.opponent.x = paddleLerp(world.opponent.x, match.player2.targetX, world.opponent.w, dt)

    const { outcome, pickup } = stepWorld(world, dt, match.simTime)
    if (pickup) lastPickup = pickup

    if (outcome !== 'playing') {
      if (outcome === 'player') match.p1Rounds += 1
      else match.p2Rounds += 1

      match.lastWallMs = anchor + (i + 1) * TICK_MS

      if (match.p1Rounds >= ROUNDS_TO_WIN || match.p2Rounds >= ROUNDS_TO_WIN) {
        match.finished = true
        return {
          type: 'match_end',
          winner: match.p1Rounds >= ROUNDS_TO_WIN ? 'player1' : 'player2',
          pickup: lastPickup,
        }
      }

      match.roundSeed = Date.now()
      match.world = createWorld(match.roundSeed)
      match.simTime = 0
      match.pausedUntil = nowMs + ROUND_PAUSE_MS
      match.lastWallMs = match.pausedUntil
      return {
        type: 'round_end',
        winner: outcome === 'player' ? 'player1' : 'player2',
        pickup: lastPickup,
      }
    }
  }

  match.lastWallMs = anchor + ticksToRun * TICK_MS
  return { type: 'state', pickup: lastPickup }
}