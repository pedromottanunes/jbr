# Autorizar Google Ads no computador local

O WhatsApp já pode alimentar o CRM. Para conectar o Google Ads, falta criar as credenciais no projeto Google Cloud e concluir o consentimento do usuário.

## Contas confirmadas nos prints de 21/11/2026

- Conta gerente: **Merlin Publicidade**, `735-910-4084`. Usar `GOOGLE_ADS_LOGIN_CUSTOMER_ID=7359104084`.
- Conta anunciante vinculada diretamente: **JBR Soluções Transportes**, `913-774-4539`. Usar `GOOGLE_ADS_CUSTOMER_ID=9137744539`.
- **MCC da Rabbit**, `680-413-7478`, aparece como outra conta gerente acessível ao usuário. Os prints não mostram vínculo dela com a JBR; o caminho confirmado para esta integração é Merlin → JBR.
- **Projeto teste**, no Google Cloud, é o projeto de APIs e credenciais. Ele não substitui nenhuma das contas Google Ads acima. O print inicial não confirma que Google Ads API esteja ativada ou que haja cliente OAuth criado.

O usuário pode autorizar com seu próprio e-mail Google, desde que mantenha as permissões de acesso à JBR por meio da Merlin. O e-mail que criou a conta anunciante não precisa ser o usuário que autoriza o CRM. A API segue o [modelo de acesso e permissões do Google Ads](https://developers.google.com/google-ads/api/docs/oauth/access-model).

## Configurar OAuth

1. No [Google Cloud Console](https://console.cloud.google.com/), selecione ou crie o projeto que usará para o CRM JBR. Ative a **Google Ads API**. Confira na página da API o nível de acesso do projeto: a conta real da JBR exige acesso de produção, e não apenas Test. Veja a [configuração oficial](https://developers.google.com/google-ads/api/docs/oauth/cloud-project).
2. Configure a tela de consentimento em **Google Auth Platform**: nome do aplicativo, e-mail de suporte e público. Se estiver em teste, adicione o e-mail Google que acessa a JBR como usuário de teste.
3. Em **Clientes**, crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre exatamente esta URI de redirecionamento: `http://127.0.0.1:3001/oauth/google/callback`.
4. Copie o Client ID e o Client Secret para `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` no arquivo local `.env`. Coloque a URI acima em `GOOGLE_ADS_OAUTH_REDIRECT_URI`. Preencha também `GOOGLE_ADS_LOGIN_CUSTOMER_ID` com o ID do MCC e `GOOGLE_ADS_CUSTOMER_ID` com o ID da conta JBR, ambos sem hífens.
5. Na pasta `CRM JBR`, execute `npm run google:authorize`. Abra o endereço que o comando mostrar. Entre com a conta Google autorizada e conclua o consentimento. O Google pode exigir a autenticação com passkey; veja os [requisitos atuais](https://developers.google.com/google-ads/api/docs/oauth/security-requirements).

O assistente expira em cinco minutos, usa `state` e PKCE, aceita somente o callback local e salva o refresh token protegido pelo DPAPI do Windows em `local-data/google-refresh-token.dpapi`. Não é necessário copiar o token para `GOOGLE_ADS_REFRESH_TOKEN`. O cliente OAuth permanece no `.env`, excluído do Git. O assistente usa a biblioteca oficial `google-auth-library` e o [fluxo documentado pelo Google](https://developers.google.com/identity/protocols/oauth2/web-server).

A autorização é uma etapa separada da coleta. Depois de autorizar, execute `npm run sync:google` para consultar e salvar as campanhas locais; veja [DADOS-REAIS.md](DADOS-REAIS.md) para os limites e o período.

O callback é apenas para esta etapa local. Antes de publicar no Render, serão necessários o callback HTTPS, autenticação dos administradores e armazenamento de credenciais apropriado ao servidor.
