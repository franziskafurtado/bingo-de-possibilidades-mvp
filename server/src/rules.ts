import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type Phase = 'lobby' | 'preparing' | 'playing' | 'finished';
export type Player = {
  id: string; name: string; avatar: string; sessionHash: string;
  joinedAt: number; lastSeen: number; ready: boolean;
};
export type Possibility = { id: string; text: string; authorId: string; createdAt: number };
export type Card = { slots: (string | null)[]; marks: boolean[] };
export type Room = {
  id: string; code: string; fruit: string; phase: Phase; round: number;
  players: Player[]; possibilities: Possibility[]; roundPlayers: string[];
  cards: Record<string, Card>; winnerId: string | null; finishedAt: number | null;
};
export type RoomAction =
  | 'possibility:add' | 'possibility:delete' | 'round:prepare' | 'card:choose'
  | 'player:ready' | 'round:start' | 'card:mark' | 'round:bingo'
  | 'round:next' | 'round:removeInactive';

export class GameError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'GameError'; }
}
const fail = (message: string): never => { throw new GameError(message); };
const requireThat = (condition: unknown, message: string): void => { if (!condition) fail(message); };
const slotPositions = [0, 1, 2, 3, 5, 6, 7, 8];
const MAX_TEXT = 90;

export const makeToken = () => randomBytes(32).toString('hex');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const normalizeCode = (s: string) => s.trim().toUpperCase();
export const fruits = ['MANGA', 'MORANGO', 'BANANA', 'CEREJA', 'LIMAO', 'PESSEGO', 'AMORA', 'ABACAXI', 'MELANCIA', 'KIWI', 'UVA', 'PERA'];
export function makeCode() {
  const fruit = fruits[Math.floor(Math.random() * fruits.length)];
  return { fruit, code: `${fruit}-${randomBytes(3).toString('hex').toUpperCase()}` };
}
export function newPlayer(nameInput: unknown, avatarInput: unknown, token: string): Player {
  const name = String(nameInput ?? '').trim().replace(/\s+/g, ' ');
  requireThat(name.length >= 1 && name.length <= 24, 'O apelido deve ter de 1 a 24 caracteres.');
  const avatars = ['🦊','🐱','🐸','🐼','🦄','🐰','🐻','🐝','🐧','🐢','🐙','🦋'];
  const avatar = String(avatarInput ?? '🐱');
  requireThat(avatars.includes(avatar), 'Avatar inválido.');
  return { id: randomUUID(), name, avatar, sessionHash: hashToken(token), joinedAt: Date.now(), lastSeen: Date.now(), ready: false };
}
export function newRoom(name: unknown, avatar: unknown, token: string): Room {
  const { fruit, code } = makeCode();
  return {
    id: randomUUID(), code, fruit, phase: 'lobby', round: 0,
    players: [newPlayer(name, avatar, token)], possibilities: [],
    roundPlayers: [], cards: {}, winnerId: null, finishedAt: null
  };
}
export function findPlayer(room: Room, token: unknown): Player | undefined {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return undefined;
  const hash = hashToken(token);
  return room.players.find(p => p.sessionHash === hash);
}
const shuffle = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const makeCard = (ids: string[]): Card => {
  const slots: (string | null)[] = Array(9).fill(null);
  const marks = Array(9).fill(false);
  for (const [index, id] of shuffle(ids).entries()) slots[slotPositions[index]] = id;
  marks[4] = true;
  return { slots, marks };
};
export function canClaimBingo(card?: Card): boolean {
  return !!card && card.slots.length === 9 && slotPositions.every(i => !!card.slots[i] && card.marks[i] === true);
}
export function allReady(room: Room): boolean {
  return room.roundPlayers.length > 0 && room.roundPlayers.every(id => room.players.some(p => p.id === id && p.ready && room.cards[id]));
}
export function applyAction(room: Room, actorId: string, action: RoomAction, data: any = {}, isOnline: (id: string) => boolean = () => false, graceMs = 60000) {
  const actor = room.players.find(p => p.id === actorId);
  requireThat(actor, 'Você não participa desta sala.');
  if (!actor) return;
  const participating = room.roundPlayers.includes(actorId);
  const lobby = () => requireThat(room.phase === 'lobby', 'Esta ação só está disponível antes da preparação.');
  const preparing = () => requireThat(room.phase === 'preparing', 'Esta ação só está disponível durante a preparação.');

  switch (action) {
    case 'possibility:add': {
      lobby();
      const value = String(data?.text ?? '').trim().replace(/\s+/g, ' ');
      requireThat(value.length >= 1 && value.length <= MAX_TEXT, `A frase deve ter de 1 a ${MAX_TEXT} caracteres.`);
      requireThat(!room.possibilities.some(p => p.text.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR')), 'Essa possibilidade já foi cadastrada.');
      room.possibilities.unshift({ id: randomUUID(), text: value, authorId: actorId, createdAt: Date.now() });
      break;
    }
    case 'possibility:delete': {
      lobby();
      const p = room.possibilities.find(p => p.id === data?.id);
      requireThat(p, 'Possibilidade não encontrada.');
      requireThat(p?.authorId === actorId, 'Você só pode remover suas próprias possibilidades.');
      room.possibilities = room.possibilities.filter(p => p.id !== data?.id);
      break;
    }
    case 'round:prepare': {
      lobby();
      requireThat(room.possibilities.length >= 8, 'Cadastre pelo menos 8 possibilidades antes de iniciar.');
      room.phase = 'preparing';
      room.round += 1;
      room.roundPlayers = room.players.map(p => p.id);
      room.cards = {};
      room.winnerId = null;
      room.finishedAt = null;
      for (const player of room.players) player.ready = false;
      if (room.possibilities.length === 8) {
        const ids = room.possibilities.map(p => p.id);
        for (const id of room.roundPlayers) room.cards[id] = makeCard(ids);
      }
      break;
    }
    case 'card:choose': {
      preparing();
      requireThat(participating, 'Você entrou após o início da preparação. Aguarde a próxima rodada.');
      requireThat(!actor.ready, 'Você já confirmou sua cartela.');
      const ids: unknown = data?.ids;
      requireThat(Array.isArray(ids) && ids.length === 8 && ids.every(id => typeof id === 'string'), 'Escolha exatamente 8 possibilidades.');
      const selected = ids as string[];
      requireThat(new Set(selected).size === 8, 'Escolha 8 possibilidades diferentes.');
      requireThat(selected.every(id => room.possibilities.some(p => p.id === id)), 'Há possibilidades inválidas na seleção.');
      room.cards[actorId] = makeCard(selected);
      break;
    }
    case 'player:ready': {
      preparing();
      requireThat(participating, 'Você deve aguardar a próxima rodada.');
      requireThat(room.cards[actorId], 'Escolha 8 possibilidades antes de confirmar.');
      actor.ready = true;
      break;
    }
    case 'round:start': {
      preparing();
      requireThat(allReady(room), 'Todos os participantes da rodada precisam confirmar que estão prontos.');
      room.phase = 'playing';
      break;
    }
    case 'card:mark': {
      requireThat(room.phase === 'playing', 'Não é possível marcar a cartela fora da partida.');
      requireThat(participating, 'Você não participa desta rodada.');
      const index = data?.index;
      requireThat(Number.isInteger(index) && index >= 0 && index < 9 && index !== 4, 'Quadrado inválido.');
      requireThat(typeof data?.marked === 'boolean', 'Informe se o quadrado está marcado.');
      const card = room.cards[actorId];
      requireThat(card?.slots[index], 'Quadrado não disponível.');
      card.marks[index] = data.marked;
      break;
    }
    case 'round:bingo': {
      requireThat(room.phase === 'playing', 'Esta partida já terminou ou ainda não começou.');
      requireThat(participating, 'Você não participa desta rodada.');
      requireThat(canClaimBingo(room.cards[actorId]), 'Marque as 8 possibilidades para anunciar BINGO.');
      room.winnerId = actorId;
      room.phase = 'finished';
      room.finishedAt = Date.now();
      break;
    }
    case 'round:next': {
      requireThat(room.phase === 'finished', 'A rodada atual ainda não terminou.');
      requireThat(typeof data?.keepPossibilities === 'boolean', 'Escolha se deseja manter ou limpar as possibilidades.');
      if (!data.keepPossibilities) room.possibilities = [];
      room.phase = 'lobby';
      room.cards = {};
      room.roundPlayers = [];
      room.winnerId = null;
      room.finishedAt = null;
      for (const player of room.players) player.ready = false;
      break;
    }
    case 'round:removeInactive': {
      preparing();
      const target = room.players.find(p => p.id === data?.playerId);
      requireThat(target && room.roundPlayers.includes(target.id), 'Participante não encontrado nesta rodada.');
      if (!target) return;
      requireThat(!target.ready, 'Não é permitido retirar um jogador que já confirmou estar pronto.');
      requireThat(!isOnline(target.id) && Date.now() - target.lastSeen >= graceMs, 'O jogador precisa estar desconectado por mais tempo para ser retirado.');
      room.roundPlayers = room.roundPlayers.filter(id => id !== target.id);
      delete room.cards[target.id];
      break;
    }
    default: fail('Ação desconhecida.');
  }
}
export function publicRoom(room: Room, actorId: string, isOnline: (id: string) => boolean) {
  const selfCard = room.cards[actorId] ?? null;
  return {
    code: room.code, fruit: room.fruit, phase: room.phase, round: room.round,
    players: room.players.map(({ id, name, avatar, ready, lastSeen }) => ({
      id, name, avatar, ready, online: isOnline(id), lastSeen, inRound: room.roundPlayers.includes(id)
    })),
    possibilities: room.possibilities,
    roundPlayers: room.roundPlayers,
    readyCount: room.roundPlayers.filter(id => room.players.some(p => p.id === id && p.ready)).length,
    allReady: allReady(room),
    winnerId: room.winnerId,
    myId: actorId,
    myCard: selfCard,
    maxPhraseLength: MAX_TEXT
  };
}
