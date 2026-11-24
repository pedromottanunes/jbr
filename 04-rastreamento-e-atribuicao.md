# Rastreamento e atribuição de leads

O CRM deve registrar o que ocorreu e a evidência disponível em cada etapa. A jornada desejada é **anúncio → visita → clique no CTA → mensagem recebida → contato → oportunidade → resultado comercial**. Nem todas essas ligações existem no material atual.

## Níveis de evidência propostos

| Evidência | O que permite afirmar | Limite |
| --- | --- | --- |
| Chave de ligação entre visita e primeira mensagem, associada a identificador publicitário verificável | Vínculo técnico entre um contato observado e aquela visita/clique. | Não prova exclusividade causal; chaves encaminhadas ou reutilizadas exigem tratamento. |
| Mensagem inicial compatível com um CTA versionado | Indício de uso daquele texto da landing e interesse no serviço. | Pode ser editada, copiada, compartilhada ou usada em outras origens; não prova campanha. |
| Etiqueta Google no provedor | Origem indicada pela operação. | Não substitui um vínculo de visita ou clique. |
| Origem informada manualmente | Declaração registrada pelo atendente ou contato. | Depende da qualidade da informação; preservar autoria. |
| Evidências incompatíveis | Origem em conflito. | Não resolver silenciosamente por prioridade arbitrária. |
| Nenhuma evidência suficiente | Origem desconhecida. | Não significa orgânico, direto ou ausência de anúncio. |

Guardar origem, método, evidência, versão da regra e momento da classificação em campos separados. A indicação “Google Ads” não deve apagar o fato de que foi inferida por texto ou etiqueta. Uma associação por proximidade de horário não deve criar atribuição individual.

## Catálogo inicial de mensagens da landing

Textos extraídos da versão local de `Land Page Atualizada/public_html/index.html` em 21/11/2026. Os IDs abaixo são rótulos propostos para o catálogo, ainda não implantados no site.

| ID proposto | Contexto | Mensagem |
| --- | --- | --- |
| CTA01 | Geral, rodapé e estado inicial dos botões de contato | Olá! Gostaria de orientação sobre o RNTRC. Como posso começar? |
| CTA02 | Cadastro, hero | Olá! Vou fazer meu primeiro cadastro no RNTRC. Quais documentos preciso reunir? |
| CTA03 | Regularização, hero | Olá! Preciso regularizar meu RNTRC. Como posso verificar a situação do meu registro? |
| CTA04 | Inclusão de veículo, hero | Olá! Preciso incluir um veículo na minha frota do RNTRC. Quais são os próximos passos? |
| CTA05 | Alteração de dados, hero | Olá! Preciso atualizar os dados do meu cadastro no RNTRC. Como faço a alteração? |
| CTA06 | Ajuda para escolher o serviço | Olá! Tenho uma dúvida sobre o RNTRC e não sei qual serviço escolher. Podem me ajudar? |
| CTA07 | Como funciona | Olá! Gostaria de entender como funciona a assessoria para o RNTRC, quais são as etapas e os prazos. |
| CTA08 | Atendimento a distância | Olá! Sou transportador e gostaria de saber como funciona o atendimento a distância para o meu RNTRC. |
| CTA09 | Contexto da seção de cursos | Olá! Estou vendo os cursos para condutores. Quais formações estão disponíveis e como faço a matrícula? |
| CTA10 | Contexto da seção de dúvidas | Olá! Consultei as dúvidas frequentes sobre o RNTRC e gostaria de esclarecer uma questão com a equipe. |
| CTA11 | Avaliações | Olá! Vi as avaliações de clientes da JBR e gostaria de conversar sobre o meu RNTRC. |

O JavaScript usa a seção visível para trocar a mensagem do botão flutuante e do contato do cabeçalho. Assim, CTA07, por exemplo, pode aparecer por mais de uma posição. Registrar separadamente página, seção, posição e texto efetivamente usado. O catálogo acima cobre a landing principal; páginas aninhadas de cursos, institucional, versões anteriores e textos efetivamente publicados precisam de catálogo complementar com datas de vigência.

## Reconhecimento inicial proposto

