import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import demo from './demo-data.json' with { type: 'json' };
import { registerLocalData } from './local-data.js';
import {connectMongo,type MongoContext} from './mongo/connection.js';
import {checkSchema} from './mongo/schema.js';
import {registerMongoData} from './mongo/routes.js';

export function buildApp(options: { mode?: string; databasePath?: string;mongo?:MongoContext } = {}) {
  const production = process.env.NODE_ENV === 'production';
  const mode = options.mode ?? process.env.APP_MODE ?? 'demo';
  if (!['demo','local','mongo'].includes(mode)) throw new Error('APP_MODE inválido.');
  if (mode !== 'demo' && (production || !['127.0.0.1','localhost','::1'].includes(process.env.HOST ?? '127.0.0.1'))) throw new Error('Dados reais locais exigem loopback e ambiente de desenvolvimento.');
  if (production && process.env.ALLOW_PUBLIC_DEMO !== 'true') throw new Error('Demo pública desabilitada. Defina autenticação antes da publicação.');
  const app = Fastify({ bodyLimit: 65536, requestTimeout:30000, connectionTimeout:30000, disableRequestLogging: mode !== 'demo', logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] }, trustProxy: production });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { max: 90, timeWindow: '1 minute' });

  app.addHook('onRequest', async (request,reply) => {
    reply.header('Cache-Control','private, no-store');
    if(mode!=='demo') {
      const validHost=/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(request.headers.host ?? '');
      const origin=request.headers.origin;
      const validOrigin=!origin || [process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3000'].includes(origin);
      if(!validHost || !validOrigin || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({message:'Acesso permitido apenas no computador local.'});
    }
  });
  app.get('/api/health', async () => ({ status: 'ok', mode }));
  // Serve the same build locally before deployment; the real-data production
  // guard above remains until authentication and permissions are implemented.
  if (production || process.env.SERVE_WEB==='true') {
    const dist = fileURLToPath(new URL('../../front-end/dist/', import.meta.url));
    app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ code: 'NOT_FOUND' });
      return reply.sendFile('index.html');
    });
  }
  if(mode!=='demo') {
    app.setErrorHandler((error,_request,reply)=>{
      const code=error instanceof Error&&'statusCode' in error?error.statusCode:500;
      const status=typeof code==='number'&&code>=400&&code<=503?code:500;
      return reply.code(status).send({message:status>=500?'Não foi possível consultar o banco de dados.':'Parâmetros inválidos.'});
    });
    if(mode==='mongo')app.register(async instance=>{const ctx=options.mongo??await connectMongo();if(!options.mongo)instance.addHook('onClose',()=>ctx.close());await checkSchema(ctx);registerMongoData(instance,ctx);});
    else registerLocalData(app,options.databasePath); return app;
  }
  app.get('/api/v1/status',async()=>({mode:'demo'}));
  app.get('/api/v1/overview', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { period: demo.period, timezone: demo.timezone, sourceLabel: demo.sourceLabel, metrics: demo.metrics, attendance: demo.attendance };
  });
  app.get('/api/v1/ads', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { period: demo.period, campaigns: demo.campaigns, termCoverage: demo.termCoverage };
  });
  app.get<{ Querystring: { q?: string; limit?: string; cursor?: string } }>('/api/v1/contacts', {
    schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 80 }, limit: { type: 'string', pattern: '^[0-9]{1,3}$' }, cursor: { type: 'string', pattern: '^[0-9]{1,4}$' } }, additionalProperties: false } }
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const q = (request.query.q ?? '').trim().toLocaleLowerCase('pt-BR');
    const limit = Math.min(Math.max(Number(request.query.limit ?? 12), 1), 50);
    const offset = Math.min(Number(request.query.cursor ?? 0), demo.contacts.length);
    const filtered = q ? demo.contacts.filter(c => `${c.label} ${c.id}`.toLocaleLowerCase('pt-BR').includes(q)) : demo.contacts;
    return { items: filtered.slice(offset, offset + limit), nextCursor: offset + limit < filtered.length ? String(offset + limit) : null, totalInSample: filtered.length };
  });
  app.get('/api/v1/conversations', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { items: demo.contacts.slice(0, 24).map(c => ({ id: c.conversationId, contactId: c.id, label: c.label, at: c.firstInboundAt })) };
  });
  app.get<{ Params: { id: string } }>('/api/v1/conversations/:id', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (request.params.id !== 'historical-sample') return reply.code(404).send({ code: 'NOT_FOUND', message: 'Conversa indisponível nesta amostra.' });
    return {chat:{contact_id:demo.conversation.contactId,label:demo.conversation.contactLabel},contentStorageEnabled:false,focusMessage:null,messages:[],nextCursor:null};
  });

  return app;
}
