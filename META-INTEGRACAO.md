# Meta — integração de métricas da JBR

Estado conferido em 27/11/2026. Escopo: somente leitura das contas de anúncios do portfólio JBR ANTT. Não criar/editar anúncios, campanhas, públicos, orçamentos, pagamentos ou enviar mensagens.

## Configuração concluída

| Recurso | Nome | ID |
|---|---|---|
| Portfólio proprietário | JBR ANTT | 107227610975997 |
| Aplicativo novo, publicado | JBR Integração | 1129420006733991 |
| Usuário do sistema novo, Employee | CRM JBR Métricas | 61597022790216 |
| Conta de anúncios | BM TESTE - HÉLIO | 1638336274287834 |
| Conta de anúncios | JBR CARTÃO | 523435535018960 |
| Conta de anúncios | JBR [CA - RESERVA] | 2705808446379845 |

O usuário autorizou a leitura das três contas. Os usuários do sistema e aplicativos anteriores não foram alterados. As três contas foram atribuídas ao usuário novo com **Ver desempenho**. O aplicativo JBR Integração foi atribuído com **Desenvolver app**, que a interface apresenta junto com Ver insights e Testar app. Não foi concedida administração geral do portfólio nem gerenciamento das contas de anúncios.

Os IDs acima são as identificações das contas exibidas pela Meta. O parâmetro `selected_asset_id` das URLs do Business Suite pode ser diferente e não deve ser utilizado como ID da conta na Graph API.

BM TESTE - HÉLIO apresenta aviso de desabilitação por forma de pagamento. Nenhuma cobrança ou configuração financeira foi alterada. A disponibilidade de seus relatórios históricos ainda precisa ser validada pela API.

## Aplicativo e páginas públicas

- Status **Publicado** confirmado na interface, com a mensagem de publicação concluída.
- Categoria: Negócio e Páginas.
- Domínio: `jbr-o9l2.onrender.com`.
- E-mail de contato do app: `pedromottanunes@hotmail.com`.
- Política: https://jbr-o9l2.onrender.com/privacidade.html
- Instruções de exclusão: https://jbr-o9l2.onrender.com/exclusao-de-dados.html
- Contato de solicitações da JBR: `comercial@jbrantt.com.br`, já presente no material institucional do projeto.

Páginas HTML estáticas em `front-end/public`, disponíveis sem login e sem depender de JavaScript. Links também incluídos no rodapé de login. Build e entrega HTTP 200 verificados localmente e no Render. Commit da publicação: `7620608`.

Os dois casos de uso previamente selecionados na criação foram mantidos: gerenciamento de anúncios e mensuração de desempenho. A presença desses casos de uso não significa concessão de todas as permissões no token. A solicitação de token realizada contém **somente `ads_read`**, sem `ads_management`, `business_management`, permissões de Páginas, WhatsApp ou Instagram orgânico.

## Pendência concreta: aprovação da geração do token

Foi solicitada a geração para o usuário novo e o aplicativo novo, com expiração **Nunca**. Isso significa ausência de expiração programada, não imunidade a revogação.

A Meta impôs aprovação por **outro administrador** do portfólio. A tela confirma que Pedro Nunes solicitou a geração para JBR Integração, permissão `ads_read`. O pedido expira em sete dias.

- Solicitação: `28634533266224535`.
- Link: https://business.facebook.com/latest/settings/requests?business_id=107227610975997&selected_request_id=28634533266224535
- Estado verificado: **Solicitação enviada**.
- Token ainda não emitido nem armazenado. Nenhuma consulta à Graph API foi executada com esta integração.

Não repetir a geração enquanto o pedido estiver pendente, nem tentar aprovar usando outra identidade. Outro administrador deve acessar Pedidos e aprovar pessoalmente.

## Retomada após aprovação

1. Confirmar a aprovação do pedido, a identidade do aplicativo e do usuário novo.
2. Concluir a geração e preservar a credencial criptografada antes de fechar a janela. Usar o mecanismo de segredos do backend, coleção `integration_credentials`, chave dedicada `meta-ads-token`, com `CREDENTIALS_ENCRYPTION_KEY`. Nunca inserir a credencial em arquivos versionados, frontend, URL ou logs. A gravação ainda não ocorreu.
3. Selecionar versão suportada da Graph API na documentação vigente. Validar token/identidade e ler cada conta autorizada com `Authorization: Bearer`.
4. Fazer consultas pequenas a campanhas, conjuntos, anúncios e insights, com período explícito, incluindo moeda e fuso de cada conta. Registrar paginação e critério de atribuição; não somar alcance de contas como pessoas únicas nem tratar ausência de dados como zero confirmado.
5. Conferir permissões e Marketing API Access Tier. Na inspeção inicial o Tier estava como **Acesso limitado**. Publicação não equivale a App Review, acesso ampliado ou validação das APIs.
6. Integrar a coleta ao backend e ao painel com cobertura por conta/período, deduplicação, fila e limites de chamadas. Essa implementação de métricas Meta ainda não foi realizada; preservar Google Ads, Umbler e as regras de armazenamento mínimo existentes.

Referências oficiais: [Usuários do sistema](https://developers.facebook.com/docs/business-management-apis/system-users/), [Tokens](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/), [Visão geral e níveis de acesso](https://developers.facebook.com/docs/business-management-apis/system-users/overview/).
