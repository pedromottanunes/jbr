# Inventário e evidências do projeto JBR

Levantamento de 21/11/2026. A inspeção cobriu a estrutura das quatro pastas existentes, os documentos de entrada, o HTML/CSS/JavaScript da landing atualizada e os principais scripts de coleta e análise. Os milhares de arquivos de conversas, mídias, arquivos compactados e relatórios não foram auditados individualmente.

## Estrutura encontrada

| Local | Conteúdo e papel no novo CRM |
| --- | --- |
| `Land Page Atualizada/` | 120 arquivos no levantamento; contém `public_html`, landing principal e conteúdo de cursos. É a referência visual solicitada. |
| `API CRM JBR/` | 2.640 arquivos; coletor Python, bancos SQLite, exportações de conversas, análises, testes e relatórios. É a referência operacional de integração. |
| `landing page/` | 191 arquivos; versão anterior, estudos visuais, documentação de marca e ferramentas de publicação. Serve como histórico. |
| `site institucional/` | 179 arquivos; site de serviços e cursos, geradores e documentação. Serve como contexto comercial e referência secundária. |
| `Google API Referência.txt` | Referência técnica do Rabbit CRM preparada em 21/11/2026; inclui OAuth, renovação de tokens, consultas e persistência Google Ads. |
| `README.md` da raiz | Mapa anterior dos projetos; não relaciona a landing atualizada nem o novo CRM. Não deve sobrepor o escopo desta pasta. |
| `Wireframes_Grupo_JBR.pdf` e `video-jbr.mp4` | Materiais visuais inventariados; conteúdo não revisado nesta etapa. |

As contagens descrevem a fotografia do diretório, incluindo derivados e arquivos de apoio; não representam componentes do futuro produto.

## Identidade comercial e canais

O usuário apresenta a JBR como transportadora. A landing se apresenta como assessoria privada para cadastro e regularização RNTRC, e o institucional também oferece cursos. O primeiro funil proposto acompanha esses serviços observados. Cotação de frete, frota, roteirização e TMS não devem ser presumidos como requisitos.

O nome técnico encontrado para a plataforma de conversas é **Umbler Talk**. A identificação vem do [README do coletor](../API%20CRM%20JBR/README.md) e da URL base em [utalk_reader.py](../API%20CRM%20JBR/utalk_reader.py).

A landing atualizada usa `wa.me/558005911602`. O README do institucional informa WhatsApp `(41) 3359-4191` e mantém o 0800 para ligações. Confirmar quais números e canais estão efetivamente em produção; a divergência não autoriza alterar nenhum deles agora.

## Evidências da landing atualizada

- [index.html](../Land%20Page%20Atualizada/public_html/index.html) contém GTM `GTM-K7BN9KFC`, Google tag `AW-18426281398`, mensagens distintas nos CTAs e atributos `data-service` e `data-cta-position` em parte dos links.
- [hero-scroll.js](../Land%20Page%20Atualizada/public_html/hero-scroll.js) altera o texto dos botões flutuante e de contato do cabeçalho conforme a seção visível. Portanto, posição do botão e mensagem não têm relação exclusiva.
- Nos dois arquivos acima, não foi encontrada implementação de captura/persistência de GCLID, UTMs ou uma chave que vincule visita e conversa.
- A configuração publicada do contêiner GTM não está nesses arquivos. A presença das tags não confirma eventos, regras, contagem ou ausência de duplicidade na produção.
- [styles.css](../Land%20Page%20Atualizada/public_html/styles.css) fornece as cores e tipografia registradas no documento de produto. Não foi feita revisão visual renderizada nesta etapa.

## Referências operacionais

| Arquivo | Conhecimento aproveitável |
| --- | --- |
| `API CRM JBR/utalk_reader.py` | Leitura autenticada, paginação, retomada, chaves de mensagens, cursores e armazenamento de respostas. |
| `API CRM JBR/configurar_token.ps1` e `executar_coleta.ps1` | Fluxo local documentado de token protegido por DPAPI e execução assistida. Não equivalem a uma solução de credenciais para servidor. |
| `API CRM JBR/cruzar_google_ads_whatsapp.py` | Cruzamento local, contatos distintos, evidências de origem e análise comercial. |
| `API CRM JBR/analisar_comparativo_outubro.py` | Consolidação por contato, mensagens recebidas, resposta humana e tempo de atendimento. |
| `API CRM JBR/analisar_fluxo_conversas.py` | Separação de bot, menus, resposta do contato e transferência para atendente; registra anomalias de ordem temporal. |
| `API CRM JBR/test_*.py` | Exemplos de verificações para coleta, identidade e fluxo; não foram executados nesta etapa documental. |

Os scripts analíticos usam recortes fixos, caminhos locais e regras específicas de relatórios. São referência de comportamento; não são serviços prontos para a aplicação.

## Diagnóstico histórico que orienta o planejamento

O [diagnóstico de 01 a 23/10/2026](../API%20CRM%20JBR/output/diagnostico_google_ads_whatsapp_01_a_23_outubro_2026.txt), concluído em 24/10/2026, relata ausência de GCLID, GBRAID, WBRAID, UTMs e ponte de sessão no CRM daquele recorte. A etiqueta Google foi tratada como indicação, sem atribuição individual de campanha. Também distingue acionamentos de botão de pessoas e separa valor publicitário de receita comercial.

Esse é um achado histórico, não uma auditoria da configuração atual. Ele justifica projetar a atribuição e a cobertura dos dados desde o início.
