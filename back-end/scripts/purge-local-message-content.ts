// One-time cleanup of the CRM's retired SQLite stores and local test/backups.
// No provider calls. Only explicitly recognized artifacts below local-data.
import {DatabaseSync} from 'node:sqlite';
import {realpath,readdir,readFile,writeFile,rename,stat,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {resolve,join,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {BSON} from 'mongodb';
import {sourceFacts,messageFacts} from '../src/mongo/message-storage.js';
import {extractCtaKey} from '../src/cta.js';

async function main(){
 if(!process.argv.includes('--apply'))throw new Error('Use --apply para remover conteúdo das cópias locais do CRM.');
 const root=await realpath(resolve('local-data'));
 async function safe(path:string){const resolved=await realpath(path),rel=relative(root,resolved);if(rel.startsWith('..')||resolve(root,rel)!==resolved||(await lstat(path)).isSymbolicLink())throw new Error('Arquivo fora de local-data.');return resolved;}
 const sha=async(path:string)=>{const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');};
 const folders=[root];
 const backups=join(root,'backups');
 for(const d of await readdir(backups,{withFileTypes:true}))if(d.isDirectory()&&!d.isSymbolicLink())folders.push(await safe(join(backups,d.name)));
 let sqliteFiles=0,archives=0;
 for(const folder of folders){
  const files=await readdir(folder);
  if(files.includes('umbler.sqlite3')){
   const file=await safe(join(folder,'umbler.sqlite3')),db=new DatabaseSync(file);
   try{
    db.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA wal_checkpoint(TRUNCATE);');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
    db.exec('BEGIN IMMEDIATE');
    try{
     for(const name of ['channels','chats','messages','service_chats','service_events','service_ratings','export_messages']){
      if(!tables.has(name))continue;const update=db.prepare('UPDATE '+name+' SET raw_json=? WHERE rowid=?');
      for(const row of db.prepare('SELECT rowid AS cleanup_row,raw_json FROM '+name).iterate()){
       const clean=sourceFacts(name,{raw:JSON.parse(String(row.raw_json))});update.run(JSON.stringify(clean.raw??{}),row.cleanup_row);
      }
     }
     if(tables.has('crm_messages')){
      const columns=db.prepare('PRAGMA table_info(crm_messages)').all();if(!columns.some(c=>c.name==='cta_key'))db.exec('ALTER TABLE crm_messages ADD COLUMN cta_key TEXT');
      const update=db.prepare("UPDATE crm_messages SET cta_key=?,content='' WHERE rowid=?");
      for(const row of db.prepare('SELECT rowid AS cleanup_row,content,cta_key FROM crm_messages').iterate())update.run(row.cta_key??extractCtaKey({content:String(row.content)}),row.cleanup_row);
     }
     if(tables.has('crm_meta'))db.prepare("INSERT INTO crm_meta(key,value) VALUES('messageContentRemoved','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');sqliteFiles++;
   }finally{db.close();}
  }
  for(const name of files){
   if(!/^(messages|umbler_[a-z_]+)\.jsonl\.gz$/.test(name))continue;
   const file=await safe(join(folder,name)),collection=name.slice(0,-9),temp=file+'.sanitized';
   const lines=createInterface({input:createReadStream(file).pipe(createGunzip()),crlfDelay:Infinity});
   async function* clean(){for await(const line of lines){if(!line)continue;const doc=BSON.EJSON.parse(line,{relaxed:false});const row=collection==='messages'?messageFacts(doc):sourceFacts(collection.slice(7),doc);yield BSON.EJSON.stringify(row,{relaxed:false})+'\n';}}
   await pipeline(Readable.from(clean()),createGzip(),createWriteStream(temp,{mode:0o600}));await safe(file);await safe(temp);await rename(temp,file);archives++;
  }
  if(files.includes('manifest.json')){
   const file=await safe(join(folder,'manifest.json')),manifest=JSON.parse(await readFile(file,'utf8'));
   if(Array.isArray(manifest.collections))for(const item of manifest.collections)item.sha256=await sha(await safe(join(folder,item.collection+'.jsonl.gz')));
   else if(manifest['umbler.sqlite3']){
    const path=await safe(join(folder,'umbler.sqlite3')),value=manifest['umbler.sqlite3'];
    if(typeof value==='string')manifest['umbler.sqlite3']=await sha(path);
    else {if('sha256'in value)value.sha256=await sha(path);if('bytes'in value)value.bytes=(await stat(path)).size;if('size'in value)value.size=(await stat(path)).size;}
   }
   manifest.messageContent=false;manifest.contentPurgedAt=new Date().toISOString();await writeFile(file,JSON.stringify(manifest,null,2));
  }
 }
 for(const name of ['mongo-baseline.json','review-baseline.json']){
  const file=await safe(join(root,name)),data=JSON.parse(await readFile(file,'utf8'));
  for(const [route,response] of Object.entries(data) as [string,any][]){
   if(route.startsWith('/api/v1/conversations/')){response.messages=(response.messages??[]).map(messageFacts);if(response.focusMessage)response.focusMessage=messageFacts(response.focusMessage);response.contentStorageEnabled=false;}
   if(route.startsWith('/api/v1/funnel'))for(const lead of response.items??[])for(const e of lead.evidence??[])if(['message','reply'].includes(e.kind)){e.ctaKey=extractCtaKey({content:e.text});e.text=e.kind==='reply'?'Resposta registrada':'Mensagem registrada';e.contentStored=false;}
  }
  await writeFile(file,JSON.stringify(data));
 }
 console.log(JSON.stringify({sqliteFiles,archives,baselines:2,messageContent:false}));
}
main().catch(()=>{console.error('Limpeza local interrompida. Verifique os arquivos do CRM e repita o comando.');process.exitCode=1;});
