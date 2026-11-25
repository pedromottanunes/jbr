import {it,expect} from 'vitest';
import {normalizeSource, digest} from './datasets.js';
import {buildViews,analytics} from './model.js';
import {protectSecret} from './secrets.js';
import {randomBytes} from 'node:crypto';

it('preserva identidade, origem, mensagem privada, autoria e cobertura na publicação',()=>{
 const raw={id:'chat',contact:{id:'lead',contactType:'DirectMessage',name:'Cliente',phoneNumber:'554100000000',tags:[{name:'Google'}]},firstContactMessage:{eventAtUTC:'2026-11-24T11:00:00Z'},lastMessage:{eventAtUTC:'2026-11-24T12:00:00Z'},open:true};
 const rows={chats:[{organization_id:'org',id:'chat',raw_json:JSON.stringify(raw)}],messages:[{organization_id:'org',chat_id:'chat',id:'m1',event_at_utc:'2026-11-24T11:00:00Z',raw_json:JSON.stringify({_t:'MessageModel',source:'Contact',content:'Olá',messageType:'Text'})},{organization_id:'org',chat_id:'chat',id:'m2',event_at_utc:'2026-11-24T12:00:00Z',raw_json:JSON.stringify({_t:'SentMessageModel',source:'Member',content:'Nota',isPrivate:true,sentByOrganizationMember:{id:'human'}})}],crm_members:[{organization_id:'org',id:'human',name:'Equipe',kind:'OrganizationHumanAgentReferenceModel',active:1}],crm_meta:[{key:'publishedAt',value:JSON.stringify('2026-11-24T15:00:00Z')}],service_progress:[],service_chats:[],service_events:[],service_coverage:[],service_ratings:[],chat_sync:[]};
 const normalized=normalizeSource(rows),v=buildViews(normalized),result=analytics(v.contacts,v.conversations,v.messages);
 expect(v.totals).toMatchObject({contacts:1,messages:2,conversations:1,googleIndicated:1});expect(v.contacts[0].id).toBe('org:lead');expect(v.contacts[0].tags).toEqual([{name:'Google',scopes:['contato']}]);expect(v.conversations[0].limited).toBe(1);expect(v.messages[1].author).toBe('Equipe');expect(result.attendance.conversations[0].events).toHaveLength(1);expect(result.funnel[0].messages).toHaveLength(1);expect(digest(buildViews(normalizeSource(rows)))).toBe(digest(v));
 const bsonRows=Object.fromEntries(Object.entries(rows).map(([key,items])=>[key,items.map((r:any)=>{const {raw_json,...rest}=r;return raw_json?{...rest,raw:JSON.parse(raw_json)}:r;})]));
 expect(buildViews(normalizeSource(bsonRows))).toEqual(v);
});
it('protege tokens com autenticação criptográfica e detecta alteração ou chave errada',()=>{
 const previous=process.env.CREDENTIALS_ENCRYPTION_KEY;
 try{process.env.CREDENTIALS_ENCRYPTION_KEY=randomBytes(32).toString('base64');const encrypted=protectSecret('fixture-token',true);expect(encrypted).not.toContain('fixture-token');expect(protectSecret(encrypted,false)).toBe('fixture-token');const parts=encrypted.split('.');parts[3]=Buffer.from('corrompido').toString('base64');expect(()=>protectSecret(parts.join('.'),false)).toThrow();process.env.CREDENTIALS_ENCRYPTION_KEY=randomBytes(32).toString('base64');expect(()=>protectSecret(encrypted,false)).toThrow();}
 finally{if(previous===undefined)delete process.env.CREDENTIALS_ENCRYPTION_KEY;else process.env.CREDENTIALS_ENCRYPTION_KEY=previous;}
});
