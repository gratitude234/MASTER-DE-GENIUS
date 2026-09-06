import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableQueue, SyncFailure } from '../features/offline/queue.ts';
import { SessionClock, resumedTime } from '../features/offline/clock.ts';
import 'fake-indexeddb/auto';
import { claimOwner, clearDevice, readRecord, writeRecord, listRecords } from '../features/offline/storage.ts';
const fresh = () => ({ key:'u:exam:s', userId:'u', kind:'exam', id:'s', version:1, view:{}, answers:{q:{selectedOptionKey:null,isFlagged:false,revision:0}}, pending:{},cursor:{subject:0,question:0},serverTime:0,wallTime:0,final:false });
const choice = selectedOptionKey => ({ selectedOptionKey,isFlagged:false });
const pause = () => { let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve}; };
test('selection is committed to IndexedDB before transmission',async()=>{
 await claimOwner('u'); const record=fresh();let sent=false;
 const q=new DurableQueue(record,writeRecord,async(id,p)=>{sent=true;assert.equal((await readRecord(record.key)).pending.q.mutationId,p.mutationId);return {...p,revision:1}});
 await q.select('q',choice('A'));assert.equal(sent,false);assert.equal(await q.flush(),true);
 assert.equal(Object.keys((await readRecord(record.key)).pending).length,0);
});
test('late acknowledgement never changes a newer choice; concurrent flushes share one promise',async()=>{
 const latch=pause();let calls=0;const q=new DurableQueue(fresh(),async()=>{},async(id,p)=>{calls++;if(calls===1)await latch.promise;return {...p,revision:calls}});
 await q.select('q',choice('A'));const first=q.flush();assert.equal(q.flush(),first);
 await new Promise(r=>setTimeout(r,0));await q.select('q',choice('B'));latch.resolve();await first;
 assert.equal(q.record.answers.q.selectedOptionKey,'B');assert.equal(q.record.answers.q.revision,2);assert.equal(calls,2);
});
test('lost ack retries same mutation ID after restart',async()=>{
 let saved;const q=new DurableQueue(fresh(),async r=>{saved=r},async()=>{throw new Error('connection lost')});
 await q.select('q',choice('A'));const original=q.record.pending.q.mutationId;assert.equal(await q.flush(),false);
 const restarted=new DurableQueue(saved,async()=>{},async(id,p)=>{assert.equal(p.mutationId,original);return {...p,revision:1}});
 assert.equal(await restarted.flush(),true);assert.equal(restarted.record.answers.q.selectedOptionKey,'A');
});
test('conflicting writes preserve pending choices and stop automatic retries',async()=>{
 let calls=0;const q=new DurableQueue(fresh(),async()=>{},async()=>{calls++;throw new SyncFailure('newer answer','CONFLICT')});
 await q.select('q',choice('C'));assert.equal(await q.flush(),false);await q.flush();assert.equal(calls,1);assert.equal(q.record.pending.q.selectedOptionKey,'C');
});
test('failed device commit never sends answer',async()=>{
 let calls=0;const q=new DurableQueue(fresh(),async()=>{throw new Error('quota')},async()=>{calls++});
 await assert.rejects(q.select('q',choice('D')));assert.equal(await q.flush(),false);assert.equal(calls,0);
});
test('finalisation preserves unconfirmed changes instead of erasing them',async()=>{
 const q=new DurableQueue(fresh(),async()=>{},async()=>{});await q.select('q',choice('A'));await q.finish();assert.equal(q.record.final,true);assert.equal(q.record.pending.q.selectedOptionKey,'A');
});
test('clock ignores backward wall changes and accounts for suspended elapsed time',()=>{
 let mono=0,wall=1000;const c=new SessionClock(5000,()=>mono,()=>wall);mono=100;wall=0;assert.equal(c.now(),5100);mono=200;wall=11000;assert.equal(c.now(),15000);
 c.sync(7000);assert.equal(c.now(),7000);assert.equal(resumedTime(1000,500,400),1000);assert.equal(resumedTime(1000,500,800),1300);
});
test('account change and sign-out prevent stale tabs from restoring private data',async()=>{
 await claimOwner('u');await writeRecord(fresh());await claimOwner('other');assert.equal((await listRecords()).length,0);
 await assert.rejects(writeRecord(fresh()));await clearDevice();await assert.rejects(writeRecord({...fresh(),userId:'other'}));
});

test('storage recovery saves the retained choice before retrying delivery',async()=>{
 let fail=true;let sent=false;const q=new DurableQueue(fresh(),async()=>{if(fail)throw new Error('quota')},async(id,p)=>{sent=true;return {...p,revision:1}});
 await assert.rejects(q.select('q',choice('C')));fail=false;await q.retryStorage();assert.equal(await q.flush(),true);assert.equal(sent,true);assert.equal(q.record.answers.q.selectedOptionKey,'C');
});
