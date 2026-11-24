import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app';

const dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
it('serves only persisted records, pages tied timestamps, and blocks nonlocal access and sending',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'jbr-test-'));dirs.push(dir);const path=join(dir,'cache.db');
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE crm_meta(key TEXT,value TEXT);CREATE TABLE crm_contacts(id TEXT,label TEXT,phone TEXT,first_inbound_at TEXT,source TEXT);CREATE TABLE crm_chats(id TEXT,contact_id TEXT,label TEXT,at TEXT,is_open INTEGER,message_count INTEGER,limited INTEGER);CREATE TABLE crm_messages(chat_id TEXT,id TEXT,at TEXT,author TEXT,incoming INTEGER,content TEXT,kind TEXT,private INTEGER);
 INSERT INTO crm_contacts VALUES ('p','Contato teste','5500000000000','2026-11-20T10:00:00Z','Não identificada');
 INSERT INTO crm_chats VALUES ('c','p','Contato teste','2026-11-20T10:00:00Z',1,105,1);`);
 for(let i=0;i<105;i++) db.prepare('INSERT INTO crm_messages VALUES (?,?,?,?,?,?,?,?)').run('c',String(i).padStart(3,'0'),'2026-11-20T10:00:00Z','Contato',1,'Mensagem de teste','Text',0);
 db.close();
 const fetcher=vi.spyOn(globalThis,'fetch');
 const app=buildApp({mode:'local',databasePath:path});
 try {
  const overview=await app.inject('/api/v1/overview'); expect(overview.json().messages).toBe(105);expect(overview.json().metrics).toBeUndefined();
  expect((await app.inject('/api/v1/ads')).json().metrics).toBeNull();
  const search=await app.inject('/api/v1/contacts?q=550000');expect(search.json().items).toHaveLength(1);
  expect((await app.inject('/api/v1/contacts?q=%25')).json().items).toHaveLength(0);
  const first=(await app.inject('/api/v1/conversations/c')).json();expect(first.messages).toHaveLength(100);
  const second=(await app.inject('/api/v1/conversations/c?before='+first.nextCursor)).json();expect(second.messages).toHaveLength(5);expect(second.nextCursor).toBeNull();
  expect(new Set([...first.messages,...second.messages].map(m=>m.id)).size).toBe(105);
  expect((await app.inject('/api/v1/conversations/c?before=bad')).statusCode).toBe(400);
  expect((await app.inject({url:'/api/v1/overview',headers:{host:'attacker.example'}})).statusCode).toBe(403);
  expect((await app.inject({url:'/api/v1/overview',headers:{origin:'https://attacker.example'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/v1/conversations/c/messages'})).statusCode).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
 } finally {await app.close();}
});
it('refuses real data in production or on a public bind address',()=>{
 vi.stubEnv('HOST','0.0.0.0');expect(()=>buildApp({mode:'local'})).toThrow('loopback');
 vi.stubEnv('HOST','127.0.0.1');vi.stubEnv('NODE_ENV','production');expect(()=>buildApp({mode:'local'})).toThrow('loopback');
});
