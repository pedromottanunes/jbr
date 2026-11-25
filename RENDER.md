# Deploy no Render

A versão atual suporta um administrador com login e sessão no MongoDB Atlas. O mesmo Web Service entrega a interface, a API e, quando `EMBEDDED_WORKER=true`, processa a fila. O modo local permanece restrito ao loopback.

## Serviço existente

| Campo | Valor |
| --- | --- |
| Tipo | Web Service / Node |
| Repositório / branch | pedromottanunes/jbr / main |
| Root Directory | vazio |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/ready` |

Execute `npm run render:prepare` localmente. O comando preserva `.env`, copia as credenciais necessárias para `.env.render` e cria um acesso em `local-data/render-login.txt` na primeira execução. Ambos os arquivos são privados e ignorados pelo Git. O hash da senha fica no ambiente do servidor; a senha está somente no arquivo privado de acesso. Uma nova execução preserva o login já configurado.

Em **Environment → Add from .env**, importe o conteúdo completo de `.env.render`, substituindo os valores antigos das mesmas variáveis. Use **Save, rebuild, and deploy** após enviar o código atualizado. Não copie o `.env` local: ele aponta para loopback e desenvolvimento. Não é necessário definir `PORT`; o servidor usa a porta fornecida pelo Render.

O arquivo gerado usa `APP_MODE=mongo`, `ALLOW_PUBLIC_DEMO=false`, `INTEGRATIONS_ENABLED=true` e `EMBEDDED_WORKER=true`. `SYNC_SCHEDULER_ENABLED=false` mantém as atualizações sob demanda pelo CRM. Os tokens de Google e Umbler já são lidos do Atlas com a mesma `CREDENTIALS_ENCRYPTION_KEY`; não precisa repetir o OAuth no Render. O nome `jbr_crm_dev` é intencional para acessar o histórico já importado.

No Atlas, mantenha liberadas as faixas de saída exibidas em **Connect → Outbound IP Addresses** do serviço. As faixas configuradas nesta instalação são `74.220.48.0/24` e `74.220.56.0/24`. Se mudar de região, confira novamente.

## Validar o acesso

1. Aguarde o deploy mostrar **Live** e abra `https://jbr-o9l2.onrender.com`.
2. Entre com o usuário e a senha do arquivo privado. A sessão dura 12 horas; **Sair** a revoga imediatamente.
3. Confira as áreas Leads, Visão geral e Tráfego pago. Elas leem o Atlas existente.
4. Em Conversas, selecionar um período agenda apenas o que precisa de análise. Em Tráfego pago, use a atualização do período para consultar métricas recentes.
5. Os logs devem mostrar o servidor ouvindo a porta e `Worker integrado ativo`. Erros não exibem credenciais.

`npm run render:verify` valida o arquivo de ambiente, o login, os tokens criptografados e as leituras reais no Atlas, sem consultar Google/Umbler. Requer que o IP do computador local também esteja autorizado no Atlas.

## Funcionamento no plano Free

O worker integrado só roda enquanto o Web Service está ativo. O Render pode suspendê-lo após 15 minutos sem tráfego; ao retornar, os dados publicados continuam no Atlas e a fila retoma com os bloqueios e checkpoints existentes. Não há promessa de atualização contínua com o serviço dormindo. Referência: [Render Free](https://render.com/docs/free).

Não há um processo novo por clique ou por requisição. A conexão Mongo é compartilhada (pool máximo 8); o loop processa um lote por vez e respeita os limites e bloqueios dos provedores. O encerramento interrompe o loop e preserva o progresso. A retenção de conteúdo das conversas continua desativada; indicadores e metadados permanecem no Atlas.

Para execução contínua futura, é possível usar um serviço sempre ativo ou um Background Worker com `npm run start:worker`. Nesse caso, defina `EMBEDDED_WORKER=false` no Web Service. Não é necessário criar outro serviço para este teste.

## Acesso

`AUTH_USERNAME` e `AUTH_PASSWORD_HASH` são obrigatórios em produção com dados reais. Sessões usam cookies HttpOnly, Secure e SameSite=Lax; somente o digest do token é persistido, com expiração TTL. Mutações exigem a origem HTTPS configurada. Tentativas de login são limitadas. Alterar o usuário ou hash invalida sessões anteriores. É um acesso de administrador único, sem níveis de permissão por usuário nesta etapa.
