import http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { createMatchManager } from './matchManager.ts'

function slog(event: string, detail = '') {
  const line = `[${new Date().toISOString()}] ${event}${detail ? ` ${detail}` : ''}`
  console.log(line)
}

function cors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

const manager = createMatchManager(slog)

const server = http.createServer((req, res) => {
  cors(res)
  const url = req.url ?? '/'

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(url === '/health' ? 'ok' : 'pong-signal ok\n')
    return
  }

  if (url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        rooms: manager.roomCount(),
        queue: manager.queueCount(),
        engine: 'websocket',
      }),
    )
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found\n')
})

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false })

setInterval(() => manager.purgeStaleQueue(), 5000)

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?'
  slog('ws:connect', String(ip))
  if (ws._socket?.setNoDelay) ws._socket.setNoDelay(true)

  ws.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)

    let msg: {
      type: string
      playerId?: string
      playerName?: string
      rating?: number
      matchId?: string
      x?: number
      t?: number
    }
    try {
      msg = JSON.parse(text)
    } catch {
      slog('ws:bad-json', text.slice(0, 60))
      return
    }

    switch (msg.type) {
      case 'ping':
        send(ws, { type: 'pong', t: msg.t })
        return

      case 'join':
        if (!msg.playerId || !msg.playerName) {
          send(ws, { type: 'error', msg: 'playerId and playerName required' })
          return
        }
        manager.joinQueue(ws, msg.playerId, msg.playerName, Number(msg.rating) || 1000)
        return

      case 'cancel':
        manager.cancelQueue(ws)
        return

      case 'ready':
        if (!msg.matchId || !msg.playerId) return
        manager.handleReady(ws, msg.matchId, msg.playerId)
        return

      case 'paddle':
        if (!msg.matchId || !msg.playerId || typeof msg.x !== 'number') return
        manager.handlePaddle(msg.matchId, msg.playerId, msg.x)
        return

      case 'rejoin':
        if (!msg.matchId || !msg.playerId) return
        if (!manager.attachPlayer(ws, msg.matchId, msg.playerId)) {
          send(ws, { type: 'error', msg: 'match_not_found' })
        }
        return

      default:
        send(ws, { type: 'error', msg: `unknown type: ${msg.type}` })
    }
  })

  ws.on('close', () => {
    slog('ws:close')
    manager.handleDisconnect(ws)
  })
})

const PORT = Number(process.env.PORT) || 8788
server.listen(PORT, '0.0.0.0', () => {
  slog('server:start', `port=${PORT} ws=/ws stake=${manager.FIXED_STAKE}`)
})