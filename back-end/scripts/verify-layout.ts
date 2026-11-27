// Run after npm run build. Uses demo fixtures and inject(), never external APIs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildApp} from '../src/app.js';

const previous=process.env.SERVE_WEB;
process.env.SERVE_WEB='true';
const app=buildApp({mode:'demo'});
try {
  const html=await readFile(new URL('../../front-end/dist/index.html',import.meta.url),'utf8');
  const pages=['/','/trafego','/trafego/google','/trafego/meta','/conversas','/leads','/relatorios','/configuracoes','/leads?chat=sample'];
  for(const url of pages){
    const response=await app.inject(url);
    assert.equal(response.statusCode,200,url);
    assert.match(String(response.headers['content-type']),/text\/html/);
    assert.equal(response.body,html,url);
  }
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match=>match[1]);
  assert.ok(assets.some(path=>path.endsWith('.js')));
  assert.ok(assets.some(path=>path.endsWith('.css')));
  for(const url of [...assets,'/google-ads.svg','/jbr-logo.webp','/jbr-logo-white.webp','/login-jbr-road.webp','/manrope-latin.woff2']){
    const response=await app.inject(url);
    assert.equal(response.statusCode,200,url);
    assert.doesNotMatch(String(response.headers['content-type']),/text\/html/,url);
    assert.ok(response.rawPayload.length>0,url);
  }
  for(const url of ['/api/health','/api/v1/status','/api/v1/overview','/api/v1/ads','/api/v1/contacts','/api/v1/conversations']){
    const response=await app.inject(url);
    assert.equal(response.statusCode,200,url);
    assert.match(String(response.headers['content-type']),/application\/json/,url);
  }
  const unknown=await app.inject('/api/v1/does-not-exist');
  assert.equal(unknown.statusCode,404);
  assert.equal(unknown.json().code,'NOT_FOUND');
  for(const url of ['/.env','/back-end/src/app.ts','/shared/contracts.ts']){
    const response=await app.inject(url);
    assert.equal(response.body,html,'Private source must not be served: '+url);
  }
  console.log('Layout verificado: 9 URLs de páginas, assets compilados/públicos, APIs JSON e fallback 404 de API preservados.');
} finally {
  await app.close();
  if(previous===undefined)delete process.env.SERVE_WEB;else process.env.SERVE_WEB=previous;
}
