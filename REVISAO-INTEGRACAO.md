# Revisão da integração — 24/11/2026

Revisão do fluxo React → Fastify → MongoDB Atlas e do worker de leitura Google Ads/Umbler. Foram corrigidos os problemas abaixo e executados testes com fixtures isoladas e comparação com o histórico real. Não houve envio de mensagens, alteração de campanhas ou publicação no Render.

## Correções

| Área | Problema identificado | Comportamento revisado |
| --- | --- | --- |
| Frontend | Polling do Google repetia POST de sincronização a cada quatro segundos | Um pedido por período; acompanhamento por GET a cada cinco segundos e nova tentativa explícita em caso de falha |
| Fila | Período maior solicitado durante uma coleta podia ser descartado; cooldown podia devolver uma conclusão antiga | Períodos são combinados; expansão em andamento fica pendente para o próximo lote. A espera permanece visível como tarefa enfileirada |
| Atendimento | Relatório completo era atualizado a cada 30 segundos sem mudança no histórico | Polling leve do estado da coleta; relatório invalidado na conclusão identificada por data/revisão |
| Busca | Adiar renderização não impedia chamadas a cada tecla | Debounce de 300 ms, cancelamento de GET e prazo de requisição |
| API | Status/orçamento carregavam todas as dimensões Google; indicadores carregavam também histórico individual dos atendentes | Status lê metadados, orçamento lê somente séries diárias e atendentes são carregados separadamente |
| Cache | Mesmos cálculos de funil/horário repetidos | Cache por revisão, período e configuração, com até 12 resultados por área; carregamentos concorrentes compartilham a mesma Promise |
| Umbler | Renovação da trava e gravação por mensagem geravam muitas viagens ao banco | Página, eventos, cobertura e cursor gravados em lote, numa transação com verificação da posse |
| Publicação | Qualquer atualização regravava todas as coleções publicadas | Hash por coleção; dados inalterados são reutilizados. Ponteiro troca somente após validação e transação |
| Recuperação | Estágios de publicação interrompidos podiam ficar acumulados | Limpeza de gerações explicitamente identificadas, sem referência ativa/anterior, após 24 horas, durante novas publicações |
| Google | Falha em um relatório podia publicar a dimensão como vazia | Falha interrompe a publicação e preserva a fotografia completa anterior. Identidade da conta é validada |
| Memória | Histórico bruto era carregado com campos desnecessários e convertido repetidamente entre objetos e JSON | Projeção de campos no MongoDB e reutilização dos objetos BSON; anexos/envelopes completos continuam apenas na camada bruta |
| Worker | Reinício aguardava um lote longo, com risco de encerramento forçado no deploy | Cancelamento de chamadas/esperas, interrupção antes da publicação, reentrada na fila e reaproveitamento dos cursores confirmados |
| Recursos | Esperas de conexão/socket e execução de consultas não estavam uniformes | Pool máximo padrão de 8 por processo, criação concorrente limitada a 2, conexões ociosas liberadas após 60 s, socket de 20 s e consultas pesadas com máximo de 15 s |

A API não chama provedores para servir painéis. O worker mantém as travas globais e por integração; períodos e solicitações de orçamento não abrem um novo coletor por aba. A agenda é examinada no máximo uma vez por minuto e o worker ocioso consulta a fila a cada cinco segundos, com recuo em falhas de conexão. `INTEGRATIONS_ENABLED=false` também bloqueia novos pedidos pelas rotas.

As novas publicações usam gerações independentes por coleção. Leitores também entendem o formato anterior, o que permitiu a transição preservando os dados. A geração atual e a anterior de cada coleção são mantidas; isso não substitui backup. A primeira transição exige escrita maior, mas repetir a publicação sem mudanças não regrava os documentos.

## Evidências

- `npm run check`: 60 testes TypeScript aprovados, incluindo transporte serial, cancelamento, limite de resposta, união de períodos, carregamento único e integridade dos relatórios.
- `npm run mongo:verify`: testes no Atlas com coleções temporárias e fixtures. Incluem oito concorrentes, revisão de configuração, lease vencida, rollback da página e cursor, fila única, expansão de período, interrupção durante leitura e retomada sem duplicação.
- Comparação de 14 respostas HTTP antes/depois: equivalentes; tolerância de 1e-9 somente para diferenças de soma de números fracionários. Comparação repetida após publicar o novo formato no Atlas.
- Histórico preservado: 6.278 contatos, 7.425 conversas e 33.709 mensagens. Hashes das cinco coleções publicadas coincidem entre a leitura completa anterior e as novas projeções.
- Build de frontend, API e worker concluído. Frontend compilado servido pela API em loopback: página inicial, rotas internas, asset JavaScript, readiness e 404 de API conferidos.
- Oito consultas simultâneas de atendimento retornaram o mesmo resultado. Esse ensaio funcional pequeno não representa teste de capacidade de produção.
- `npm audit --omit=dev`: nenhuma vulnerabilidade reportada nas dependências de produção na execução desta revisão.
- Backup Atlas realizado antes da transição; snapshots e relatórios privados permanecem em `local-data/`, fora do Git.

