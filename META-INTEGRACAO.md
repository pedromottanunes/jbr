# Meta — integração de métricas da JBR

Estado conferido em **27/11/2026**. Escopo: leitura das contas de anúncios do portfólio JBR ANTT. Nenhuma campanha, anúncio, público, orçamento, cobrança ou mensagem foi alterado.

## Recursos configurados

| Recurso | Nome | ID |
|---|---|---|
| Portfólio proprietário | JBR ANTT | 107227610975997 |
| Aplicativo novo, publicado | JBR Integração | 1129420006733991 |
| Usuário do sistema novo, Employee | CRM JBR Métricas | 61597022790216 |
| Conta de anúncios | BM TESTE - HÉLIO | 1638336274287834 |
| Conta de anúncios | JBR CARTÃO | 523435535018960 |
| Conta de anúncios | JBR [CA - RESERVA] | 2705808446379845 |

O usuário autorizou as três contas. Usuários do sistema e aplicativos anteriores foram preservados. O novo usuário recebeu **Ver desempenho** nas três contas e **Desenvolver app** no aplicativo novo, apresentado pela interface junto com Ver insights e Testar app. Sem administração geral do portfólio nem gerenciamento das contas de anúncios.

Os IDs das contas foram confirmados pela Graph API. O parâmetro selected_asset_id nas URLs do Business pode ser diferente; não usá-lo como ID da conta na API.

## Aplicativo publicado

- Status **Publicado**, confirmado novamente após a geração do token.
- Categoria: Negócio e Páginas; domínio jbr-o9l2.onrender.com.
- Contato do app: pedromottanunes@hotmail.com.
- Política: https://jbr-o9l2.onrender.com/privacidade.html
- Exclusão de dados: https://jbr-o9l2.onrender.com/exclusao-de-dados.html
- Contato institucional: comercial@jbrantt.com.br.

Páginas estáticas em front-end/public, públicas e vinculadas no login. Build e HTTP 200 verificados localmente e no Render. Commit 7620608.

Os dois casos de uso previamente selecionados foram mantidos: gerenciamento e mensuração de anúncios. Sua presença não concede todas as permissões ao token.

## Token emitido e armazenado

A solicitação 28634533266224535 foi aprovada por Glauco Merlim. A geração foi concluída para o aplicativo e usuário novos, com opção de validade **Nunca**. Isso significa ausência de expiração programada; mudanças de segurança ou acesso podem revogá-lo. A expiração não foi conferida pelo endpoint de depuração de tokens.

A API confirmou **ads_read** e a permissão básica automática **public_profile**. Não retornou ads_management, business_management ou permissões de WhatsApp/Páginas/Instagram orgânico.

- GET /app: JBR Integração, 1129420006733991.
- GET /me: CRM JBR Métricas, ID no contexto do aplicativo 122097464991567426; o ID administrativo no Business continua 61597022790216.
- Banco: jbr_crm_dev, coleção integration_credentials, documento **meta-ads-token**.
- Token protegido com **AES-256-GCM** pelo mecanismo protectSecret existente no backend. Gravação e leitura com comparação em memória verificadas com sucesso.
- Backup criptografado: local-data/meta-ads-token.enc, ignorado pelo Git.
- Recuperação: carregar CREDENTIALS_ENCRYPTION_KEY do ambiente privado e chamar readSecret(ctx, 'meta-ads-token'). Para o backup, usar protectSecret(conteudoDoArquivo, false). Consumir em memória, sem imprimir nem enviar ao frontend.
- Preservar a chave de criptografia separadamente dos backups e usar a mesma no Render. O token não foi colocado no código, repositório, frontend, URLs ou logs.

A conexão local inicialmente falhou porque o IP atual não estava autorizado. Após o usuário abrir o projeto JBR no Atlas, foi usado **Add Current IP Address** nesse projeto; a conexão e a gravação passaram. Não foi liberado acesso global à internet nem desabilitada a validação TLS.

## Validação somente de leitura

Período explícito: **01/11/2026 a 26/11/2026**. Todas as contas informaram **BRL** e **America/Sao_Paulo**. Insights no nível de conta, com use_account_attribution_setting=true.

| Conta | Investimento | Impressões | Cliques | Resultado |
|---|---:|---:|---:|---|
| BM TESTE - HÉLIO | R$ 876,62 | 58.387 | 703 | HTTP 200 |
| JBR CARTÃO | R$ 1.069,17 | 49.867 | 788 | HTTP 200 |
| JBR [CA - RESERVA] | — | — | — | HTTP 200, sem linhas no período |

BM TESTE - HÉLIO possui status 3 e aviso de pagamento na interface; os relatórios históricos funcionaram. As outras contas retornaram status 1. Nenhuma configuração financeira foi alterada.

Leituras de /act_ID, /campaigns, /adsets, /ads e /insights bem-sucedidas nas três contas. Campanhas, conjuntos e anúncios foram amostrados com limite de uma linha; as duas primeiras contas indicaram páginas adicionais. A reserva retornou listas vazias. Essa validação não é uma sincronização completa. Conversões e ROAS ainda não foram validados.

As chamadas iniciais solicitavam v25.0 e receberam versão efetiva v27.0. Uma consulta adicional explicitamente em **v27.0** confirmou HTTP 200 e o aplicativo esperado. Usar v27.0 na implementação. Relatório sanitizado: local-data/meta-validation.json, fora do Git, sem tokens ou URLs de paginação.

## Painel e coleta implementados em 27/11/2026

Menu expansível **Tráfego pago → Google Ads / Meta Ads**. O endereço anterior `/trafego` redireciona para `/trafego/google`; `/trafego/meta` abre o novo painel. O período continua compartilhado com as demais áreas pelo mecanismo existente.

