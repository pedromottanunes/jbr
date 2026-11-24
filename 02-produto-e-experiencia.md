# Produto e experiência do CRM JBR

Proposta inicial para concentrar aquisição e relacionamento comercial. A navegação deve permitir sair de um indicador, entender sua composição e chegar ao cadastro e às conversas que o sustentam, respeitando o nível de atribuição disponível.

Diretriz posterior confirmada pelo usuário: interface limpa, sem subtítulos explicativos de rotina. Aplicar a [especificação técnica de interface](planejamento-tecnico/02-interface.md), que prevalece sobre a densidade dos primeiros PNGs. Manter explicações em detalhes sob demanda e avisos somente quando afetarem o dado consultado.

## Módulos propostos

| Área | Conteúdo e ações |
| --- | --- |
| Visão geral | Investimento, cliques, conversões Google, contatos novos observados, leads qualificados, oportunidades e resultados; filtros de período e indicação de cobertura. |
| Tráfego pago | Campanhas, grupos, palavras-chave, termos de pesquisa disponíveis, dispositivos, rede, horários, páginas de destino e ações de conversão. Comparação de períodos e acesso ao detalhamento. |
| Conversas | Lista de conversas, mensagens em ordem temporal, busca, filtros por canal, atendente, estado e origem; acesso ao contato e às oportunidades. |
| Leads | Cadastro automático a partir de contato direto recebido, telefone, nome disponível, serviço, responsável, etiquetas, origem e histórico. Visões em lista e por estágio. |
| Relatórios | Aquisição, qualidade dos leads, tempo até resposta humana, evolução comercial e cobertura da atribuição. Exportação sujeita às permissões do usuário. |
| Configurações | Usuários e acessos, canais, conta Ads, conexão, última sincronização, falhas, catálogo de CTAs e regras comerciais. |

## Tela de conversas

Adotar a organização familiar do WhatsApp Web com identidade JBR: lista à esquerda, histórico no centro e ficha do lead em painel lateral recolhível. A ficha exibe telefone, responsável, serviço, estágio e origem com sua evidência.

Separar visualmente mensagens do contato, atendente e bot. Mostrar data, hora, tipo e estado apenas quando disponíveis no provedor. Indicar histórico parcial e anexos indisponíveis. Notas privadas precisam de tratamento e permissão próprios; não devem aparecer como mensagens enviadas ao cliente.

No celular, alternar entre lista, conversa e ficha em vez de comprimir três colunas. Busca e filtros devem preservar o contexto ao retornar à lista.

**Escopo confirmado em 21/11/2026:** a integração WhatsApp/Umbler Talk será exclusivamente de leitura. O CRM exibirá conversas e dados disponíveis, sem compositor, botão de envio, resposta automática, envio de anexos ou alterações de chats no provedor. Consultar uma conversa não deve marcá-la como lida no Umbler. A gestão de cadastro e oportunidades pertence ao CRM local e não implica escrita no provedor.

## Cadastro e funil

Todo contato direto elegível recebido deve gerar ou atualizar seu cadastro, mesmo quando não houver indicação de Google Ads. A identificação comercial acontece depois: cliente recorrente, novo interessado, suporte, contato fora do perfil ou classificação pendente.

Proposta de etapas para oportunidades: **Novo → Em atendimento → Qualificado → Proposta enviada → Ganho ou Perdido**. Aguardar documentos e follow-up podem ser situações operacionais associadas. Validar essa estrutura com o atendimento antes de transformá-la em regra.

Um contato pode ter várias conversas e várias oportunidades. Encerrar uma conversa não equivale a ganhar ou perder uma oportunidade. Expressões detectadas no texto podem sugerir classificação; fechamento, receita e perda precisam de registro verificável e possibilidade de revisão.

## Identidade visual derivada da landing

| Elemento observado | Valor | Aplicação proposta |
| --- | --- | --- |
| Azul principal | `#172b53` | Texto, navegação e títulos. |
| Azul escuro | `#112141` | Cabeçalho e áreas de destaque. |
| Fundo claro | `#f8f7f0` | Fundo da aplicação. |
| Branco | `#ffffff` | Superfícies de tabelas, fichas e mensagens. |
| Divisórias | `#d8dcd9` | Separação discreta de linhas e painéis. |
| Texto secundário | `#34425a` | Descrições e metadados. |
| Verde | `#2faa52`, `#18753a`; cabeçalho usa `#006846` | Ações, confirmação e presença de WhatsApp. |
| Amarelo | `#f0e92e`; cabeçalho usa `#f6e300` | Seleção e destaques pontuais. |
| Tipografia efetiva do corpo | Arial, Helvetica, sans-serif | Interface, dados e mensagens. |

O CSS declara uma variável serifada Georgia, mas o corpo efetivamente usa Arial/Helvetica. Não adotar uma fonte diferente apenas por ela existir no arquivo.

Reutilizar futuramente os arquivos oficiais `assets/jbr-logo.webp` e `assets/jbr-logo-white.webp`, preservando proporção. Cards brancos, bordas discretas, cantos suaves e botões arredondados mantêm continuidade com a landing. Fotos e animações da página comercial não precisam ocupar a área operacional.

A interface deve priorizar leitura de tabelas e mensagens, foco visível, operação por teclado e estados compreensíveis sem depender só de cor. Contraste e responsividade serão verificados no protótipo.

## Estados que precisam de desenho

Prever carregamento, primeira conexão, período sem registros, filtro sem resultados, conexão expirada, coleta parcial, dado desatualizado e acesso sem permissão. “Nenhum registro” e “não foi possível consultar” devem produzir mensagens distintas. Indicadores sem base suficiente aparecem como indisponíveis, com motivo e horário da última atualização válida.

