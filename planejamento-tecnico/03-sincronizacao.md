# Sincronização sem duplicidade de resultados

## Responsabilidade única pela coleta

Somente o worker chama os endpoints de dados dos provedores. Todas as chamadas passam por um transporte comum que valida destino, método, limites, timeout e orçamento. A API web pode executar apenas operações administrativas de autenticação explicitamente autorizadas; não coleta dados ao abrir telas.

O conector Umbler expõe operações de domínio de leitura, não um método HTTP arbitrário. Allowlist inicial: GET de membro atual, canais, etiquetas, chats e mensagens relativas. O conector Google permite Search/SearchStream e a infraestrutura OAuth necessária. POST de SearchStream é consulta; qualquer endpoint de mutate ou envio de conversão permanece bloqueado.

## Quatro controles complementares

| Controle | Chave e efeito |
| --- | --- |
| Pedido HTTP repetido | `Idempotency-Key`, usuário, rota e hash do corpo. A mesma chave devolve o mesmo pedido; corpo diferente resulta em 409. |
| Trabalho equivalente | Chave canônica por ambiente, organização, provedor, conta, tarefa e partição. Um trabalho ativo por chave. Datas sobrepostas são divididas em partições equivalentes. |
| Execução simultânea | Lease no PostgreSQL por recurso de integração e por trabalho, com proprietário e número de geração. Um processo ativo por recurso no primeiro escopo. |
| Persistência repetida | Constraints únicas das entidades e upsert condicional. Reprocessar a página não cria novas mensagens, contatos ou métricas. |

Desabilitar um botão não basta. A chave única e a aquisição atômica no servidor devem funcionar mesmo com duas abas, dois administradores ou substituição de worker durante deploy.

## Ciclo do pedido e da fila

1. API ou scheduler normaliza escopo, datas e dimensões. Google é particionado por conta, dimensão e dia; Umbler usa descoberta por organização e leitura por conversa/cursor.
2. Em transação curta, cria ou recupera trabalho lógico ativo e registra evento na outbox. Outbox é a tabela de publicação pendente, gravada junto com o pedido para evitar pedido salvo sem tarefa publicada.
3. O dispatcher publica no pg-boss e marca a outbox. Se cair entre publicar e marcar, pode publicar de novo; ambas as entregas apontam para o mesmo trabalho lógico.
4. O consumidor consulta o trabalho. Se concluído, retorna sem chamada externa. Se outro proprietário tem lease válida, não executa. A fila não substitui essa verificação.
5. Com lease e orçamento válidos, consulta uma página ou partição limitada. Não mantém transação SQL aberta enquanto espera a rede.
6. Valida resposta, normaliza e grava dados, checkpoint e progresso em uma transação, verificando novamente a geração e validade da lease.
7. Confirma a entrega da fila somente após o commit. Uma queda após commit repete a entrega, mas o checkpoint ou estado concluído impede nova gravação lógica.
8. Se houver mais páginas, publica continuação com o cursor confirmado. Libera o recurso entre lotes para permitir justiça entre conversas e contas.

Estados do trabalho: `queued`, `running`, `retry_wait`, `succeeded`, `partial`, `failed`, `cancelled`. Entregas da fila e tentativas HTTP têm contadores próprios. `partial` preserva recortes válidos; não é sinônimo de sucesso completo.

O índice parcial único de trabalhos ativos inclui queued/running/retry_wait. Depois de concluído, o mesmo recorte pode ser atualizado novamente quando sua cobertura estiver vencida. Consultar frescor antes de iniciar evita reconsulta imediata após cliques repetidos. Um forçar atualização administrativo deve respeitar intervalo mínimo e orçamento.

## Leases e retomada

Tabela `integration_leases`: chave do recurso, owner, generation, expires_at e heartbeat_at. Aquisição e renovação usam hora do banco, atualização condicional e transações curtas. Parâmetros iniciais: validade de 90 segundos, renovação a cada 20 segundos e chamada com timeout de 20 segundos; lote de trabalho de até 60 segundos antes de checkpoint/continuação.

Antes de cada chamada, verificar que a lease ainda pertence ao processo e há tempo suficiente para a chamada. Se perder a lease ou a conexão com o banco, não iniciar novas chamadas. Tentar cancelar a requisição pendente; ignorar resposta de geração antiga. O commit exige owner/generation válidos, impedindo o processo antigo de sobrescrever trabalho novo.

Heartbeat e aquisição usam o mesmo orçamento de conexões definido para o worker. Travas de tarefas de curta duração não seguram conexões exclusivamente durante a rede. Rotinas que adquiram mais de um recurso seguem ordem canônica para evitar deadlock.

Mesmo com geração, não se promete impedir uma requisição que já saiu para a rede antes de uma queda. As leases evitam concorrência ordinária e o fencing impede commits de processos vencidos; a persistência idempotente trata as reexecuções. A fila é usada assumindo que tarefas podem ser entregues novamente.

## Escopo dos limites

