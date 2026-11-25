// Creates private deployment files; never writes credentials to stdout or Git.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parse} from 'dotenv';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../src/auth.js';

const local=parse(await readFile('.env','utf8'));
for(const name of ['MONGODB_URI','MONGODB_DB','CREDENTIALS_ENCRYPTION_KEY','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_CUSTOMER_ID'])if(!local[name])throw new Error(`Configure ${name} no .env local.`);
let previous:Record<string,string>={};
try{previous=parse(await readFile('.env.render','utf8'));}catch{}
const username=previous.AUTH_USERNAME||'admin';
let passwordHash=previous.AUTH_PASSWORD_HASH;
if(!passwordHash){
 const password=randomBytes(24).toString('base64url');
 passwordHash=await hashPassword(password);
 await mkdir('local-data',{recursive:true});
 await writeFile('local-data/render-login.txt',`CRM JBR — acesso ao Render\n\nURL: https://jbr-o9l2.onrender.com\nUsuário: ${username}\nSenha: ${password}\n\nArquivo privado. Não enviar ao GitHub.\n`,{encoding:'utf8',mode:0o600});
}
const env:Record<string,string>={
 NODE_VERSION:'22.18.0',NODE_ENV:'production',HOST:'0.0.0.0',APP_ORIGIN:'https://jbr-o9l2.onrender.com',SERVE_WEB:'true',
 APP_MODE:'mongo',ALLOW_PUBLIC_DEMO:'false',AUTH_USERNAME:username,AUTH_PASSWORD_HASH:passwordHash,
 MONGODB_URI:local.MONGODB_URI,MONGODB_DB:local.MONGODB_DB,MONGODB_MAX_POOL_SIZE:'8',CREDENTIALS_ENCRYPTION_KEY:local.CREDENTIALS_ENCRYPTION_KEY,
 INTEGRATIONS_ENABLED:'true',EMBEDDED_WORKER:'true',SYNC_SCHEDULER_ENABLED:'false',
 GOOGLE_ADS_API_VERSION:local.GOOGLE_ADS_API_VERSION||'v26',GOOGLE_ADS_CLIENT_ID:local.GOOGLE_ADS_CLIENT_ID,GOOGLE_ADS_CLIENT_SECRET:local.GOOGLE_ADS_CLIENT_SECRET,
 GOOGLE_ADS_LOGIN_CUSTOMER_ID:local.GOOGLE_ADS_LOGIN_CUSTOMER_ID||'',GOOGLE_ADS_CUSTOMER_ID:local.GOOGLE_ADS_CUSTOMER_ID
};
for(const key of ['CRM_ENVIRONMENT','GOOGLE_ADS_DEVELOPER_TOKEN'])if(local[key])env[key]=local[key];
if(Object.values(env).some(value=>/[\r\n"\\]/.test(value)))throw new Error('Valor incompatível com a exportação dotenv. Nenhum segredo foi exibido.');
const content='# CRM JBR — Render: dados reais, login e processamento no Web Service.\n# Arquivo privado; importar em Environment > Add from .env.\n'+Object.entries(env).map(([key,value])=>`${key}="${value}"`).join('\n')+'\n';
if(JSON.stringify(parse(content))!==JSON.stringify(env))throw new Error('Falha na validação do arquivo Render.');
await writeFile('.env.render',content,{encoding:'utf8',mode:0o600});
console.log('.env.render preparado. Acesso privado em local-data/render-login.txt. O .env local foi preservado.');
