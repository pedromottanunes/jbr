# Visão geral — funil local

Implementado em 21/11/2026. Acesse `http://127.0.0.1:5173/` com `APP_MODE=local`.

## Operação

- Período inicial: janela sincronizada do Google Ads, atualmente os últimos 30 dias completos.
- Google Ads: investimento, impressões, cliques e conversões da ação selecionada. Quando existe uma única ação ativa de site com categoria `OUTBOUND_CLICK`, ela é selecionada inicialmente pelo nome. Na conta JBR, é “Botões de Contato”. Isso não confirma que seu disparo no GTM ocorre exclusivamente no WhatsApp.
- Funil: recebidos e atendidos têm contagem baseada nos registros. Qualificados, propostas e ganhos aparecem como não classificados. Não há receita ou ROAS presumidos.
- Origem e etapas filtram a lista inferior, sem alterar os totais gerais da coorte. Busca por nome/telefone e paginação de 20 registros.
- Selecionar um lead abre entrada conhecida, primeira mensagem disponível e primeira resposta humana. “Abrir conversa” leva ao chat e destaca a mensagem vinculada, mesmo que esteja fora das 100 mensagens mais recentes.
- “Atualizar painel” relê dados locais. Coleta externa continua manual: `npm run sync:google` e `npm run sync:umbler`.

## Regras de contagem

1. Na visão geral, IDs de contato da mesma organização com telefone completo igual após remover pontuação são agrupados. Sem telefone válido, vale o ID do provedor. O cadastro original não é fundido nem alterado; telefones compartilhados podem representar mais de uma pessoa. Não há tentativa de inferir DDI ou nono dígito ausente.
2. A entrada é a menor data conhecida entre metadados e mensagens recebidas. A janela usa o fuso retornado pela conta Google Ads (`America/Sao_Paulo` nesta conta), incluindo o dia final inteiro.
3. Contatos anteriores com mensagens no período são retornos, apresentados em “Cobertura e critérios”. Não entram novamente na coorte. Contatos sem data ficam fora das contagens por período.
4. CTA: comparação exata após normalizar caixa, acentos, espaços e pontuação, usando `back-end/src/cta-catalog.json`. O catálogo guarda os textos e caminhos das páginas atuais/anteriores, mais o padrão histórico informado e observado. Para classificar como site, a mensagem precisa ser a primeira conhecida (tolerância de menos de um segundo). CTA encontrado depois ou em início incompleto fica apenas como evidência no detalhe.
5. Categorias exclusivas: site por CTA; caso contrário, indicação por etiqueta Google; caso contrário, a identificar. Etiqueta adicional é preservada no detalhe. Nenhuma dessas regras comprova campanha paga individual.
6. Atendimento exige mensagem pública com `source=Member`, posterior a uma entrada na mesma conversa e até o final da janela. Bot, External e notas privadas ficam fora. Ausência na base não prova que o contato não foi atendido.
7. Conversões da ação usam `all_conversions_by_conversion_date`; cliques e custos usam a data da interação. A tela Tráfego pago continua mostrando `metrics.conversions` por data da interação. Frações não são truncadas no cálculo. Não calcular abandono ou conversão pessoa a pessoa comparando essas bases agregadas.
8. Janela fora da cobertura Google apresenta indisponível, sem preencher os dias ausentes com zero. Etapas comerciais sem registro permanecem nulas.

## Arquitetura e verificação

`GET /api/v1/funnel` aceita `start`, `end`, `action`, `origin`, `stage`, `q`, `cursor`, `limit`. Há validação de datas reais, intervalo máximo de 366 dias, filtros enumerados e tamanho de página até 50. Consultas SQL usam parâmetros. A rota não chama Google ou Umbler.

As evidências são carregadas em uma transação SQLite somente de leitura e mantidas em memória até mudar `crm_meta.publishedAt`. A leitura usa a chave composta das mensagens brutas para reconhecer o autor humano. As respostas são paginadas, e o frontend compartilha consultas pelo React Query. O cache Google é publicado por substituição atômica pelo coletor, com dados diários, ações e fuso/moeda da conta.

Testes cobrem telefones repetidos, organizações distintas, fronteiras de dia no fuso da conta, retornos, mensagens posteriores com CTA, histórico parcial, bot/External, resposta futura, origem exclusiva, paginação, conversões fracionadas, cobertura Google, invalidação após publicação e ausência de chamadas externas pela rota. Revisão visual e navegação verificadas em desktop e celular.

## Próximos dados necessários

Classificação comercial e oportunidades ainda precisam de armazenamento próprio, preservado nas sincronizações, com evidência e histórico de alterações. A atribuição individual ao anúncio depende da ponte entre visita e conversa descrita em `04-rastreamento-e-atribuicao.md`. Acesso público no Render continua condicionado à autenticação e à adaptação da persistência; esta entrega permanece local.