O painel Meta contém filtros por conta, campanha e ação de conversão; investimento, cliques, CTR, CPC, custo por conversão, impressões, alcance e frequência; destaques e tabelas de campanhas, conjuntos e anúncios; ações separadas por tipo; evolução diária por conta; galeria de anúncios veiculados no Instagram com prévia, texto, link, status e desempenho exclusivo dessa plataforma. A evolução diária fica oculta ao selecionar campanha, pois a série coletada é no nível de conta.

### Contrato do backend

Atualização de desempenho (27/11/2026): a Meta tem uma fila de execução independente de Google/Umbler, limitada a uma tarefa Meta por vez. Os bloqueios persistidos por provedor continuam impedindo coletas concorrentes entre Render e computador local. Há no máximo duas tarefas de integração simultâneas no worker integrado; o pool Mongo continua compartilhado.

- `GET /api/v1/meta/detail?start=AAAA-MM-DD&end=AAAA-MM-DD&account=ID&campaign=ID`: lê somente o cache do MongoDB. Filtros de conta/campanha são opcionais. Não chama a Meta.
- `POST /api/v1/meta/sync`: recebe `{start,end,refresh?}` e registra uma tarefa deduplicada. Não realiza coleta dentro da requisição HTTP.
- `GET /api/v1/meta/sync`: acompanha a tarefa persistida. As três rotas usam a autenticação existente do CRM.
- O worker existente executa a tarefa `meta` com lease exclusivo, renovação, recuperação após reinício e espera progressiva para limites/erros transitórios do provedor. Requisições simultâneas do mesmo período compartilham a tarefa. Períodos distintos permanecem na fila, até oito, sem unir janelas de alcance.
- A primeira abertura de um período ausente/desatualizado solicita a coleta. Cache automático de uma hora; atualização manual respeita dez minutos por conta/período. Não há varredura Meta contínua em segundo plano quando ninguém solicita o painel.

### Armazenamento e proteção

`meta_snapshots` guarda um documento por conta/período exato, com índices de expiração (TTL de trinta dias), limite de oito períodos após coleta completa e limite de 1,5 MB por documento. Cada conta é publicada atomicamente; totais consolidados só aparecem quando todas as contas selecionadas estão disponíveis. As contas concluídas há menos de dez minutos são reaproveitadas nas tentativas seguintes.

Guardamos apenas métricas e metadados selecionados dos criativos (texto limitado, URLs de prévia/publicação e estado). Não baixamos vídeos ou imagens nem persistimos respostas brutas. A coleta validada de 01–26/11 retornou sete campanhas e treze anúncios com veiculação no Instagram, prévias e links; os três documentos somaram aproximadamente 100 KiB de JSON.

O token permanece em `integration_credentials/meta-ads-token`, descriptografado somente em memória no backend com `CREDENTIALS_ENCRYPTION_KEY`. **Não é necessário adicionar token da Meta ao frontend ou criar nova variável no Render.** O Render precisa usar o mesmo banco, a mesma chave e manter `INTEGRATIONS_ENABLED=true` e um worker ativo (`EMBEDDED_WORKER=true` na implantação atual).

Somente GET na Graph API v27.0, contas autorizadas fixas, token em Authorization Bearer, paginação por cursor reconstruído (nunca seguindo URLs que contenham token), máximo de 180 chamadas por execução, 30 páginas/2.500 linhas por relatório e intervalo persistido entre requisições. Respostas limitadas, cancelamento no desligamento e mensagens de erro sem credenciais. Outros portfólios não são consultados.

### Semântica das métricas

- A ação escolhida define as conversões e o custo por conversão. `lead` e `offsite_conversion.fb_pixel_lead`, por exemplo, podem representar a mesma conversão e não são somados entre si. Grupos de engajamento também não têm um total artificial de ações sobrepostas.
- Relatórios completos por período, `action_report_time=impression` e `use_unified_attribution_setting=true`. Atribuição pode incluir visualização; ações/cliques não equivale a pessoas únicas nem conversão exclusivamente pós-clique.
- Alcance e frequência são exibidos somente a partir de um total único fornecido pela API para conta ou campanha. Não se somam alcance diário, contas ou anúncios. Moedas diferentes impedem um total financeiro consolidado.
- ROAS só aparece para uma ação de compra com valor informado. Não representa receita confirmada no CRM.
- Instagram refere-se ao desempenho **pago**, com breakdown `publisher_platform=instagram`. Não inclui métricas orgânicas. A mesma publicação pode aparecer em anúncios diferentes. Falha de acesso ao detalhamento ou criativo gera aviso, preservando os demais relatórios.
- Status/textos refletem a coleta mais recente, não um histórico de alterações. URLs das imagens podem expirar; há tratamento de prévia indisponível.

### Validação e pendências

Build e tipagem aprovados; suíte geral com 92 testes aprovada, incluindo testes de isolamento de contas/períodos/moedas, alcance, ações sobrepostas, paginação, proteção de URLs e deduplicação da fila. API local validada com dados reais das três contas e acesso ao Google preservado.

Marketing API Access Tier conferido: **Acesso limitado**; ads_read aparece como **Pronto para teste**. Publicação e leituras bem-sucedidas não equivalem a App Review ou acesso ampliado para outros clientes. A configuração atende às contas da JBR autorizadas neste documento. A ativação no Render depende da implantação deste código; não se deve confundir testes locais com deploy concluído.

Referências: [Usuários do sistema](https://developers.facebook.com/docs/business-management-apis/system-users/), [Tokens](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/), [Insights](https://developers.facebook.com/docs/graph-api/reference/adaccount/insights/).
