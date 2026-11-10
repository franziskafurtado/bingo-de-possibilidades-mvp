import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { Server, type Socket } from 'socket.io';
import {
  applyAction, findPlayer, GameError, makeToken, newPlayer, newRoom,
  normalizeCode, publicRoom, type Room, type RoomAction
} from './rules.js';

const port = Number(process.env.PORT || 3000);
const maxRooms = Number(process.env.MAX_ACTIVE_ROOMS || 10);
const ttlHours = Number(process.env.ROOM_TTL_HOURS || 48);
const graceMs = Number(process.env.INACTIVE_GRACE_SECONDS || 60) * 1000;
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env.example).');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// A chave é código-da-sala:id-do-jogador. Várias abas do mesmo usuário são suportadas.
const presence = new Map<string, Set<string>>();
const onlineKey = (code: string, playerId: string) => `${code}:${playerId}`;
const isOnline = (code: string, id: string) => (presence.get(onlineKey(code, id))?.size ?? 0) > 0;
const getRoom = async (code: string): Promise<Room> => {
  const result = await pool.query('SELECT data FROM rooms WHERE code = $1', [normalizeCode(code)]);
  if (!result.rows.length) throw new GameError('Sala não encontrada ou expirada.', 404);
  return result.rows[0].data as Room;
};
async function inTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function mutate<T>(code: string, fn: (room: Room) => T | Promise<T>): Promise<{room: Room; result: T}> {
  return inTransaction(async client => {
    const query = await client.query('SELECT data FROM rooms WHERE code = $1 FOR UPDATE', [normalizeCode(code)]);
    if (!query.rows.length) throw new GameError('Sala não encontrada ou expirada.', 404);
    const room = query.rows[0].data as Room;
    const result = await fn(room);
    await client.query('UPDATE rooms SET data = $1::jsonb, updated_at = now() WHERE code = $2', [JSON.stringify(room), room.code]);
    return { room, result };
  });
}
function sendError(res: express.Response, error: unknown) {
  if (!(error instanceof GameError)) console.error(error);
  res.status(error instanceof GameError ? error.status : 500).json({ error: error instanceof GameError ? error.message : 'Erro interno. Tente novamente.' });
}
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/rooms', async (req, res) => {
  try {
    const token = makeToken();
    const room = newRoom(req.body?.name, req.body?.avatar, token);
    await inTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(490718)');
      await client.query('DELETE FROM rooms WHERE updated_at < now() - ($1::double precision * interval \'1 hour\')', [ttlHours]);
      const count = await client.query('SELECT count(*)::int AS count FROM rooms');
      if (count.rows[0].count >= maxRooms) throw new GameError('O limite de salas ativas foi atingido. Tente novamente mais tarde.');
      await client.query('INSERT INTO rooms(id, code, data) VALUES ($1, $2, $3::jsonb)', [room.id, room.code, JSON.stringify(room)]);
    });
    res.status(201).json({ code: room.code, token });
  } catch (e) { sendError(res, e); }
});
app.post('/api/rooms/:code/join', async (req, res) => {
  try {
    const code = normalizeCode(req.params.code);
    const token = typeof req.body?.token === 'string' ? req.body.token : undefined;
    const result = await mutate(code, room => {
      const existing = findPlayer(room, token);
      if (existing) return { token, playerId: existing.id };
      // Cada participante novo recebe um segredo individual; não usamos senha nem login.
      const freshToken = makeToken();
      const player = newPlayer(req.body?.name, req.body?.avatar, freshToken);
      room.players.push(player);
      return { token: freshToken, playerId: player.id };
    });
    broadcast(result.room);
    res.json({ code: result.room.code, token: result.result.token });
  } catch (e) { sendError(res, e); }
});
function broadcast(room: Room) {
  // Estado individual: apenas o dono recebe a própria cartela; hashes nunca são enviados.
  const sockets = io.sockets.adapter.rooms.get(room.code);
  if (!sockets) return;
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    const playerId = socket?.data.playerId as string | undefined;
    if (socket && playerId) socket.emit('room:state', publicRoom(room, playerId, id => isOnline(room.code, id)));
  }
}
function addPresence(socket: Socket, code: string, id: string) {
  const key = onlineKey(code, id);
  const connections = presence.get(key) ?? new Set<string>();
  connections.add(socket.id); presence.set(key, connections);
}
function removePresence(socket: Socket, code: string, id: string) {
  const key = onlineKey(code, id);
  const connections = presence.get(key);
  if (!connections) return;
  connections.delete(socket.id);
  if (!connections.size) presence.delete(key);
}
type Ack = (result: {ok: boolean; state?: unknown; error?: string}) => void;
const safeAck = (ack: unknown, result: {ok: boolean; state?: unknown; error?: string}) => {
  if (typeof ack === 'function') (ack as Ack)(result);
};
io.on('connection', socket => {
  socket.on('room:join', async (payload: any, ack: Ack) => {
    try {
      const code = normalizeCode(String(payload?.code ?? ''));
      const { room, result: playerId } = await mutate(code, room => {
        const player = findPlayer(room, payload?.token);
        if (!player) throw new GameError('Sua sessão não foi encontrada. Entre novamente na sala.', 401);
        player.lastSeen = Date.now();
        return player.id;
      });
      const previousCode = socket.data.roomCode as string | undefined;
      const previousPlayer = socket.data.playerId as string | undefined;
      if (previousCode && previousPlayer) {
        socket.leave(previousCode);
        removePresence(socket, previousCode, previousPlayer);
      }
      socket.data.roomCode = code;
      socket.data.playerId = playerId;
      socket.join(code);
      addPresence(socket, code, playerId);
      safeAck(ack, { ok: true, state: publicRoom(room, playerId, id => isOnline(code, id)) });
      broadcast(room);
    } catch (e) { safeAck(ack, { ok: false, error: e instanceof GameError ? e.message : 'Não foi possível acessar a sala.' }); }
  });
  socket.on('room:action', async (payload: {action?: RoomAction; data?: unknown}, ack: Ack) => {
    try {
      const code = socket.data.roomCode as string | undefined;
      const playerId = socket.data.playerId as string | undefined;
      if (!code || !playerId) throw new GameError('Conecte-se à sala para continuar.');
      const actions: RoomAction[] = ['possibility:add','possibility:delete','round:prepare','card:choose','player:ready','round:start','card:mark','round:bingo','round:next','round:removeInactive'];
      if (!payload || !actions.includes(payload.action as RoomAction)) throw new GameError('Ação inválida.');
      const {room} = await mutate(code, room => {
        applyAction(room, playerId, payload.action as RoomAction, payload.data, id => isOnline(code, id), graceMs);
      });
      safeAck(ack, {ok: true});
      broadcast(room);
    } catch (e) { safeAck(ack, {ok:false, error: e instanceof GameError ? e.message : 'Erro ao processar a ação.' }); }
  });
  socket.on('disconnect', async () => {
    const code = socket.data.roomCode as string | undefined;
    const id = socket.data.playerId as string | undefined;
    if (!code || !id) return;
    removePresence(socket, code, id);
    try {
      if (!isOnline(code, id)) {
        const { room } = await mutate(code, room => {
          const player = room.players.find(p => p.id === id);
          if (player) player.lastSeen = Date.now();
        });
        broadcast(room);
      } else { broadcast(await getRoom(code)); }
    } catch (e) { console.error('Falha ao atualizar presença:', e); }
  });
});
const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return res.status(404).end();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
async function start() {
  await pool.query(`CREATE TABLE IF NOT EXISTS rooms (
    id uuid PRIMARY KEY,
    code varchar(32) UNIQUE NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms(updated_at)');
  server.listen(port, '0.0.0.0', () => console.info(`Bingo disponível em http://localhost:${port}`));
}
start().catch(e => { console.error('Falha ao conectar ao PostgreSQL:', e); process.exit(1); });
