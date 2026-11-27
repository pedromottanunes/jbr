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

### Atualização dos relatórios

O cartão de orçamento consulta `account_budget` separadamente das campanhas: mostra a situação atual da conta, sem filtro histórico. Com o painel aberto, solicita atualização quando a última tentativa tem pelo menos 15 minutos, mesmo se o agendador global estiver desativado. O botão do próprio cartão permite consulta manual (mínimo 30 segundos); ambas respeitam `retry-after`, fila deduplicada e bloqueio do provedor Google. As requisições HTTP só enfileiram trabalho. Não é necessário ativar as coletas automáticas de outras integrações para manter esse cartão atualizado.

- Google e Meta usam cache automático de uma hora e intervalo mínimo de dez minutos para atualização manual. Abrir filtros lê o Atlas; a coleta externa é enfileirada, deduplicada e acompanhada por consultas de status.
- O botão **Atualizar dados** do Google agora solicita a coleta externa. Na Visão geral, **Atualizar painel** faz a mesma solicitação e relê os indicadores do CRM.
- Google conserva a cobertura histórica. As coletas automáticas renovam os últimos 90 dias dentro dessa cobertura e intervalos ainda ausentes, sem sobrepor consultas. Uma atualização manual também inclui o período escolhido. O histórico completo é reconciliado semanalmente; a primeira execução após esta mudança faz uma revisão completa. Isso permite incorporar revisões tardias de conversões sem reconsultar todo o histórico em cada atualização.
- As linhas Google são armazenadas em blocos de até 200 linhas/1 MiB, com geração publicada atomicamente e compatibilidade com o formato anterior. Dados inalterados reutilizam a geração; falhas preservam a anterior. Versões substituídas são limpas após a janela de segurança dos leitores.
- A Meta possui uma faixa de execução independente. Uma coleta Google/Umbler não bloqueia a Meta, mas cada provedor continua com exclusão mútua, limites persistidos, cancelamento e tentativas limitadas. Não há paralelismo ilimitado de chamadas.
- Teste isolado no mesmo Atlas com os dados reais: 12.803 linhas preservadas, 71 documentos em vez de 12.803; publicação em 1,8 s, com igualdade integral dos relatórios e reutilização da geração no segundo envio. Esse tempo é uma medição local contra o Atlas, não uma garantia de latência no Render.

O worker integrado só roda enquanto o Web Service está ativo. O Render pode suspendê-lo após 15 minutos sem tráfego; ao retornar, os dados publicados continuam no Atlas e a fila retoma com os bloqueios e checkpoints existentes. Não há promessa de atualização contínua com o serviço dormindo. Referência: [Render Free](https://render.com/docs/free).

Não há um processo novo por clique ou por requisição. A conexão Mongo é compartilhada (pool máximo 8); cada faixa do worker processa um lote por vez (Meta independente, demais integrações sequenciais) e respeita os limites e bloqueios dos provedores. O encerramento interrompe o loop e preserva o progresso. A retenção de conteúdo das conversas continua desativada; indicadores e metadados permanecem no Atlas.

Para execução contínua futura, é possível usar um serviço sempre ativo ou um Background Worker com `npm run start:worker`. Nesse caso, defina `EMBEDDED_WORKER=false` no Web Service. Não é necessário criar outro serviço para este teste.

## Acesso

`AUTH_USERNAME` e `AUTH_PASSWORD_HASH` são obrigatórios em produção com dados reais. Sessões usam cookies HttpOnly, Secure e SameSite=Lax; somente o digest do token é persistido, com expiração TTL. Mutações exigem a origem HTTPS configurada. Tentativas de login são limitadas. Alterar o usuário ou hash invalida sessões anteriores. É um acesso de administrador único, sem níveis de permissão por usuário nesta etapa.
