# CRM JBR

CRM para acompanhar aquisição, leads e atendimento da JBR. A aplicação integra dados do Google Ads e leitura de conversas do Umbler Talk, com cache local, identificação dos CTAs do site, indicadores por atendente e controle de saldo estimado. Não envia mensagens pelo WhatsApp.

## Executar localmente

Requer Node.js 22.12+; os coletores locais usam Python e PowerShell no Windows.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Abra `http://127.0.0.1:5173`. A configuração inicial usa `APP_MODE=demo`, com uma amostra anonimizada. Para dados reais, siga [Credenciais](CREDENCIAIS.md), [Google OAuth](GOOGLE-OAUTH.md) e [Dados reais](DADOS-REAIS.md), configure `APP_MODE=local` e execute as coletas. Crie `.env` apenas na primeira configuração; preserve seu arquivo existente.

Validação: `npm run check`, `npm run test:collector` e `npm run build`. Os recursos de sábado, desempenho dos atendentes e saldo estão descritos em [Implementação local](IMPLEMENTACAO.md).

O repositório contém código, testes e documentação. Credenciais, bancos, conversas completas, caches e estudos visuais com dados reais permanecem locais e são ignorados pelo Git. A publicação do repositório não publica o CRM na internet. Autenticação de usuários, persistência e adaptação dos coletores para o Render continuam pendentes.

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

O plano técnico define React/TypeScript, API Fastify, PostgreSQL e worker com pg-boss como base de implementação. Render é o destino solicitado para a publicação futura; plano contratado e domínio permanecem pendentes. A estratégia de atribuição e as regras operacionais ainda têm pontos a validar. O WhatsApp está definido como exclusivamente de leitura.

## Ponto central

Cliques, conversões publicitárias, contatos únicos, oportunidades e vendas são medidas diferentes. O CRM deve preservar essas diferenças e apresentar a evidência que sustenta a origem atribuída. Reconhecer uma mensagem da landing é útil; associá-la a uma campanha específica exige uma ligação adicional entre a visita e a conversa.
