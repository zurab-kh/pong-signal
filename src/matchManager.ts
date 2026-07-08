import type { WebSocket } from 'ws'
import {
  pickupForRole,
  roundWinnerForRole,
  wireForRole,
  worldToWire,
  type PvpRole,
} from './shared/pvpWire.ts'
import {
  advanceMatch,
  applyPaddle,
  createStoredMatch,
  markPlayerSeen,
  roleFor,
  tryStartLive,
  TICK_MS,
  type QueueEntry,
  type SimEvent,
  type StoredMatch,
} from './matchSim.ts'

const FIXED_STAKE = 10
const MATCH_TIMEOUT_MS = 45_000

export interface QueueItem {
  ws: WebSocket
  ticketId: string
  playerId: string
  playerName: string
  rating: number
  joinedAt: number
}

interface LiveRoom {
  match: StoredMatch
  p1Ws: WebSocket | null
  p2Ws: WebSocket | null
  tickTimer: ReturnType<typeof setInterval> | null
}

function send(ws: WebSocket | null, msg: object) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
}

function wsForRole(room: LiveRoom, role: PvpRole): WebSocket | null {
  return role === 'player1' ? room.p1Ws : room.p2Ws
}

function syncPayload(match: StoredMatch, role: PvpRole, serverNow: number) {
  return {
    type: 'sync' as const,
    serverNow,
    startAt: match.startAt,
    readyP1: match.readyP1,
    readyP2: match.readyP2,
    p1Rounds: match.p1Rounds,
    p2Rounds: match.p2Rounds,
    finished: match.finished,
    countdownMs: match.startAt > serverNow ? match.startAt - serverNow : 0,
    world: wireForRole(worldToWire(match.world), role),
  }
}

function statePayload(match: StoredMatch, event: SimEvent, role: PvpRole, serverNow: number) {
  const wire = wireForRole(worldToWire(match.world), role)
  const base = {
    type: 'state' as const,
    serverNow,
    startAt: match.startAt,
    world: wire,
    p1Rounds: match.p1Rounds,
    p2Rounds: match.p2Rounds,
    pickup: event.pickup ? pickupForRole(event.pickup, role) : null,
  }

  if (event.type === 'round_end') {
    return { ...base, roundEnd: { winner: roundWinnerForRole(event.winner, role) } }
  }
  if (event.type === 'match_end') {
    return {
      ...base,
      roundEnd: { winner: roundWinnerForRole(event.winner, role) },
      matchEnd: { winner: event.winner },
    }
  }
  return base
}

