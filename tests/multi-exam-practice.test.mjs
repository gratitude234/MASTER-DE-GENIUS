import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
registerAliasHook();
const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
registerHooks({resolve(specifier,context,next){
 if(specifier==='next/headers') return stub('export async function cookies(){return {get(){return {value:"student:waec"}}}}');
 if(specifier==='@/lib/supabase/admin') return stub('export const createAdminClient=()=>globalThis.__multiDb');
 if(specifier==='@/features/questions/service') return stub(`export async function fetchCanonicalQuestions(query){globalThis.__query=query;return [{id:'q1',examBody:query.examBody,subject:{slug:'mathematics'},source:{provider:'internal',providerQuestionId:'q1'},prompt:'2 + 2?',options:[],assets:[],correctOptionKey:'A',explanation:'4'}];}`);
 return next(specifier,context);
}});
const {createPracticeSessionForUser}=await import('../features/practice/service.ts');
function database(owned=['jamb','waec'],selected=true){
 globalThis.__query=null; globalThis.__payload=null;
 globalThis.__multiDb={from(table){
 const filters=[];
 const result=()=>{
 const eq=k=>filters.find(([key])=>key===k)?.[1];
 if(table==='profiles')return {onboarding_completed:true};
 if(table==='student_exam_preferences')return owned.map(code=>({id:code+'-pref',user_id:'student',exam_body_id:code+'-id',is_primary:code==='jamb',is_active:true}));
 if(table==='exam_bodies'){const exams=['jamb','waec'].map(code=>({id:code+'-id',code,short_name:code.toUpperCase()}));return eq('id')?exams.find(e=>e.id===eq('id')):exams;}
 if(table==='subjects')return {id:'math',slug:'mathematics',name:'Mathematics'};
 if(table==='student_subject_preferences')return selected?{subject_id:'math'}:null;
 throw new Error('Unexpected table '+table);
 };
 const chain={select(){return chain},eq(k,v){filters.push([k,v]);return chain},in(){return chain},order(){return chain},maybeSingle:async()=>({data:result(),error:null}),then(resolve){return Promise.resolve({data:result(),error:null}).then(resolve)}};
 return chain;
 },async rpc(name,payload){assert.equal(name,'create_practice_session');globalThis.__payload=payload;return {data:'session-id',error:null}}};
}
test('both practice engines use explicitly requested exam despite different cookie/default and preserve safe snapshots',async()=>{
 for(const examBody of ['jamb','waec']){
 database(); const created=await createPracticeSessionForUser('student',{examBody,subjectSlug:'mathematics',count:1,mode:'practice'});
 assert.equal(created.sessionId,'session-id'); assert.equal(globalThis.__query.examBody,examBody);
 assert.equal(globalThis.__payload.p_exam_body_id,examBody+'-id');
 assert.equal(globalThis.__payload.p_questions[0].studentSnapshot.examBody,examBody);
 assert.equal(globalThis.__payload.p_questions[0].studentSnapshot.correctOptionKey,undefined);
 }
});
test('foreign exam and unselected subject are rejected before question-provider access',async()=>{
 database(['jamb']);await assert.rejects(createPracticeSessionForUser('student',{examBody:'waec',subjectSlug:'mathematics',count:1,mode:'practice'}),/Add this exam/);assert.equal(globalThis.__query,null);
 database(['jamb','waec'],false);await assert.rejects(createPracticeSessionForUser('student',{examBody:'waec',subjectSlug:'mathematics',count:1,mode:'practice'}),/not part/);assert.equal(globalThis.__query,null);
});
