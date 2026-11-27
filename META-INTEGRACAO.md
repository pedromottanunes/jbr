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

## Estado da plataforma e próximos passos

**Aplicativo publicado, usuário novo configurado, token emitido, acesso validado e credencial armazenada no Atlas. O coletor periódico e o painel Meta no CRM ainda não foram implementados.**

1. Usar o segredo meta-ads-token no backend e restringir as consultas às três contas deste documento. Validar no ambiente Render com sua chave de criptografia antes de ativar a coleta.
2. Integrar a coleta à fila e aos leases existentes: deduplicação por conta/período, atualização incremental, paginação, limites e tentativas com espera progressiva. Não chamar a Meta a cada renderização do frontend.
3. Persistir apenas métricas e metadados necessários, com cobertura, moeda, fuso e estado da sincronização. Distinguir erro, ausência de linhas e zero medido. Não somar alcance entre contas como pessoas únicas.
4. Preservar Google Ads, Umbler e a política existente de armazenamento mínimo.
5. Marketing API Access Tier novamente conferido: **Acesso limitado**; ads_read aparece como **Pronto para teste**. Publicação e testes bem-sucedidos não equivalem a App Review ou acesso ampliado para outros clientes.

Referências: [Usuários do sistema](https://developers.facebook.com/docs/business-management-apis/system-users/), [Tokens](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/), [Insights](https://developers.facebook.com/docs/graph-api/reference/adaccount/insights/).
