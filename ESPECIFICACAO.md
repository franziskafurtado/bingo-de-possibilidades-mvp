# Especificação funcional — Bingo de Possibilidades

**Versão:** MVP 0.1.0  
**Público:** amigos participando de uma sala pela internet.  
**Plataforma:** site responsivo/PWA instalável, sem contas. O multiplayer exige internet.

## Decisões aprovadas

| Tema | Regra |
|---|---|
| Quem adiciona frases? | Qualquer participante, antes da preparação. |
| Quem inicia? | Qualquer participante inicia a preparação; a partida só começa quando TODOS os jogadores da rodada confirmarem estar prontos. |
| Quantos jogadores? | Sem limite fixo por sala (sujeito à capacidade da hospedagem). |
| Verificação do BINGO | O jogador marca os próprios acontecimentos; o servidor exige oito quadrados marcados, sem verificar acontecimentos reais. |
| Próxima partida | Após cada BINGO, o primeiro participante a acionar "Nova rodada" escolhe manter ou limpar as possibilidades. |
| Reconexão | O mesmo navegador recupera identificação e cartela usando um token local. |
| Publicação | Acesso pela internet a um site compartilhado entre amigos. |

## Complementos definidos para o MVP

- A sala tem nome de fruta e código aleatório, por exemplo `MANGA-ABC123`.
- No máximo 10 salas simultâneas por padrão, ajustável por variável de ambiente; salas inativas podem expirar depois de 48 horas.
- Um apelido pode se repetir; o sistema utiliza identificadores individuais.
- Um jogador que chega após o início da preparação aguarda a próxima rodada.
- Ao iniciar a preparação, a lista de jogadores da rodada é congelada. Ela não muda durante o jogo.
- Oito possibilidades são o mínimo para preparar o jogo; as frases são ordenadas da mais recente para a mais antiga.
- Se houver exatamente oito possibilidades, a cartela é preenchida automaticamente; com mais de oito, cada jogador escolhe oito.
- A ordem dos quadrados é embaralhada individualmente por jogador.
- O quadrado central é livre e contém a palavra BINGO.
- Quem escreveu uma possibilidade pode excluí-la durante o lobby.
- Se um participante estiver offline há pelo menos 60 segundos e ainda não tiver confirmado a cartela, outra pessoa pode tirá-lo *daquela rodada*, sem apagar sua sessão ou histórico.
- O servidor impede vitórias simultâneas e aceita apenas o primeiro BINGO que satisfizer oito marcações.
- Após a vitória, aparece um modal para todos, seguido da tela da sala para decidir a próxima rodada.
- As interfaces usam cores pastel, cantos arredondados e layout adaptável a dispositivos móveis.

## Estados da sala

`lobby → preparing → playing → finished → lobby`

- `lobby`: cadastrar e remover frases, receber jogadores e iniciar preparação.
- `preparing`: selecionar cartela, confirmar pronto e aguardar unanimidade.
- `playing`: marcar quadrados, anunciar bingo e registrar vencedor.
- `finished`: notificar todos e escolher se mantém ou limpa as frases.

## Testes de aceitação prioritários

1. Não permitir preparar a rodada com menos de oito frases.
2. Permitir cartela automática com oito frases e seleção manual de oito entre nove ou mais.
3. Impedir início enquanto pelo menos uma pessoa da rodada não estiver pronta.
4. Garantir que a pessoa que entrou depois da preparação não bloqueie o início.
5. Impedir BINGO com menos de oito casas marcadas.
6. Definir um único vencedor se duas pessoas tentarem anunciar ao mesmo tempo.
7. Recuperar uma cartela após atualizar a página sem modificar as marcações.
8. Impedir retirada de jogador online ou já confirmado como pronto.
9. Manter ou limpar as frases na transição para a rodada seguinte.

## Infraestrutura e observações

Frontend Vue 3 + TypeScript; API Express + Socket.IO; PostgreSQL. A persistência da versão inicial usa JSONB por sala e transações com bloqueio de linha para preservar a consistência. Para uso público e em larga escala, são melhorias recomendadas: limite de requisições, moderação, gestão de retenção de dados, observabilidade e adaptador distribuído do Socket.IO.
