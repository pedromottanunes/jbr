# Ambientes e publica??o ? estado revisado

Atualizado em 24/11/2026. Este documento substitui o plano inicial de PostgreSQL/pg-boss e Node 24. A implementa??o ativa usa MongoDB Atlas e Node 22. Os registros da migra??o est?o em [MONGODB.md](../MONGODB.md) e as evid?ncias da revis?o em [REVISAO-INTEGRACAO.md](../REVISAO-INTEGRACAO.md).

## Opera??o local

- Runtime: Node `>=22.18.0 <23`, depend?ncias pelo `package-lock.json`.
- `npm run dev`: API em 127.0.0.1:3000, Vite em 127.0.0.1:5173 e worker.
- `APP_MODE=mongo`: dados persistentes no Atlas; n?o usa SQLite/JSON como fallback.
- `INTEGRATIONS_ENABLED=true`: permite enfileirar e executar coletas. `SYNC_SCHEDULER_ENABLED=false`: mant?m a agenda autom?tica desligada.
- Atualiza??es dos pain?is leem o banco. Bot?es de coleta e pedidos de per?odo Google ainda n?o dispon?vel usam a fila compartilhada.
- `npm run check` e `npm run build`: verifica??es e artefatos. O assistente OAuth local ? separado e n?o faz parte do startup remoto.

Para ensaiar o build sem Vite: `npm run build`, definir `SERVE_WEB=true` no ambiente do processo e executar `npm start`, mantendo `NODE_ENV=development`, `HOST=127.0.0.1` e modo Mongo. Interface e API ficam na porta 3000. Isso ? um ensaio local; n?o libera produ??o p?blica.

## Topologia futura no Render

| Servi?o | Build / execu??o | Responsabilidade |
| --- | --- | --- |
| Web Service | `npm ci && npm run check && npm run build` / `npm start` | Fastify e frontend compilado na mesma origem |
| Background Worker | Mesmo build / `npm run start:worker` | Fila, limites por provedor, cursores e publica??es |
| MongoDB Atlas | Servi?o j? criado fora do Render | Dados, configura??es, credenciais criptografadas, fila e travas |

N?o haver? PostgreSQL adicional nem SQLite em disco do Render. O filesystem ef?mero n?o ser? fonte dos dados. Exporta??es e backups dur?veis exigem armazenamento externo pr?prio. [Servi?os web](https://render.com/docs/web-services), [workers](https://render.com/docs/background-workers).

Os dois processos devem usar o mesmo commit. Configurar no ambiente privado `MONGODB_URI`, `MONGODB_DB`, `CREDENTIALS_ENCRYPTION_KEY` e credenciais/configura??o Google. Tokens operacionais Umbler/Google ficam criptografados no banco. Nunca criar vari?veis `VITE_*` com segredos.

O limite padr?o de pool ? oito conex?es por processo, al?m das conex?es internas de monitoramento do driver. Escolher regi?o considerando o Atlas em S?o Paulo, medir lat?ncia e dimensionar mem?ria com os dados reais. Os ensaios locais da revis?o n?o garantem capacidade de produ??o.

## Libera??o p?blica ainda pendente

O c?digo continua recusando modo real em `NODE_ENV=production` ou bind p?blico. Antes de modificar esse bloqueio, implementar autentica??o, sess?es e permiss?es. Depois configurar dom?nio HTTPS, `APP_ORIGIN`, proxy confi?vel, `HOST=0.0.0.0`, porta fornecida pelo Render e IPs de sa?da na lista do Atlas.

N?o existe Blueprint de produ??o ativado nem deploy executado. A habilita??o do worker remoto deve ocorrer somente depois de validar acesso, restaura??o e dados; n?o publicar um painel real an?nimo.

## Release e recupera??o

1. Preparar o schema uma vez com `npm run mongo:setup`; o comando tem trava e ?ndices idempotentes. API e worker validam o schema no startup.
2. Executar testes, build e valida??es de integridade; CI sem segredos usa fixtures. Testes Atlas exigem banco isolado e credenciais pr?prias.
3. Publicar o mesmo commit em API e worker com integra??es desligadas para a confer?ncia inicial.
4. Healthchecks dispon?veis: `/api/health` para processo e `/api/ready` para banco. N?o consultam Google/Umbler.
5. Conferir contagens, per?odos, CTAs, permiss?es, fuso e cobertura parcial. Ensaiar rollback/restore e configurar backup externo antes da libera??o.
6. Desligar coleta/scheduler local e transferir a opera??o ao worker remoto. Em bancos separados, leases n?o impedem dois ambientes de consultarem o mesmo provedor.
7. Iniciar com coleta controlada e acompanhar erros, limites, armazenamento e mem?ria antes de ativar a agenda.

SIGTERM interrompe novas leituras e esperas, preserva p?ginas confirmadas e recoloca a tarefa na fila. O limite interno de encerramento ? 25 s; travas vencidas tamb?m permitem recupera??o ap?s uma interrup??o abrupta. O ciclo real de deploy Linux ainda precisa ser testado no Render. [Deploy e encerramento](https://render.com/docs/deploys#graceful-shutdown).

Rollback n?o deve apontar para um worker anterior ? revis?o de gera??es independentes depois de haver novas publica??es. A c?pia de backup preservada permite recupera??o, mas mudan?as de dados posteriores precisam ser reconciliadas. N?o executar remo??es de schema ou restaura??o sobre a base ativa automaticamente.
