# Segurança da aplicação e das integrações

## Autenticação e autorização

Login fechado por convite administrativo, sem cadastro público. Sessões opacas geradas por fonte criptográfica; banco armazena hash do identificador e vencimento. Cookie HttpOnly, Secure em HTTPS e SameSite apropriado ao callback OAuth. Token de sessão não fica em localStorage. Rotacionar sessão no login e em mudança de privilégio; logout e bloqueio de usuário revogam acesso no servidor.

Senha com Argon2id por biblioteca mantida, parâmetros aferidos no runtime e mínimo conforme orientação vigente da OWASP. Não criar algoritmo de senha ou criptografia próprio. Limitar tentativas por IP e conta sem mensagens que revelem existência de usuário. [Sessões OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Senhas OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Proposta inicial: sessão com até 12 horas e expiração por inatividade de 60 minutos; atividade automática de polling não renova o prazo de interação indefinidamente. Reautenticação para trocar credenciais. Primeiro administrador criado por comando local de uso explícito, sem senha padrão no seed. Recuperação por token único de curta validade ou comando administrativo auditado durante a fase local; não criar serviço de email só para a primeira etapa.

| Perfil proposto | Acesso |
| --- | --- |
| Administrador | Usuários, canais, credenciais, sincronização e dados autorizados da organização. |
| Gestor | Indicadores, conversas e operação comercial dos canais permitidos; sem revelar segredos. |
| Operador | Conversas/cadastros da carteira ou canais atribuídos; mudanças internas permitidas. Sem envio WhatsApp. |

Validar perfil e organização em toda requisição, inclusive download, busca e agregados. Não confiar em botão escondido, ID difícil de adivinhar ou filtro de frontend. Redução de permissões deve valer também para sessões abertas e invalidar caches autorizados anteriormente. MFA para administradores antes de exposição pública, com biblioteca mantida e recuperação protegida, será incluído no marco de produção.

## Proteção HTTP e conteúdo

Mesma origem para React e API em produção. CORS sem wildcard credenciado; desenvolvimento usa proxy Vite. Verificar Origin/CSRF nas operações de escrita, inclusive pedidos de sincronização. Cookie de sessão e OAuth state têm finalidades diferentes; um não substitui o outro.

Renderizar mensagens como texto; não executar HTML recebido, links JavaScript, SVG ativo ou conteúdo de anexos. Limitar tamanho de request, comprimento de busca, intervalo e paginação. SQL parametrizado e GAQL construída a partir de templates e valores validados; nenhuma consulta arbitrária vinda do navegador.

Configurar CSP, proteção contra framing, política de referrer e headers adequados. Caches HTTP para dados pessoais usam `private, no-store`; o cache controlado em memória da aplicação é separado. Logs de acesso excluem corpos, telefones, conteúdo de mensagem e query strings sensíveis.

## Segredos e tokens externos

Credenciais Google e Umbler existem somente no servidor. Tokens persistidos criptografados com AES-256-GCM por API criptográfica padrão, nonce aleatório por cifragem, autenticação do contexto, key_id e chave fora do banco. Planejar rotação e manter a chave antiga disponível durante migração de segredos. Backup do banco sem acesso à chave não permite recuperação dos tokens.

Configuração valida nomes e presença de variáveis na inicialização, sem imprimir valores. Segredos não recebem prefixo `VITE_`, não entram em bundle, fixture, prompt, imagem, arquivo de log ou `render.yaml`. `.env.example` contém nomes e placeholders vazios; `.env` real fica fora do Git e Docker context.

Google: state de uso único vinculado a sessão/usuário, TTL de 10 minutos, callback exato, escopo necessário e tokens criptografados. Renovação usa geração da autorização e coordenação do documento de sincronização. Umbler: preferir token com menor permissão oferecida; se o provedor não disponibilizar credencial exclusivamente de leitura, reforçar allowlist da aplicação e não alegar que o token em si é read-only.

## Transporte externo

HTTPS com validação de certificado, bases fixas e IDs validados. Não seguir redirecionamentos de API com Authorization. Não aceitar host de destino fornecido pelo usuário. Sanitizar mensagens de erro; logs podem registrar status, duração, requestId e código de erro seguro, sem tokens ou respostas completas.

Consultas de mídia, se incluídas, usam rota autorizada e proxy controlado com allowlist de destinos, bloqueio de endereços internos, limites de tamanho/tempo e validação de redirecionamentos. Não abrir qualquer URL encontrada em `raw_json`. Na primeira entrega, mostrar metadados/indisponibilidade é preferível a um proxy sem proteção; binários e transcrição automática não entram no primeiro escopo.

Notas privadas do Umbler não entram na visão comum. Se forem necessárias depois, importar e autorizar explicitamente; não confundir com notas comerciais criadas no CRM. Exportações protegem também contra fórmulas ativas em CSV e têm limite de escopo e prazo de disponibilidade.

## Dados, auditoria e conservação

Banco com TLS quando remoto, credencial de aplicação sem poder de criação arbitrária de schema e migrations com credencial separada. Permissões do schema pg-boss concedidas deliberadamente; manutenção/migration da fila ocorre no fluxo de release, sem dar privilégios administrativos gerais ao runtime.

Auditar login relevante, troca de acesso, configuração, sincronização manual, edição de lead, atribuição, fusão, estágio e resultado. Eventos não precisam duplicar transcrições ou segredos. Logs operacionais mostram IDs internos e métricas; registros de negócio mantêm o necessário para revisão.

Proposta para validação operacional: tentativas HTTP sanitizadas por 14 dias; jobs concluídos por 7 dias; staging abandonado por 24 horas; chaves HTTP de idempotência por 7 dias; logs de execução por 30 dias. A limpeza usa lotes pequenos e nunca remove trabalho ativo. Identidades externas, mensagens e chaves de resultado mantêm unicidade além dessas janelas. Retenção comercial de conversas e auditoria deve ser acordada antes do piloto; não inventar prazo legal.

Mídias, backups e exportações futuras ficam em armazenamento privado com acesso temporário, não em diretório público da aplicação. Testar restauração e rotação de chave com amostra isolada. Nenhum dado pessoal é necessário no CI.
