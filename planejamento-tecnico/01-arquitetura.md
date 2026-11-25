# Arquitetura e estrutura do código

> Atualização de 24/11/2026: as escolhas de PostgreSQL, Drizzle, pg-boss e a estrutura futura abaixo são do plano inicial. O projeto real usa `back-end/src` e `front-end/src`; a nova persistência será MongoDB Atlas com driver oficial. Consulte o [plano vigente e o inventário](../MONGODB.md) antes de implementar.

## Stack definida para implementação

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Runtime | Node.js 24 LTS, patch fixado na criação do projeto | Mesma versão local, CI e Render; linha LTS disponível. |
| Linguagem | TypeScript com verificação estrita | Contratos compartilhados e erros de integração detectáveis no desenvolvimento. |
| Frontend | React, Vite, React Router | Aplicação autenticada, sem necessidade inicial de SEO ou renderização no servidor. |
| Estado remoto da interface | TanStack Query | Cache por filtro, requisições compartilhadas e invalidação controlada. |
| UI | CSS Modules e tokens próprios, primitives acessíveis quando necessárias | Visual JBR consistente, sem tema administrativo genérico ou framework visual pesado. |
| Backend | Fastify, contratos JSON Schema com TypeBox | Validação de entrada e saída, módulos HTTP separados das regras de negócio. |
| Banco | PostgreSQL 18 | Mesmo mecanismo no ambiente local e no Render. |
| Acesso a dados | Drizzle ORM e driver pg | Consultas explícitas, tipos e migrations SQL revisáveis. |
| Tarefas | pg-boss no mesmo PostgreSQL, schema próprio | Fila durável, agendamento e repetição controlada sem outro serviço de armazenamento. |
| Testes | Vitest, integração em Postgres e Playwright | Regras, concorrência real e fluxos do navegador. |
| Dependências | npm workspaces, package-lock.json | Instalação reproduzível por `npm ci`. |

Node 24 consta como LTS na documentação consultada. Não escolher automaticamente a versão mais recente do runtime nem deixar imagens com tag `latest`. [Ciclo oficial Node.js](https://nodejs.org/en/about/previous-releases).

React documenta Vite como uma opção de construção de SPA e explicita as responsabilidades adicionais de roteamento e busca de dados. Neste projeto, essas responsabilidades ficam em React Router e TanStack Query; SSR não é requisito. [React](https://react.dev/learn/build-a-react-app-from-scratch), [Vite](https://vite.dev/guide/).

As versões exatas das bibliotecas serão resolvidas e fixadas em conjunto na primeira implementação, conferindo compatibilidade com Node 24 e Postgres 18. Não instalar dependências nem atualizar o computador durante este planejamento.

## Dois processos de aplicação

**Web/API:** autentica, autoriza, consulta dados e registra alterações internas do CRM. Em produção, serve também o build estático do React na mesma origem. Conexões de integração e callback OAuth são operações administrativas explícitas. Nenhuma rota de painel aguarda chamada ao Google ou ao Umbler.

**Worker:** mantém o agendamento, processa a fila, consulta provedores, normaliza registros, atualiza agregados e executa exportações maiores. Não tem porta pública. Um worker inicial, preparado para concorrência segura durante reinício ou substituição de instância.

O agendador vive no worker; não duplicar agenda na API, no navegador e em cron do Render. A API pode publicar pedidos na fila, mas não consumir tarefas de coleta.

## Estrutura futura do repositório

Os caminhos abaixo são o contrato de organização; ainda não foram criados como código.

```text
CRM JBR/
  apps/
    web/src/                  # páginas, componentes, estilos e cliente HTTP
    api/src/                  # rotas, autenticação, autorização e bootstrap
    worker/src/               # scheduler, dispatcher e consumidores
  packages/
    contracts/src/            # DTOs e schemas públicos, sem segredos
    domain/src/               # contatos, oportunidades, atribuição e indicadores
    database/src/             # schema, repositórios, pools e transações
    database/migrations/      # SQL versionado
    integrations/src/         # Google Ads, Umbler e transporte controlado
    config/src/               # validação de configuração exclusiva do servidor
    observability/src/        # logs sanitizados e métricas operacionais
  tests/
    fixtures/                 # respostas sintéticas ou anonimizadas
    integration/
    e2e/
  scripts/                    # comandos portáveis e importador de histórico
  docs/                       # operação e arquitetura autocontidas
  .github/workflows/ci.yml
  .env.example
  .gitignore
  .dockerignore
  compose.yaml
  Dockerfile
  render.yaml
  package.json
  package-lock.json
```

Imports do frontend só podem alcançar contratos públicos e componentes. Nunca importar repositórios, configuração de servidor ou conectores em `apps/web`. Os módulos de domínio não dependem de Fastify; API e worker chamam as mesmas regras internas.

## Limites dos módulos

- `contacts`: cadastro, identidades externas, normalização de telefone e revisão de duplicatas.
- `conversations`: histórico lido, canais, mensagens e cobertura; sem função de envio.
- `opportunities`: estágios internos, responsáveis, valores e resultado comercial.
- `attribution`: evidências, catálogo de CTA e revisão de origem; não confundir texto de CTA com campanha comprovada.
- `ads`: métricas diárias e dimensões; nunca deriva receita confirmada de valor de conversão.
- `sync`: pedidos, execuções, cursores, orçamento de requisições e saúde dos conectores.
- `reports`: leituras e agregados com definições compartilhadas; exportação com o mesmo escopo de acesso das telas.

## Reutilização do material existente

Portar comportamentos relevantes de `utalk_reader.py`, especialmente paginação, sobreposição, checkpoint e testes de falhas. O coletor Python não será um subprocesso permanente do CRM. A leitura de SQLite ficará restrita ao importador de histórico.

Adaptar a referência Google para os módulos do novo projeto, sem transportar dependências do Rabbit. Copiar os arquivos oficiais da marca para o frontend quando ele existir. Nenhum build ou serviço deve depender de caminhos como `../API CRM JBR` ou da pasta de landing fora do repositório.

## Decisões adiadas por escopo

Sem Redis, Elasticsearch, microsserviços, WebSocket, processamento de IA ou armazenamento permanente de anexos na primeira entrega. Usar consulta paginada e atualização moderada. Acrescentar infraestrutura somente após medir uma necessidade que o desenho atual não atende.
