# MongoDB Atlas — CRM JBR

Estado em 25/11/2026: integração implementada e histórico local importado. O modo `APP_MODE=mongo` atende os painéis pelo Atlas. O armazenamento do conteúdo das mensagens é desabilitado por padrão; eventos analíticos e cadastros permanecem. SQLite e JSON antigos foram higienizados, sem alimentar esse modo. Google Ads e Umbler continuam exclusivamente de leitura.

## Ambiente criado

| Recurso | Configuração |
| --- | --- |
| Organização | JBR TRANSPORTADORA |
| Projeto | JBR CRM database |
| Cluster | JBR — Free, AWS São Paulo |
| Banco | `jbr_crm_dev` |
| Usuário técnico | `jbr_crm_app_dev` |
| Permissão | `readWrite` somente em `jbr_crm_dev` |
| Aplicação | API e interface no computador; persistência no Atlas |

A URI está no `.env` privado. O acesso de rede permite o IP autorizado no painel. Se o IP do computador mudar, atualize a lista do Atlas.

## Dados migrados

| Conjunto publicado | Quantidade |
| --- | ---: |
| Contatos | 6.278 |
| Conversas | 7.425 |
| Eventos de mensagens | 33.709 |
| Conversas com mensagens disponíveis | 1.979 |
| Atendentes e membros | 13 |

Também foram preservados os 7.439 chats e 33.837 registros de mensagens de origem, eventos, cobertura, cursores, exportações históricas, relatórios Google, horários/SLA e configurações do orçamento. Brutos e publicados são camadas do mesmo histórico: não somar as contagens.

A carga inicial mediu 140.508.339 bytes de dados e 34.127.872 bytes de índices, aproximadamente 166,5 MiB no total. Novas publicações e testes podem aumentar esse uso. O cluster Free escolhido tem 512 MB; acompanhar capacidade antes de ampliar a retenção.

Após atualizar os relatórios Google e manter a geração anterior, o total medido foi 184,1 MiB. API e worker foram reiniciados, e os painéis continuaram lendo o Atlas. A fila registrou conclusão das consultas reais de orçamento e relatórios Google. A autenticação Umbler foi confirmada em leitura, sem iniciar uma nova coleta extensa de conversas.

Backup consistente anterior à troca: `local-data/backups/before-atlas-2026-11-24/`, com os dois bancos SQLite, JSON Google e manifesto SHA-256. Nenhum arquivo de dados ou credencial foi incluído no Git.

## Organização das coleções

| Coleções | Uso |
| --- | --- |
| `contacts`, `conversations`, `messages` | Listas e detalhes publicados, com IDs preservados, etiquetas e referências de origem |
| `service_conversations`, `members` | Histórico normalizado para desempenho dos atendentes |
| `umbler_*` | Dados de origem, eventos, avaliações, cobertura, descoberta e checkpoints de coleta/exportação |
| `ads_rows` | Séries e dimensões Google separadas por tipo, posição e geração |
| `data_revisions` | Ponteiro da geração ativa, período, metadados, totais e cobertura |
| `publication_staging` | Gerações em preparação e limpeza de publicações interrompidas |
| `settings` | Horários, vigência de sábado, SLA, retenção de conteúdo e revisão concorrente |
| `google_budget_snapshots`, `google_budget_limits` | Última leitura, valor válido anterior, alertas e controle da consulta |
| `sync_jobs` | Fila persistente, tentativas, status, dono e prazo de execução |
| `integration_leases`, `provider_limits` | Exclusão entre processos, expiração e espera imposta pelo provedor |
| `integration_state` | Metadados e progresso da integração |
| `integration_credentials`, `oauth_cache` | Tokens criptografados; cache com expiração |
| `schema_migrations`, `migration_runs` | Versão dos índices, manifesto e estado da importação |

Há índices únicos para identidades externas e registros por geração. Mensagens ficam fora do documento do contato, para evitar um único documento crescente. Os relatórios Google não são somados entre dimensões diferentes.

A publicação verifica contagens e troca o ponteiro com transação e verificação da posse do coletor. Coleções Umbler têm gerações independentes e hashes; as inalteradas são reutilizadas. No Google, mudança somente da data de sincronização não regrava as linhas. Mantemos a geração atual e uma anterior por coleção; uma geração anterior não substitui backup. A transição continua compatível com os ponteiros antigos.

