# Desenvolvimento local e publicação futura

## Situação local verificada

Em 21/11/2026, o terminal encontrou Node `22.18.0`, npm `10.9.3` e Git `2.49.0.windows.1`. Docker não foi encontrado no PATH; isso não comprova ausência de instalação. A implementação deverá validar Docker Desktop/Compose ou disponibilizar PostgreSQL local antes de iniciar a base. Nenhuma instalação foi feita.

A stack planejada usa Node 24 LTS e PostgreSQL 18, com versões fixadas. Preferir gerenciador de versões ou containers a substituir globalmente o Node usado por outros projetos.

## Desenvolvimento local

Compose terá banco com volume persistente local, porta exposta somente em loopback e healthcheck. API, worker e Vite podem rodar no host com os mesmos pacotes; perfil opcional sobe todos os processos em containers. Script portável em Node evita dependência de comandos Bash no PowerShell.

Por padrão, `INTEGRATIONS_ENABLED=false` e `SYNC_SCHEDULER_ENABLED=false`. O primeiro uso deve funcionar com fixtures anonimizadas, sem token ou chamadas externas. A importação de histórico real é explícita, com banco local identificado e caminho fornecido pelo operador. O produto não depende do caminho absoluto do projeto atual.

| Comando previsto | Responsabilidade |
| --- | --- |
| npm ci | Instalar versões do lockfile. |
| npm run doctor | Conferir runtime, configuração, disponibilidade de banco e ambiente, sem mostrar segredos. |
| npm run db:up | Iniciar banco local pelo Compose, sem apagar volume. |
| npm run db:migrate | Aplicar migrations com trava e histórico. |
| npm run seed:demo | Popular apenas banco de demonstração com dados anonimizados. Bloqueado em produção. |
| npm run dev | Web e API com recarga; sem iniciar agenda externa implicitamente. |
| npm run dev:worker | Worker explícito, respeitando flags de integração. |
| npm run import:legacy | Importador com dry-run, caminho de origem e checkpoint. |
| npm run check; npm test | Tipos, lint e testes definidos para a etapa. |
| npm run build; npm run start:api; npm run start:worker | Mesmos pontos de entrada usados na publicação. |

Estes comandos ainda não existem; serão entregues na etapa de fundação. Não prometer operação local pronta com base apenas neste plano.

## Contrato de configuração

| Grupo | Variáveis previstas |
| --- | --- |
| Ambiente | APP_ENV, NODE_ENV, HOST, PORT, APP_ORIGIN, LOG_LEVEL |
| Banco | DATABASE_URL, MIGRATION_DATABASE_URL, DB_POOL_MAX, QUEUE_POOL_MAX |
| Segurança | CREDENTIALS_KEY_ID, CREDENTIALS_ENCRYPTION_KEY, SESSION_SECRET |
| Integrações | INTEGRATIONS_ENABLED, SYNC_SCHEDULER_ENABLED, SYNC_OWNER_ENV |
| Google | GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_API_VERSION, GOOGLE_ADS_OAUTH_REDIRECT_URI |
| Escopo Google | Customer/MCC em configuração de conexão no banco; não embutidos no frontend. |
| Umbler | Token criptografado via configuração administrativa; organização e canais permitidos no banco. |
| Limites | Budgets por conexão, cadências, tamanho de lote, timeout e janelas de reconciliação com defaults validados. |

Refresh tokens ficam no cofre lógico de credenciais criptografadas após OAuth; não criar duas fontes concorrentes permanentes de token em `.env` e banco. Bootstrap por ambiente, se necessário, deve ser importação explícita e posterior remoção da variável.

`SYNC_OWNER_ENV` é um bloqueio de configuração operacional, não trava entre bancos independentes. Transferir a coleta exige desligar a origem anterior. Local, CI, preview e produção usam bancos e segredos distintos.

## GitHub

O repositório futuro terá como raiz o conteúdo de `CRM JBR`, não a pasta que contém todos os projetos JBR. Inicialmente privado. Não criar repositório remoto, publicar ou fazer push nesta etapa.

Criar `.gitignore` e `.dockerignore` antes da primeira importação. Excluir `.env*` reais, bancos SQLite, dumps, backups, transcrições, exportações, downloads de anexos, logs, volumes, `node_modules` e artefatos de teste. Preservar apenas `.env.example` sem valores.

Os PNGs, `prompts.json` e README de `estudos-visuais` contêm nomes e trechos reais: manter a pasta inteira fora do Git por padrão. Preparar imagens anonimizadas separadas se forem necessárias na documentação do repositório. Não confiar apenas em detecção de segredos para proteger dados pessoais.

