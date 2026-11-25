import {MongoClient,type Db,type Collection} from 'mongodb';
import {randomUUID} from 'node:crypto';

export class MongoContext {
 readonly db:Db;
 constructor(readonly client:MongoClient,database:string,readonly prefix=''){this.db=client.db(database);}
 collection(name:string):Collection<any>{
  if(!/^[a-z][a-z0-9_]*$/.test(name)||!/^(test_[a-f0-9]+_)?$/.test(this.prefix))throw new Error('Coleção inválida.');
  return this.db.collection(this.prefix+name);
 }
 async lease(resource:string,ttl=120000,owner:string=randomUUID()){
  const now=new Date();
  try{const row=await this.collection('integration_leases').findOneAndUpdate({_id:resource,$or:[{expiresAt:{$lte:now}},{owner}]},{$set:{owner,expiresAt:new Date(+now+ttl)},$inc:{generation:1}},{upsert:true,returnDocument:'after'});return row?owner:null;}
  catch(e){if((e as any).code===11000)return null;throw e;}
 }
 async renew(resource:string,owner:string,ttl=120000){return (await this.collection('integration_leases').updateOne({_id:resource,owner,expiresAt:{$gt:new Date()}},{$set:{expiresAt:new Date(Date.now()+ttl)}})).matchedCount===1;}
 async release(resource:string,owner:string){await this.collection('integration_leases').deleteOne({_id:resource,owner});}
 async transaction<T>(work:(session:import('mongodb').ClientSession)=>Promise<T>){
  const session=this.client.startSession();try{return await session.withTransaction(()=>work(session),{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},readPreference:'primary',maxCommitTimeMS:15000});}finally{await session.endSession();}
 }
 async close(){await this.client.close();}
}

export async function connectMongo(prefix=''){
 const uri=process.env.MONGODB_URI??'',database=process.env.MONGODB_DB??'';
 if(!uri.startsWith('mongodb+srv://')||/[<>]/.test(uri)||!/^[a-z][a-z0-9_]{2,37}$/.test(database)||['admin','local','config'].includes(database))throw new Error('Configure MONGODB_URI e MONGODB_DB no backend.');
 const pool=Number(process.env.MONGODB_MAX_POOL_SIZE??8);
 if(!Number.isInteger(pool)||pool<1||pool>20)throw new Error('MONGODB_MAX_POOL_SIZE deve estar entre 1 e 20.');
 const client=new MongoClient(uri,{appName:'jbr-crm',maxPoolSize:pool,minPoolSize:0,maxConnecting:2,maxIdleTimeMS:60000,socketTimeoutMS:20000,serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,waitQueueTimeoutMS:10000,retryWrites:true,writeConcern:{w:'majority',wtimeoutMS:10000},ignoreUndefined:true});
 try{
  await client.connect();const hello=await client.db(database).command({hello:1});
  if(!hello.logicalSessionTimeoutMinutes||(!hello.setName&&hello.msg!=='isdbgrid'))throw new Error('topology');
  await client.db(database).command({ping:1});return new MongoContext(client,database,prefix);
 }catch{await client.close();throw new Error('Não foi possível conectar ao Atlas com suporte a transações. Verifique rede, credenciais e configuração.');}
}
