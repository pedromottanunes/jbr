# Implementação local do CRM JBR

## Banco de dados — decisão de 24/11/2026

MongoDB Atlas está integrado e ativo em `APP_MODE=mongo`. Foram migrados contatos, conversas, mensagens, relatórios Google, atendimento, configurações e progresso. `npm run dev` inicia API, interface e worker Node; atualizações gravam no Atlas e a agenda automática permanece desativada. O backup local foi preservado. Consulte [MONGODB.md](MONGODB.md) para coleções, credenciais protegidas, importação, testes e recuperação.

As descrições de SQLite, DPAPI e worker no processo da API abaixo registram a implementação anterior. No modo Mongo, configurações, snapshots, filas, limites e tokens criptografados são persistidos no Atlas, e o worker é um processo separado. A autenticação para publicação pública continua pendente.

## Atendimento e saldo — 24/11/2026

Em **Conversas → Indicadores**, o horário de entrada usa cinco grupos sem sobreposição: semana dentro e fora do expediente, sábado dentro e fora do expediente, e domingo. Cada grupo informa leads com CTA, conversas e respostas observadas. A regra de sábado é 8h–13h; segunda a sexta permanece 8h–18h, no fuso `America/Sao_Paulo`.

Em **Atendentes → Horários e critérios**, configure a data em que o atendimento aos sábados começou e a meta de primeira resposta. A vigência inicial é **24/11/2026**, escolhida como referência provisória da solicitação; ajuste para a data real se já havia atendimento antes. A meta inicial é 15 minutos úteis, configurável. Não há calendário de feriados ou escalas individuais.

O painel individual usa o cadastro de humanos da Umbler, autoria das mensagens, `MemberTimelines`, histórico de atribuições e metadados de transferências/encerramentos. Mostra atribuições, conversas respondidas, primeiras respostas, demais respostas, mediana, média, P90, cumprimento da meta, fila anterior, transferências, encerramentos, reaberturas e pendências verificáveis. O nome abre detalhes e links para conversas. Não há envio ou alteração na Umbler.

Regras de medição:

- Primeira resposta: atribuições iniciadas no período; começa na atribuição ou mensagem pendente do cliente, o que ocorrer depois. A espera anterior em fila fica separada.
- Respostas seguintes: primeira mensagem de cada sequência do cliente até a resposta humana, limitada ao trecho de responsabilidade do atendente.
- A porcentagem na meta considera primeiras respostas com tempo verificável. Trechos sem resposta e sem cobertura aparecem separadamente.
- Sem histórico contínuo ou referência explícita da fonte, não se inventa um tempo nem se assume falta de resposta. Bots, IA, notas privadas, envios agendados, disparos e falhas são excluídos.
- Pendências são fotografias da última coleta de cada conversa, não um monitor em tempo real. Encerramento não significa venda ou resolução. Uma conversa transferida pode aparecer para mais de um atendente.
- Avaliações sem vínculo inequívoco com atendente não entram em uma nota individual. A coleta atual de avaliações traz no máximo 50 registros e informa cobertura parcial quando atingir esse limite.

**Atualizar atendimentos / Continuar coleta** executa o enriquecimento local em lotes de até 150 chamadas, intervalo mínimo de 3 segundos, com os mesmos locks e tratamento de limite de API do coletor existente. A descoberta percorre conversas criadas nos últimos 90 dias e conversas abertas mais antigas. Históricos são retomados por cursor, com IDs únicos e cobertura armazenada. Dados anteriores permanecem disponíveis durante a coleta. A conclusão de um lote não garante histórico completo: o painel mostra a cobertura observada.

Execução manual atual:

```powershell
npm run sync:attendance
# Janela opcional de até 366 dias, com orçamento explícito:
npm run sync:attendance -- --days 180 --max-requests 150
```

### Orçamento da conta Google Ads — substitui o controle manual anterior

Em **Tráfego pago → Ver orçamento**, o CRM consulta `account_budget` aprovado e vigente. Calcula `max(0, adjusted_spending_limit_micros - amount_served_micros)` com `BigInt` e transmite valores decimais exatos. Não desconta novamente os custos de campanhas. Não há formulário de saldo ou recarga manual: as rotas antigas de lançamentos foram removidas; registros legados locais são preservados, mas não alimentam o novo cálculo.

