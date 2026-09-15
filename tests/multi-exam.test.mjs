import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
registerAliasHook();
const { chooseExamPreference } = await import('../features/exam-context/selection.ts');
const { parseCreatePracticeSessionInput } = await import('../features/practice/validation.ts');
const { summariseStudentAcademics } = await import('../features/admin/student-academics.ts');
const { recommendClass } = await import('../features/classes/recommendation.ts');

const preferences = [{ is_primary: true, exam: { code: 'jamb' } }, { is_primary: false, exam: { code: 'waec' } }];
test('default, persisted active, explicit and account ownership resolve independently', () => {
 assert.equal(chooseExamPreference(preferences,'u').exam.code,'jamb');
 assert.equal(chooseExamPreference(preferences,'u','u:waec').exam.code,'waec');
 assert.equal(chooseExamPreference(preferences,'u','u:jamb','waec').exam.code,'waec');
 assert.equal(chooseExamPreference(preferences,'u','other:waec').exam.code,'jamb');
 assert.equal(chooseExamPreference(preferences,'u','u:waec','jamb').exam.code,'jamb');
 assert.equal(preferences[0].is_primary,true);
 assert.equal(chooseExamPreference([], 'u'),undefined);
 assert.throws(() => chooseExamPreference(preferences.slice(0,1),'u',undefined,'waec'),/Add this exam/);
 assert.throws(() => chooseExamPreference(preferences,'u',undefined,'both'),/Add this exam/);
});
test('practice validates supported explicit exams and rejects spoofed contexts', () => {
 const input = {subjectSlug:'mathematics',count:10,mode:'practice'};
 for (const examBody of ['jamb','waec']) assert.equal(parseCreatePracticeSessionInput({...input,examBody}).examBody,examBody);
 for (const examBody of ['both','neco','',42,null]) assert.throws(() => parseCreatePracticeSessionInput({...input,examBody}), /supported exam/);
});
function result(examCode, correct) {
 return { id:examCode, kind:'practice', examBodyId:examCode, examCode, completedAt:'2026-09-15', total:10, correct,
 subjects:[{subjectSlug:'mathematics',name:'Mathematics',correct,total:10,accuracy:correct*10}], topics:[], items:[] };
}
test('admin subjects and tutoring recommendations remain exam-specific', () => {
 const history=[result('jamb',2),result('waec',9)];
 assert.equal(summariseStudentAcademics(history,'jamb').accuracy,20);
 assert.equal(summariseStudentAcademics(history,'waec').accuracy,90);
 assert.equal(summariseStudentAcademics(history,'waec').subjects[0].accuracy,90);
 assert.equal(recommendClass(history,'jamb').examType,'jamb');
 assert.equal(recommendClass(history,'waec'),null);
});
test('atomic multi-exam onboarding, legacy compatibility, ownership and default integrity', async () => {
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for (const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 const uid='77777777-7777-4777-8777-777777777777', other='88888888-8888-4888-8888-888888888888';
 await db.query("insert into auth.users values ($1,'multi@example.invalid','{}'),($2,'other@example.invalid','{}')",[uid,other]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const subjects=(await db.query("select id,slug from subjects")).rows;
 const id=slug=>subjects.find(s=>s.slug===slug).id;
 const year=new Date().getUTCFullYear()+1;
 const jamb={examCode:'jamb',examYear:year,targetScore:280,intendedCourse:'Engineering',studyIntensity:'moderate',subjectIds:['use-of-english','mathematics','physics','chemistry'].map(id)};
 const waec={examCode:'waec',examYear:year,targetScore:70,intendedCourse:'',studyIntensity:'light',subjectIds:['mathematics','government'].map(id)};
 const save=(configs,code)=>db.query('select save_exam_preparations($1::jsonb,$2)',[JSON.stringify(configs),code]);
 const rows=async()=> (await db.query(`select p.*,e.code from student_exam_preferences p join exam_bodies e on e.id=p.exam_body_id where p.user_id=$1 and p.is_active order by e.code`,[uid])).rows;
 await save([jamb],'jamb'); assert.equal((await rows()).length,1);
 const original=(await rows())[0].id;
 await save([jamb,waec],'jamb'); assert.equal((await rows()).length,2);
 assert.equal((await rows()).find(p=>p.code==='jamb').id,original);
 assert.deepEqual((await rows()).filter(p=>p.is_primary).map(p=>p.code),['jamb']);
 await save([jamb,waec],'waec'); assert.deepEqual((await rows()).filter(p=>p.is_primary).map(p=>p.code),['waec']);
 const count=(await db.query('select count(*)::integer n from student_subject_preferences')).rows[0].n;
 assert.equal(count,6);
 await assert.rejects(save([],'jamb'),/at least one/);
 await assert.rejects(save([jamb,jamb],'jamb'),/Duplicate exam/);
 await assert.rejects(save([jamb, {...waec,targetScore:101}],'jamb'),/percentage/);
 assert.deepEqual((await rows()).filter(p=>p.is_primary).map(p=>p.code),['waec'],'failed save must roll back default changes');
 await assert.rejects(save([jamb],'both'),/configured default/);
 await assert.rejects(save([{...jamb,subjectIds:waec.subjectIds}],'jamb'),/four/);
 await assert.rejects(save([{...waec,subjectIds:[id('physics')]}],'waec'),/not valid/);
 await assert.rejects(save([{...waec,examCode:'both'}],'both'),/not available/);
 await save([{...jamb,examYear:year+1},waec],'jamb');
 assert.equal((await rows()).length,2);
 assert.equal((await db.query('select count(*)::integer n from student_exam_preferences where user_id=$1',[uid])).rows[0].n,3,'old preference is archived, not deleted');
 await assert.rejects(db.query('update student_exam_preferences set is_primary=true where user_id=$1 and is_active',[uid]),/unique|duplicate/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await save([waec],'waec');
 assert.equal((await rows()).length,2,'saving another account cannot alter this account');
 await db.exec('grant usage on schema public, auth to authenticated; grant select on public.exam_bodies to authenticated; grant select, insert, update, delete on public.student_exam_preferences to authenticated; set role authenticated');
 assert.equal((await db.query('select count(*)::integer n from student_exam_preferences')).rows[0].n,1,'RLS reveals only caller preferences');
 await assert.rejects(db.query('insert into student_exam_preferences(user_id,exam_body_id,exam_year) select $1,id,$2 from exam_bodies limit 1',[other,year+2]),/row-level security/);
 await db.exec('reset role');
 assert.equal((await db.query("select has_function_privilege('anon','save_exam_preparations(jsonb,text)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await db.query('select onboarding_completed from profiles where id=$1',[uid])).rows[0].onboarding_completed,true);
 } finally {await db.close();}
});
