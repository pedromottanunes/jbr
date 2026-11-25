# CRM JBR

CRM para acompanhar aquisição, leads e atendimento da JBR. Integra Google Ads e leitura de conversas do Umbler Talk, com persistência no MongoDB Atlas, identificação dos CTAs do site, indicadores por atendente e orçamento de conta consultado na API. Não envia mensagens pelo WhatsApp.

## Organização do código

```text
CRM JBR/
  front-end/
    src/             # páginas React, componentes e estilos
    public/          # imagens, ícones e fontes
    index.html
    vite.config.ts
    dist/            # interface compilada (gerada, fora do Git)
  back-end/
    src/             # API Fastify, integrações e persistência MongoDB
    scripts/         # worker, OAuth, importação e verificações
    migrations/      # SQL legado, sem uso no Atlas
    dist/            # servidor e worker compilados (gerados)
  shared/            # contratos da API e regras comuns, sem segredos
  package.json       # comandos e dependências de todo o projeto
  .env               # configuração privada do backend, fora do Git
  local-data/        # arquivos locais privados, fora do Git
```

Execute os comandos abaixo a partir da raiz `CRM JBR`. Há um único `package-lock.json`. A separação de pastas preserva as URLs: `/`, `/trafego`, `/conversas`, `/leads`, `/relatorios`, `/configuracoes` e `/api/*`. O front-end acessa a API pela mesma origem; no desenvolvimento, o proxy Vite encaminha `/api` à porta 3000. No build, o servidor entrega `front-end/dist` e mantém o fallback das páginas React sem transformar erros de API em HTML.

`npm run build:web` compila a interface e `npm run build:api` compila servidor e worker. `npm run build` verifica os tipos e compila ambos; `npm run verify:layout`, após o build, confere páginas, assets e rotas de API. Os contratos em `shared/contracts.ts` são verificados tanto no servidor quanto na interface.

Para o Render, a **Root Directory deve continuar vazia** (raiz do repositório), pois os dois serviços utilizam `shared` e as dependências da raiz. Os comandos permanecem `npm start` para Web Service e `npm run start:worker` para Background Worker. A preparação de autenticação para publicação continua pendente.

## Executar localmente

Requer Node.js da linha 22, versão 22.18 ou superior, e acesso ao Atlas. API, interface e worker usam Node; Python/PowerShell permanecem apenas no legado e no assistente OAuth local.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Abra `http://127.0.0.1:5173`. A configuração inicial usa `APP_MODE=demo`, com uma amostra anonimizada. A instalação JBR já está configurada com `APP_MODE=mongo` e histórico importado em `jbr_crm_dev`. Para outra instalação, siga [MongoDB Atlas](MONGODB.md) e [Google OAuth](GOOGLE-OAUTH.md). Crie `.env` apenas na primeira configuração; preserve seu arquivo existente.

Validação: `npm run check`, `npm run test:collector` e `npm run build`. Os recursos de sábado, desempenho dos atendentes e saldo estão descritos em [Implementação local](IMPLEMENTACAO.md).

O repositório contém código, testes e documentação. Credenciais privadas, dumps e estudos com dados reais ficam fora do Git; os dados operacionais ficam no Atlas. A aplicação continua local. Persistência e worker já foram adaptados; autenticação, permissões e ensaio de restauração ainda são necessários para publicar no Render.

O objetivo é acompanhar a jornada entre aquisição, contato pelo WhatsApp, atendimento e resultado comercial. A plataforma reunirá métricas do Google Ads, conversas provenientes do Umbler Talk e cadastro de leads, com identidade visual inspirada em `Land Page Atualizada`.

## Documentos

| Documento | Conteúdo |
| --- | --- |
| [Inventário e evidências](01-inventario.md) | O que existe no projeto, fontes consultadas e limites do material atual. |
| [Produto e experiência](02-produto-e-experiencia.md) | Módulos, telas, identidade visual e primeira proposta de escopo. |
| [Integrações e arquitetura](03-integracoes-e-arquitetura.md) | Como aproveitar as referências Google Ads e Umbler Talk. |
| [Rastreamento e atribuição](04-rastreamento-e-atribuicao.md) | Jornada, evidências de origem e catálogo inicial das mensagens de CTA. |
| [Dados e indicadores](05-dados-e-indicadores.md) | Contatos, conversas, oportunidades, deduplicação e definição das métricas. |
| [Etapas e decisões](06-etapas-e-decisoes.md) | Sequência proposta, critérios de aceite e assuntos a definir. |
| Propostas visuais (somente locais) | Estudos em `estudos-visuais/`, excluídos do Git por conterem dados reais. |
| [Planejamento técnico](planejamento-tecnico/README.md) | Arquitetura, interface limpa, sincronização, banco, segurança, desenvolvimento local e publicação futura no Render. |
| [Implementação local](IMPLEMENTACAO.md) | Como executar, o que funciona e o que falta para conectar as APIs. |
| [Credenciais locais](CREDENCIAIS.md) | Local do MCC, requisitos OAuth e token Umbler protegido. |
| [Dados reais](DADOS-REAIS.md) | Coleta WhatsApp, cache local, cobertura e testes. |
| [Autorizar Google Ads](GOOGLE-OAUTH.md) | Configurar o Cloud e executar o assistente OAuth local. |
| [MongoDB Atlas](MONGODB.md) | Configuração ativa, dados migrados, coleções, comandos e recuperação. |
| [Revisão da integração](REVISAO-INTEGRACAO.md) | Correções, medições, testes de integridade e pendências para o Render. |

## Decisões já dadas pelo projeto

- O novo CRM fica integralmente em `CRM JBR`, separado do coletor existente.
- A referência visual principal é `Land Page Atualizada/public_html`.
- O produto deve reunir tráfego pago, conversas e cadastro de leads.
- Decisão de 21/11/2026: a integração Umbler Talk será exclusivamente de leitura. O CRM não enviará mensagens pelo WhatsApp nem alterará conversas no provedor.
- O telefone recebido pelo WhatsApp será uma das bases de identificação do contato.
- `Google API Referência.txt` e `API CRM JBR` são referências para o desenvolvimento.
- A implementação local foi iniciada após autorização posterior do usuário.
- Diretriz de interface: área útil limpa, sem subtítulos explicativos permanentes. Os estudos visuais serão simplificados conforme o plano técnico.
- Desenvolvimento local primeiro; repositório GitHub e deploy no Render posteriormente, com configuração portável desde a fundação.

A integração de 24/11/2026 mantém React/TypeScript e API Fastify e usa **MongoDB Atlas**, substituindo PostgreSQL/pg-boss. Histórico, configurações, credenciais protegidas e tarefas foram migrados. `npm run dev` inicia também o worker; coletas automáticas continuam desligadas e os botões de atualização usam a fila persistente. Estado e operação em [MongoDB Atlas](MONGODB.md).

## Ponto central

Cliques, conversões publicitárias, contatos únicos, oportunidades e vendas são medidas diferentes. O CRM deve preservar essas diferenças e apresentar a evidência que sustenta a origem atribuída. Reconhecer uma mensagem da landing é útil; associá-la a uma campanha específica exige uma ligação adicional entre a visita e a conversa.
