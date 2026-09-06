import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
 if(specifier==='server-only') return { url:'data:text/javascript,export {}',shortCircuit:true };
 if(specifier==='@/lib/supabase/admin') return {url:'data:text/javascript,export const createAdminClient=()=>globalThis.__testDatabase',shortCircuit:true};
 if(specifier==='./grading') return next('./grading.ts', context);
 return next(specifier,context);
}});
const { checkAutomaticExpiry, parseRevision } = await import('../features/offline/server.ts');
const { loadResult, startRevision } = await import('../features/results/service.ts');
const id='11111111-1111-4111-8111-111111111111';
function database(responses) {
 const calls=[];
 globalThis.__testDatabase={from(table){
  const call={table,filters:[]}; calls.push(call);
  const chain={select(){return chain},eq(...filter){call.filters.push(filter);return chain},order(){return chain},
   maybeSingle(){return Promise.resolve(responses[table]??{data:null,error:null})},single(){return chain.maybeSingle()},
   then(resolve,reject){return Promise.resolve(responses[table]??{data:[],error:null}).then(resolve,reject)}};
  return chain;
 },rpc(){throw new Error('Unexpected mutation')}};
 return calls;
}
test('non-owned or active exam returns no keys and never queries questions',async()=>{
 const calls=database({});
 assert.equal(await loadResult('student-1','exam',id),null);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].filters,[['id',id],['user_id','student-1'],['status','submitted']]);
});
test('practice result requires ownership and completed status before keys',async()=>{
 const calls=database({}); await loadResult('student-2','practice',id);
 assert.equal(calls.length,1);assert.ok(calls[0].filters.some(f=>f[0]==='status'&&f[1]==='completed'));
 assert.ok(calls[0].filters.some(f=>f[0]==='user_id'&&f[1]==='student-2'));
});
test('invalid ID cannot initiate a database lookup',async()=>{
 const calls=database({});assert.equal(await loadResult('student','exam','bad-id'),null);assert.equal(calls.length,0);
});
test('revision rejects an unavailable completed result without mutating',async()=>{
 database({});await assert.rejects(startRevision('student',{resultId:id,kind:'exam',subjectSlug:'physics'}),/Completed result not found/);
});
test('completed result grades frozen key and caps expired elapsed duration',async()=>{
 const snapshot={examBody:'jamb',subject:{slug:'physics',name:'Physics'},topic:null,source:{provider:'internal',providerQuestionId:'q1'}};
 database({exam_attempts:{data:{id,exam_body_id:'jamb',total_questions:1,started_at:'2026-01-01T00:00:00Z',expires_at:'2026-01-01T02:00:00Z',submitted_at:'2026-01-02T00:00:00Z'},error:null},
 exam_bodies:{data:{code:'jamb',short_name:'JAMB'},error:null},
 exam_attempt_questions:{data:[{id:'q1',overall_position:1,student_snapshot:snapshot,correct_option_key:'B',explanation:'Because B.'}],error:null},
 exam_attempt_answers:{data:[{attempt_question_id:'q1',selected_option_key:'B',is_correct:false,is_flagged:true}],error:null}});
 const r=await loadResult('student','exam',id);assert.equal(r.correct,1);assert.equal(r.elapsedSeconds,7200);assert.equal(r.items[0].explanation,'Because B.');
});
test('revision copies server-owned keys into the RPC and returns only a session ID',async()=>{
 const snapshot={examBody:'jamb',subject:{slug:'physics',name:'Physics'},topic:null,source:{provider:'internal',providerQuestionId:'q1'}};
 database({exam_attempts:{data:{id,exam_body_id:'jamb',total_questions:1,started_at:'2026-01-01T00:00:00Z',expires_at:'2026-01-01T02:00:00Z',submitted_at:'2026-01-01T01:00:00Z'},error:null},
 exam_bodies:{data:{code:'jamb',short_name:'JAMB'},error:null},subjects:{data:{id:'physics-id'},error:null},
 exam_attempt_questions:{data:[{id:'q1',overall_position:1,student_snapshot:snapshot,correct_option_key:'B',explanation:'Saved explanation.'}],error:null},
 exam_attempt_answers:{data:[],error:null}});
 let payload;
 globalThis.__testDatabase.rpc=async(name,args)=>{assert.equal(name,'create_practice_session');payload=args;return {data:'revision-id',error:null}};
 const response=await startRevision('student',{resultId:id,kind:'exam',subjectSlug:'physics'});
 assert.equal(response,'revision-id');assert.equal(payload.p_user_id,'student');assert.equal(payload.p_questions[0].correctOptionKey,'B');
 assert.equal(payload.p_questions[0].studentSnapshot.correctOptionKey,undefined);
 assert.equal(payload.p_questions[0].sourceQuestionId,'q1');assert.equal(payload.p_requested_count,1);
});

test('automatic expiry is blocked while server deadline remains in the future',async()=>{
 database({exam_attempts:{data:{status:'in_progress',expires_at:new Date(Date.now()+60000).toISOString()},error:null}});
 assert.equal(typeof await checkAutomaticExpiry('student','exam',id),'number');
 database({practice_sessions:{data:{status:'in_progress',expires_at:new Date(Date.now()-1000).toISOString()},error:null}});
 assert.equal(await checkAutomaticExpiry('student','practice',id),null);
});
test('revision metadata rejects missing, fractional and malformed identifiers',()=>{
 for(const body of [{},{expectedRevision:0.5,mutationId:id},{expectedRevision:-1,mutationId:id},{expectedRevision:1,mutationId:'invalid'}]) assert.throws(()=>parseRevision(body));
 assert.deepEqual(parseRevision({expectedRevision:2,mutationId:id}),{expectedRevision:2,mutationId:id});
});
