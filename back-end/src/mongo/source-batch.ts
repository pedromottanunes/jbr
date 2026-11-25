import type {AnyBulkWriteOperation, ClientSession} from 'mongodb';
import type {MongoContext} from './connection.js';
import {digest} from './datasets.js';
import {checkSignal} from './cancellation.js';
import {messageStorage,sourceFacts} from './message-storage.js';

export type SourceBatch = Record<string, AnyBulkWriteOperation<any>[]>;
export function sourceRow(batch: SourceBatch, table: string, keys: string[], row: any) {
  (batch['umbler_' + table] ??= []).push({updateOne: {
    filter: {_id: digest(keys.map(k => row[k]))}, update: {$set: {...row, hash: digest(row)}}, upsert: true,
  }});
}
export function sourceMeta(batch: SourceBatch, key: string, value: any) {
  (batch.integration_state ??= []).push({updateOne: {filter: {_id: key}, update: {$set: {value}}, upsert: true}});
}
// The page and its resume cursor commit together. The lease is fenced in the
// same transaction, so an expired worker cannot advance another worker's cursor.
export async function saveSourceBatch(ctx: MongoContext, owner: string, batch: SourceBatch, signal?: AbortSignal) {
  checkSignal(signal);
  await ctx.transaction(async (session: ClientSession) => {
    checkSignal(signal);
    const held = await ctx.collection('integration_leases').updateOne(
      {_id: 'umbler', owner, expiresAt: {$gt: new Date()}},
      {$set: {expiresAt: new Date(Date.now() + 120000)}}, {session},
    );
    if (!held.matchedCount) throw new Error('Posse da coleta expirada.');
    const policy=await messageStorage(ctx,session);
    for (const [name, operations] of Object.entries(batch)) {
      checkSignal(signal);
      const safe=operations.map((op:any)=>{
        if(!name.startsWith('umbler_')||!op.updateOne?.update?.$set||op.updateOne.update.$max)return op;
        const row=sourceFacts(name.slice(7),{...op.updateOne.update.$set,_id:op.updateOne.filter._id},policy.storeContent);
        return {replaceOne:{filter:op.updateOne.filter,replacement:row,upsert:op.updateOne.upsert}};
      });
      if (safe.length) await ctx.collection(name).bulkWrite(safe, {ordered: false, session});
    }
  });
}
