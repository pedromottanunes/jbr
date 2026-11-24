# Etapas e decisões para o CRM JBR

O planejamento começa pela definição de operação e atribuição. A implementação depende de uma próxima orientação do usuário; esta etapa termina com registros locais, sem integração autenticada ou alteração dos projetos existentes.

## Sequência proposta

| Etapa | Resultado esperado | Critério de aceite |
| --- | --- | --- |
| 0 — Descoberta inicial | Inventário e proposta registrados nesta pasta. | Fontes existentes, limites, escopo e pendências documentados. Concluída nesta rodada. |
| 1 — Definições operacionais | Canais, contas, usuários, funil e critérios comerciais definidos; WhatsApp já confirmado como somente leitura. | Decisões registradas e lista do primeiro escopo fechada. |
| 2 — Desenho das telas | Protótipo de visão geral, tráfego, conversas e ficha do contato. | Identidade JBR reconhecível, navegação revisada, estados vazios/parciais e uso móvel contemplados. |
| 3 — Fundação e integração de leitura | Backend, acesso, persistência e sincronização Google/Umbler. | Repetir coleta não duplica dados; retomada e falhas preservam o último estado válido; comparação por amostra com a origem. |
| 4 — CRM operacional | Contatos automáticos, conversas consultáveis, responsáveis, oportunidades e histórico. | Mesmo contato em vários chats não duplica cadastro indevidamente; mudanças comerciais têm autoria. |
| 5 — Atribuição e reconciliação | Catálogo versionado, classificação de origem e ponte visita/conversa quando aprovada. | Casos com chave, sem chave, chave removida, reuso, retorno e conflito produzem resultados explicáveis. |
| 6 — Relatórios e piloto | Métricas reconciliadas e uso por grupo inicial. | Totais, recortes, fórmulas e cobertura conferidos; acessos e restauração de backup verificados. |

O desenho da ponte de rastreamento pertence às etapas iniciais, mesmo que sua ativação aconteça depois. Não prometer atribuição histórica que os dados existentes não permitem recuperar.

## Decisões pendentes prioritárias

| Tema | O que definir | Hipótese inicial para discussão |
| --- | --- | --- |
| Papel do Umbler | Decisão confirmada em 21/11/2026. | O CRM consulta o Umbler; não substitui o canal de envio. |
| Conversas | Decisão confirmada em 21/11/2026. | Exclusivamente leitura. Sem envio de texto, áudio ou anexos e sem alterações de chats no provedor. |
| Canais | Quais números e canais entram, incluindo divergência 0800 versus número de Curitiba? | Lista explícita de canais JBR; todas as origens nesses canais. |
| Usuários | Quem administra, acompanha tráfego e atende? Há restrição por carteira? | Perfis de administrador, gestor e atendente a validar. |
| Processo comercial | Quais serviços, etapas, critérios de qualificação e motivos de perda? | Serviços RNTRC e cursos observados nos sites. |
| Receita | Onde se confirma venda e recebimento? | Registro comercial explícito com evidência; texto só sugere classificação. |
| Rastreamento | Pode haver referência curta no texto de WhatsApp? Quais páginas são de aquisição? | Chave de ligação a avaliar antes de mudar a landing. |
| Google Ads | Conta cliente, MCC, ações de conversão e fuso/moeda efetivos. | Usar a referência para conexão; nenhuma credencial solicitada nesta rodada. |
| Histórico | Data inicial, volume, limites do plano e política de retenção. | Importação controlada com cobertura por conversa e período. |
| Atualização | Qual atraso é aceitável para mensagens e indicadores? | Cadências iniciais e limites definidos no plano técnico, ajustáveis após medir volume; sem promessa de tempo real. |
| Hospedagem | Render confirmado como destino futuro; faltam plano, região e domínio. | Desenvolvimento local primeiro, mesma stack e configuração portável. |

## Verificações previstas para a implementação

- Simular duplicidade, paginação, retomada, falhas parciais e limites de histórico.
- Confirmar isolamento por organização/canal e autorização de usuários.
- Testar um contato em dois chats, dois IDs no mesmo telefone, telefone ausente e número compartilhado.
- Validar primeira entrada, retorno, resposta de bot versus humana e horários anômalos.
- Conferir GTM publicado e teste completo de clique até mensagem, sem confundir saída com contato.
- Reconciliar métricas Ads por conta, período, fuso e ação de conversão; manter conversões decimais.
- Verificar que falha de API não gera zero nem remove dados válidos.
- Testar navegação, contraste, teclado e organização da tela de conversas em celular e computador.

## Limites desta rodada

Na descoberta inicial foram analisados arquivos locais e consultadas referências públicas oficiais das APIs. Não foram consultadas contas autenticadas, executadas coletas, migrados bancos ou alterados tags, sites, credenciais e conversas. No complemento de 21/11/2026, o usuário solicitou propostas visuais: cinco PNGs e seu registro de fontes foram adicionados em `estudos-visuais`, usando relatórios e consulta somente leitura à base local. Nenhuma aplicação foi implementada.

A leitura exclusiva do WhatsApp foi confirmada pelo usuário em 21/11/2026. A orientação seguinte definiu frontend limpo, controle de chamadas duplicadas, trabalho local e futuro deploy GitHub/Render. O [planejamento técnico](planejamento-tecnico/README.md) detalha a implementação e substitui as pendências iniciais de stack. Canais, perfis de acesso e processo comercial continuam a validar antes do piloto.

**Implementação iniciada em 21/11/2026:** a [primeira versão local](IMPLEMENTACAO.md) contém frontend, API de demonstração histórica, conectores de leitura isolados e migration inicial. Ainda não é um CRM conectado aos provedores nem um serviço pronto para publicação.
