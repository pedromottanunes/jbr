# Tráfego pago detalhado

A tela `/trafego` usa `GET /api/v1/ads/detail` e a base Google local. Filtros de período e campanha abrangem indicadores, gráficos e tabelas. Buscas, ordenação e paginação ocorrem nas tabelas, sem chamadas externas. A leitura do JSON é compartilhada em memória e invalidada quando o arquivo sincronizado muda.

## Coleta e interpretação

`npm run sync:google` consulta, de forma sequencial, campanhas, palavras-chave (`keyword_view`), grupos, termos (`search_term_view`), anúncios responsivos e horários. Cada relatório informa disponibilidade separadamente; falhas não viram zeros. O cache completo é publicado atomicamente. Nenhuma rota de escrita em campanhas é usada.

Conversões usam `metrics.conversions` por data da interação e preservam frações. CTR = cliques / impressões; CPC = custo / cliques; custo por conversão = custo / conversões. Denominadores zerados resultam em indisponível. Conversões / cliques é uma relação entre ações reportadas, não pessoas únicas.

Evolução diária, dias da semana e horas respeitam o fuso da conta. Gráficos possuem seletor de métrica e valores ao passar o mouse ou focar os pontos. Datas sem movimento são preenchidas apenas dentro da cobertura sincronizada; datas externas não são tratadas como zero.

Campanhas exibidas têm registros na série diária. Orçamento, estratégia, status e otimização refletem o momento da coleta. Parcela de impressões é consultada para a janela completa: não se calcula uma média incorreta ao reduzir o período, e o campo fica indisponível nesse caso. O valor sentinela inferior a 10% é apresentado como limite.

Termos de pesquisa podem ter cobertura inferior aos totais, devido à disponibilização pelo Google. Os textos ficam agrupados por anúncio; impressões e custos são do anúncio inteiro, não de cada título/descrição. Não são inventadas métricas individuais de ativos.

Google + CRM apresenta indícios de site/Google no mesmo período, para todas as campanhas. CTA e etiqueta não comprovam atribuição paga. Fechamentos, receita e ROAS permanecem indisponíveis até haver registros comerciais e atribuição verificável.

Campos consultados conforme a [referência oficial do Google Ads](https://developers.google.com/google-ads/api/fields/v26/keyword_view).
