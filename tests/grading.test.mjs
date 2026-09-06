import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, outcome, mistakeBank } from '../features/results/grading.ts';
const item = (id, subject, selected = 'A', topic = 'waves') => ({ id, position: 1,
  question: { examBody: 'jamb', subject: { slug: subject, name: subject, id: subject }, topic: topic ? { slug: topic, name: topic } : null,
    source: { provider: 'internal', providerQuestionId: id }, prompt: 'Question', options: [], assets: [] },
  selected, correct: 'A', outcome: outcome(selected, 'A'), flagged: false, explanation: null });
const result = (id, items, date) => ({ id, kind: 'practice', completedAt: date, examBodyId: 'jamb', items, ...grade(items, false) });
test('wrong, unanswered and correct reconcile, without negative marking', () => {
 const g = grade([item('1','physics'), item('2','physics','B'), item('3','physics',null)], false);
 assert.deepEqual([g.correct,g.incorrect,g.unanswered,g.score,g.maximum,g.accuracy], [1,1,1,1,3,33]);
});
test('JAMB subjects contribute equally despite 60/40 question counts', () => {
 const items = ['english','maths','physics','chemistry'].flatMap(s => Array.from({length:s==='english'?60:40},(_,n)=>item(`${s}${n}`,s,s==='english'?'A':null)));
 const g = grade(items,true); assert.equal(g.score,100); assert.equal(g.maximum,400); assert.equal(g.correct,60); assert.equal(g.total,180);
});
test('perfect and empty results stay bounded', () => {
 assert.equal(grade(['a','b','c','d'].map(s=>item(s,s)),true).score,400);
 assert.equal(grade([],false).accuracy,0); assert.equal(grade([],true).scaled,false);
});
test('topics are scoped by subject and missing taxonomy is retained', () => {
 const g = grade([item('1','physics'),item('2','chemistry'),item('3','physics',null,null)],false);
 assert.equal(g.topics.length,3); assert.ok(g.topics.some(t=>t.name==='Uncategorised'));
});
test('two separate successful completions master a mistake; repeats do not', () => {
 const a=result('a',[item('1','physics','B')],'2026-01-01');
 const b=result('b',[item('1','physics')],'2026-01-02');
 const c=result('c',[item('1','physics')],'2026-01-03');
 assert.equal(mistakeBank([a,b,b])[0].mastered,false);
 assert.equal(mistakeBank([c,a,b,b])[0].mastered,true);
 const d=result('d',[item('1','physics',null)],'2026-01-04');
 const m=mistakeBank([a,b,c,d])[0]; assert.equal(m.mastered,false);assert.equal(m.streak,0);assert.equal(m.failures,2);
});
test('provider question IDs shared across subjects do not merge', () => {
 const bank=mistakeBank([result('a',[item('1','physics','B'),item('1','chemistry','B')],'2026-01-01')]);assert.equal(bank.length,2);
});
test('multiple appearances within a session do not create mastery', () => {
 const bank=mistakeBank([result('a',[item('1','physics','B')],'2026-01-01'),result('b',[item('1','physics'),item('1','physics')],'2026-01-02')]);assert.equal(bank[0].streak,1);
});
