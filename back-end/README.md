# Back-end

API Fastify, integrações Google Ads/Umbler, persistência MongoDB e processamento da fila. `src` contém a aplicação; `scripts` contém os comandos operacionais e o worker. `migrations` preserva somente o SQL do plano antigo, desativado.

Execute na raiz do repositório:

- `npm run dev:api`: API em `http://127.0.0.1:3000`.
- `npm run dev:worker`: processador da fila Atlas.
- `npm run build:api`: gera `back-end/dist/server.js` e `back-end/dist/worker.js`.
- `npm start` e `npm run start:worker`: executam os artefatos compilados.

O `.env`, `local-data`, `package.json` e as dependências continuam na raiz. O servidor compilado entrega a interface de `front-end/dist`; execute `npm run build` para gerar ambos. Os endpoints `/api/*`, callback OAuth local e regras de acesso mantêm os mesmos endereços e comportamento.

As respostas usadas pela interface têm contratos em `shared/contracts.ts`, sem dependências do servidor. Em produção, `APP_MODE=mongo` exige login; `auth.ts` mantém sessões no Atlas. `EMBEDDED_WORKER=true` executa a fila no próprio Web Service. Veja [Render](../RENDER.md).
