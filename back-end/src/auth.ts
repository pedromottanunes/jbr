import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import cookie from '@fastify/cookie';
import type {FastifyInstance} from 'fastify';
import type {MongoContext} from './mongo/connection.js';

const cookieName='__Host-jbr_session';
const sessionSeconds=12*60*60;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>{
 scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key));
});
export async function hashPassword(password:string){
 if(password.length<16||password.length>256)throw new Error('A senha deve ter entre 16 e 256 caracteres.');
 const salt=randomBytes(16).toString('hex');
 return `scrypt:${salt}:${(await derive(password,salt)).toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string){
 if(!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)||password.length>256)return false;
 const [,salt,expected]=encoded.split(':');
 return timingSafeEqual(await derive(password,salt),Buffer.from(expected,'hex'));
}
export function authConfig(){
 const username=process.env.AUTH_USERNAME??'',passwordHash=process.env.AUTH_PASSWORD_HASH??'';
 if(!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username)||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash))throw new Error('Configure AUTH_USERNAME e AUTH_PASSWORD_HASH para acessar os dados reais no servidor.');
 let origin:URL;
 try{origin=new URL(process.env.APP_ORIGIN??'');}catch{throw new Error('Configure APP_ORIGIN com a URL HTTPS do CRM.');}
 if(origin.protocol!=='https:'||origin.origin!==process.env.APP_ORIGIN)throw new Error('APP_ORIGIN deve ser a origem HTTPS do CRM, sem caminho ou barra final.');
 return {username,passwordHash,origin:origin.origin,version:digest(username+'\n'+passwordHash)};
}
export async function registerAuth(app:FastifyInstance,ctx:MongoContext,config:ReturnType<typeof authConfig>){
 await app.register(cookie);
 const sessions=ctx.collection('auth_sessions');
 await sessions.createIndex({expiresAt:1},{expireAfterSeconds:0,name:'session_expiry'});
 const options={path:'/',httpOnly:true,secure:true,sameSite:'lax' as const};
 const session=async(token:string|undefined)=>{
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return sessions.findOne({_id:digest(token),credentialVersion:config.version,expiresAt:{$gt:new Date()}},{projection:{username:1,expiresAt:1},maxTimeMS:5000});
 };
 app.addHook('onRequest',async(req,reply)=>{
  const origin=req.headers.origin;
  if((origin&&origin!==config.origin)||(!['GET','HEAD','OPTIONS'].includes(req.method)&&origin!==config.origin))return reply.code(403).send({message:'Origem da solicitação inválida.'});
  const route=req.routeOptions.url;
  if(route==='/api/ready'||route==='/api/v1/auth/session'||route==='/api/v1/auth/login')return;
  if(!await session(req.cookies[cookieName]))return reply.code(401).send({message:'Entre no CRM para continuar.'});
 });
 app.get('/api/v1/auth/session',async(req)=>{
  const current=await session(req.cookies[cookieName]);
  return {required:true,authenticated:!!current,...(current?{username:current.username}:{} )};
 });
 app.post<{Body:{username:string;password:string}}>('/api/v1/auth/login',{
  // One shared bucket prevents spoofed forwarded IPs from bypassing password throttling.
  config:{rateLimit:{max:5,timeWindow:'1 minute',keyGenerator:()=> 'crm-login'}},
  schema:{body:{type:'object',required:['username','password'],additionalProperties:false,properties:{username:{type:'string',maxLength:80},password:{type:'string',maxLength:256}}}}
 },async(req,reply)=>{
  const valid=await verifyPassword(req.body.password,config.passwordHash);
  if(!valid||req.body.username!==config.username)return reply.code(401).send({message:'Usuário ou senha incorretos.'});
  const old=req.cookies[cookieName];
  if(old&&/^[a-f0-9]{64}$/.test(old))await sessions.deleteOne({_id:digest(old)});
  const token=randomBytes(32).toString('hex');
  await sessions.insertOne({_id:digest(token),username:config.username,credentialVersion:config.version,expiresAt:new Date(Date.now()+sessionSeconds*1000)});
  reply.setCookie(cookieName,token,{...options,maxAge:sessionSeconds});
  return {required:true,authenticated:true,username:config.username};
 });
 app.post('/api/v1/auth/logout',async(req,reply)=>{
  const token=req.cookies[cookieName];
  if(token)await sessions.deleteOne({_id:digest(token)});
  reply.clearCookie(cookieName,options);
  return {ok:true};
 });
}
