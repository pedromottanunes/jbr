import 'dotenv/config';
import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error('Não foi possível iniciar a API. Verifique porta, banco e configuração.');
  process.exitCode = 1;
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
    void app.close().then(()=>clearTimeout(deadline)).catch(()=>{process.exitCode=1;});
  });
}
