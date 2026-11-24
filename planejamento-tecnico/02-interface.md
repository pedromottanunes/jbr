# Interface limpa e comportamento do frontend

Esta especificação substitui a densidade explicativa dos primeiros estudos visuais. Preservar cores, marca e organização principal; retirar subtítulos descritivos, grandes avisos permanentes e textos que apenas narram a função da tela.

## Estrutura visual

- Menu lateral de aproximadamente 208 px, recolhível, com logo oficial e seis entradas: Visão geral, Tráfego, Conversas, Leads, Relatórios e Configurações.
- Cabeçalho compacto com título de uma linha, período e ações pertinentes. Sem slogan, breadcrumb redundante ou parágrafo abaixo do título.
- Fundo `#f8f7f0`, superfícies brancas, azul `#172b53`, verde `#006846` e amarelo usado pontualmente. Tipografia Arial/Helvetica, escala consistente e bordas discretas.
- Cartões de indicador somente quando resumirem uma decisão útil; no máximo quatro no topo. Evitar repetir o mesmo total em várias áreas da tela.
- Uma ação principal por contexto. Ícones de ação com nome acessível e tooltip; campos com rótulos claros, sem depender apenas de placeholder.
- Mensagens de erro e cobertura aparecem perto do dado afetado. Estado saudável não gera banner.

“Google indicado”, “Receita recebida” e “Conversões de botão” são rótulos necessários para a precisão do produto. A limpeza visual não deve tornar métricas diferentes indistinguíveis. Explicação completa em um painel de detalhes ou ícone de informação.

## Telas

| Tela | Área principal | Informação secundária |
| --- | --- | --- |
| Visão geral | Quatro indicadores, evolução/funil observado e composição de origem | Método e cobertura ao abrir detalhes do indicador. |
| Tráfego | Abas Campanhas, Grupos, Palavras-chave, Termos e Conversões; tabela e período | Dispositivo, rede, horário e página de destino em filtros ou aba de detalhamento. |
| Conversas | Lista pesquisável e histórico; ficha lateral recolhida por padrão | Origem, etiquetas, telefone, cobertura e dados do contato na ficha. |
| Leads | Lista filtrável; cadastro e oportunidades em painel lateral | Histórico de alterações, evidências e junção de identidades. |
| Relatórios | Relatório selecionado, período e resultados | Metodologia e exportação em menu secundário. |
| Configurações | Usuários, canais, conexões, sincronização e regras | Logs técnicos resumidos, somente para administradores. |

Nas conversas, nenhum compositor, botão de enviar, anexar, chamar, áudio ou mudança de estado no Umbler. Uma indicação pequena de leitura no cabeçalho é suficiente, sem repetir “somente leitura” em três lugares. Separadores de data e autores distinguem contato, bot e atendente. Sem simular presença, digitação ou mensagens lidas.

No mobile, lista e conversa são telas sucessivas. No desktop, a área do histórico ganha prioridade sobre a ficha. Preservar a posição de rolagem ao carregar mensagens anteriores e não forçar rolagem para o fim enquanto o usuário lê o histórico.

## Dados, filtros e carregamento

Usar um único `QueryClient`. Chaves de consulta incluem sessão/organização, recurso, filtros normalizados e cursor. Mesmos dados usados por componentes diferentes compartilham uma consulta. Não combinar fetch em `useEffect` com a mesma consulta do TanStack Query.

Os padrões da biblioteca incluem dados considerados desatualizados, refetch por foco e retries. Serão configurados explicitamente para o CRM. [Padrões oficiais do TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

| Consulta ao CRM interno | Cache fresco inicial | Atualização automática |
| --- | --- | --- |
| Visão geral e Ads | 60 segundos | A cada 5 minutos apenas com página visível. |
| Lista de conversas | 20 segundos | A cada 30 segundos com página visível. |
| Conversa aberta | 15 segundos | A cada 30 segundos, apenas conversa selecionada. |
| Cadastro de leads | 30 segundos | Por invalidação após alteração e atualização explícita. |
| Catálogos | 5 minutos | Após alteração; sem polling. |
| Saúde das integrações | 30 segundos | Só na tela administrativa. |

Esses intervalos consultam **o banco local do CRM**, não os provedores. São valores iniciais ajustáveis. Pausar polling em aba oculta e offline; não usar `refetchOnWindowFocus` indiscriminado. Cache de uma aba não coordena outras abas: a proteção do servidor continua obrigatória.

Busca textual tem debounce de 300 ms e cancelamento da requisição anterior. Filtros simples alteram a chave uma vez; período com duas datas usa Aplicar para não carregar intervalos incompletos. Preservar resultados válidos durante refetch e usar skeleton apenas na primeira carga.

GET interno pode repetir uma vez em erro transitório; 401, 403 e validação não repetem automaticamente. Mutação não tem retry automático no navegador; usa chave de idempotência e reconciliação em caso de resposta incerta. React StrictMode não será removido para esconder efeitos duplicados.

## Estados e desempenho

Resposta vazia, busca sem resultados, falta de permissão e falha de coleta são estados diferentes. Dado antigo continua legível com pequeno marcador de desatualização. Indicadores sem receita ou vínculo usam “—” e um detalhe acessível que explica o motivo.

Paginar no servidor, carregar inicialmente 50 conversas ou mensagens e limitar a 100 por requisição. Não trazer todo o histórico nem todo o cadastro para depois filtrar no navegador. Virtualizar listas quando a quantidade carregada justificar; dividir o bundle por rota.

Sem contagens de exemplo no produto conectado. O modo local de demonstração será identificado discretamente e usará dados anonimizados. Os PNGs com informações históricas ficam como referências locais, não como telas embutidas no app.

## Aceite visual

Conferir 1440×900, 1280×800 e 390×844, teclado, foco, contraste e ampliação a 200%. Tabelas podem rolar dentro de sua área; a página não deve criar rolagem horizontal acidental. Na conversa desktop em 1440×900, título e controles devem deixar pelo menos 70% da altura útil para a área de trabalho. Nenhuma tela exige texto explicativo permanente para ser operada.
