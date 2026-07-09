import {
  FIELD_H,
  FIELD_W,
  type PickupEvent,
  type PongWorld,
  type PowerKind,
  type RoundOutcome,
} from './pong'

export type PvpRole = 'player1' | 'player2'

export interface WireState {
  ball: { x: number; y: number; vx: number; vy: number }
  player: { x: number; w: number }
  opponent: { x: number; w: number }
  powerUps: PongWorld['powerUps']
  playerBuffs: { kind: PowerKind; until: number }[]
  opponentBuffs: { kind: PowerKind; until: number }[]
  elapsed: number
  lastTouch: 'player' | 'opponent' | null
  rally: number
  rallyPeak: number
}

export function worldToWire(world: PongWorld): WireState {
  return {
    ball: { ...world.ball },
    player: { ...world.player },
    opponent: { ...world.opponent },
    powerUps: world.powerUps.map((p) => ({ ...p })),
    playerBuffs: world.playerBuffs.map((b) => ({ ...b })),
    opponentBuffs: world.opponentBuffs.map((b) => ({ ...b })),
    elapsed: world.elapsed,
    lastTouch: world.lastTouch,
    rally: world.rally,
    rallyPeak: world.rallyPeak,
  }
}

export function wireToWorld(wire: WireState, spawnTimer = 99): PongWorld {
  return {
    ball: { ...wire.ball },
    player: { ...wire.player },
    opponent: { ...wire.opponent },
    powerUps: wire.powerUps.map((p) => ({ ...p })),
    playerBuffs: wire.playerBuffs.map((b) => ({ ...b })),
    opponentBuffs: wire.opponentBuffs.map((b) => ({ ...b })),
    elapsed: wire.elapsed,
    lastTouch: wire.lastTouch,
    spawnTimer,
    rally: wire.rally ?? 0,
    rallyPeak: wire.rallyPeak ?? 0,
  }
}

/** Server view: player1 = bottom, player2 = top */
export function wireForRole(wire: WireState, role: PvpRole): WireState {
  if (role === 'player1') return wire
  return {
    ball: {
      x: wire.ball.x,
      y: FIELD_H - wire.ball.y,
      vx: wire.ball.vx,
      vy: -wire.ball.vy,
    },
    player: { ...wire.opponent },
    opponent: { ...wire.player },
    powerUps: wire.powerUps.map((p) => ({ ...p, y: FIELD_H - p.y })),
    playerBuffs: wire.opponentBuffs.map((b) => ({ ...b })),
    opponentBuffs: wire.playerBuffs.map((b) => ({ ...b })),
    elapsed: wire.elapsed,
    lastTouch:
      wire.lastTouch === 'player' ? 'opponent' : wire.lastTouch === 'opponent' ? 'player' : null,
    rally: wire.rally,
    rallyPeak: wire.rallyPeak,
  }
}

export function pickupForRole(pickup: PickupEvent, role: PvpRole): PickupEvent {
  if (role === 'player1') return pickup
  return {
    ...pickup,
    who: pickup.who === 'player' ? 'opponent' : 'player',
    y: FIELD_H - pickup.y,
  }
}

export function roundWinnerForRole(winner: PvpRole, role: PvpRole): RoundOutcome {
  if (winner === role) return 'player'
  return 'opponent'
}

export function paddleLerp(current: number, target: number, w: number, dt: number): number {
  const half = w / 2 + 12
  const clamped = Math.max(half, Math.min(FIELD_W - half, target))
  return current + (clamped - current) * Math.min(1, dt * 16)
}