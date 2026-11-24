# Investigação de dados comerciais Umbler Talk

**Atualização:** as etiquetas observadas no cache já aparecem no rastro individual da Visão geral, com indicação da origem (contato ou conversa). Registros antigos de diferentes conversas podem ser reunidos para um contato; o resultado não é necessariamente o estado atual e não informa a data de aplicação. Telefones idênticos agrupados na visão geral também reúnem suas etiquetas. As etapas comerciais continuam sem classificação automática.

Na lista Leads, as etiquetas são agrupadas por nome em origem, atendimento, serviço, responsável e outras, por uma regra local revisável em `src/shared/lead-tags.ts`. Uma consulta GET ao catálogo de etiquetas retornou 39 registros, com propriedade `groupIds` sem valores preenchidos nos itens retornados; isso não comprova ausência de grupos além da página consultada. A categoria é uma organização visual, sem inferir que o valor seja o atual ou confirmar venda, receita ou tráfego pago. Etiquetas desconhecidas ficam em Outras, sem descarte, e origens simultâneas são preservadas.

Investigação de leitura em 21/11/2026: documentação OpenAPI pública e cache local da JBR, complementados por até 10 chamadas autenticadas GET, sequenciais e sob a mesma trava e espera do coletor existente. Não foram realizadas operações de escrita, envio ou alteração de estado.

## Resultados observados

- A base local tem 6.054 registros de conversas e 4.999 IDs distintos de contato direto. Destes, 2.347 têm alguma etiqueta de contato em pelo menos um registro conhecido. São números do cache parcial, não uma contagem completa da agenda. Etiquetas foram unidas entre registros históricos do mesmo ID e podem ter sido removidas ou alteradas depois.
- Contatos distintos por etiqueta histórica no cache: `VENDA OK` 211, `PAGAMENTO FINALIZADO` 52, `AGUARD PAG` 35, `AGUARDANDO PAGAMENTO` 10, `Google ADS` 383, `ANTT` 750, `CURSO` 58, `Sem Resposta` 432. As categorias se sobrepõem e não devem ser somadas. As contagens não têm corte temporal de aplicação da etiqueta e não são vendas confirmadas.
- Em consulta autenticada à organização, `GET /v1/custom-field-definitions/` retornou uma lista vazia. Em dois contatos amostrados com indicação de venda, os endpoints de campos personalizados e notas retornaram listas vazias. Esta amostra não prova que não haja notas em outros contatos, nem que não existam informações em outros sistemas.
- `GET /v1/contacts/{id}/` retornou estrutura com nome, telefones, email, endereço, data de criação, etiquetas, atendentes associados, campos personalizados e notas. A presença da chave não comprova que os valores estejam preenchidos.
- `GET /v1/contacts/{id}/relationship/` retornou as chaves `lastRating` e `wonDeals` nos dois testes. A documentação descreve contagem de itens de pipeline encerrados com sucesso; ainda não foi validado o significado operacional para a JBR, e não foram coletados valores individuais neste diagnóstico.
- A primeira tentativa de listagem `GET /v1/contacts/` com parâmetros opcionais retornou HTTP 400. A disponibilidade da lista completa, formato correto dos parâmetros e paginação efetiva precisam de uma nova validação; não houve varredura da agenda.
- Conversas no cache incluem informações de responsável, equipe, setor e histórico, estado de abertura e fechamento, primeiras mensagens e etiquetas. Dos 1.070 registros que incluem `customFields` e `timeline`, nenhum tinha conteúdo não vazio nesses campos no cache consultado. Campos ausentes ou vazios na listagem não demonstram ausência em endpoints detalhados.

## Endpoints documentados de interesse

| Recurso GET | Finalidade | Teste na JBR |
| --- | --- | --- |
| `/v1/contacts/` | Agenda paginada e filtros; opção `includeCustomFields` | Primeira tentativa rejeitada por parâmetros; requer ajuste. |
| `/v1/contacts/{id}/` | Detalhes completos do contato | Estrutura confirmada em dois contatos. |
| `/v1/custom-field-definitions/` | Definições dos campos personalizados | Lista vazia para a organização consultada. |
| `/v1/contacts/{id}/custom-fields/` | Valores do contato | Vazio nos dois contatos amostrados. |
| `/v1/contacts/{id}/notes/` | Notas do contato | Vazio nos dois contatos amostrados. |
| `/v1/contacts/{id}/relationship/` | Última avaliação e quantidade de negócios ganhos | Estrutura confirmada em dois contatos; significado a validar. |
| `/v1/contacts/{id}/chats/` | Histórico de conversas do contato | Documentado, não testado nesta investigação. |
| `/v1/chats/{id}/custom-fields/` | Campos personalizados preenchidos no chat | Documentado, não testado nesta investigação. |
| `/v1/tags/` | Catálogo de etiquetas | Já utilizado pelo coletor. |

O Swagger não apresentou endpoints GET com `pipeline` ou `board` no caminho. Isso não comprova que o produto não tenha funil ou que não exista outra API. A documentação do board descreve colunas vinculadas a etiquetas; é preciso confirmar a configuração específica da JBR antes de associar etiquetas às etapas.

## Regras para uma futura integração

1. Validar com a equipe JBR o significado de cada etiqueta, sua permanência no contato ou conversa, quem a aplica, se pode ser removida e se `VENDA OK` e `PAGAMENTO FINALIZADO` equivalem a venda concluída. Não tratar etiqueta histórica como data de venda, receita ou etapa automaticamente confirmada.
2. Investigar listagem de contatos com paginação documentada e parâmetros mínimos; incluir grupos apenas conforme decisão de produto. Coletar detalhes incrementalmente, com checkpoint, limitação e preservação de Retry-After, evitando uma chamada por contato a cada visita.
3. Separar data de observação da data real do evento; não reconstruir historicamente a progressão de etapas sem eventos de origem. Preservar evidência e permitir revisão manual.
4. Restringir uso e exibição de dados pessoais e notas de acordo com permissão, inclusive antes de qualquer publicação. Manter mensagens somente leitura.
5. Evitar GETs com efeitos colaterais: a especificação também contém endpoints GET que criam chats ou atualizam dados. Apenas endpoints expressamente verificados como leitura devem entrar na allowlist.

Fontes: [Swagger Umbler Talk](https://app-utalk.umbler.com/api/docs/index.html), [manual da API](https://help.umbler.com/hc/pt-br/articles/21150267515149-Manual-da-API-do-Talk), [campos do contato](https://help.umbler.com/hc/pt-br/articles/42557221620237-Blocos-do-chatbot-no-Talk-Campo-do-Contato) e [board de contatos](https://help.umbler.com/hc/pt-br/articles/34499080478733-Como-usar-o-board-de-contatos).