## Diretriz da visão geral: funil e rastro dos leads

Pedido posterior do usuário, com imagens de um CRM de referência: a visão geral deve mostrar aquisição, entrada no WhatsApp, atendimento e resultado comercial. Os números, serviços capilares e integração Meta das imagens pertencem à referência, não à JBR. Usar sua organização funcional mantendo a identidade clara da landing JBR e explicações sob demanda.

### Organização da tela

1. Cabeçalho com período, filtro de origem e atualização das fontes. Os filtros abrangem a mesma janela; a evolução comercial dos leads recebidos nessa janela é acompanhada até um corte explícito.
2. Linha de indicadores: investimento Google Ads, cliques nos anúncios, conversões da ação WhatsApp, leads recebidos, entradas compatíveis com CTA do site e vendas confirmadas. Valores sem fonte ou sem classificação ficam indisponíveis, nunca zero presumido.
3. Painel principal: captação (cliques e conversões) seguida do funil comercial (recebidos, atendidos, qualificados, proposta enviada, ganhos). Mostrar a passagem entre ações publicitárias agregadas e contatos identificados como comparação, sem alegar correspondência individual ou abandono comprovado. Pessoas que pularam etapas não recebem eventos intermediários inventados; distinguir etapa atual de etapas alcançadas.
4. Ao lado: origem e evidência dos leads, incluindo site por CTA, mídia paga confirmada, indicação por etiqueta, outras origens, desconhecidos e conflitos. A visualização deve escolher um eixo e uma classificação mutuamente exclusiva; evidências adicionais ficam no detalhe e não somam o lead novamente.
5. Área inferior: rastro dos leads, com busca por nome/telefone e filtro de etapa. Selecionar um lead abre linha do tempo com primeira entrada observada, mensagem de CTA e versão reconhecida, primeira resposta humana, serviço indicado, qualificação, proposta, resultado e valor quando registrado. Cada evento leva à conversa/mensagem ou registro que o sustenta.
6. Receita, ROAS e serviços vendidos entram quando existirem vendas e valores confirmados. Interesse em serviço e serviço vendido são indicadores distintos. Sem vínculo de aquisição compatível, ROAS não será calculado.

### Definições operacionais

| Etapa | Unidade / evidência |
| --- | --- |
| Cliques Google Ads | Interações reportadas pela API, não pessoas únicas nem todas as visitas do site. |
| Conversões WhatsApp | Somente ações Google validadas como clique no CTA; preservam atribuição, contagem e possíveis frações. Não equivalem automaticamente a todos os cliques do site. |
| Leads recebidos | Contatos distintos com entrada elegível na janela; separar novos observados e retornos. O total de contatos do cache não é o total do período. |
| Entrada pelo site indicada | Primeira mensagem recebida do episódio corresponde a CTA conhecido, com versão e confiança; não classificar automaticamente como anúncio pago. |
| Em atendimento | Resposta humana posterior à entrada. Mensagem de bot ou nota interna não conta como resposta ao lead. |
| Qualificado | Serviço e necessidade enquadrados em regra comercial explícita, com evidência e revisão. Ainda depende de definição operacional. |
| Proposta enviada | Registro explícito de proposta vinculada à oportunidade; mera menção a preço não basta. |
| Ganho / perdido | Resultado comercial confirmado no CRM, com data, responsável e evidência. Fechamento do chat não é fechamento da venda. |

Cada contato conta uma vez por etapa no funil de leads da coorte. O cadastro preserva conversas, retornos e oportunidades distintas. Taxas usam a mesma população e denominadores positivos; etapas sem cobertura aparecem como indisponíveis. Não calcular a taxa de vendas dividindo vendas de clientes antigos pelos novos leads do período.

### Preparação técnica para implementação

1. Consultar fuso/moeda da conta e ações de conversão Google. Validar com o GTM qual ação mede o botão; armazenar dados diários e ações separadas, distinguindo data de interação e data de conversão. O cache atual elimina a dimensão diária após agregar campanhas e precisa evoluir para filtros de período.
2. Catalogar CTAs atuais e antigos com página, canal, serviço e vigência. Reconhecer somente mensagens de entrada elegíveis, ignorando bot e notas privadas. Salvar mensagem, texto original, versão da regra e classificação. Correspondência aproximada é sugestão revisável; histórico parcial mantém o rótulo “primeira observada”.
3. Criar histórico persistente de eventos comerciais e oportunidades dentro do CRM. A rotina de publicação do cache não pode apagar classificações manuais. O Umbler permanece somente leitura.
4. Materializar agregações e evidências na sincronização e expor consultas locais por período/origem. Abertura de tela ou clique em etapa não chama APIs externas. Falhas parciais preservam dados válidos e sua cobertura.
5. Implementar funil e rastro com acesso aos registros que compõem cada número. Validar idempotência, datas, contatos repetidos, retornos, etapas puladas, ausência de informação e mudança de texto do site.
6. Para o rastro individual desde o anúncio, desenvolver posteriormente a ponte visita → mensagem descrita em `04-rastreamento-e-atribuicao.md`. Totais e frases genéricas não permitem reconstruir retroativamente campanha e clique de cada pessoa.

Implementação inicial entregue em 21/11/2026: funil de entradas e atendimento, métricas diárias Google, catálogo de CTAs, origens exclusivas e rastro com links às mensagens. Classificação comercial e atribuição individual de anúncio continuam pendentes. Regras operacionais, cobertura e verificações estão em [FUNIL.md](FUNIL.md).