Listagens são paginadas no Mongo. Funil e atendimento carregam a geração publicada uma vez por processo e a reutilizam em cache; os cálculos existentes foram preservados. Esse cache é reconstruível e não é a fonte dos dados. Não foram criadas agregações diárias materializadas nesta etapa.

Valores de orçamento em micros permanecem strings decimais exatas, calculadas com BigInt. Métricas de exibição mantêm o contrato numérico anterior, incluindo conversões fracionárias. Datas dos eventos preservam UTC; calendário usa America/Sao_Paulo e relatórios Google respeitam o fuso da conta.

## Configuração e comandos

```dotenv
APP_MODE=mongo
MONGODB_URI=...
MONGODB_DB=jbr_crm_dev
MONGODB_MAX_POOL_SIZE=8
CREDENTIALS_ENCRYPTION_KEY=...
INTEGRATIONS_ENABLED=true
SYNC_SCHEDULER_ENABLED=false
```

`INTEGRATIONS_ENABLED=true` permite ao worker processar atualizações solicitadas. A agenda automática permanece desativada na etapa local. Cada atualização é compartilhada pela fila; abrir o mesmo painel em duas abas não dispara duas coletas.

| Comando | Função |
| --- | --- |
| `npm run dev` | Inicia API, Vite e worker |
| `npm run mongo:check` | Testa conexão autenticada |
| `npm run mongo:setup` / `npm run db:migrate` | Prepara índices e versão do schema |
| `npm run sync:google` | Atualiza relatórios Google e publica no Atlas |
| `npm run sync:attendance -- --days 90 --max-requests 150` | Coleta limitada e retomável Umbler |
| `npm run sync:budget` | Atualiza o orçamento de conta |
| `npm run mongo:credentials` | Importação explícita inicial de tokens locais para o cofre |
| `npm run mongo:verify` | Testes Atlas isolados com dados fictícios |
| `npm run mongo:backup` | Exportação privada com compressão, contagens e hashes |
| `npm run check` / `npm run build` | Tipos, testes e build |
| `npm run start:worker` | Worker compilado em `back-end/dist/worker.js` |

O importador aceita `npm run mongo:import -- --from DIRETORIO` para ensaio sem escrita, e `--apply` para importar. Um backup já concluído é reconhecido e não é regravado; outra importação sobre uma base publicada é recusada. Para migrar alterações posteriores, é necessário um procedimento incremental, sem sobrepor a base ativa.

Os wrappers PowerShell antigos recusam coleta quando `APP_MODE=mongo`. Python/SQLite ficam disponíveis para análise e rollback do legado. O migrador PostgreSQL foi desativado, sua dependência removida e o Compose isolado em perfil legado.

## Sincronização e credenciais

Um MongoClient por processo, pool limitado, timeouts e escrita majority. Inicialização valida conexão, suporte a transações e versão do schema. Não existe fallback automático para SQLite ou demo quando o Atlas fica indisponível. `/api/ready` testa o banco sem consultar os provedores.

Worker único por banco, com lease renovável, posse por execução e recuperação de trabalhos interrompidos. As tarefas usam IDs estáveis. Cursores só avançam após salvar a página; IDs únicos impedem mensagens repetidas. Erros temporários do provedor têm espera e limite de tentativas; uma tarefa expirada três vezes fica em erro. A próxima atualização manual ou programada pode retomar o progresso.

Umbler: rotas GET em allowlist, intervalo mínimo de 3 segundos e orçamento padrão de até 150 chamadas por lote. Preservamos cobertura parcial e não prometemos recuperar mensagens fora do limite de histórico do plano. Google: consultas GAQL de leitura em janelas limitadas, sem alteração de campanhas. O orçamento mantém sua própria trava/cooldown e última leitura válida.

Refresh token Google e token Umbler foram migrados do DPAPI para AES-256-GCM no Atlas. A chave `CREDENTIALS_ENCRYPTION_KEY` fica somente no ambiente privado, fora do banco. Client ID, Client Secret e configuração da conta permanecem no backend. Não copie segredos para variáveis `VITE_*` ou para o Git.

