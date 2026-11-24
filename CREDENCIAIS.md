# Variáveis locais do CRM JBR

O CRM está em **modo local com dados reais do Umbler Talk**. O servidor lê `APP_MODE=local` e consulta o cache SQLite em `local-data/umbler.sqlite3`. A coleta é executada separadamente por `npm run sync:umbler`, usando o token protegido do Windows. O script de migração PostgreSQL lê `DATABASE_URL`; o Docker Compose lê `POSTGRES_PASSWORD`. Esses dois últimos ainda não são necessários para o modo local.

Edite apenas `CRM JBR/.env`, que já está excluído do Git. Não coloque senhas ou tokens em mensagens, imagens ou documentação.

## Aplicação local

| Variável | Como preencher agora | Uso |
| --- | --- | --- |
| `APP_MODE` | `local` | Dados reais do cache local. `demo` continua disponível para a amostra anonimizada. |
| `HOST` | `127.0.0.1` | Limita o servidor ao computador local. |
| `PORT` | `3000` | Porta da API. Se estiver ocupada, escolha outra porta livre. |
| `APP_ORIGIN` | `http://127.0.0.1:5173` | Endereço do frontend local; reservado para a configuração futura de origem e sessão. |
| `INTEGRATIONS_ENABLED` | `false` | Não habilita chamadas pelo servidor web. A coleta manual usa um comando separado. |
| `SYNC_SCHEDULER_ENABLED` | `false` | Ainda não há agendador ativo. |

## PostgreSQL

Deixe ambos vazios enquanto usar o cache SQLite local. Quando instalar e iniciar o PostgreSQL via `compose.yaml`:

| Variável | Como obter/preencher |
| --- | --- |
| `POSTGRES_PASSWORD` | Crie uma senha forte e exclusiva em um gerenciador de senhas. O Compose a usará para criar o usuário `jbr_crm`. |
| `DATABASE_URL` | Use `postgresql://jbr_crm:SENHA@127.0.0.1:5432/jbr_crm`, substituindo `SENHA` pela mesma senha. Caracteres reservados na senha precisam de codificação URL dentro da URL. |

O script `npm run db:migrate` só funcionará depois que o banco estiver acessível. A demonstração não exige banco.

## Google Ads

Para a futura conexão, escolha um **projeto no Google Cloud**, ative a Google Ads API nele e confira na página [Google Ads API Overview](https://console.cloud.google.com/apis/api/googleads.googleapis.com/overview) se o nível de acesso permite consultar a conta real da JBR. Crie as credenciais OAuth no mesmo projeto. O token antigo do MCC, sozinho, não autoriza a leitura de dados. A documentação do Google informa que, desde setembro de 2026, o nível de acesso passou a ser associado ao projeto Cloud e o header de developer token se tornou opcional e ignorado. Consulte a [mudança oficial](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) antes de reutilizar configurações antigas.

| Variável | Onde encontrar / como preencher |
| --- | --- |
| `GOOGLE_ADS_API_VERSION` | `v26` é a versão principal atual em 21/11/2026. É a versão do caminho REST, mesmo com a revisão `v26.2` nas [notas de versão](https://developers.google.com/google-ads/api/docs/release-notes). Deixe vazia até a conexão ser implementada. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Se você já tem o token antigo do MCC, ele era exibido na Central de API da conta gerente. Hoje pode ficar vazio: a autorização da API é gerenciada no projeto Cloud. Este campo é opcional no conector. |
| `GOOGLE_ADS_CLIENT_ID` | ID do cliente OAuth no Google Cloud Console, em **APIs e serviços / Credenciais** ou **Google Auth Platform / Clientes**. Use o projeto em que a Google Ads API foi habilitada. |
| `GOOGLE_ADS_CLIENT_SECRET` | Segredo do mesmo cliente OAuth. Não é a senha da conta Google nem o developer token. |
| `GOOGLE_ADS_OAUTH_REDIRECT_URI` | `http://127.0.0.1:3001/oauth/google/callback`. Cadastre exatamente essa URI no cliente OAuth do tipo Aplicativo da Web. O comando `npm run google:authorize` inicia esse callback temporário. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID de dez dígitos da conta gerente MCC que dá acesso à JBR, **sem hífens**. |
| `GOOGLE_ADS_CUSTOMER_ID` | ID de dez dígitos da conta de anúncios da JBR, **sem hífens**. |
| `GOOGLE_ADS_REFRESH_TOKEN` | Deixe vazio no fluxo local. O assistente de autorização salva o token protegido em `local-data/google-refresh-token.dpapi`. |

Os IDs das contas aparecem no Google Ads, perto do nome da conta ou no menu da conta gerente; veja [onde localizar o ID](https://support.google.com/google-ads/answer/1704344). Siga [GOOGLE-OAUTH.md](GOOGLE-OAUTH.md) para criar o cliente e concluir a autorização local. A sincronização de campanhas ainda depende dessa configuração e da implementação da coleta Ads.

## Umbler Talk (Rumble)

| Variável | Como preencher agora |
| --- | --- |
| `UMBLER_TALK_TOKEN` | **Deixe vazio.** O projeto antigo já tem um token protegido pelo DPAPI do Windows em `%LOCALAPPDATA%\UmblerTalkReader\api_token.dpapi`. |

O comando `npm run sync:umbler` já abre essa credencial apenas no processo do coletor e a remove do ambiente ao terminar. O servidor web não recebe o token. No Render, será necessário configurar um segredo do serviço, pois o DPAPI do Windows não é portátil. O acesso ao Umbler Talk é somente de leitura.
