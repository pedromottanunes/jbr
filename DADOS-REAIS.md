# Dados reais no ambiente local

## Visão geral

O dashboard agora apresenta o funil e o rastro dos leads. Regras e limitações em [FUNIL.md](FUNIL.md). A identidade do cadastro continua sendo o ID Umbler; apenas a contagem da visão geral agrupa telefones completos iguais dentro da mesma organização, sem modificar os cadastros.

O cache Google agora inclui fuso e moeda consultados na conta, dados diários e ações de conversão. A visão geral permite escolher uma ação e usa sua data de conversão; a tela Tráfego pago mantém conversões por data da interação. O fuso foi confirmado como `America/Sao_Paulo`. Esta atualização substitui a ressalva anterior sobre fuso ainda não conferido.

## Executar

Use Node 22.18+ e Python 3.10+ neste Windows. O arquivo `.env` atual usa `APP_MODE=local`. Execute `npm run dev` e abra `http://127.0.0.1:5173/`.

O cache fica em `local-data/umbler.sqlite3`, excluído do Git. A API abre o SQLite somente para leitura; navegar, pesquisar ou paginar não consulta provedores externos. Contatos e mensagens são servidos com paginação. O modo local recusa publicação em produção e bind público; o frontend de desenvolvimento bloqueia acesso direto aos arquivos de dados e credenciais.

## Coleta WhatsApp

Execute `npm run sync:umbler`. A primeira janela é de sete dias, com até 150 tentativas HTTP por execução e intervalo mínimo de três segundos. Se atingir o orçamento, execute o mesmo comando para retomar. Após concluir uma janela, a próxima começa no último corte confirmado, com sobreposição de cinco minutos e alcance máximo de sete dias. Para outro orçamento: `npm run sync:umbler -- -MaxRequests 300`. Não há coleta automática nesta etapa.

O processo usa a credencial DPAPI do coletor anterior. A trava e o estado de espera são compartilhados com o coletor antigo, impedindo execuções concorrentes sob o mesmo usuário Windows. O cliente permite apenas endpoints GET, usa timeout, limita tentativas, respeita Retry-After e preserva checkpoints. A retomada pode consultar novamente mensagens de fronteira; a chave da organização, conversa e mensagem impede duplicidade no banco.

As classes de transporte TypeScript continuam preparatórias; a coleta ativa usa `scripts/umbler/collector.py`, derivado do leitor anterior e acompanhado de seus testes. O wrapper `scripts/umbler/sync.py` faz importação, atualização e publicação transacional das tabelas de leitura do CRM. Grupos ficam fora do cadastro de leads. A identidade principal é o ID do contato Umbler dentro da organização; telefones não são usados para fundir pessoas automaticamente.

## Importação histórica e cobertura

O histórico inicial foi importado dos bancos em `API CRM JBR/data` por leitura SQLite, inclusive dos respectivos WALs. Os arquivos originais permanecem no projeto anterior. Para uma importação explícita em outro ambiente: `python scripts/umbler/sync.py --import-from "../API CRM JBR/data"`. A importação evita repetir arquivos já processados e faz upsert por IDs do provedor.

O painel distingue quantidade de conversas registradas da quantidade com mensagens coletadas. Nem todos os históricos estão completos; metadados de conversa não equivalem à cobertura integral de mensagens. O período e a cobertura da atualização estão em Relatórios e Configurações. Primeira entrada é a primeira conhecida na base, não uma garantia de primeiro contato absoluto. Etiqueta Google é indício de origem, sem atribuição de campanha comprovada. Qualificação, propostas e vendas ainda não foram recalculadas.

## Google e publicação futura

Tráfego pago agora inclui palavras-chave, termos de pesquisa, grupos, anúncios e horários, além de campanhas. Consulte [TRAFEGO-PAGO.md](TRAFEGO-PAGO.md). A coleta continua manual; esta atualização substitui a indicação anterior de palavras-chave ainda não implementadas.

O Google Ads foi autorizado e o projeto Cloud obteve acesso Exploração. Execute `npm run sync:google` para atualizar manualmente campanhas, séries diárias e ações dos últimos 30 dias completos, calculados no fuso retornado pela conta. O resultado é publicado atomicamente em `local-data/google-ads.json`; caso a consulta falhe, a última versão válida é preservada. Um mutex do Windows impede duas execuções simultâneas sob o mesmo usuário. As telas leem o arquivo local, sem chamadas ao Google. O relatório de campanhas usa `metrics.conversions` por data da interação; o funil usa `all_conversions_by_conversion_date` para a ação selecionada. Os totais podem diferir. Campanhas e dados históricos podem ser atualizados pelo Google após a data da interação; execute novamente para atualizar a janela. Palavras-chave e atualização automática ainda não foram implementadas.

SQLite é a etapa local para aproveitar a infraestrutura disponível. A migration PostgreSQL existente permanece como base da futura camada persistente no Render. Antes da publicação: adaptar repositórios e worker para PostgreSQL, implementar autenticação e controle de acesso, migrar credenciais protegidas e verificar sincronização coordenada no servidor.

## Verificar

`npm run check`, `npm run test:collector` e `npm run build`. Os testes cobrem serialização, allowlist de leitura, Retry-After, retomada, identidade, publicação idempotente, paginação de mensagens com horários iguais, busca, bloqueio de acesso remoto e ausência de envio e de chamadas externas nas rotas de tela.
