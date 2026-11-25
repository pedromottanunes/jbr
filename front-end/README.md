# Front-end

Interface React/TypeScript, estilos e arquivos públicos do CRM. Os contratos e regras comuns ficam em `../shared`. Não importar módulos de `back-end`, credenciais ou acesso ao banco nesta camada.

Execute na raiz do repositório:

- `npm run dev:web`: Vite em `http://127.0.0.1:5173`; requer a API na porta 3000.
- `npm run build:web`: gera `front-end/dist`.
- `npm run dev`: inicia interface, API e worker juntos.

O Vite não carrega o `.env` do backend. `/api/*` usa o proxy local durante o desenvolvimento e a mesma origem do servidor no build. Imagens e fontes mantêm seus endereços públicos, como `/google-ads.svg`.
