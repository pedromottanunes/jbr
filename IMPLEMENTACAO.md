# Implementação local do CRM JBR

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

Execução manual equivalente, em Windows:

```powershell
npm run sync:attendance
# Janela opcional de até 366 dias, com orçamento explícito:
powershell -NoProfile -File scripts/enrich-umbler.ps1 -Days 180 -MaxRequests 150
```

No **Tráfego pago → Saldo e recargas**, informe o saldo confirmado agora no Google Ads e, depois, as recargas realizadas. O CRM calcula uma estimativa pelo consumo coletado, com referência em centavos, gastos em micros, idempotência do registro e histórico das confirmações. Uma nova confirmação substitui a referência de cálculo. Os alertas também aparecem na Visão geral quando exigem atenção.

O saldo pré-pago oficial não é disponibilizado por esse conector da Google Ads API. Portanto, este recurso não consulta caixa, não efetua recargas e não representa um saldo bancário oficial. A estimativa exige gastos cobrindo a confirmação até hoje. Dados com mais de 2 horas ou referência com mais de 7 dias pedem conferência, sem status de saldo seguro. A projeção usa os últimos 7 dias completos; atraso de métricas, tributos, créditos e ajustes podem gerar diferenças. Limites iniciais editáveis: R$ 200, atenção em 3 dias e crítico em 1 dia. Nenhum valor financeiro foi inventado para configurar a conta.

Persistência: conversas, atendentes, eventos e progresso em `local-data/umbler.sqlite3`; horários e registros de saldo em `local-data/crm-settings.sqlite3`; gastos em `local-data/google-ads.json`. Esses arquivos ficam fora do Git. O servidor web lê a base Umbler; o coletor é o responsável pelas escritas. As rotas locais de configuração exigem as mesmas proteções de loopback/origem do restante do CRM. Esta entrega ainda não habilita publicação ou autenticação no Render.

Rotas novas: `GET/PUT /api/v1/attendance/config`, `GET /api/v1/attendance/agents`, `GET/POST /api/v1/attendance/sync`, `GET /api/v1/ads/balance`, `PUT /api/v1/ads/balance/limits`, `POST /api/v1/ads/balance/entries`. `POST /api/v1/ads/sync` aceita `refresh: true` para atualizar custos já cobertos no cache. As páginas consultam o cache local; a coleta externa só ocorre por ação explícita ou pelas rotinas existentes.

Validação: `npm run check`, `npm run test:collector` e `npm run build`. Os testes cobrem limites de horário, sábado e vigência, transferência e fila, respostas sem cobertura, exclusão de automações, saldo/recargas idempotentes, períodos de custo incompletos e retomada da coleta sem misturar eventos com mensagens.

Fontes consultadas: [OpenAPI Umbler Talk](https://app-utalk.umbler.com/api/docs/index.html) e [esclarecimento da equipe Google Ads sobre saldo restante na API](https://groups.google.com/g/adwords-api/c/KxTS_HYqSyA).

## Registro das entregas anteriores

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