A vigência é avaliada a cada leitura no fuso da conta, usando início aprovado ou proposto e término exclusivo; `FOREVER` representa ausência de término. Conta divergente, resposta malformada e números imprecisos são bloqueados. Sem orçamento utilizável, limite/consumo ausentes ou mais de um vigente, o estado é **indisponível**. `INFINITE` produz **ilimitado**, sem valor inventado. Os demais estados são disponível, consultando e erro. A última leitura válida é preservada como referência histórica após falhas ou informações incompletas.

Este recurso representa orçamento de conta durante uma vigência; não é orçamento diário nem saldo financeiro pré-pago. A documentação vincula a gestão de faturamento por API à configuração de faturamento mensal. A disponibilidade é verificada pela resposta real, sem inferir o regime financeiro da conta. Versão padrão `v26`, configurável em `GOOGLE_ADS_API_VERSION`, verificada em suporte em 24/11/2026. Os campos GAQL estão disponíveis nessa versão. O developer token é enviado quando configurado; o projeto Google Cloud também precisa ter acesso de produção conforme as regras atuais.

Um worker assíncrono no processo da API executa a consulta inicial e verifica atualizações a cada minuto, respeitando **15 minutos por conta**. Atualização manual tem intervalo mínimo de **30 segundos** e responde `202` quando inicia ou encontra trabalho em andamento. Há um trabalhador para o vínculo local JBR; leases SQLite com dono e prazo de 10 minutos coordenam várias instâncias que compartilhem o mesmo banco. Nenhuma transação permanece aberta aguardando o Google. `GET` só lê o snapshot e os custos locais, sem chamar o provedor.

Snapshots e limites são separados por ambiente, cliente e conta. O vínculo é fixado no backend; parâmetros de conta/cliente enviados pela interface são rejeitados. O modo local mantém a restrição de loopback/origem e recusa execução pública/produção. A publicação futura exigirá autenticação de usuários, vínculo autorizado por tenant, persistência compartilhada e adaptação da proteção de credenciais; esses controles locais não substituem autorização multiusuário no Render.

O access token é reutilizado, renovado perto da expiração e salvo protegido por DPAPI no cache local. Há single-flight no processo e lease para a renovação entre instâncias. HTTP 401 provoca uma renovação e uma repetição; 403 não é repetido; 429 respeita `Retry-After`; falhas temporárias têm retry limitado. Respostas sensíveis e credenciais não são entregues à interface. A autorização usa `state` vinculado ao cookie da sessão local, PKCE e validade de cinco minutos; uma reconexão sem refresh token não apaga o anterior.

Alertas configuráveis por vínculo: **urgente até R$ 100 ou 2 dias**, **atenção até R$ 500 ou 5 dias**, **esgotado quando o restante é zero**. Os limiares monetários usam a moeda da conta. Previsão usa apenas sete dias completos com cobertura, moeda, conta e atualização de custos verificadas; média zero não gera duração. Leitura com mais de uma hora suspende alertas e previsão, exibindo desatualização. Nenhum alerta afirma necessidade de recarga ou garante quando os anúncios pararão.

Persistência: conversas, atendentes, eventos e progresso em `local-data/umbler.sqlite3`; horários, snapshots de orçamento, leases, limites e cache OAuth criptografado em `local-data/crm-settings.sqlite3`; gastos em `local-data/google-ads.json`. Arquivos locais ficam fora do Git. A chave DPAPI é gerenciada pelo Windows, separada do banco.

Rotas: `GET/PUT /api/v1/attendance/config`, `GET /api/v1/attendance/agents`, `GET/POST /api/v1/attendance/sync`, `GET /api/v1/ads/balance`, `POST /api/v1/ads/balance/sync`, `PUT /api/v1/ads/balance/limits`. `POST /api/v1/ads/sync` permanece dedicado aos relatórios de tráfego. Os alertas de orçamento também aparecem na Visão geral.

Validação: `npm run check`, `npm run test:collector` e `npm run build`. Testes de orçamento cobrem valores grandes e zero, infinito, campos ausentes, datas passadas/futuras, vigência ambígua, fuso/moeda, custos desatualizados, 401/403/429/5xx/timeout, leases entre conexões, token compartilhado, isolamento, throttling e preservação da última leitura. A conta JBR foi consultada com as credenciais locais; a comparação visual com a tela de faturamento do Google depende de acesso ao navegador.

