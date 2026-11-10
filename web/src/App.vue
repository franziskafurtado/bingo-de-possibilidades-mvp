<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';

type Phase = 'lobby' | 'preparing' | 'playing' | 'finished';
type Player = { id: string; name: string; avatar: string; ready: boolean; online: boolean; lastSeen: number; inRound: boolean };
type Possibility = {id: string; text: string; authorId: string; createdAt: number};
type Card = {slots: (string|null)[]; marks: boolean[]};
type RoomView = {
  code: string; fruit: string; phase: Phase; round: number; myId: string;
  players: Player[]; possibilities: Possibility[]; roundPlayers: string[];
  readyCount: number; allReady: boolean; winnerId: string | null; myCard: Card|null;
  maxPhraseLength: number;
};
type Ack = {ok: boolean; state?: RoomView; error?: string};
const avatars = ['🦊','🐱','🐸','🐼','🦄','🐰','🐻','🐝','🐧','🐢','🐙','🦋'];
const name = ref(localStorage.getItem('bingo_profile_name') ?? '');
const avatar = ref(localStorage.getItem('bingo_profile_avatar') ?? '🐱');
const roomCodeInput = ref('');
const possibilityInput = ref('');
const selectedIds = ref<string[]>([]);
const room = ref<RoomView|null>(null);
const errorMessage = ref('');
const successMessage = ref('');
const connecting = ref(false);
const pending = ref(false);
const isConnected = ref(false);
const roundOptions = ref(false);
const winnerModal = ref(false);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let socket: Socket | null = null;

const me = computed(() => room.value?.players.find(p => p.id === room.value?.myId));
const winner = computed(() => room.value?.players.find(p => p.id === room.value?.winnerId));
const inRound = computed(() => !!room.value?.roundPlayers.includes(room.value.myId));
const card = computed(() => room.value?.myCard);
const myReady = computed(() => !!me.value?.ready);
const markedCount = computed(() => card.value?.marks.filter((v,i) => i !== 4 && v).length ?? 0);
const isBingo = computed(() => markedCount.value === 8);
const phraseById = (id: string | null) => room.value?.possibilities.find(p => p.id === id)?.text ?? '';
const playerById = (id: string) => room.value?.players.find(p => p.id === id);
const sortedPlayers = computed(() => [...(room.value?.players ?? [])].sort((a,b) => Number(b.inRound)-Number(a.inRound) || Number(b.online)-Number(a.online)));
const readyPlayers = computed(() => (room.value?.players ?? []).filter(p => p.inRound));
const canRemoveInactive = (p: Player) => room.value?.phase === 'preparing' && p.inRound && !p.ready && !p.online && now.value-p.lastSeen >= 60000;

