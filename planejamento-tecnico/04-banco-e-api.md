# Banco de dados e API interna

## Modelo físico proposto

IDs internos UUID; IDs de provedores como texto; instantes em `timestamptz`; data de métrica em `date` e fuso da conta em campo próprio. Dinheiro comercial em `numeric(18,2)` com moeda; custo Google preservado em `bigint` micros; conversões em `numeric(20,6)` e payload bruto preserva a precisão original. Valores decimais e IDs grandes trafegam como strings quando necessário para evitar perda de precisão em JavaScript.

| Tabelas | Identidade e invariantes |
| --- | --- |
| organizations, users, memberships | Email normalizado único; membership por usuário/organização; organização ativa vem da sessão, não de confiança no body. |
| sessions, oauth_states | Hash de token de sessão único; estado OAuth de uso único, validade e usuário/sessão vinculados. |
| integration_connections, encrypted_credentials | Provedor/organização/conta/ambiente; versão de autorização e status. Tokens separados dos DTOs de leitura. |
| channels | Única por organização, conexão e ID externo. |
| contacts | ID estável, nome, classificação e datas observadas; telefone sozinho não é chave de pessoa. |
| contact_identities | Única por organização, conexão e ID de contato externo. Um contato pode ter várias identidades. |
| contact_phones | Número original, normalizado quando válido, país conhecido e vínculo. Permitir compartilhamento e registrar conflito. |
| conversations | Única por organização, conexão e ID externo de chat. FK de contato e canal; estado externo separado de estado comercial interno. |
| messages | Única por organização, conexão, conversa e ID externo. Autor, tipo, instante, texto, hash do conteúdo, editado/excluído quando confirmado. |
| message_attachments | Referência e metadados mínimos; bytes fora do Postgres. Conteúdo indisponível tem estado próprio. |
| opportunities, stage_history | Contato, serviço, responsável, estágio e versão de concorrência; todo avanço/recuo auditável. |
| commercial_events | Evento de venda/recebimento/estorno com chave de origem ou chave idempotente interna. Orçamento não preenche receita. |
| cta_versions, attribution_evidence | Catálogo com vigência e evidência versionada por mensagem/visita/regra; preservar override humano. |
| visits, whatsapp_exits | Etapa posterior: chave aleatória de saída única, sem telefone na URL; identificadores publicitários separados. |
| ads_accounts, ads_campaigns, ads_entities | Chaves por conexão, conta e ID externo; renomear campanha não cria entidade nova. |
| ads_daily_totals | Conta, campanha, dia, base temporal e versão da consulta. Granularidade explícita. |
| ads_daily_dimensions | Mesma base + tipo de dimensão e chave canônica de todos os segmentos selecionados. |
| sync_jobs, sync_runs, sync_checkpoints, sync_coverage | Trabalho lógico, tentativas, cursores, geração ativa, intervalo e dimensão validados. |
| integration_leases, provider_budgets | Exclusão, geração, cooldown e orçamento persistentes. |
| outbox, idempotency_keys, audit_events | Publicação confiável, repetição HTTP e trilha de alteração. |
| report_daily, data_revisions | Agregados internos por versão de regra e revisão de dados. |

Para uma dimensão Ads, a chave não pode omitir um segmento selecionado. Exemplo: conta + campanha + grupo + palavra-chave + correspondência + dia + base temporal; termos usam texto e grupo conforme o recurso. Valor nulo precisa de representação canônica consistente para não escapar da unicidade. Definir schema/chave por dimensão antes de escrever sua consulta.

## Cadastro atômico e identidade

Na ingestão, resolver primeiro identidade externa. Criar contato e associação na mesma transação; duas tentativas para a mesma identidade usam constraint e tratamento de conflito, sem deixar contato órfão. Número normalizado pode indicar outra identidade já conhecida, mas fusões ambíguas são revisadas. Não fundir por nome ou últimos dígitos.

Separar campos externos e campos editados no CRM. Uma coleta não pode apagar nome preferencial, responsável, revisão de origem ou estágio interno. Atualizações concorrentes de cadastro usam coluna `version` e condição de escrita; conflito devolve 409 para revisão, sem sobreposição silenciosa.

Mensagens reprocessadas só escrevem se o conteúdo/estado relevante mudou. Atualizar carimbo de cobertura uma vez por lote em vez de tocar cada mensagem intacta. FKs com organização impedem associação entre registros de organizações diferentes. Não usar exclusão em cascata indiscriminada sobre histórico comercial.

