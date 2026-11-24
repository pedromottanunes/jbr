# Dados e indicadores do CRM

Modelo conceitual proposto, sem tabelas criadas. O princípio é separar pessoa ou contato, conversa, oportunidade comercial e atividade publicitária para evitar contagens duplicadas e associações sem evidência.

## Entidades

| Entidade | Campos e relações essenciais |
| --- | --- |
| Contato | ID interno, nome disponível, telefone original e normalizado, primeira entrada observada, responsável, classificação e datas. |
| Identidade externa | Organização, provedor, ID de contato externo, canal quando necessário e vínculo com contato interno. |
| Conversa | Organização, canal, ID externo, contato, estado no provedor, atendente, datas e cobertura histórica. |
| Mensagem | Organização, conversa, ID externo, direção, autor/tipo, instante do evento, instante de ingestão, texto, estado e referências de mídia. |
| Oportunidade | Contato, serviço, responsável, estágio, valor proposto, resultado, motivo de perda e datas. |
| Evento comercial | Oportunidade, identificação de venda/recebimento, valor, moeda, data e origem da confirmação. |
| Histórico de alterações | Entidade afetada, campo, valores anterior/novo, autor, instante e justificativa quando necessária. |
| Visita e saída para WhatsApp | Chave de ligação, sessão quando disponível, página, CTA, horário, UTMs e identificadores de clique disponíveis. |
| Evidência de atribuição | Contato/conversa/oportunidade, origem sugerida, método, mensagem ou visita de referência, regra e decisão de revisão. |
| Catálogo de CTA | ID estável, versão, texto, página, serviço, vigência e posição/contexto. |
| Métrica Ads | Conta, data no fuso da conta, entidade, dimensão, métricas, moeda e instante de sincronização. |
| Execução de sincronização | Provedor, escopo, intervalo, cursor, status, cobertura, última execução válida e erro sanitizado. |

## Identidade e deduplicação

Usar identificadores do provedor dentro da organização, mantendo associação explícita com um ID interno estável. Normalizar telefone em formato internacional quando houver informação suficiente, preservando o original. Não assumir país ou corrigir dígitos de forma silenciosa.

O mesmo número pode aparecer em mais de um canal, e uma pessoa pode ter vários números. Números compartilhados ou reciclados também existem. Correspondência exata em número validado pode orientar a consolidação, mas conflitos devem ir para revisão, com histórico de fusão e possibilidade de desfazer. Nome igual não é critério suficiente.

Sem telefone utilizável, manter cadastro provisório por identidade externa. Uma segunda conversa não deve criar automaticamente um segundo contato; um novo pedido de serviço pode criar outra oportunidade para o mesmo contato.

Deduplicar mensagens por organização, conversa e ID externo. Reprocessar dados não deve aumentar as contagens. Registrar edição/exclusão quando detectável e distinguir ausência de acesso de exclusão confirmada.

## Datas e cobertura

Guardar instantes de mensagens em UTC e exibir inicialmente em `America/Sao_Paulo`. Conservar também o fuso e a data de referência da conta Ads. Conversões por data da interação e por data de conversão precisam de indicadores separados.

Não tratar a data de criação do chat como primeira mensagem do lead. Quando houver histórico limitado, “novo” significa novo dentro da cobertura conhecida; apresentar essa limitação. Preservar ordem e evidências originais em anomalias de horário de bots e respostas estruturadas.

Cada relatório deve declarar período, fuso, canais/contas incluídos, última atualização, regras de deduplicação, método de atribuição e cobertura. Comparar períodos de mesma duração ou indicar a diferença. Períodos em andamento não devem ser apresentados como completos.

## Dicionário inicial de métricas

| Indicador | Definição proposta |
| --- | --- |
| Investimento | Soma do custo da fonte Ads de totais, em moeda única e período explícito. |
| CTR | Cliques ÷ impressões × 100. |
| CPC | Investimento ÷ cliques. |
| Conversões Google | Valor retornado pela métrica e ação escolhidas, preservando decimais. Não é uma contagem de pessoas. |
| Custo por conversão Google | Investimento ÷ conversões da definição selecionada. |
| Saídas para WhatsApp | Eventos de clique registrados pelo rastreamento do site. Só podem ser contados quando a fonte existir. |
| Contatos com entrada | Contatos distintos com mensagem recebida elegível no período. |
| Novos contatos observados | Contatos cuja primeira entrada conhecida está no período, com cobertura declarada. |
| Retornos | Contatos com entrada no período e entrada conhecida anterior. |
| Leads qualificados | Contatos/oportunidades que atendem aos critérios comerciais acordados, com evidência ou revisão. Exibir a unidade escolhida. |
| Conversas sem resposta humana | Conversas com entrada elegível sem resposta de atendente até o corte; bot não conta como resposta humana. |
| Tempo até primeira resposta | Tempo entre entrada elegível e primeira resposta humana; mediana e percentis, com casos sem resposta separados. |
| Oportunidades ganhas | Oportunidades com fechamento confirmado e data de ganho no recorte. |
| Receita recebida | Soma dos recebimentos conciliados, na data de recebimento, separada do valor proposto e da venda contratada. |
| Cobertura da atribuição | Contatos com vínculo verificável ÷ contatos elegíveis da população informada. Exibir também inferidos, desconhecidos e conflitos. |

Denominador zero ou ausente resulta em “não calculável”, não em zero ou infinito. Dado faltante não equivale a desempenho nulo.

## Métricas que exigem ligação entre fontes

CPL atribuído exige investimento e leads associados ao mesmo escopo de aquisição. Enquanto houver apenas textos ou etiquetas, apresentar uma estimativa identificada pela sua origem indicada, sem tratar como atribuição exata por campanha.

ROAS comercial exige receita atribuída e investimento compatível com a coorte escolhida. Não usar valores de proposta, valores padrão das ações Google ou qualquer menção a preço como receita recebida. CAC exige definição de cliente adquirido e do conjunto de custos; se o numerador incluir apenas mídia, explicitar esse recorte.

Uma taxa entre oportunidade e venda usa a mesma população de origem e uma janela de maturação definida. Não dividir vendas de clientes antigos pelos novos leads do mês. Uma taxa entre saída para WhatsApp e conversa só é diretamente observável no subconjunto com ligação; razão entre totais agregados deve ser identificada como comparação, sem alegar abandono individual.