export function createMatchManager(slog: (event: string, detail?: string) => void) {
  const queue: QueueItem[] = []
  const rooms = new Map<string, LiveRoom>()

  function removeFromQueue(ws: WebSocket) {
    const idx = queue.findIndex((e) => e.ws === ws)
    if (idx >= 0) queue.splice(idx, 1)
  }

  function destroyRoom(matchId: string) {
    const room = rooms.get(matchId)
    if (!room) return
    if (room.tickTimer) clearInterval(room.tickTimer)
    rooms.delete(matchId)
  }

  function broadcastSync(room: LiveRoom) {
    const serverNow = Date.now()
    const p1Role = roleFor(room.match, room.match.player1.playerId)
    const p2Role = roleFor(room.match, room.match.player2.playerId)
    if (p1Role) send(room.p1Ws, syncPayload(room.match, p1Role, serverNow))
    if (p2Role) send(room.p2Ws, syncPayload(room.match, p2Role, serverNow))
  }

  function broadcastState(room: LiveRoom, event: SimEvent) {
    const serverNow = Date.now()
    const p1Role = roleFor(room.match, room.match.player1.playerId)
    const p2Role = roleFor(room.match, room.match.player2.playerId)
    if (p1Role) send(room.p1Ws, statePayload(room.match, event, p1Role, serverNow))
    if (p2Role) send(room.p2Ws, statePayload(room.match, event, p2Role, serverNow))
  }

  function startTickLoop(room: LiveRoom) {
    if (room.tickTimer) return
    room.tickTimer = setInterval(() => {
      const match = room.match
      if (match.finished) {
        destroyRoom(match.matchId)
        return
      }

      const nowMs = Date.now()
      if (room.p1Ws) markPlayerSeen(match, 'player1')
      if (room.p2Ws) markPlayerSeen(match, 'player2')
      tryStartLive(match, nowMs)

      if (nowMs < match.startAt) {
        broadcastSync(room)
        return
      }

      const event = advanceMatch(match, nowMs)
      broadcastState(room, event)

      if (event.type === 'match_end') {
        destroyRoom(match.matchId)
      }
    }, TICK_MS)
  }

  function attachPlayer(ws: WebSocket, matchId: string, playerId: string) {
    const room = rooms.get(matchId)
    if (!room) return false

    const role = roleFor(room.match, playerId)
    if (!role) return false

    if (role === 'player1') room.p1Ws = ws
    else room.p2Ws = ws

    ;(ws as WebSocket & { _matchId?: string; _playerId?: string })._matchId = matchId
    ;(ws as WebSocket & { _matchId?: string; _playerId?: string })._playerId = playerId

    markPlayerSeen(room.match, role)
    tryStartLive(room.match, Date.now())
    send(ws, syncPayload(room.match, role, Date.now()))
    startTickLoop(room)
    return true
  }

  function pairPlayers(a: QueueItem, b: QueueItem) {
    const entryA: QueueEntry = {
      ticketId: a.ticketId,
      playerId: a.playerId,
      playerName: a.playerName,
      rating: a.rating,
      joinedAt: a.joinedAt,
    }
    const entryB: QueueEntry = {
      ticketId: b.ticketId,
      playerId: b.playerId,
      playerName: b.playerName,
      rating: b.rating,
      joinedAt: b.joinedAt,
    }

    const match = createStoredMatch(entryA, entryB)
    const room: LiveRoom = {
      match,
      p1Ws: a.ws,
      p2Ws: b.ws,
      tickTimer: null,
    }
    rooms.set(match.matchId, room)

    ;(a.ws as WebSocket & { _matchId?: string; _playerId?: string })._matchId = match.matchId
    ;(a.ws as WebSocket & { _matchId?: string; _playerId?: string })._playerId = a.playerId
    ;(b.ws as WebSocket & { _matchId?: string; _playerId?: string })._matchId = match.matchId
    ;(b.ws as WebSocket & { _matchId?: string; _playerId?: string })._playerId = b.playerId

    send(a.ws, {
      type: 'matched',
      matchId: match.matchId,
      role: 'player1',
      opponent: { id: b.playerId, name: b.playerName, isBot: false, rating: b.rating },
    })
    send(b.ws, {
      type: 'matched',
      matchId: match.matchId,
      role: 'player2',
      opponent: { id: a.playerId, name: a.playerName, isBot: false, rating: a.rating },
    })

    broadcastSync(room)
    startTickLoop(room)
    slog('match:paired', `${match.matchId} ${a.playerId} vs ${b.playerId}`)
  }

  function joinQueue(ws: WebSocket, playerId: string, playerName: string, rating: number): QueueItem {
    removeFromQueue(ws)

    const existing = queue.find((e) => e.playerId === playerId)
    if (existing) {
      existing.ws = ws
      send(ws, { type: 'searching', ticketId: existing.ticketId })
      return existing
    }

    const opponent = queue.find((e) => e.ws !== ws && e.ws.readyState === 1 && e.playerId !== playerId)
    const item: QueueItem = {
      ws,
      ticketId: crypto.randomUUID(),
      playerId,
      playerName,
      rating,
      joinedAt: Date.now(),
    }

    if (opponent) {
      removeFromQueue(opponent.ws)
      pairPlayers(opponent, item)
      return item
    }

    queue.push(item)
    send(ws, { type: 'searching', ticketId: item.ticketId })
    slog('match:queued', `${playerId} (${queue.length} waiting)`)
    return item
  }

  function cancelQueue(ws: WebSocket) {
    removeFromQueue(ws)
    send(ws, { type: 'gone' })
  }

  function handleReady(ws: WebSocket, matchId: string, playerId: string) {
    const room = rooms.get(matchId)
    if (!room) return
    const role = roleFor(room.match, playerId)
    if (!role) return

    if (role === 'player1') room.match.readyP1 = true
    else room.match.readyP2 = true

    markPlayerSeen(room.match, role)
    tryStartLive(room.match, Date.now())
    broadcastSync(room)
  }

  function handlePaddle(matchId: string, playerId: string, x: number) {
    const room = rooms.get(matchId)
    if (!room) return
    applyPaddle(room.match, playerId, x)
    const role = roleFor(room.match, playerId)
    if (role) {
      markPlayerSeen(room.match, role)
      tryStartLive(room.match, Date.now())
    }
  }

  function handleDisconnect(ws: WebSocket) {
    removeFromQueue(ws)

    const meta = ws as WebSocket & { _matchId?: string; _playerId?: string }
    const matchId = meta._matchId
    if (!matchId) return

    const room = rooms.get(matchId)
    if (!room || room.match.finished) return

    const role = meta._playerId ? roleFor(room.match, meta._playerId) : null
    if (role === 'player1') room.p1Ws = null
    else if (role === 'player2') room.p2Ws = null

    const peer = role === 'player1' ? room.p2Ws : room.p1Ws
    const peerRole = role === 'player1' ? 'player2' : 'player1'
    if (peer && peer.readyState === 1) {
      send(peer, {
        type: 'peer_left',
        winner: peerRole === 'player1' ? 'player1' : 'player2',
      })
    }

    room.match.finished = true
    destroyRoom(matchId)
    slog('match:disconnect', `${matchId} ${meta._playerId ?? '?'}`)
  }

  function purgeStaleQueue() {
    const now = Date.now()
    for (let i = queue.length - 1; i >= 0; i--) {
      const e = queue[i]
      if (e.ws.readyState !== 1 || now - e.joinedAt > MATCH_TIMEOUT_MS) {
        if (e.ws.readyState === 1) send(e.ws, { type: 'gone' })
        queue.splice(i, 1)
      }
    }
  }

  return {
    FIXED_STAKE,
    joinQueue,
    cancelQueue,
    handleReady,
    handlePaddle,
    handleDisconnect,
    attachPlayer,
    purgeStaleQueue,
    roomCount: () => rooms.size,
    queueCount: () => queue.length,
  }
}