### Medições locais

Na base atual, o processamento anterior atingiu aproximadamente 567 MiB de RSS observado; o ensaio revisado de leitura/normalização/publicação repetida atingiu aproximadamente 268 MiB. A reconstrução com projeções também passou sob limite de heap de 256 MiB, com pico de RSS entre 284 e 289 MiB. Os ensaios incluem fases distintas e variação do coletor de lixo: não representam teto garantido para novos volumes de dados.

A API compilada atingiu pico de aproximadamente 277 MiB após carregar as áreas. Leituras frias do funil e atendentes levaram cerca de 1,3–1,6 s; listagens ficaram em torno de 36–63 ms nesse ensaio local. Rede, histórico, filtros e infraestrutura alteram esses tempos. O endpoint legado `/ads` ainda retorna o relatório completo (~7 MB nesta fotografia); a tela atual usa `/ads/detail` e não faz polling desse endpoint legado.

Após a transição e retenção da versão anterior, dados e índices mediram aproximadamente 228,4 MiB na auditoria final. O Free precisa de acompanhamento de armazenamento; o histórico bruto cresce com novas conversas. A consulta de status não executa `dbStats` continuamente.

## Render: preparação e pendências reais

Runtime fixado à linha Node 22 (`>=22.18.0 <23`) em `package.json`. Build: `npm ci && npm run check && npm run build`. Web Service: `npm start`. Background Worker: `npm run start:worker`. Ambos devem usar o mesmo commit, banco e chave de criptografia. O build do worker usa somente Node; não depende do coletor PowerShell/SQLite para operar em modo Mongo.