PostgreSQL oferece `ON CONFLICT` para resolver inserções concorrentes apoiadas em constraints únicas; uma consulta prévia de existência sozinha não protege a gravação. [Documentação PostgreSQL 18](https://www.postgresql.org/docs/18/sql-insert.html).

## Índices e limites

- Conversas: organização, canal e última atividade/ID; índices adicionais para responsável/estado conforme consultas medidas.
- Mensagens: organização, conversa, horário do evento e ID, para paginação estável; metadados do chat agregados na ingestão para evitar uma consulta por linha.
- Contatos: identidade externa, telefone normalizado e busca normalizada de nome; testar `pg_trgm` antes de depender da extensão no ambiente remoto.
- Ads: conta/dia/campanha, mais dimensão/chave quando aplicável. Não indexar todo `raw_json` sem uma consulta concreta.
- Tarefas: status, próxima execução, chave lógica ativa e lease. Auditoria: organização, entidade e instante.

Paginação por cursor com ordenação determinística. Máximo 100 linhas por chamada; padrão 50. Filtro de dashboard inicialmente até 366 dias, limitado no servidor. Exportação maior vira job; contagens exatas caras não acompanham cada tecla digitada.

Pool inicial: web até 5 conexões, domínio do worker até 3, fila até 2. Somar os pools de cada biblioteca e as conexões temporárias de migration; contar sobreposição de instâncias no deploy. Ajustar o total à capacidade contratada, com reserva de ao menos 30%. Não escalar workers sem recalcular esse orçamento.

Timeout inicial de query interativa de 5 segundos; jobs e importações usam limites próprios e lotes. Registrar queries lentas sem parâmetros pessoais. Otimizar por `EXPLAIN` com dados representativos, não criando índices preventivos para todos os campos.

## Agregados e cache

Indicadores leem tabelas normalizadas/agregados, não reinterpretam o JSON de todas as conversas a cada acesso. Recalcular somente períodos e contatos afetados; consolidar pedidos repetidos de recálculo. Um recálculo completo escreve uma nova versão e a ativa após validação.

Cache em memória curto da API, inicialmente 15 segundos, com tamanho limitado e chave de organização, permissões, filtros e revisão do dado. Promessas em andamento compartilham a mesma consulta por processo. Cache é otimização, nunca mecanismo de autorização ou garantia de exclusão entre instâncias. Invalidar após commit; respostas de uma mutação trazem o recurso atualizado.

## Contratos HTTP previstos

Prefixo `/api/v1`. Rotas abaixo são especificação, não endpoints implementados.

| Método e rota | Comportamento |
| --- | --- |
| POST /auth/login; POST /auth/logout; GET /auth/me | Sessão autenticada; sem cadastro público. |
| GET /dashboard | Indicadores com período e escopo de acesso. |
| GET /ads/campaigns; /ads/ad-groups; /ads/keywords; /ads/search-terms; /ads/conversions | Leituras por conta, intervalo e cursor; sem execução de GAQL arbitrária. |
| GET /conversations; /conversations/:id/messages | Lista e histórico paginado autorizado. Não altera o estado no Umbler. |
| GET /contacts; /contacts/:id | Cadastro, identidades e contexto permitido. |
| PATCH /contacts/:id | Alteração interna autorizada e versionada. |
| POST /opportunities; PATCH /opportunities/:id | Criação/edição interna, idempotência e controle de versão. |
| POST /commercial-events | Registro explícito de resultado; nunca inferido automaticamente de valor de proposta. |
| GET /reports/:type; POST /exports; GET /exports/:id | Consulta e exportação com o mesmo filtro de autorização. |
| GET /integrations/status; GET /sync/jobs/:id | Estado de cobertura e execução; detalhes restritos ao administrador. |
| POST /sync/requests | Valida permissão e orçamento, retorna 202/jobId; pedido equivalente retorna o trabalho existente. |
| POST /integrations/google/authorize; GET /integrations/google/callback | OAuth administrativo com state, sessão e destino de redirecionamento fixos. |
| PUT /integrations/umbler/credential | Armazena segredo criptografado; não o devolve na resposta. |

Listas retornam `items`, `nextCursor`, `hasMore` e `meta` com cobertura, revisão, fuso e data de atualização. O frontend exibe somente metadados pertinentes, sem despejar detalhes técnicos na tela. Erros usam código estável, mensagem curta e requestId; nunca stacktrace, token ou payload do provedor.

Schemas de entrada e saída fazem parte do código. Validação de forma antecede consultas de autorização; não aceitar schemas enviados pelo usuário. [Validação Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).

## Migrations e histórico

Gerar SQL com Drizzle, revisar e versionar; aplicar por comando exclusivo com trava de migration. Proibido schema push automático em produção ou migrations disparadas por cada instância ao iniciar. [Migrations Drizzle](https://orm.drizzle.team/docs/migrations).

Importador SQLite: origem em modo somente leitura, mapeamento por IDs externos, manifesto do recorte, contagens antes/depois, checkpoint e operação dry-run. A amostra histórica não comprova completude atual. Importação termina antes da primeira coleta real, que reconcilia as mesmas chaves. Nenhuma cópia automática do banco antigo para Git ou imagem Docker.