1. Considerar a primeira mensagem recebida do contato no episódio observado, ignorando bot, atendente e notas internas.
2. Guardar o texto original e produzir uma versão normalizada para comparação de espaços, caixa e acentuação.
3. Comparar com versões conhecidas do catálogo. Correspondência aproximada deve ser identificada como tal e revisável.
4. Registrar mensagem usada como evidência, versão do CTA, serviço sugerido e método da inferência.
5. Se o histórico anterior não estiver disponível, usar “primeira mensagem observada”, sem afirmar que foi o primeiro contato da pessoa com a JBR.

Uma frase mencionada mais tarde no atendimento não deve reescrever retroativamente a origem da aquisição. Também é necessário manter as interações de retorno separadas da origem inicial do cadastro.

## Ponte proposta para atribuição futura

Quando a implementação do rastreamento for autorizada, avaliar uma chave aleatória curta por saída ao WhatsApp. Antes do redirecionamento, registrar no servidor a chave, instante, página, CTA e identificadores disponíveis da visita. Acrescentar a referência ao texto pré-preenchido, sem expor telefone ou dados pessoais na chave.

Ao receber a mensagem pelo Umbler, buscar essa referência e relacionar a conversa à saída registrada. GCLID, GBRAID, WBRAID e UTMs devem ser preservados como campos distintos quando disponíveis; a capacidade de resolver campanha e demais dimensões depende do identificador, da configuração e das APIs aplicáveis. UTMs podem indicar origem, mas não têm o mesmo valor de verificação de um clique conciliado.

Apenas adicionar parâmetros ao link `wa.me` não comprova que eles chegarão ao payload da conversa. Da mesma forma, uma sessão no navegador não fornece o telefone do visitante. A ligação precisa sobreviver de forma observável até a mensagem recebida.

Se o visitante remover a referência, não enviar a mensagem ou compartilhar o texto, preservar o estado adequado: saída sem conversa vinculada, origem inferida ou associação em conflito. Atribuição retroativa exata não pode ser criada a partir de totais agregados.

Essa proposta altera site e experiência de contato; sua forma final será definida antes de implementação. Nesta etapa não houve alteração de links, tags ou mensagens.

## Revisão necessária do GTM

### Evidências da análise local para o funil

Na análise do cache real, foram encontrados 1.624 contatos com ao menos uma mensagem recebida não privada. A primeira mensagem observada foi selecionada por contato, reunindo suas conversas e ordenando por instante e ID. Esses números abrangem o histórico disponível, sem recorte mensal; não são totais da janela Google Ads nem garantem cobertura integral.

- 295 contatos iniciam o histórico observado com a frase normalizada “ola queria mais informacoes sobre os servicos antt por favor”, compatível com o exemplo dado pelo usuário. Ela deve entrar como candidata de CTA histórico, com sua origem e vigência a confirmar.
- Outras frases recorrentes são pedidos de informações sobre cadastro ANTT (142 contatos) e consulta ANTT (110 contatos). Frequência isolada não comprova uso de um botão específico.
- A extração de links WhatsApp e atributos de contexto dos HTMLs locais da landing anterior e atual, incluindo páginas de cursos, reuniu 50 textos distintos normalizados; 410 contatos têm a primeira mensagem observada exatamente compatível com algum deles após normalização. Essa contagem é exploratória: faltam confirmar publicação, vigência e versões de textos geradas em JavaScript. Não somar automaticamente aos 295 acima.
- Existem entradas com outras origens expressas no texto, inclusive referência a anúncio no ChatGPT. A regra de atribuir todo texto padronizado ao Google Ads produziria falsos vínculos.

O conector Google atual consulta `metrics.conversions` agregado por campanha, sem seleção de `conversion_action`; logo, o total ainda não está validado como conversões específicas do CTA WhatsApp. É necessário consultar as ações, validar configuração e contagem e distinguir a [data da conversão da data de interação](https://developers.google.com/google-ads/api/docs/conversions/reporting). Mesmo uma ação de botão não representa necessariamente pessoas únicas; o Google oferece [regras de contagem por ação e interação](https://support.google.com/google-ads/answer/3438531).

Conferir o contêiner publicado, eventos e gatilhos de CTA, ações primárias/secundárias, contagem, valores, configuração simultânea de GTM e gtag, UTMs e marcação automática. Verificar cliques repetidos, múltiplos botões e o comportamento após troca dinâmica do texto.

Definir com o responsável pelo projeto as condições de coleta, armazenamento e retenção dos identificadores. Manter texto de WhatsApp, telefone e conteúdo comercial fora de URLs de análise e eventos publicitários genéricos.
