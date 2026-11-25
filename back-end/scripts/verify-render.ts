// Production configuration + real Atlas reads, without querying either provider.
import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {buildApp} from '../src/app.js';
import {connectMongo} from '../src/mongo/connection.js';
import {readSecret} from '../src/mongo/secrets.js';
import {verifyPassword} from '../src/auth.js';
import assert from 'node:assert/strict';

async function main(){
 Object.assign(process.env,parse(await readFile('.env.render','utf8')));
 process.env.EMBEDDED_WORKER='false';
 const login=await readFile('local-data/render-login.txt','utf8');
 const password=login.match(/^Senha: (.+)$/m)?.[1]??'';
 assert.ok(await verifyPassword(password,process.env.AUTH_PASSWORD_HASH??''),'Confira o arquivo privado de acesso.');
 const ctx=await connectMongo();
 const app=buildApp({mongo:ctx});
 try{
  for(const id of ['google-refresh','umbler-token'])assert.ok((await readSecret(ctx,id)).length>0,'Credencial de integração indisponível.');
  assert.equal((await app.inject('/api/v1/leads')).statusCode,401);
  const authorized=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin:process.env.APP_ORIGIN},payload:{username:process.env.AUTH_USERNAME,password}});
  assert.equal(authorized.statusCode,200,'Login indisponível.');
  const cookie=String(authorized.headers['set-cookie']).split(';')[0];
  try{
   for(const url of ['/api/ready','/api/v1/status','/api/v1/overview','/api/v1/ads/detail','/api/v1/leads?limit=1','/api/v1/settings/message-storage']){
    const response=await app.inject({url,headers:{cookie}});
    assert.equal(response.statusCode,200,url);
    if(url==='/api/v1/status')assert.equal(response.json().mode,'mongo');
    if(url==='/api/v1/settings/message-storage')assert.equal(response.json().storeContent,false,'A retenção de conteúdo precisa continuar desativada.');
    console.log('OK '+url);
   }
  }finally{await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{cookie,origin:process.env.APP_ORIGIN},payload:{}});}
  assert.equal((await app.inject({url:'/api/v1/status',headers:{cookie}})).statusCode,401);
  console.log('Render validado com Atlas: login, leituras reais, tokens descriptografados e logout. Sem chamadas aos provedores.');
 }finally{await app.close();await ctx.close();}
}
main().catch(()=>{console.error('Validação Render incompleta. Confira rede Atlas, configuração e arquivo privado de login. Nenhuma credencial foi exibida.');process.exitCode=1;});