A autorização Google local grava o refresh token no Atlas em modo Mongo e invalida o cache anterior. A chave externa precisa acompanhar a configuração privada em uma mudança de computador/servidor; perdê-la impede abrir os tokens, exigindo nova autorização.

## Validação e recuperação

Na migração inicial: 49 testes TypeScript (60 após a revisão de integração); build da interface/API/worker; comparação de 14 respostas HTTP com o mesmo recorte local. Contagens e valores inteiros são exatos; médias aceitam diferença de até 1e-9 decorrente da ordem de soma. Reimportação do mesmo backup confirmada sem duplicatas. A normalização Node também reproduziu integralmente os contatos, conversas e mensagens publicados pelo coletor antigo.

Os 21 testes Python do legado também passaram, incluindo o bloqueio do coletor antigo em modo Mongo. O backup Atlas foi conferido por hash, descompressão e contagem: 31 coleções e 119.589 documentos na fotografia anterior à atualização Google. Isso valida a integridade do arquivo; não equivale a um ensaio de restauração completa.

Para repetir a comparação antes de novas coletas: `npm run mongo:verify -- --baseline local-data/mongo-baseline.json`. Esse arquivo é privado e não acompanha o repositório. Após atualizar os provedores, diferenças contra a fotografia antiga são esperadas; a verificação padrão usa apenas fixtures e não depende dessa fotografia.

Testes de integração usam coleções temporárias `test_<id>_*` no banco de desenvolvimento, com dados fictícios e remoção somente do prefixo criado. Cobrem disputa de oito execuções, lease vencida, revisão concorrente, rollback de transação, fila única, publicação idempotente, retomada de cursor, limite de chamadas e Retry-After. Os testes de coletor usam respostas simuladas; a autenticação real de ambos os provedores foi validada separadamente com consultas de leitura no escopo JBR.

O backup Atlas exporta Extended JSON canônico comprimido por coleção. Faça com a API parada e aguarde a coleta terminar. Ele adquire as travas de coleta e recusa concluir caso detecte alteração dos estados/configurações durante a exportação. Um diretório sem `manifest.json` não representa backup concluído. Cache OAuth e leases são excluídos; o cofre permanece criptografado e sua chave deve ser guardada separadamente.

Não há agendamento automático de backups nem restauração automática neste entregável. Antes do deploy, ensaiar restauração em banco isolado e definir retenção/cópia externa. Se houver novas escritas no Atlas, reconciliá-las antes de voltar à cópia SQLite antiga.

## Publicação futura

A revisão posterior da integração, correções de consumo, ensaios de concorrência e preparação do build estão em [REVISAO-INTEGRACAO.md](REVISAO-INTEGRACAO.md). A medição após a transição das gerações foi aproximadamente 226,5 MiB de dados e índices; as medições anteriores acima registram o estado antes dessa revisão.

O CRM continua acessível apenas no computador local; conectar Atlas não publica a interface. Autenticação, sessões e permissões ainda precisam ser implementadas antes de liberar dados reais no Render. O bloqueio de produção/loopback permanece ativo.

No Render, usar API e worker com as mesmas variáveis privadas e banco, liberar os IPs de saída necessários no Atlas e manter apenas um ambiente coletor por vez. Interface, imagens da marca e código permanecem no repositório. A política de conteúdo abaixo também se aplica às referências de anexos recebidas do provedor.

## Conteúdo das conversas — padrão desabilitado

A área Conversas apresenta apenas indicadores de atendimento, CTAs e performance dos atendentes. O leitor de mensagens foi retirado. Os links de atendimentos e os endereços antigos abrem a ficha do lead, com cadastros, etiquetas e metadados dos atendimentos. A API de detalhe não consulta nem retorna os corpos das mensagens, inclusive em bases antigas que ainda os contenham. O funil também retorna apenas evidências analíticas.

A retenção permanece desabilitada. A ausência da configuração equivale a `false`. A preferência técnica fica em `settings/message_storage`, com revisão para evitar alterações concorrentes; o controle legado de ativação não está exposto na interface. Ela não interfere nas contas do WhatsApp/Umbler, que continuam acessadas somente por GET.