O encerramento tem prazo interno de 25 s, com retomada da tarefa por fila/lease se necessário. O Render documenta SIGTERM seguido de SIGKILL após o prazo configurado, cujo padrão é 30 s. O cancelamento foi testado no código e em fixtures; o ciclo real de deploy Linux ainda deve ser ensaiado no Render. [Documentação de deploy e shutdown](https://render.com/docs/deploys#graceful-shutdown).

O pool e os prazos foram conferidos com o driver instalado. Na versão 7.9.1, `timeoutMS` está depreciado e não tem efeito; usamos socket, seleção, fila de conexões e `maxTimeMS` nas consultas. [Opções oficiais do driver](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/).

Antes de liberar o CRM na internet, ainda são necessários:

1. Autenticação, sessões e autorização de acesso. O bloqueio de dados reais em produção/fora de loopback foi mantido deliberadamente.
2. Definir domínio, origem HTTPS, proxy confiável, secrets do Render e IPs de saída permitidos no Atlas.
3. Ensaiar restauração em banco isolado e definir backup com cópia externa/retensão. O backup atual foi gerado; restauração completa ainda não foi ensaiada.
4. Validar em Linux o deploy dos dois serviços, retomada de coleta, recursos de memória/CPU e limites do Atlas com a carga esperada.
5. Desligar o coletor local antes de transferir a operação. Não ativar schedulers de desenvolvimento e produção contra o mesmo provedor em bancos independentes.

Não foi criado `render.yaml` que publique dados reais sem autenticação. O ambiente local permanece com a agenda automática desligada. A revisão melhora coordenação e consumo observados; não promete carga ilimitada ou ausência absoluta de falhas externas.


## Otimização incremental — 27/11/2026

- Umbler: máximo de 24 chamadas por lote, janela de 60 segundos para iniciar chamadas, até cinco páginas de descoberta por lote e retomada transacional dos cursores. Uma chamada em andamento e a publicação podem ultrapassar essa janela. A fila escolhe a tarefa disponível há mais tempo; a continuação Umbler espera 60 segundos, sem a pausa fixa de 15 minutos a cada seis lotes.
- Quando a agenda está habilitada, a descoberta automática cobre sete dias. Períodos históricos continuam sendo coletados por demanda; selecionar datas já cobertas reutiliza os eventos analisados.
- A primeira mensagem recebe a versão do catálogo CTA. Ao mudar o catálogo, resultados desconhecidos ou removidos são rechecados apenas pela primeira mensagem; correspondências ainda válidas e eventos de atendimento já cobertos são reaproveitados. O conteúdo continua sendo descartado por padrão.
- Progresso e cobertura são lidos para os candidatos do período. Eliminada a agregação redundante de toda a cobertura. Avaliações agora paginam com cursor persistido e retomada, em vez de parar em 50 registros.
- Mudanças analíticas são marcadas na mesma transação das páginas e cursores. Durante coletas parciais, reconstruções são espaçadas em três minutos; ao concluir o período, a publicação é obrigatória. Lotes sem mudanças atualizam somente os metadados. Falhas preservam a publicação anterior e o marcador de trabalho pendente.
- A interface invalida os dados pela publicação efetiva, não por cada checkpoint. A consulta de progresso Umbler fica ativa somente nas áreas que usam a análise.
- No backend, atualizações de Google e orçamento preservam o cache de atendimento. Publicações que alteram somente o status também reutilizam as coleções analíticas; mudanças de geração continuam recarregando os dados necessários. A recuperação de uma tarefa interrompida preserva a data da publicação efetiva.
- Google: coletas frequentes reconciliam sete dias; diariamente, 90 dias; semanalmente, todo o histórico retido. Datas ausentes sempre entram no plano e a atualização manual inclui o intervalo solicitado. Conversões de datas antigas podem, portanto, ser incorporadas na reconciliação diária/semanal; esse é o compromisso de atualização adotado.
- Meta: uma leitura de dias por conta/período durante cada execução, atualizada em memória após a confirmação das gravações. Índices são preparados uma vez por contexto de conexão. Além do limite do aplicativo, são observados os cabeçalhos de limite de Insights e conta.
- Timeouts e falhas transitórias de rede voltam à fila com espera e limite de tentativas; autenticação, permissão e erros de formato não são repetidos automaticamente por essa regra.

A vigência do expediente de sábado e as variáveis que habilitam a agenda permanecem configuráveis e não foram alteradas. Não houve exclusão de dados reais nem migração destrutiva. As duas representações dos metadados de mensagens ainda existem; esta etapa reduz frequência de reconstrução e tráfego, não promete eliminar os ~30 MiB dessas coleções.

Validação: 123 testes aprovados em 31 arquivos, verificação TypeScript, build de frontend/API/worker e `npm run attendance:verify` em coleções temporárias isoladas no Atlas, com respostas de provedor simuladas. O ensaio verifica períodos sobrepostos, retomada sem reler histórico, chegada de nova resposta, reclassificação CTA somente pela primeira mensagem, paginação de 51 avaliações e ausência de conteúdo armazenado. Não representa medição de latência de produção após deploy.

## Revisão entre camadas — 27/11/2026

Revisão posterior da otimização incremental, abrangendo interface, rotas Fastify, filas, worker e persistência. As seções de 24/11 são registros históricos; a autenticação já está implementada e foi validada nesta revisão.

### Ajustes encontrados na revisão

- Falhas definitivas de credencial ou permissão agora bloqueiam o reagendamento automático da integração. Navegação e agenda não reiniciam essas tentativas. Após corrigir a configuração, a atualização manual permite retomar, preservando a espera determinada pelo provedor e os dados já publicados. A regra vale para Google, Meta, Umbler e a fila de orçamento.
- Erros transitórios do OAuth Google também entram na política limitada de tentativas. O tempo solicitado em `retryAfterMs` é respeitado, inclusive quando o erro vem da camada de tokens.
- Ao sair das telas de atendimento, dados de progresso que permanecem no cache do navegador não provocam invalidações de status e relatórios de atendentes.
- A preparação do índice de expiração dos snapshots Meta foi incluída na inicialização compartilhada por conexão; não se repete a cada coleta.

### Validações concluídas

- `npm run check`: 131 testes em 32 arquivos aprovados, com verificação de tipos. Inclui recuperação manual após bloqueio automático das quatro integrações e espera de OAuth.
- `npm run build`: frontend, servidor e worker compilados.
- `npm run verify:layout`: nove rotas de páginas, arquivos estáticos, respostas JSON e fallback de API verificados após o build.
- `npm run mongo:verify`: cenários isolados no Atlas de concorrência, transações, fila, perda de posse, interrupção e retomada.
- `npm run privacy:verify`: retenção desabilitada por padrão, alteração explícita, limpeza retomável e preservação dos indicadores sem conteúdo.
- `npm run render:verify`: execução **local** com a configuração do Render e o Atlas real. Login, proteção de rotas, credenciais armazenadas, logout e retenção desabilitada conferidos. Google, Meta, funil, atendimento e atendentes devolveram o mesmo período solicitado. Chamadas HTTP externas foram bloqueadas durante o ensaio; as consultas funcionaram somente com dados do banco.

Não houve push nem deploy nesta revisão. O ciclo de reinício Linux e a latência sob carga no Render precisam ser observados após publicar esta versão. A verificação de rotas não substitui inspeção visual no navegador. Não houve limpeza adicional das coleções reais nem alteração das regras de expediente ou das credenciais.
