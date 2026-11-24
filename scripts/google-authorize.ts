import 'dotenv/config';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const redirect='http://127.0.0.1:3001/oauth/google/callback';
async function protect(token:string) {
 if(process.platform!=='win32') throw new Error('Este assistente local usa a proteção do Windows.');
 const encrypted=await new Promise<string>((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $secret=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; try { $secret | ConvertFrom-SecureString } finally { $secret.Dispose() }"],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();
  child.on('error',()=>reject(new Error('Não foi possível proteger o token.')));
  child.on('close',code=>code===0&&output.trim()?resolve(output.trim()):reject(new Error('Não foi possível proteger o token.')));
  child.stdin.on('error',()=>{});child.stdin.end(token);
 });
 const folder=resolve('local-data');await mkdir(folder,{recursive:true});
 const target=resolve(folder,'google-refresh-token.dpapi');const temporary=target+'.tmp';
 await writeFile(temporary,encrypted,{mode:0o600});await rename(temporary,target);
}
async function main() {
 const clientId=process.env.GOOGLE_ADS_CLIENT_ID,clientSecret=process.env.GOOGLE_ADS_CLIENT_SECRET;
 if(!clientId||!clientSecret) throw new Error('Preencha GOOGLE_ADS_CLIENT_ID e GOOGLE_ADS_CLIENT_SECRET no .env. Veja GOOGLE-OAUTH.md.');
 if(process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI!==redirect) throw new Error('Configure GOOGLE_ADS_OAUTH_REDIRECT_URI como '+redirect);
 if(process.platform!=='win32') throw new Error('Execute este assistente no Windows local.');
 const client=new OAuth2Client({clientId,clientSecret,redirectUri:redirect});
 const verifier=await client.generateCodeVerifierAsync();const state=randomBytes(32).toString('base64url');let used=false;
 const url=client.generateAuthUrl({scope:['https://www.googleapis.com/auth/adwords'],access_type:'offline',prompt:'consent',state,code_challenge:verifier.codeChallenge,code_challenge_method:CodeChallengeMethod.S256});
 await new Promise<void>((resolve,reject)=>{
  const server=createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Referrer-Policy','no-referrer');
   if(req.method!=='GET'||req.headers.host!=='127.0.0.1:3001') {res.writeHead(400).end('Requisição inválida.');return;}
   const request=new URL(req.url??'/',redirect);const received=request.searchParams.get('state')??'';
   if(request.pathname!=='/oauth/google/callback'||used||!/^[A-Za-z0-9_-]{43}$/.test(received)||!timingSafeEqual(Buffer.from(received),Buffer.from(state))) {res.writeHead(400).end('Autorização inválida ou expirada.');return;}
   used=true;
   try {
    const code=request.searchParams.get('code');if(!code||request.searchParams.has('error')) throw new Error('Autorização não concedida.');
    const response=await client.getToken({code,codeVerifier:verifier.codeVerifier,redirect_uri:redirect});
    if(!response.tokens.refresh_token) throw new Error('O Google não retornou um refresh token.');
    await protect(response.tokens.refresh_token);
    res.end('Google autorizado. O token foi protegido neste computador. Pode fechar esta aba.');
    clearTimeout(timer);server.close();resolve();
   } catch {res.writeHead(400).end('Não foi possível concluir a autorização. Execute o comando novamente.');clearTimeout(timer);server.close();reject(new Error('Autorização não concluída; nenhuma credencial foi exibida.'));}
  });
  const timer=setTimeout(()=>{server.close();reject(new Error('Autorização expirou após 5 minutos.'));},300_000);
  server.on('error',()=>{clearTimeout(timer);reject(new Error('Não foi possível abrir a porta local 3001.'));});
  server.listen(3001,'127.0.0.1',()=>{console.log('Abra este endereço no navegador e autorize com a conta Google que acessa a JBR:\n'+url);});
 });
 console.log('Refresh token salvo com proteção DPAPI em local-data/google-refresh-token.dpapi.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Falha na autorização.');process.exitCode=1;});