Os documentos atuais usam alguns links para pastas irmãs; antes de publicar o repositório, converter a documentação operacional para referências autocontidas e manter o inventário local como tal. O build deve passar em checkout limpo, sem acesso ao restante deste diretório.

CI em GitHub Actions: instalar via lockfile, tipos/lint, testes de regras e contratos, Postgres isolado para integração, migration desde banco vazio e build. E2E para fluxos críticos. Sem tokens de produção; pull requests usam mocks. Mudanças em dependências/migrations exigem revisão. Verificar arquivos staged e segredo/dado pessoal antes do primeiro push.

## Topologia Render

| Recurso | Responsabilidade |
| --- | --- |
| jbr-crm-web | Web Service com API e frontend estático, mesma origem e domínio futuro. |
| jbr-crm-worker | Background Worker com fila/agendamento, sem entrada HTTP pública. |
| jbr-crm-db | PostgreSQL gerenciado para domínio, sessões, cursores e fila. |

Render documenta workers contínuos sem tráfego de entrada e Web Services com bind em `0.0.0.0` e porta configurável. Usar `$PORT` no servidor, nunca uma porta fixa de desenvolvimento. [Workers](https://render.com/docs/background-workers), [Web Services](https://render.com/docs/web-services).

Web, worker e banco na mesma região, com conexão interna ao Postgres. Plano e dimensionamento serão escolhidos antes da contratação, sem assumir quotas gratuitas ou disponibilidade de recursos pagos. [Conexão Postgres no Render](https://render.com/docs/postgresql-creating-connecting).

Entregar `Dockerfile` multi-stage com runtime não root e imagem fixada; a mesma imagem lógica terá comandos distintos para API e worker. `render.yaml` declarará os três recursos, variáveis e healthcheck, sem segredos literais. Validar o Blueprint antes de aplicar. [Blueprint oficial](https://render.com/docs/blueprint-spec).

O filesystem padrão do Render é efêmero. Dados, cursores e fila ficam no Postgres; anexos/exportações duráveis, quando necessários, usam object storage privado. Não hospedar o SQLite legado dentro do container. [Filesystem e discos Render](https://render.com/docs/disks).

## Release e migrations

Pipeline inicial com deploy manual após CI verde; automatizar depois do piloto. API e worker devem publicar o mesmo commit. Render pode aguardar os checks do repositório antes de deploy automático, mas isso não torna a atualização de vários serviços uma transação atômica. [Fluxo de deploy Render](https://render.com/docs/deploys).

Migration roda uma vez por release, com trava global e usuário apropriado. O pre-deploy command é uma opção documentada para serviços pagos. Se o plano escolhido não fornecer esse recurso, preparar execução única de migration pelo fluxo de release, não pelo startup concorrente dos serviços. [Pre-deploy no Render](https://render.com/docs/deploys#pre-deploy-command).

Usar mudanças de schema compatíveis com a versão anterior: adicionar, preencher por lotes e só remover em release posterior. API/worker novos recusam iniciar trabalhos se a versão mínima do schema não estiver disponível. Atualizações incompatíveis da fila exigem pausa e drenagem controlada.

No SIGTERM, parar de aceitar novos jobs, terminar ou interromper o lote dentro da janela do serviço, salvar somente checkpoints confirmados e fechar pools. Um worker substituto retoma por lease/cursor. `/health/live` indica processo vivo; `/health/ready` valida banco/schema, sem chamar provedores. Falha do Google não deve derrubar o site inteiro. Heartbeat do worker é monitorado separadamente.

Rollback volta API/worker para commit conhecido e interrompe a coleta se necessário. Não executar down migration destrutiva automaticamente; preferir correção aditiva. Backup e ensaio de restauração precedem alterações de dados de maior impacto.

## Passagem do local para produção

1. Criar ambiente remoto com integrações desligadas, aplicar migrations e autenticação.
2. Definir se o histórico será importado da fonte legada ou restaurado de uma cópia do CRM local. Não fazer ambos sem reconciliação de chaves.
3. Verificar contagens, identidades, amostras, fuso, cobertura e acesso; transferir credenciais por canal seguro ou reconectar OAuth.
4. Desligar scheduler/coletor local e registrar o checkpoint final. Confirmar que o coletor antigo também não está executando.
5. Ativar worker remoto com orçamento pequeno, reconciliar e acompanhar antes de aumentar cadência.
6. Manter desenvolvimento local posterior em modo offline/mocks para esses mesmos provedores.

Backup diário e objetivo inicial de recuperação de até 24 horas de dados e retorno em até 4 horas são metas a validar por teste e plano contratado, não SLA existente. Mensagens antigas podem deixar de estar disponíveis no provedor; reconsulta não substitui backup.
