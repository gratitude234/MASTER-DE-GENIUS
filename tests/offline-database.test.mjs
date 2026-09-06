import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('M1–M6 migrations and revision RPC enforce ownership, replay, conflicts and deadlines',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
 for(const file of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 const u='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 await db.query(`insert into auth.users values ($1,'test@example.invalid','{}'),($2,'other@example.invalid','{}')`,[u,other]);
 const exam=(await db.query("select id from exam_bodies where code='jamb'")).rows[0].id;
 const subject=(await db.query("select id from subjects where slug='physics'")).rows[0].id;
 const paper=JSON.stringify([{sourceProvider:'internal',sourceQuestionId:'q1',studentSnapshot:{id:'q1',prompt:'Test question',options:[{key:'A',text:'A'},{key:'B',text:'B'}]},correctOptionKey:'A',explanation:'A is correct.'}]);
 const session=(await db.query(`select create_practice_session($1,$2,$3,null,'timed',null,null,1,'internal',3600,$4::jsonb) id`,[u,exam,subject,paper])).rows[0].id;
 const qid=(await db.query('select id from practice_session_questions where session_id=$1',[session])).rows[0].id;
 const save=(owner,rev,mutation,key='A')=>db.query(`select save_response_v2($1,'practice',$2,$3,$4,false,$5,$6) result`,[owner,session,qid,key,rev,mutation]);
 const m1='33333333-3333-4333-8333-333333333333',m2='44444444-4444-4444-8444-444444444444';
 await assert.rejects(save(other,0,m1),/SESSION_NOT_FOUND/);
 assert.equal((await save(u,0,m1)).rows[0].result.revision,1);
 assert.equal((await save(u,0,m1)).rows[0].result.revision,1);
 await assert.rejects(save(u,0,m2,'B'),/RESPONSE_CONFLICT/);
 assert.equal((await save(u,1,m2,'B')).rows[0].result.revision,2);
 await assert.rejects(save(u,0,m1),/RESPONSE_CONFLICT/);
 await db.query("update practice_sessions set expires_at=now()-interval '1 second' where id=$1",[session]);
 await assert.rejects(save(u,2,'55555555-5555-4555-8555-555555555555'),/PRACTICE_SESSION_TIME_UP/);
 await db.query('select complete_practice_session($1,$2)',[u,session]);
 assert.equal((await save(u,1,m2,'B')).rows[0].result.revision,2);
 assert.equal((await db.query("select has_table_privilege('authenticated','response_revisions','select') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','save_response_v2(uuid,text,uuid,uuid,text,boolean,integer,uuid)','execute') allowed")).rows[0].allowed,false);
 const blueprint=(await db.query('select id from exam_blueprints where exam_body_id=$1',[exam])).rows[0].id;
 const attempt=(await db.query(`insert into exam_attempts(user_id,exam_body_id,blueprint_id,exam_year,source_provider,status,duration_seconds,total_questions,started_at,expires_at) values($1,$2,$3,2027,'internal','in_progress',3600,1,now(),now()+interval '1 hour') returning id`,[u,exam,blueprint])).rows[0].id;
 const section=(await db.query('insert into exam_attempt_subjects(attempt_id,subject_id,display_order,question_count) values($1,$2,1,1) returning id',[attempt,subject])).rows[0].id;
 const eq=(await db.query(`insert into exam_attempt_questions(attempt_id,attempt_subject_id,subject_id,subject_position,overall_position,source_provider,source_question_id,student_snapshot,correct_option_key) values($1,$2,$3,1,1,'internal','q1',$4,'A') returning id`,[attempt,section,subject,JSON.stringify({options:[{key:'A'},{key:'B'}]})])).rows[0].id;
 const saveExam=(rev,mutation,selected)=>db.query(`select save_response_v2($1,'exam',$2,$3,$4,true,$5,$6) result`,[u,attempt,eq,selected,rev,mutation]);
 const e1=(await saveExam(0,m1,'A')).rows[0].result;assert.equal(e1.is_flagged,true);assert.equal(e1.correct_option_key,undefined);
 await assert.rejects(saveExam(0,m2,'B'),/RESPONSE_CONFLICT/);
 const e2=(await saveExam(1,m2,null)).rows[0].result;assert.equal(e2.selected_option_key,null);assert.equal(e2.revision,2);
 await db.query(`update exam_attempts set expires_at=now()-interval '1 second' where id=$1`,[attempt]);
 await assert.rejects(saveExam(2,'66666666-6666-4666-8666-666666666666','A'),/EXAM_TIME_UP/);
 await db.query(`select submit_exam_attempt($1,$2,'time_expired')`,[u,attempt]);
 assert.equal((await saveExam(1,m2,null)).rows[0].result.revision,2);
 } finally {await db.close()}
});