Fontes: [Umbler Talk](https://app-utalk.umbler.com/api/docs/index.html), [faturamento Google Ads](https://developers.google.com/google-ads/api/docs/billing/overview), [orçamentos de conta](https://developers.google.com/google-ads/api/docs/billing/account-budgets), [campos v26](https://developers.google.com/google-ads/api/fields/v26/account_budget) e [versões em suporte](https://developers.google.com/google-ads/api/docs/sunset-dates).

## Registro histórico das entregas anteriores (não é o procedimento atual)

**Visão geral atual:** o dashboard de funil e rastro já usa a base real local. Consulte [FUNIL.md](FUNIL.md) para regras, filtros, cobertura e etapas comerciais ainda pendentes.

**Atualização de 21/11/2026:** o modo `local` já serve dados reais do Umbler Talk, com importação histórica e coleta manual por API. Veja [DADOS-REAIS.md](DADOS-REAIS.md) para o estado atual e [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md) para a conexão Google. As seções abaixo registram a primeira entrega de demonstração, anterior à integração real.

Primeira entrega executável, iniciada em 21/11/2026. A interface e a API rodam localmente com uma amostra histórica anonimizada de 01 a 23/10/2026. Os totais foram derivados dos relatórios locais existentes; IDs de contatos foram substituídos por identificadores de demonstração. A conversa exibida contém trechos selecionados, com um texto de atendimento abreviado para retirar detalhes de operação. Não representa uma conexão ativa.

## Executar

Requer Node 22.12+ para este Vite; Node 24 LTS é o alvo de publicação do plano técnico. Na pasta `CRM JBR`:

```powershell
npm ci
npm run dev
```

Abrir `http://127.0.0.1:5173`. A API fica em `http://127.0.0.1:3000`. O proxy Vite encaminha `/api` para a API. `npm run check` executa tipos e testes; `npm run build` gera `dist/web` e `dist/server.js`.

`APP_MODE=demo` é o único modo habilitado. Em produção, o servidor recusa iniciar a demo pública sem uma liberação explícita, para evitar expor a amostra como CRM conectado. Não usar `ALLOW_PUBLIC_DEMO` como substituto de autenticação.

## O que funciona nesta entrega

- Navegação responsiva entre Visão geral, Tráfego pago, Conversas, Leads, Relatórios e Configurações.
- API interna com visão geral, campanhas, contatos paginados e amostra de conversa. Busca de contatos por rótulo/ID de demonstração.
- Indicadores históricos coerentes com o diagnóstico de outubro, sem atribuição fictícia por campanha ou receita inventada.
- Cliente de leitura Umbler com allowlist das cinco rotas GET usadas no coletor; cliente Google Ads com consulta GAQL controlada e validação de conta/período.
- Um gate por conector serializa chamadas externas dentro de um processo e aplica intervalo mínimo. Os conectores ainda não são executados pela aplicação.
- Build e testes locais de rotas, bloqueio de envio e serialização das chamadas.
- Migration inicial versionada para organização, contatos, conversas, mensagens e controle de sincronização; Compose local de PostgreSQL. O banco ainda não alimenta a aplicação e a migration não foi executada por falta de PostgreSQL/Docker disponível no PATH desta sessão.

## Próximas entregas técnicas

1. Aplicar e verificar a migration em PostgreSQL local; conectar repositórios de dados à API. Criar autenticação de usuários e controle de acesso.
2. Worker com fila durável, leases, orçamento por credencial, retry e checkpoints. O gate atual em memória é apenas uma proteção inicial; ele não coordena instâncias nem persiste `Retry-After`.
3. Sincronização Umbler real em modo de leitura, importação histórica idempotente e listagem completa de mensagens.
4. OAuth e sincronização Google Ads, dimensões de campanha e termos, com cobertura explícita.
5. Cadastros e oportunidades editáveis no banco, relatórios e preparação verificada para Render.

O [plano técnico](planejamento-tecnico/README.md) define as regras de cada etapa. Ainda não há banco, login, worker, coleta agendada, GitHub ou deploy. Credenciais não foram necessárias para a versão local de demonstração.