function clearMessage() { errorMessage.value = ''; successMessage.value = ''; }
function fail(e: unknown) { errorMessage.value = e instanceof Error ? e.message : String(e); }
function authToken(code: string) { return localStorage.getItem(`bingo_room_${code.toUpperCase()}`); }
function roomFromPath() {
  const match = window.location.pathname.match(/^\/sala\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]).toUpperCase() : '';
}
function saveProfile() {
  localStorage.setItem('bingo_profile_name', name.value.trim());
  localStorage.setItem('bingo_profile_avatar', avatar.value);
}
async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  let result: any;
  try { result = await response.json(); } catch { throw new Error('Não foi possível acessar o servidor.'); }
  if (!response.ok) throw new Error(result.error || 'Erro ao acessar o servidor.');
  return result as T;
}
function loadRoom(code: string, token: string) {
  clearMessage();
  connecting.value = true;
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  const next = io({autoConnect: false, reconnection: true});
  socket = next;
  next.on('connect', () => {
    isConnected.value = true;
    next.timeout(8000).emit('room:join', {code, token}, (err: Error | null, result: Ack) => {
      connecting.value = false;
      if (err || !result?.ok) {
        errorMessage.value = result?.error || 'Falha ao entrar na sala.';
        if (result?.error?.includes('sessão')) localStorage.removeItem(`bingo_room_${code}`);
        room.value = null;
      } else if (result.state) {
        room.value = result.state;
        window.history.replaceState({}, '', `/sala/${code}`);
      }
    });
  });
  next.on('room:state', (state: RoomView) => { room.value = state; connecting.value = false; });
  next.on('disconnect', () => { isConnected.value = false; });
  next.on('connect_error', () => { connecting.value = false; isConnected.value = false; errorMessage.value = 'Sem conexão com o servidor. Tentando reconectar…'; });
  next.connect();
}
async function createRoom() {
  clearMessage();
  if (!name.value.trim()) { errorMessage.value = 'Informe seu apelido.'; return; }
  connecting.value = true;
  try {
    saveProfile();
    const data = await post<{code:string;token:string}>('/api/rooms', {name:name.value, avatar:avatar.value});
    localStorage.setItem(`bingo_room_${data.code}`, data.token);
    loadRoom(data.code, data.token);
  } catch(e) { fail(e); connecting.value=false; }
}
async function joinRoom() {
  clearMessage();
  if (!name.value.trim()) { errorMessage.value = 'Informe seu apelido.'; return; }
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { errorMessage.value = 'Informe o código da sala.'; return; }
  connecting.value = true;
  try {
    saveProfile();
    const data = await post<{code:string;token:string}>(`/api/rooms/${encodeURIComponent(code)}/join`, {name:name.value, avatar:avatar.value, token:authToken(code)});
    localStorage.setItem(`bingo_room_${data.code}`, data.token);
    loadRoom(data.code, data.token);
  } catch(e) { fail(e); connecting.value=false; }
}
function home() {
  socket?.removeAllListeners(); socket?.disconnect(); socket=null;
  room.value=null; selectedIds.value=[]; roundOptions.value=false; winnerModal.value=false; connecting.value=false;
  roomCodeInput.value='';
  window.history.pushState({}, '', '/'); clearMessage();
}
function copyInvite() {
  if (!room.value) return;
  const link = `${window.location.origin}/sala/${room.value.code}`;
  navigator.clipboard?.writeText(link).then(() => successMessage.value = 'Link copiado!').catch(() => successMessage.value = `Compartilhe: ${link}`) ?? (successMessage.value = link);
}
function choose(id: string) {
  if (myReady.value || card.value) return;
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(x => x !== id) : selectedIds.value.length < 8 ? [...selectedIds.value, id] : selectedIds.value;
}
async function action(type: string, data: any = {}) {
  clearMessage();
  if (!socket?.connected) { errorMessage.value = 'Você está desconectado. Reconecte-se para continuar.'; return; }
  pending.value = true;
  try {
    const result = await new Promise<Ack>((resolve, reject) => {
      socket!.timeout(10000).emit('room:action', {action:type, data}, (err: Error | null, response: Ack) => {
        if (err) reject(new Error('A operação demorou demais. Tente novamente.'));
        else resolve(response);
      });
    });
    if (!result.ok) throw new Error(result.error || 'Operação inválida.');
    if (type === 'card:choose') selectedIds.value = [];
    if (type === 'round:next') roundOptions.value = false;
    if (type === 'possibility:add') possibilityInput.value = '';
  } catch(e) { fail(e); }
  finally { pending.value = false; }
}
function toggleMark(index: number, current: boolean) { if (!pending.value) action('card:mark', {index,marked:!current}); }
watch(() => room.value?.round, () => { selectedIds.value = []; roundOptions.value = false; });
watch(() => room.value?.phase, phase => { winnerModal.value = phase === 'finished'; });
onMounted(() => {
  timer = setInterval(() => now.value = Date.now(), 1000);
  const code = roomFromPath();
  if (code) {
    roomCodeInput.value = code;
    const token = authToken(code);
    if (token) loadRoom(code, token);
  }
  window.addEventListener('popstate', handlePopState);
});
function handlePopState() {
  const code = roomFromPath();
  if (!code) home();
  else {
    roomCodeInput.value=code;
    const token=authToken(code);
    if (token) loadRoom(code, token);
  }
}
onBeforeUnmount(() => { if (timer) clearInterval(timer); window.removeEventListener('popstate', handlePopState); socket?.disconnect(); });
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="wordmark" @click="home" aria-label="Voltar para início"><span class="wordmark-icon">✦</span> bingo<span class="wordmark-soft">de possibilidades</span></button>
      <div v-if="room" class="header-side"><span class="connection" :class="{offline: !isConnected}"><span class="status-dot"></span>{{isConnected ? 'Online' : 'Reconectando'}}</span><button class="small-link" @click="home">Sair da tela</button></div>
      <span v-else class="header-subtitle">Para jogar juntinhos, mesmo de longe.</span>
    </header>

    <main class="main-content">
      <div v-if="errorMessage" class="notice notice-error" role="alert"><span>{{errorMessage}}</span><button @click="errorMessage=''" aria-label="Fechar mensagem">×</button></div>
      <div v-if="successMessage" class="notice notice-good" role="status"><span>{{successMessage}}</span><button @click="successMessage=''" aria-label="Fechar mensagem">×</button></div>

      <section v-if="!room" class="landing">
        <div class="hero"><span class="eyebrow">UM JOGO FEITO DE EXPECTATIVAS</span><h1>Quem disse que o <em>inesperado</em> não dá bingo?</h1><p>Crie uma sala, invente possibilidades com seus amigos e marque quando cada uma acontecer. Simples assim!</p><div class="hero-doodles"><span>✿</span><span>✧</span><span>✿</span></div></div>
        <div class="surface entry-panel">
          <h2>Antes de começar…</h2><p class="muted">Como podemos chamar você?</p>
          <label class="field-label" for="nickname">Seu apelido</label><input id="nickname" v-model="name" maxlength="24" placeholder="Ex.: Fran" autocomplete="nickname" class="text-input" @keyup.enter="roomCodeInput ? joinRoom() : createRoom()"/>
          <label class="field-label">Escolha seu avatar</label>
          <div class="avatars" role="group" aria-label="Escolha um avatar"><button v-for="option in avatars" :key="option" class="avatar-option" :class="{active: avatar===option}" :aria-pressed="avatar===option" @click="avatar=option">{{option}}</button></div>
          <div class="entry-actions"><button class="btn btn-primary" :disabled="connecting" @click="createRoom">{{connecting ? 'Entrando…' : 'Criar minha sala'}} <span>↗</span></button><div class="separator"><span>ou entre na diversão</span></div><label class="field-label" for="room-code">Código da sala</label><div class="inline-form"><input id="room-code" v-model="roomCodeInput" class="text-input" maxlength="32" placeholder="MANGA-A1B2C3" @keyup.enter="joinRoom"/><button class="btn btn-secondary" :disabled="connecting" @click="joinRoom">Entrar</button></div></div>
        </div>
      </section>

      <template v-else>
        <section class="room-heading"><div><span class="eyebrow">SALA {{room.fruit}}</span><h1>{{room.phase === 'lobby' ? 'A diversão começa aqui.' : room.phase === 'preparing' ? 'Monte a sua cartela!' : room.phase === 'playing' ? 'Olho nas possibilidades!' : 'Temos um BINGO!'}}</h1><p class="muted">{{room.phase === 'lobby' ? 'Reúnam as melhores previsões para esta rodada.' : room.phase === 'preparing' ? 'Escolha suas frases e confirme quando estiver pronto.' : room.phase === 'playing' ? 'Toque nos quadrados quando cada situação acontecer.' : 'A rodada terminou, mas a diversão pode continuar.'}}</p></div><div class="room-code"><span>Código da sala</span><strong>{{room.code}}</strong><button class="copy-button" @click="copyInvite">Copiar convite ↗</button></div></section>
        <div class="dashboard">
          <div class="primary-column">
            <section v-if="room.phase === 'lobby'" class="surface panel">
              <div class="section-heading"><div class="section-icon pink">✦</div><div><h2>Possibilidades da sala</h2><p class="muted">Cada pessoa pode sugerir o que acha que vai acontecer.</p></div><span class="pill">{{room.possibilities.length}} frases</span></div>
              <form class="possibility-form" @submit.prevent="action('possibility:add',{text:possibilityInput})"><input v-model="possibilityInput" :maxlength="room.maxPhraseLength" class="text-input" placeholder="Ex.: alguém vai falar 'eu avisei'…" aria-label="Nova possibilidade"/><button :disabled="pending || !possibilityInput.trim()" class="btn btn-primary">Adicionar</button></form>
              <div v-if="!room.possibilities.length" class="empty-state"><span class="empty-illustration">✿</span><h3>Uma página em branco!</h3><p>Adicione a primeira possibilidade para começar.</p></div>
              <div v-else class="possibilities-list"><div v-for="(p,index) in room.possibilities" :key="p.id" class="possibility-line"><span class="item-index">{{String(index+1).padStart(2,'0')}}</span><span class="possibility-text">{{p.text}}</span><span class="byline">{{playerById(p.authorId)?.name}}</span><button v-if="p.authorId === room.myId" class="delete-btn" :disabled="pending" :aria-label="`Excluir ${p.text}`" @click="action('possibility:delete',{id:p.id})">×</button></div></div>
              <div class="panel-footer"><span class="muted">{{room.possibilities.length < 8 ? `Faltam ${8-room.possibilities.length} possibilidades para começar.` : 'Já temos possibilidades suficientes para começar!'}}</span><button class="btn btn-primary" :disabled="pending || room.possibilities.length<8" @click="action('round:prepare')">Preparar bingo →</button></div>
            </section>

            <section v-else-if="room.phase === 'preparing'" class="surface panel">
              <div class="section-heading"><div class="section-icon purple">▦</div><div><h2>Sua cartela</h2><p class="muted">{{inRound ? (card ? 'Sua seleção está salva. Agora confirme que está pronto.' : 'Selecione 8 possibilidades diferentes para jogar.') : 'A rodada já está sendo preparada. Você poderá jogar na próxima.'}}</p></div><span class="pill">{{room.readyCount}}/{{room.roundPlayers.length}} prontos</span></div>
              <template v-if="inRound">
                <div v-if="!card" class="select-list"><label v-for="p in room.possibilities" :key="p.id" class="select-option" :class="{chosen:selectedIds.includes(p.id)}"><input type="checkbox" :checked="selectedIds.includes(p.id)" :disabled="pending || (!selectedIds.includes(p.id) && selectedIds.length>=8)" @change="choose(p.id)"/><span>{{p.text}}</span></label></div>
                <div v-if="!card" class="panel-footer"><strong>{{selectedIds.length}}/8 selecionadas</strong><button class="btn btn-secondary" :disabled="pending || selectedIds.length!==8" @click="action('card:choose',{ids:selectedIds})">Salvar cartela</button></div>
                <div v-else class="confirmation-block"><div class="confirm-symbol">{{myReady ? '✓' : '✧'}}</div><h3>{{myReady ? 'Você está pronto!' : 'Sua cartela está montada!'}}</h3><p class="muted">{{myReady ? 'Aguarde a confirmação dos demais jogadores.' : 'Confira as oito possibilidades que estarão na sua cartela.'}}</p><div class="chosen-tags"><span v-for="(id,index) in card.slots.filter(Boolean)" :key="index">{{phraseById(id)}}</span></div><button v-if="!myReady" class="btn btn-primary" :disabled="pending" @click="action('player:ready')">Estou pronto ✓</button></div>
                <div class="panel-footer all-ready-footer"><span>{{room.allReady ? 'Todo mundo está pronto! Pode começar.' : 'O bingo só começa quando todos estiverem prontos.'}}</span><button class="btn btn-primary" :disabled="pending || !room.allReady" @click="action('round:start')">Iniciar bingo →</button></div>
              </template>
              <div v-else class="empty-state"><span class="empty-illustration">⏳</span><h3>Espere um pouquinho!</h3><p>Você entrou depois que a preparação começou. Aguarde a próxima rodada.</p></div>
            </section>

            <section v-else-if="room.phase === 'playing'" class="surface panel game-panel">
              <div class="section-heading"><div class="section-icon mint">✿</div><div><h2>Minha cartela</h2><p class="muted">{{inRound ? 'Marque cada acontecimento quando ele rolar.' : 'Você entrou depois do início. Aproveite para acompanhar!'}}</p></div><span class="pill">Rodada {{room.round}}</span></div>
              <template v-if="inRound && card"><div class="bingo-grid"><button v-for="(id,index) in card.slots" :key="index" class="bingo-cell" :class="{checked:card.marks[index],free:index===4}" :disabled="pending || index===4" @click="toggleMark(index,card.marks[index])"><span v-if="index===4" class="center-star">✦<strong>BINGO</strong><small>LIVRE</small></span><template v-else><span class="cell-phrase">{{phraseById(id)}}</span><span class="checkmark">{{card.marks[index] ? '✓' : '○'}}</span></template></button></div><div class="game-controls"><div><strong>{{markedCount}}/8 marcadas</strong><div class="progress-track"><div :style="{width:`${markedCount/8*100}%`}"></div></div></div><button class="btn btn-victory" :disabled="pending || !isBingo" @click="action('round:bingo')">BINGO! ★</button></div></template>
              <div v-else class="empty-state"><span class="empty-illustration">☕</span><h3>Você está acompanhando</h3><p>Espere esta partida terminar para participar da próxima.</p></div>
            </section>

            <section v-else class="surface panel result-panel"><div class="confetti">✿ &nbsp; ✦ &nbsp; ✿</div><span class="eyebrow">FIM DE RODADA</span><h2>Temos um vencedor!</h2><div class="winner-avatar">{{winner?.avatar ?? '🏆'}}</div><h3>{{winner?.name ?? 'Um participante'}}</h3><p class="muted">Foi quem anunciou BINGO primeiro. Que venha a próxima!</p><button class="btn btn-primary" @click="roundOptions = !roundOptions">Nova rodada →</button><div v-if="roundOptions" class="new-round-menu"><h3>O que fazer com as possibilidades?</h3><p class="muted">Qualquer participante pode escolher. A primeira escolha vale para a sala.</p><div class="new-round-actions"><button class="btn btn-secondary" :disabled="pending" @click="action('round:next',{keepPossibilities:true})">Manter as frases</button><button class="btn btn-primary" :disabled="pending" @click="action('round:next',{keepPossibilities:false})">Limpar as frases</button></div></div></section>
          </div>

          <aside class="sidebar"><section class="surface side-panel"><div class="sidebar-title"><h2>Quem está aqui?</h2><span class="pill">{{room.players.length}}</span></div><div class="player-list"><div v-for="p in sortedPlayers" :key="p.id" class="player-row"><span class="player-avatar">{{p.avatar}}</span><div class="player-info"><strong>{{p.name}} <span v-if="p.id === room.myId" class="you">(você)</span></strong><small v-if="room.phase==='preparing' && p.inRound">{{p.ready ? '✓ Pronto' : 'Preparando cartela…'}}</small><small v-else-if="room.phase!=='lobby' && !p.inRound">Próxima rodada</small><small v-else>{{p.online ? 'Online agora' : 'Desconectado'}}</small></div><span class="player-dot" :class="{inactive:!p.online}"></span><button v-if="canRemoveInactive(p)" class="remove-inactive" title="Retirar da rodada após 60s desconectado" :disabled="pending" @click="action('round:removeInactive',{playerId:p.id})">Retirar</button></div></div><div v-if="room.phase==='preparing'" class="ready-summary"><div class="ready-head"><span>Participantes prontos</span><strong>{{room.readyCount}} de {{room.roundPlayers.length}}</strong></div><div class="progress-track"><div :style="{width:`${room.roundPlayers.length ? room.readyCount/room.roundPlayers.length*100 : 0}%`}"></div></div><small>Todos precisam confirmar para iniciar.</small></div></section><section class="aside-tip"><span>✧</span><h3>Como funciona?</h3><p>Imagine situações engraçadas que podem acontecer. Quando alguma se realizar, marque na cartela. Com as 8 casas marcadas, anuncie BINGO!</p></section><p class="subtle-note">O jogo confia na honestidade dos participantes. Não existe sorteio de números.</p></aside>
        </div>
      </template>
    </main>
    <div v-if="room?.phase === 'finished' && winnerModal" class="modal-backdrop" role="presentation">
      <div class="winner-modal" role="dialog" aria-modal="true" aria-labelledby="victory-title">
        <div class="modal-sparkles">✧ ✿ ✧</div>
        <div class="winner-avatar">{{winner?.avatar ?? '🏆'}}</div>
        <span class="eyebrow">BINGO!</span>
        <h2 id="victory-title">{{winner?.name ?? 'Um participante'}} venceu!</h2>
        <p class="muted">A partida terminou. Volte à sala para escolher como será a próxima rodada.</p>
        <button class="btn btn-primary" @click="winnerModal=false">OK, voltar à sala →</button>
      </div>
    </div>
    <footer class="footer">Feito para transformar qualquer encontro em uma brincadeira ♡</footer>
  </div>
</template>
