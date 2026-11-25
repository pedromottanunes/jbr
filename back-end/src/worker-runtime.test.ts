import {afterEach,expect,it,vi} from 'vitest';
import type {MongoContext} from './mongo/connection.js';
const worker=vi.hoisted(()=>({started:0,stopped:0}));
vi.mock('./mongo/worker-loop.js',()=>({runWorkerLoop:async(_ctx:unknown,signal:AbortSignal)=>{worker.started++;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{worker.stopped++;resolve();},{once:true}));}}));
import {buildApp} from './app.js';
afterEach(()=>vi.unstubAllEnvs());
it('starts one embedded worker after listening and waits for it to stop on shutdown',async()=>{
 vi.stubEnv('NODE_ENV','test');vi.stubEnv('HOST','127.0.0.1');vi.stubEnv('EMBEDDED_WORKER','true');
 const ctx={collection:(name:string)=>name==='schema_migrations'?{findOne:async()=>({version:2})}:{}} as unknown as MongoContext;
 const app=buildApp({mode:'mongo',mongo:ctx});
 await app.ready();expect(worker.started).toBe(0);
 await app.listen({port:0,host:'127.0.0.1'});
 expect(worker.started).toBe(1);expect(worker.stopped).toBe(0);
 await app.close();expect(worker.stopped).toBe(1);
});
