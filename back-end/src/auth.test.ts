import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {buildApp} from './app.js';
import {hashPassword,verifyPassword} from './auth.js';
import type {MongoContext} from './mongo/connection.js';

const password='test-password-with-32-characters!',origin='https://crm.example.com';
let hash:string;
beforeAll(async()=>{hash=await hashPassword(password);});
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 for(const [key,value] of Object.entries({NODE_ENV:'production',APP_MODE:'mongo',HOST:'0.0.0.0',APP_ORIGIN:origin,AUTH_USERNAME:'admin',AUTH_PASSWORD_HASH:hash,EMBEDDED_WORKER:'false'}))vi.stubEnv(key,value);
 const rows=new Map<string,any>();
 const sessions={createIndex:vi.fn(),insertOne:async(doc:any)=>rows.set(doc._id,doc),deleteOne:async(query:any)=>rows.delete(query._id),findOne:async(query:any)=>{
  const row=rows.get(query._id);
  return row&&row.credentialVersion===query.credentialVersion&&row.expiresAt>query.expiresAt.$gt?row:null;
 }};
 const ctx={collection:(name:string)=>name==='auth_sessions'?sessions:name==='schema_migrations'?{findOne:async()=>({version:2})}:{},db:{command:async()=>({ok:1})}} as unknown as MongoContext;
 const app=buildApp({mongo:ctx});
 const login=()=>app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'admin',password}});
 return {app,login,rows,sessions};
}
it('hashes passwords with a random salt and verifies without plaintext storage',async()=>{
 expect(await verifyPassword(password,hash)).toBe(true);
 expect(await verifyPassword('wrong',hash)).toBe(false);
 expect(await verifyPassword(password,'invalid')).toBe(false);
 expect(await hashPassword(password)).not.toBe(hash);
 expect(hash).not.toContain(password);
});
it('fails closed in production if credentials or the HTTPS origin are missing',()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('AUTH_USERNAME','');
 expect(()=>buildApp({mode:'mongo'})).toThrow('AUTH_USERNAME');
 vi.stubEnv('AUTH_USERNAME','admin');vi.stubEnv('AUTH_PASSWORD_HASH',hash);vi.stubEnv('APP_ORIGIN','http://localhost');
 expect(()=>buildApp({mode:'mongo'})).toThrow('HTTPS');
 expect(()=>buildApp({mode:'local'})).toThrow('APP_MODE=mongo');
});
it('requires authentication on CRM reads and mutations while keeping health and readiness accessible',async()=>{
 const {app}=setup();
 try{
  for(const url of ['/api/v1/status','/api/v1/overview','/api/v1/ads','/api/v1/leads','/api/v1/contacts','/api/v1/conversations','/api/v1/settings/message-storage','/api/v1/meta/detail?start=2026-11-01&end=2026-11-02','/api/v1/meta/sync'])expect((await app.inject(url)).statusCode,url).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/v1/meta/sync',headers:{origin},payload:{start:'2026-11-01',end:'2026-11-02'}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/v1/attendance/ensure',headers:{origin},payload:{start:'2026-11-01',end:'2026-11-02'}})).statusCode).toBe(401);
  expect((await app.inject('/api/health')).statusCode).toBe(200);
  expect((await app.inject('/api/ready')).statusCode).toBe(200);
  expect((await app.inject('/api/v1/auth/session')).json()).toEqual({required:true,authenticated:false});
 }finally{await app.close();}
});
it('persists only a token digest, protects the cookie, rejects CSRF and revokes logout sessions',async()=>{
 const {app,login,rows,sessions}=setup();
 try{
  for(const headers of [{}, {origin:'https://other.example.com'}])expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers,payload:{username:'admin',password}})).statusCode).toBe(403);
  const result=await login();expect(result.statusCode).toBe(200);
  const setCookie=String(result.headers['set-cookie']);
  expect(setCookie).toContain('Secure');expect(setCookie).toContain('HttpOnly');expect(setCookie).toContain('SameSite=Lax');expect(setCookie).toContain('Path=/');
  const cookie=setCookie.split(';')[0],token=cookie.split('=')[1];
  expect(rows.size).toBe(1);expect(rows.has(createHash('sha256').update(token).digest('hex'))).toBe(true);
  expect(JSON.stringify([...rows.values()])).not.toContain(token);
  expect(sessions.createIndex).toHaveBeenCalledWith({expiresAt:1},{expireAfterSeconds:0,name:'session_expiry'});
  expect((await app.inject({url:'/api/v1/auth/session',headers:{cookie}})).json().authenticated).toBe(true);
  expect((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{cookie,origin:'https://other.example.com'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{cookie,origin},payload:{}})).statusCode).toBe(200);
  expect(rows.size).toBe(0);
  expect((await app.inject({url:'/api/v1/status',headers:{cookie}})).statusCode).toBe(401);
 }finally{await app.close();}
});
it('rejects expired sessions and sessions issued for a different password',async()=>{
 const {app,login,rows}=setup();
 try{
  const response=await login(),cookie=String(response.headers['set-cookie']).split(';')[0],row=[...rows.values()][0];
  row.expiresAt=new Date(0);
  expect((await app.inject({url:'/api/v1/auth/session',headers:{cookie}})).json().authenticated).toBe(false);
  row.expiresAt=new Date(Date.now()+60000);row.credentialVersion='old';
  expect((await app.inject({url:'/api/v1/status',headers:{cookie}})).statusCode).toBe(401);
 }finally{await app.close();}
});
it('limits login attempts even when forwarded IPs change',async()=>{
 const {app}=setup();
 try{
  for(let attempt=0;attempt<5;attempt++)expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin,'x-forwarded-for':`10.1.1.${attempt+1}`},payload:{username:'admin',password:'incorrect'}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin,'x-forwarded-for':'10.2.2.2'},payload:{username:'admin',password}})).statusCode).toBe(429);
 }finally{await app.close();}
});
