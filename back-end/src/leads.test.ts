import {expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {registerLeads} from './leads';
it('filters and pages observed tags, preserves contact identity and refreshes on publication',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE crm_meta(key TEXT,value TEXT);INSERT INTO crm_meta VALUES('publishedAt','"v1"');
 CREATE TABLE crm_contacts(id TEXT,label TEXT,phone TEXT,first_inbound_at TEXT,source TEXT);
 CREATE TABLE crm_chats(id TEXT,contact_id TEXT,at TEXT,is_open INTEGER,message_count INTEGER,limited INTEGER);
 CREATE TABLE chats(organization_id TEXT,raw_json TEXT);
 INSERT INTO crm_contacts VALUES('org:a','José','+55 (41) 99999-0000','2026-11-20','Não identificada'),('org:b','Maria','5541999990000','2026-11-19','Google indicado');
 INSERT INTO crm_chats VALUES('org:x','org:a','2026-11-20',1,4,1);
 INSERT INTO chats VALUES('org','{"contact":{"id":"a","tags":[{"name":"VENDA OK"}]},"tags":[{"name":"ANTT"},{"name":"VENDA OK"}]}');`);
 const app=Fastify();registerLeads(app,db);const fetcher=vi.spyOn(globalThis,'fetch');
 try{
  const list=(await app.inject('/api/v1/leads?tag=VENDA%20OK')).json();expect(list.total).toBe(1);expect(list.items[0].tags).toEqual([{name:'ANTT',scopes:['conversa']},{name:'VENDA OK',scopes:['contato','conversa']}]);
  expect((await app.inject('/api/v1/leads?q=jose')).json().total).toBe(1);expect((await app.inject('/api/v1/leads?q=41999990000')).json().total).toBe(2);
  expect((await app.inject('/api/v1/leads?limit=1')).json().nextCursor).toBe(1);
  expect((await app.inject('/api/v1/leads/org:a')).json().chats[0]).toMatchObject({id:'org:x',messageCount:4,limited:1});
  expect((await app.inject('/api/v1/leads/nope')).statusCode).toBe(404);
  expect((await app.inject('/api/v1/leads?limit=51')).statusCode).toBe(400);
  db.exec("DELETE FROM chats; UPDATE crm_meta SET value='\"v2\"'");expect((await app.inject('/api/v1/leads?tag=VENDA%20OK')).json().total).toBe(0);expect(fetcher).not.toHaveBeenCalled();
 }finally{fetcher.mockRestore();await app.close();db.close();}
});