Com a opção desabilitada, o coletor lê a página da API em memória, reconhece os CTAs pelo catálogo e persiste somente os eventos necessários aos indicadores: IDs, horários, direção, tipo/validade da mensagem, atendente, transferências, cobertura do histórico e identificador do CTA. Não grava texto, legendas, anexos, citações, notas internas ou prévias da primeira/última mensagem. Campos aninhados também passam por uma lista explícita de campos permitidos antes da escrita. Os dados cadastrais dos contatos e as etiquetas continuam disponíveis.

As métricas usam esses eventos sem conteúdo: entradas por período, CTA por tipo, expediente de segunda a sexta e sábado, primeira resposta, respostas seguintes e performance individual. Os horários são preservados para permitir recalcular períodos e mudanças de expediente. Um CTA continua sendo indício de passagem pelo site, não prova de atribuição a anúncio.

Ao desabilitar a retenção, o worker remove os conteúdos de todas as versões dos painéis e das fontes/importações antigas, por lotes com trava da integração Umbler e transações. Se houver interrupção, a limpeza recomeça de forma idempotente. O worker também executa essa manutenção quando as coletas externas estão desabilitadas. A configuração técnica só permite nova ativação após a conclusão. `npm run privacy:purge` permite retomar a limpeza manualmente.

Uma eventual ativação técnica autoriza armazenar o conteúdo recebido nas próximas coletas, mas não restaura conteúdo removido nem reativa o leitor de mensagens. A ficha do lead e as consultas de indicadores leem os dados já extraídos. A seleção de período também verifica a cobertura e pode enfileirar uma atualização em segundo plano, conforme o fluxo abaixo. O histórico textual continua sendo consultado no Umbler/WhatsApp.

O conteúdo removido não permite reclassificar retroativamente um texto desconhecido contra um CTA adicionado futuramente. O identificador preserva o reconhecimento feito com o catálogo disponível na coleta; o CRM não inventa atribuições para esses casos.

Os backups gerados por `npm run mongo:backup` também excluem conteúdo das mensagens, mesmo se a retenção técnica estiver habilitada. Preservam eventos analíticos e cadastros, e registram `messageContent: false` no manifesto. As cópias locais antigas podem ser higienizadas com `npm run privacy:purge-local -- --apply`: SQLite aposentado, exportações Atlas e fotografias de validação reconhecidas dentro de `local-data`. O utilitário não percorre as outras pastas do cliente nem modifica as credenciais.

Verificações: `npm run check`, `npm run privacy:verify`, `npm run mongo:verify` e `npm run build`. A verificação de privacidade usa dados fictícios em coleções isoladas e cobre configuração padrão, ativação, concorrência, retomada, remoção de versões antigas, preservação do CTA e novas coletas sem texto. Os baselines antigos com trechos de conversas foram higienizados e não servem mais como comparação literal de mensagens.

Aplicação em 25/11/2026: limpeza concluída, opção desabilitada. Auditoria de 149.846 documentos das coleções de conversas e fontes Umbler sem campos de conteúdo; 6.278 contatos, 7.425 conversas e 33.709 eventos publicados preservados. Nove comparações HTTP (funil, atendimento e consultores em três períodos) mantiveram os indicadores idênticos. Os 64 testes e o build passaram. O uso medido caiu de 229,2 para 164,2 MiB (110,2 MiB de dados e 54 MiB de índices). Duas bases SQLite e 34 arquivos de coleções dos backups locais foram higienizados; manifestos atualizados. Capturas antigas de conversas foram removidas. A conferência visual da nova opção ficou indisponível no ambiente; contrato HTTP e compilação foram verificados.

