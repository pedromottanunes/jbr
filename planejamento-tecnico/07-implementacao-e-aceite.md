# Sequência de implementação e critérios de aceite

## Entregas em ordem

| Etapa | Trabalho | Condição para avançar |
| --- | --- | --- |
| 1 — Fundação local | Workspaces, runtime, banco, scripts, env validado, CI e imagem Docker. | Build em checkout isolado; local sobe sem credenciais e sem rede de provedores. |
| 2 — Sessão e estrutura visual | Login, permissões, navegação, tokens JBR e telas vazias limpas. | Rotas protegidas, teclado/mobile e nenhuma função de envio WhatsApp. |
| 3 — Modelo e histórico | Migrations, identidade, contatos/conversas e importador com dry-run. | Importar duas vezes mantém contagens e IDs; origem SQLite intacta. |
| 4 — Coordenação de coleta | Jobs, outbox, lease, budgets, tentativas e observabilidade. | Cenários de concorrência e queda passam antes de habilitar coleta real. |
| 5 — Umbler leitura | Descoberta, mensagens, checkpoint, reconciliação e cobertura. | Amostra autorizada confere com a origem; allowlist bloqueia mutações. |
| 6 — Google Ads leitura | OAuth, refresh, consultas por dimensão e publicação de partições. | Totais conferidos por conta/data/fuso/ação; falha parcial preserva geração válida. |
| 7 — Operação comercial | Leads, oportunidades, responsável, evidências e resultados internos. | Campos internos sobrevivem à sincronização e alterações têm auditoria. |
| 8 — Painéis e relatórios | Totais, detalhes, filtros, exportações e regras compartilhadas. | Sem mistura de coortes, origens ou receita inferida; desempenho aferido. |
| 9 — Preparação de produção | Blueprint validado, MFA administrativo, restore, migration e runbook. | Teste local da imagem e ensaio em ambiente isolado; pacote pronto para publicação futura. |

Rastreamento da landing, conversões offline e alterações nos outros projetos ficam fora dessa implementação inicial. O CRM pode registrar origem indicada sem alegar campanha comprovada. Relatórios e telas históricas não autorizam criar ligação retroativa inexistente.

## Testes obrigatórios de duplicidade e falha

| Cenário | Resultado esperado |
| --- | --- |
| Dez pedidos simultâneos do mesmo recorte | Um trabalho lógico ativo; respostas apontam para o mesmo trabalho. |
| Períodos Google sobrepostos | Partições comuns consolidadas; um recurso de integração ativo por vez. |
| Dois workers iniciando juntos | Só o proprietário da lease consulta o recurso; outro espera/reprograma. |
| Queda antes do commit da página | Cursor não avança; repetição recupera dados sem perda. |
| Queda após commit e antes do ack | Reentrega encontra checkpoint; nenhuma duplicata lógica. |
| Lease expira com processo antigo vivo | Geração antiga não pode gravar ou iniciar nova chamada. |
| Mensagem repetida/editada/tardia | Mesma chave mantém um registro; atualização/reconciliação preserva a mudança. |
| Dois jobs criam a mesma identidade externa | Um contato associado, sem contatos órfãos. |
| Dois contatos distintos compartilham telefone | Revisão de identidade; não fundir automaticamente. |
| 429 seguido de restart | Cooldown persiste; nova instância não fura a espera. |
| 401 simultâneo e reconexão durante refresh | Uma renovação coordenada; versão antiga não sobrescreve nova autorização. |
| Tentativas em várias camadas | Orçamento total não multiplica com reentregas da fila. |
| Ads retorna metade dos blocos e falha | Recorte válido anterior permanece ativo com cobertura desatualizada. |
| Ads completo retorna zero ou remove uma linha | Nova partição completa substitui a anterior, sem deixar linhas fantasmas. |
| Página Umbler repete cursor ou concentra timestamps | Tarefa interrompe com cobertura parcial, sem loop e sem declarar completude. |

Usar PostgreSQL real isolado para testes de constraints, outbox e concorrência. Mocks de HTTP controlam falhas, atrasos, ordem e payloads. Não testar essas situações sobre contas do cliente.

## Testes de segurança e interface

- Tentativas de POST/PATCH/DELETE de chats no Umbler são rejeitadas antes da rede; não existe conector de envio.
- Navegação, filtro, refetch e React StrictMode não criam coleta externa.
- Acesso por ID de outra organização/carteira falha também em histórico, busca, exportação e cache.
- Logout, usuário bloqueado e redução de permissão removem acesso com sessão aberta.
- OAuth rejeita state expirado, repetido, sessão diferente e redirect não cadastrado.
- Tokens não aparecem em bundle, erro, logs, endpoint de status ou arquivos staged.
- Texto/HTML malicioso de mensagem é exibido com segurança; mídia não pode alcançar rede interna.
- Idempotency-Key com corpo diferente retorna conflito; edição concorrente de lead não sobrescreve silenciosamente.
- Cache mantém a separação de usuários/organizações e mostra revisão atual após edição.
- Conversa não marca leitura no provedor; não aparece nenhum controle de envio.
- Frontend atende aos critérios visuais definidos no documento de interface, sem subtítulos explicativos de rotina.

## Metas iniciais de desempenho

Perfil de carga proposto: 20 sessões internas simultâneas, base de teste com 10 mil contatos e 100 mil mensagens, além de dimensões Ads de um ano. São parâmetros de teste, não volume real declarado do cliente.

Medir p95 de listagens paginadas abaixo de 500 ms e de painel abaixo de 1 segundo em ambiente de referência documentado. Primeira tela útil abaixo de 2 segundos em rede de teste definida. Aferir chamadas externas, queries por rota, pool, backlog, memória e CPU; não aprovar apenas pela sensação de velocidade.

Metas não são garantias de produção antes de escolher o plano e executar benchmark. Se houver saturação, reduzir cadência/lotes e otimizar consultas antes de aumentar instâncias e conexões.

## Observabilidade e operação

Métricas mínimas: requisições por provedor e status, tentativas por unidade, orçamento restante, jobs ativos/pendentes, idade do job mais antigo, idade da última cobertura válida, conflitos de lease, tempo de query e conexões em uso. Logs com requestId/jobId, sem conteúdo pessoal.

Alertas operacionais: worker sem heartbeat, coleta sem avanço, autorização expirada, orçamento esgotado, taxa de erro sustentada, disco/banco perto do limite e falha de backup. Estado resumido aparece em Configurações; alertas só ocupam a área operacional quando comprometem o dado exibido. Destino externo de notificações será configurado depois, sem enviar mensagens por esta etapa.

## Definição de pronto

Uma entrega local está pronta quando instala e inicia conforme README, passa nos testes aplicáveis, não depende das pastas irmãs, preserva dados em restart e funciona sem integrações habilitadas. Não basta gerar HTML ou mostrar métricas estáticas.

Uma entrega preparada para Render inclui Dockerfile, Blueprint, migrations, configuração de secrets, healthchecks, política de shutdown, CI e procedimento de restore/rollback verificados. “Preparado para deploy” não significa “publicado”.

## Pendências para piloto

Confirmar canais/números ativos, conta Ads/MCC e suas quotas, usuários e carteiras, etapas comerciais e receita, retenção, domínio e orçamento do Render. A fundação local pode avançar sem essas respostas. Integrações reais exigem configuração explícita de escopo e credenciais, sem copiá-las para chat ou documentação.
