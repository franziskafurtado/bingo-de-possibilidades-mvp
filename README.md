# Bingo de Possibilidades

Jogo de bingo multiplayer pela internet, sem contas, com salas por código de fruta, cartelas individuais e confirmação de todos os jogadores antes de iniciar.

## Rodar localmente (Node.js 22+ e Docker)

1. Copie `.env.example` para `.env`.
2. Suba o banco: `docker compose up -d db`
3. Instale as dependências: `npm install`
4. Rode frontend e API: `npm run dev`
5. Acesse **http://localhost:5173**. Compartilhe o link de uma sala com outro navegador ou dispositivo que tenha acesso ao servidor.

Se preferir subir tudo com Docker, execute `docker compose up --build -d` e acesse **http://localhost:3000**.

**Importante:** `localhost` só funciona no próprio computador. Para usar entre amigos fora da mesma rede, publique a aplicação em uma hospedagem acessível por HTTPS com suporte a WebSocket e PostgreSQL. Você pode colocar um proxy reverso (Caddy, Nginx etc.) na frente do container. O deploy público não está configurado nem realizado neste pacote.

## Verificações

- `npm run test`: testes das regras principais (sem banco).
- `npm run build`: verifica os tipos do frontend, cria os arquivos web e compila a API.

## Regras da versão inicial

1. Qualquer participante cria sala, entra sem cadastro ou adiciona possibilidades (até 90 caracteres).
2. Código único no padrão `MANGA-ABC123`. Até 10 salas ativas por padrão, com expiração após 48 horas sem atividade (`.env`).
3. Há **no mínimo 8 possibilidades** para começar. Qualquer jogador pode colocar a sala no estado de preparação.
4. A lista de jogadores da rodada é congelada no início da preparação. Quem entra depois aguarda a próxima.
5. Com exatamente 8 frases, a cartela é montada automaticamente. Com mais, cada pessoa escolhe 8 diferentes e confirma `Estou pronto`.
6. Qualquer participante da sala pode iniciar o bingo **somente quando todos os integrantes da rodada estiverem prontos**. O servidor valida isso em cada comando.
7. A cartela é 3×3, com BINGO livre no centro. Cada pessoa marca e desmarca suas 8 casas. O servidor confia nos eventos narrados, mas exige 8 marcas para aceitar BINGO.
8. O primeiro comando válido de vitória encerra a rodada para todos (transação PostgreSQL com bloqueio por sala).
9. O usuário recupera a cartela após reconexão usando um token de sessão guardado no navegador. Se perdeu o navegador/armazenamento, não será possível provar que a sessão anterior era sua.
10. Se alguém ficar desconectado **por pelo menos 60 segundos** e ainda não estiver pronto, qualquer jogador pode retirá-lo **apenas da rodada em preparação**. A pessoa permanece na sala e joga na próxima. Jogadores prontos não podem ser retirados por essa ação.
11. Na tela de resultado, qualquer participante decide se a nova rodada mantém ou limpa as frases. A primeira decisão enviada define o estado para todos.
12. No lobby, apenas o autor de uma possibilidade pode excluí-la; não é permitido excluir durante preparação e partida.
13. Apelidos podem coincidir, pois as identidades utilizam IDs próprios. Não há limite fixo de jogadores por sala (os limites práticos dependem do servidor).

## Arquitetura

- **web/**: Vue 3, TypeScript, Vite, Socket.IO Client, CSS responsivo e manifesto PWA (instalável na tela inicial quando hospedado em HTTPS).
- **server/**: Express, Socket.IO, regras de domínio testáveis e PostgreSQL (pg).
- Persistência: uma linha JSONB por sala, incluindo participantes, rodadas, frases e cartelas. Cada alteração de partida ocorre numa transação `SELECT ... FOR UPDATE` para impedir condições de corrida. Nenhum token de sessão é enviado a terceiros; apenas um hash é armazenado no banco.
- A comunicação com o servidor usa o próprio domínio: `/api` e `/socket.io`.

## Limitações conhecidas e próximos incrementos

- PWA instalável não significa bingo offline: o modo multiplayer exige conexão com o servidor.
- Sala aberta por código: quem recebe o link pode participar; não existe convite privado nem moderação. Evite inserir informações sensíveis nas frases.
- Dados da sala expiram após 48 horas sem ações, conforme configurado.
- O estado é persistido no PostgreSQL, mas o indicador de presença está em memória de um único processo. Para hospedar várias instâncias, é necessário adaptar presença e Socket.IO com Redis Adapter, além de considerar autorização e rate limiting.
- Não há validação externa de acontecimentos, proteção anti-spam/rate limiting, moderação, métricas nem testes end-to-end.
- Fontes do Google Fonts são opcionais e usam fallback local. Nenhum código ou dado do jogo é enviado às fontes, mas o navegador pode requisitar arquivos de fonte ao Google; remova o `@import` do CSS para utilização sem fontes externas.