Referências: [driver MongoDB](https://www.mongodb.com/docs/drivers/node/current/), [transações](https://www.mongodb.com/docs/drivers/node/current/fundamentals/transactions/), [limites Free](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).

## Otimização de armazenamento e consultas — 25/11/2026

### Atualização por período

Na Visão geral e em Conversas, o período aplicado aciona `POST /api/v1/attendance/ensure`. O painel apresenta imediatamente a análise publicada. O coordenador consulta a coleção compacta `attendance_coverage` (um registro por dia, sem mensagens) e enfileira somente os dias sem verificação recente. Dias dos últimos sete dias são revalidados após 15 minutos; dias anteriores, após 24 horas. Isso evita presumir que uma semana histórica nunca possa ter alterações. A interface verifica a necessidade a cada minuto enquanto está em uso; uma verificação com cobertura recente não chama a Umbler nem grava um novo trabalho.

A fila da Umbler é única. Pedidos iguais de abas diferentes são combinados em transação. Ampliações solicitadas durante uma execução são guardadas como períodos pendentes; a janela corrente mantém seus limites e termina antes das adicionais. Intervalos separados não forçam a leitura dos dias entre eles. O botão Atualizar atendimentos agora envia o período exibido, em vez de uma janela fixa de 90 dias. A atualização sob demanda exige API e worker ativos e `INTEGRATIONS_ENABLED=true`; funciona mesmo com `SYNC_SCHEDULER_ENABLED=false`.

O coletor localiza conversas por última atividade, incluindo encerradas e contatos antigos com atividade posterior, para não depender apenas da data de criação. Usa os parâmetros de leitura documentados de `/v1/chats/`, com paginação, ordem temporal e limite fixado no início da varredura. A descoberta pode precisar examinar metadados de conversas com atividade posterior ao intervalo escolhido; os eventos analisados são limitados ao intervalo solicitado, no fuso de São Paulo. O catálogo de atendentes é reaproveitado por até 24 horas.

Para cada conversa, `umbler_service_coverage` registra os intervalos de eventos efetivamente examinados. A próxima janela é calculada a partir das lacunas, e não apenas de um booleano “analisada”. IDs únicos evitam duplicação. A primeira mensagem reconhecida em uma página é reaproveitada para CTA; a consulta pontual só ocorre quando o início do lead pertence ao período e ainda falta. Texto e anexos passam pela política de descarte antes da persistência. Restrições do provedor e primeiras mensagens indisponíveis continuam como informação parcial; não são convertidas em atendimento ou origem confirmados.

Cada lote usa no máximo 150 chamadas, espaçadas por três segundos, e até 30 páginas por conversa. A continuação aguarda pelo menos um minuto entre lotes; a cada seis lotes parciais há uma pausa de 15 minutos. Erros do provedor respeitam recuo e limite de tentativas. Página, cobertura e progresso são gravados juntos sob trava. A marca diária de verificação só é escrita após publicar os indicadores com sucesso. Uma interrupção depois dessa marca é recuperada sem consultar novamente a API. Lotes parciais já publicados atualizam o painel enquanto o restante continua.

Validação específica: `npm run attendance:verify` cobre concorrência, ampliação da janela durante execução, descarte de conteúdo, retomada por intervalo, resposta nova em conversa antiga, reutilização de CTA, falha sem falsa cobertura e recuperação após publicação. Os dados de teste ficam em coleções isoladas, removidas ao terminar. Uma consulta real de leitura com uma conversa confirmou a aceitação dos parâmetros de descoberta; não foi gravado seu conteúdo.

Os GETs de atendimento, consultores e funil leem a fotografia publicada no MongoDB, sem consultar a Umbler. O backend reaproveita os eventos em memória por versão e mantém até 12 resultados de filtros. A interface solicita separadamente a verificação automática de cobertura; os detalhes estão na seção Atualização por período. Datas fora da cobertura continuam parciais, sem preencher lacunas com zeros de atendimento ou atribuições inventadas.

Na sincronização, o cadastro das conversas informa IDs e horários da primeira/última mensagem. A primeira mensagem pode ser consultada isoladamente em `GET /v1/messages/{id}/`, conforme a [documentação da Umbler](https://app-utalk.umbler.com/api/docs/index.html). Quando seu evento já está armazenado, não há consulta adicional. Quando veio em uma página necessária ao atendimento, é aproveitado nessa mesma execução. Quando falta, a busca pontual divide o orçamento de até 150 chamadas, limitada a 20 por lote e a 20% do orçamento. Respostas 404/410 recebem espera de sete dias; outros erros preservam o tratamento de falhas do provedor. O resultado é o identificador do CTA e os metadados; o texto continua descartado por padrão. Uma mensagem isolada não comprova cobertura do restante da conversa.

Tempos de resposta, transferências e performance dos atendentes precisam dos eventos posteriores, não apenas da primeira mensagem. O coletor usa páginas de até 250 eventos, checkpoints transacionais, IDs únicos, intervalo de três segundos e exclusão mútua. Conversas sem novidade e com cobertura suficiente são puladas. Uma janela histórica maior busca os intervalos faltantes, preservando os eventos recentes; retomadas continuam da cobertura salva. Restrições de histórico do provedor permanecem sinalizadas.

Schema v2: `umbler_chats` é a fonte única dos cadastros de conversas. `observed_at` e `service_candidate` preservam o horário observado e a seleção usada pelo coletor de atendimento. A cópia `umbler_service_chats` e os cinco arquivos `umbler_export_*`, não utilizados pelos painéis, foram removidos do banco ativo. O importador mantém compatibilidade com backups locais antigos, consolidando os cadastros e ignorando exportações obsoletas.

Cada publicação troca o ponteiro de versão em uma transação. A versão substituída recebe `deleteAfter` cinco minutos após essa troca, protegendo requisições em andamento. A manutenção do worker roda a cada minuto, inclusive sem coleta externa habilitada, e remove somente gerações explicitamente aposentadas ou staging abandonado há mais de 24 horas. Os lotes de exclusão verificam a posse da trava em transações. Versões ativas nunca são removidas. A limpeza não depende de haver novas publicações.

Os IDs internos das novas fotografias usam prefixo por geração e posição, reduzindo a fragmentação e o tamanho dos índices. IDs de leads/conversas na API continuam iguais. Os índices de pesquisa e unicidade são preservados.

Comandos adicionais:

- `npm run mongo:compact`: remove versões vencidas, respeitando a carência. Não executa o comando MongoDB `compact`.
- `npm run mongo:storage-verify`: testa migração, retenção, retomada, CTA pontual, filtros sem chamadas externas e reconstrução de índices em coleções fictícias.
- `npm run attendance:verify`: testa atualização por período, concorrência, ampliação durante coleta, retomada, privacidade e falhas em coleções fictícias isoladas, com respostas simuladas da Umbler.
- `npm run mongo:repack`: mostra o diagnóstico; com `-- --apply`, reconstrói coleções e índices com API/worker parados. Copia os documentos, recria os mesmos índices e compara contagem e hash integral antes da troca atômica. A operação é manutenção excepcional, não deve rodar junto com o servidor nem a cada sincronização. A base de origem permanece intacta se a validação falhar.

Para atualizar um ambiente antigo: pare API/worker, execute `npm run mongo:setup`, depois `npm run mongo:compact` e reinicie. No Render, não mantenha uma versão antiga do coletor ativa durante essa migração. Testes temporários removem apenas seu prefixo exclusivo; não fazem parte da base publicada.

O limite Free considera dados BSON sem compressão mais índices; `storageSize` isolado não representa a cota. `atlasSize` mede o total do cluster e `dbStats` detalha o banco. O painel Atlas pode exibir uma amostra anterior; compare a coleta direta com o horário da métrica. [Critério do Atlas](https://www.mongodb.com/docs/atlas/free-tier-commands/).

Resultado aplicado em 25/11/2026: **86,9 MiB no cluster**, sendo 61,8 MiB de dados e 25,0 MiB de índices. A medição direta no início desta otimização era 164,2 MiB. Foram removidos 66.845 documentos de versões anteriores, 3.000 cópias de cadastros e os arquivos de exportação sem uso. Há somente uma versão ativa de cada conjunto publicado e nenhuma coleção de teste ou cópia temporária restante. A reconstrução verificou todos os documentos antes da troca; o worker também limpa temporários abandonados após expirar a trava de uma manutenção interrompida.

Validação final: 69 testes de unidade, ensaios Atlas de privacidade/coleta/retenção/reconstrução, build da interface/API/worker, hash integral dos registros publicados (desconsiderando somente o ID interno reconstruído) e nove comparações de métricas em três períodos. Os nove resultados permaneceram equivalentes, com **zero chamadas externas** durante a leitura dos relatórios. Auditoria de 92.235 documentos Umbler e conversacionais encontrou zero campos de conteúdo. Permanecem 6.278 contatos, 7.425 conversas e 33.709 eventos publicados. A sincronização real não foi disparada durante a otimização; as novas chamadas pontuais foram verificadas com respostas simuladas e o contrato oficial da API.