- Umbler: uma requisição em voo por credencial/organização no primeiro escopo, cadência mínima inicial de 3 segundos entre tentativas.
- Google: uma requisição de dados em voo por conexão/developer token administrado pelo CRM; compartilhar o orçamento entre contas abaixo do mesmo token. Renovação OAuth usa trava própria, também coordenada.
- Persistir `next_allowed_at`, cooldown e contadores de consumo para que reiniciar o processo não apague a espera.
- Quotas compartilhadas com outros aplicativos não são controladas pelo CRM. Separar credenciais quando adequado e reservar margem; não executar o coletor antigo em paralelo no mesmo recurso.
- Bancos local e produção não compartilham trava. Na transição para o Render, desligar a coleta local antes de ligar a remota. Ambientes de preview/CI sempre usam conectores desativados.

A especificação pública Umbler consultada em 21/11/2026 informa até 100 requisições por janela de 5 segundos nas cinco rotas de leitura verificadas. A cadência local de 3 segundos é uma escolha inicial conservadora, não esse limite oficial. [OpenAPI Umbler](https://app-utalk.umbler.com/api/docs/v1/docs.json).

Os limites Google dependem do tipo de operação e do acesso do developer token; o orçamento real deve ser configurado após conferir a conta. Não aplicar um número genérico como quota garantida. [Quotas oficiais Google Ads](https://developers.google.com/google-ads/api/docs/best-practices/quotas).

## Tentativas, erros e circuit breaker

O transporte é o único dono das tentativas HTTP. Persistir um limite inicial de quatro tentativas por unidade página/consulta, incluindo repetição após 401. Reentrega do job não reinicia esse contador. Evitar multiplicar retries do SDK, transporte, fila e navegador.

| Evento | Ação |
| --- | --- |
| 429 | Respeitar Retry-After, reduzir ritmo e reprogramar; nunca girar em loop. |
| Timeout, desconexão, 5xx transitório | Repetir com espera exponencial e variação, dentro do orçamento. Resultado anterior pode ser desconhecido; tratar como leitura repetível. |
| 401 Google | Uma renovação coordenada e no máximo uma repetição; persistência condicionada à versão da autorização. |
| 401 Umbler ou 403 | Parar o escopo e solicitar correção de autorização no painel administrativo. |
| 400/consulta incompatível | Não repetir a mesma consulta; registrar dimensão inválida. |
| Resposta fora do schema/página repetida/cursor parado | Interromper a partição sem avançar cursor. |
| Falhas transitórias persistentes | Após cinco unidades com falha consecutiva, abrir circuito por cinco minutos; uma tentativa de sondagem ao reabrir. |

Espera longa é `run_after` na fila; não ocupa worker ou conexão SQL. Um Retry-After maior que a pausa padrão prevalece. Orçamento diário esgotado suspende jobs elegíveis até reposição; coleta histórica cede prioridade à incremental.

## Agenda inicial configurável

| Trabalho | Frequência proposta | Estratégia |
| --- | --- | --- |
| Descobrir chats e atualizar lista | A cada 2 minutos | Uma rodada por organização; não sobrepor rodada em andamento. |
| Mensagens de chats recentes/abertos | A cada 2 minutos elegíveis | Rodízio entre chats, limites por rodada e checkpoint. |
| Canais e etiquetas | A cada 6 horas | Cache de catálogo e atualização explícita controlada. |
| Reconciliação de chats encerrados/recentes | Diária | Releitura progressiva, prioridade dos últimos 7 dias; histórico mais antigo em rodízio. |
| Ads hoje e ontem | A cada 60 minutos | Partições por dia e dimensão; dados do dia continuam parciais. |
| Ads últimos 30 dias | Diária | Reprocessar ajustes de atribuição. |
| Ads janela adicional | Semanal | Até 90 dias inicialmente, ajustável à janela real de conversão/ajuste da conta. |
| Importação histórica | Manual e de baixa prioridade | Intervalo definido, orçamento e capacidade de retomar. |

Frequência de elegibilidade não é promessa de atualização. Com 33 canais históricos e muitos chats, uma rodada pode ultrapassar dois minutos. Medir backlog e idade do dado; não iniciar cópias para “compensar” atraso. Agendas não consultam automaticamente todos os chats completos a cada ciclo.

## Particularidades da persistência

Umbler: chave estável de mensagem, cursor com sobreposição, detecção de página repetida e transação página/checkpoint. Páginas inteiras com mesmo timestamp e ausência de desempate devem produzir cobertura parcial, não loop nem descarte silencioso. Reconciliar edições e atrasos; ausência em página parcial não prova exclusão.

Google: receber a partição completa em staging, validar os blocos e trocar a geração ativa numa transação curta. Só então remover/aposentar linhas antigas ausentes naquela partição. Resposta parcial nunca substitui a geração válida por zero. Uma resposta completa vazia pode representar zero; registrar cobertura validada. Não somar dimensões diferentes nos totais.

OAuth: single-flight local para reduzir chamadas e lease no banco para coordenar processos. Gravar tokens somente se a versão da autorização ainda corresponder à que iniciou o refresh. Reconexão incrementa essa versão; resposta antiga não a sobrescreve.
