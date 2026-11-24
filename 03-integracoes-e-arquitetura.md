# Integrações e arquitetura propostas

A interface deve consultar dados persistidos pelo backend. Processos de sincronização consultam os provedores, normalizam os registros e preservam a cobertura de cada execução. Essa separação permite abrir o CRM mesmo quando uma API está lenta ou indisponível.

Fluxo proposto: **Google Ads e Umbler Talk → conectores no servidor → persistência e reconciliação → API interna → interface JBR**. Em uma etapa posterior, eventos de visita e clique da landing entram nessa mesma persistência para vinculação às conversas.

## Google Ads

Usar [Google API Referência.txt](../Google%20API%20Refer%C3%AAncia.txt) como guia de adaptação. O material vem do Rabbit CRM, usa dependências próprias e não é um módulo executável independente.

Preservar os seguintes comportamentos descritos na referência:

- OAuth com acesso offline, validação de sessão e `state`, prazo e prevenção de reutilização do fluxo.
- Tokens criptografados no servidor, chave separada e renovação coordenada. Uma nova autorização não pode ser sobrescrita por uma renovação antiga.
- Conta cliente distinta do MCC; IDs sem hífens e `login-customer-id` quando aplicável.
- Consulta GAQL por `POST /customers/{customerId}/googleAds:searchStream`, com Bearer e developer token; datas e campos controlados pelo servidor.
- Conversão de `cost_micros` por 1.000.000, valores monetários precisos, conversões decimais e preservação de moeda e fuso da conta.
- Atualização idempotente por conta, entidade, período e granularidade. O nome de uma campanha não deve definir sua identidade.
- Falhas parciais não apagam métricas válidas nem viram zero. Cada dimensão precisa registrar atualização e cobertura próprias.

A referência cita `v23`; isso é uma informação do arquivo, não uma versão aprovada para o CRM. Conferir suporte e compatibilidade dos campos na implementação. O Google documenta `SearchStream` como resposta contínua e `Search` como consulta paginada; a escolha deve considerar volume e memória. [Documentação oficial de relatórios](https://developers.google.com/google-ads/api/docs/reporting/streaming).

### Cuidados ao adaptar

O exemplo contém limites de 500, 1.000 e 10.000 linhas em consultas. Não tratá-los como coleta integral. Remover limites arbitrários ou particionar consultas e verificar cobertura. Validar todos os blocos antes de substituir dados de um recorte.

Não somar tabelas de dimensões diferentes como se fossem parcelas do investimento: campanha, dispositivo e palavra-chave podem descrever os mesmos eventos. Definir uma fonte para os totais e usar as demais para detalhamento. Distinguir palavras-chave configuradas de termos pesquisados efetivamente disponibilizados.

Reprocessar uma janela recente para absorver ajustes de conversão; duração a definir. Registrar se o relatório usa data da interação publicitária ou data da conversão. Não equiparar `conversions`, `all_conversions` e valor de conversão a leads ou receita do CRM.

O primeiro módulo Ads será analítico. Criação de campanhas, alterações de orçamento e envio de conversões offline ficam fora do primeiro escopo. Uma futura devolução de resultados comerciais ao Google exige desenho próprio de identificação, configuração e diagnóstico. [Documentação oficial de conversões offline](https://developers.google.com/google-ads/api/docs/conversions/upload-offline).

## Umbler Talk

O coletor atual usa a base `https://app-utalk.umbler.com/api`, autenticação Bearer e rotas GET de membros, canais, etiquetas, chats e mensagens relativas. Isso descreve o código existente; os contratos deverão ser conferidos antes da implementação.

| Comportamento existente | Adaptação necessária |
| --- | --- |
| SQLite e respostas em `raw_json` | Modelar banco próprio do CRM e política de retenção dos payloads. |
| Paginação, sobreposição de horários e retomada | Reaproveitar a estratégia e testar fronteiras, atrasos e páginas repetidas. |
| Exportação por etiqueta `Google ADS` | Coletar todos os canais WhatsApp incluídos no projeto, sem restringir o CRM à etiqueta. |
| Mensagens e chats com identificadores | Usar chaves externas compostas e operações idempotentes. |
| Indicação de limite histórico do plano | Exibir cobertura incompleta na conversa e nos indicadores. |
| Sem download de mídia ou envio de mensagens | Validar somente consulta de anexos; envio e atendimento ativo pelo CRM estão fora do escopo. |
| Incremento por horário | Prever reconciliação de edições, exclusões e mensagens antigas recebidas tardiamente. |

No código, a sincronização pode incluir grupos; o novo cadastro automático deve considerar conversas diretas e excluir grupos do funil individual. A exportação TXT exclui notas privadas, mas o armazenamento bruto precisa ser analisado separadamente antes da migração.

O manual oficial descreve autenticação e acesso condicionado ao plano e remete ao Swagger para as rotas. A disponibilidade real para a JBR depende da conta e de suas permissões. [Manual da API do Talk](https://help.umbler.com/hc/pt-br/articles/21150267515149-Manual-da-API-do-Talk).

A integração será exclusivamente de leitura, conforme decisão de 21/11/2026. Não implementar envio nem mutações de chats. Não presumir webhook ou atualização instantânea com base no coletor existente. Avaliar eventos disponíveis; se houver webhook utilizável, verificar autenticação, repetição e ordem de entrega. Caso contrário, usar consulta periódica com intervalo compatível com limites e volume. Em ambos os casos, reconciliar o histórico.

## Persistência e operação

Registrar dados e avanço do cursor na mesma transação; executar tentativas limitadas com espera para falhas transitórias e respeito a `Retry-After`. Erros de autorização exigem estado de reconexão ou correção de acesso. Logs não podem conter tokens ou transcrições completas por padrão.

Proposta de acesso: administrador configura integrações; gestor consulta desempenho e gerencia a operação; atendente acessa a carteira autorizada. A definição final depende da equipe. Toda alteração de responsável, estágio, origem, fusão de contatos e resultado comercial deve registrar autor e momento.

Credenciais DPAPI do coletor local não serão copiadas para documentação nem tratadas como credenciais portáveis de produção. O CRM terá configuração de servidor, acesso autenticado, backup com restauração verificável e política própria de conservação de mensagens e anexos.

## Tecnologia definida no planejamento técnico

O [plano técnico](planejamento-tecnico/README.md) estabelece React/TypeScript/Vite, Node/Fastify, PostgreSQL e pg-boss, com API e worker separados no mesmo repositório. A implantação começa localmente e será levada ao Render depois. O Python existente serve de referência e origem de importação, sem um segundo backend permanente. Contratação, domínio e dimensionamento remoto permanecem pendentes.
