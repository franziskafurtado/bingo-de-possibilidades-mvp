import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyAction, canClaimBingo, findPlayer, makeToken, newPlayer, newRoom, type Room } from './rules.js';

function setup(): Room {
  const room = newRoom('Ana', '🐱', makeToken());
  for (let i = 0; i < 8; i++) applyAction(room, room.players[0].id, 'possibility:add', { text: `Possibilidade ${i}` });
  return room;
}

test('precisa de 8 possibilidades para preparar', () => {
  const room = newRoom('Ana', '🐱', makeToken());
  assert.throws(() => applyAction(room, room.players[0].id, 'round:prepare'), /pelo menos 8/);
});
test('sala com 8 possibilidades distribui cartela automática e só inicia após todos prontos', () => {
  const room = setup();
  const bob = newPlayer('Beto', '🐸', makeToken()); room.players.push(bob);
  applyAction(room, bob.id, 'round:prepare');
  assert.equal(room.phase, 'preparing');
  assert.equal(room.cards[bob.id].slots.filter(Boolean).length, 8);
  applyAction(room, bob.id, 'player:ready');
  assert.throws(() => applyAction(room, bob.id, 'round:start'), /Todos/);
  applyAction(room, room.players[0].id, 'player:ready');
  applyAction(room, bob.id, 'round:start');
  assert.equal(room.phase, 'playing');
});
test('BINGO só é válido após 8 marcações; a primeira vitória encerra a partida', () => {
  const room = setup(); const player = room.players[0];
  applyAction(room, player.id, 'round:prepare');
  applyAction(room, player.id, 'player:ready');
  applyAction(room, player.id, 'round:start');
  assert.throws(() => applyAction(room, player.id, 'round:bingo'), /Marque as 8/);
  for (const index of [0,1,2,3,5,6,7,8]) applyAction(room, player.id, 'card:mark', { index, marked: true });
  assert.equal(canClaimBingo(room.cards[player.id]), true);
  applyAction(room, player.id, 'round:bingo');
  assert.equal(room.winnerId, player.id);
  assert.throws(() => applyAction(room, player.id, 'round:bingo'), /terminou/);
});
test('jogadores novos não entram no meio da preparação', () => {
  const room = setup(); const owner = room.players[0];
  applyAction(room, owner.id, 'round:prepare');
  const late = newPlayer('Carla', '🐝', makeToken()); room.players.push(late);
  assert.throws(() => applyAction(room, late.id, 'player:ready'), /próxima rodada/);
});
test('só o autor remove possibilidade; seleção não permite repetições', () => {
  const room = setup(); const other = newPlayer('Beto', '🐸', makeToken()); room.players.push(other);
  assert.throws(() => applyAction(room, other.id, 'possibility:delete', { id: room.possibilities[0].id }), /próprias/);
  applyAction(room, other.id, 'possibility:add', { text: 'Possibilidade extra' });
  applyAction(room, other.id, 'round:prepare');
  assert.throws(() => applyAction(room, other.id, 'card:choose', { ids: Array(8).fill(room.possibilities[0].id) }), /diferentes/);
});
test('nova rodada limpa ou mantém as frases', () => {
  const room = setup(); const id = room.players[0].id;
  applyAction(room, id, 'round:prepare'); applyAction(room, id, 'player:ready'); applyAction(room, id, 'round:start');
  for (const index of [0,1,2,3,5,6,7,8]) applyAction(room, id, 'card:mark', { index, marked: true });
  applyAction(room, id, 'round:bingo');
  applyAction(room, id, 'round:next', { keepPossibilities: false });
  assert.equal(room.phase, 'lobby'); assert.equal(room.possibilities.length, 0);
});
test('token de sessão recupera jogador original', () => {
  const token = makeToken(); const room = newRoom('Ana', '🐱', token);
  assert.equal(findPlayer(room, token)?.id, room.players[0].id);
  assert.equal(findPlayer(room, makeToken()), undefined);
});
test('não permite tirar jogador pronto ou online da preparação', () => {
  const room = setup(); const id = room.players[0].id;
  const b = newPlayer('Beto', '🐸', makeToken()); room.players.push(b);
  applyAction(room, id, 'round:prepare');
  b.lastSeen = Date.now() - 65000;
  assert.throws(() => applyAction(room, id, 'round:removeInactive', {playerId: b.id}, () => true), /desconectado/);
  applyAction(room, id, 'round:removeInactive', {playerId: b.id}, () => false);
  assert.equal(room.roundPlayers.includes(b.id), false);
});
