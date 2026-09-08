import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

// The explanation panel now renders an upgrade prompt when a plan allowance is
// reached, and that prompt links to pricing. A plain Node render has no router.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { explanationAccessDenial } = await import('../features/ai/policy.ts');
const { parseGeminiExplanation, GeminiExplanationError } = await import('../features/ai/providers/gemini.ts');
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { AiQuestionExplanation } = await import('../components/ai/question-explanation.tsx');

const USER = '11111111-1111-4111-8111-111111111111';

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
  await db.query(`insert into auth.users values ($1,'student@example.invalid','{}')`, [USER]);
  return db;
}

test('normal practice is explainable only after an answer exists', () => {
  const base = { targetKind: 'practice', status: 'in_progress', practiceMode: 'practice', isCorrect: false, explanationType: 'explain_better' };
  assert.equal(explanationAccessDenial({ ...base, hasAnswer: false }), 'ANSWER_REQUIRED');
  assert.equal(explanationAccessDenial({ ...base, hasAnswer: true }), null);
});

test('active timed practice and active mocks cannot expose answers through AI', () => {
  assert.equal(explanationAccessDenial({
    targetKind: 'practice', status: 'in_progress', practiceMode: 'timed', hasAnswer: true,
    isCorrect: false, explanationType: 'explain_better',
  }), 'ACTIVE_TIMED_SESSION');
  assert.equal(explanationAccessDenial({
    targetKind: 'exam', status: 'in_progress', hasAnswer: true,
    isCorrect: false, explanationType: 'explain_better',
  }), 'ACTIVE_EXAM');
});

test('completed timed practice and submitted mocks can use AI review', () => {
  assert.equal(explanationAccessDenial({
    targetKind: 'practice', status: 'completed', practiceMode: 'timed', hasAnswer: true,
    isCorrect: false, explanationType: 'why_wrong',
  }), null);
  assert.equal(explanationAccessDenial({
    targetKind: 'exam', status: 'submitted', hasAnswer: true,
    isCorrect: false, explanationType: 'why_wrong',
  }), null);
  assert.equal(explanationAccessDenial({
    targetKind: 'exam', status: 'submitted', hasAnswer: true,
    isCorrect: true, explanationType: 'why_wrong',
  }), 'WHY_WRONG_NOT_APPLICABLE');
});

test('Gemini output is validated before reaching the student', () => {
  const explanation = parseGeminiExplanation({
    summary: ' The pancreas produces insulin. ',
    reasoning: 'Beta cells in the pancreas produce the hormone.',
    whyStudentAnswerIsWrong: 'The liver regulates glucose but does not produce insulin.',
    memoryTip: null,
  });
  assert.equal(explanation.summary, 'The pancreas produces insulin.');
  assert.equal(explanation.memoryTip, null);
  assert.throws(
    () => parseGeminiExplanation({ summary: '', reasoning: 'x', whyStudentAnswerIsWrong: null, memoryTip: null }),
    GeminiExplanationError,
  );
});

test('the UI is intent-driven and never calls AI automatically', () => {
  const html = renderToStaticMarkup(React.createElement(AiQuestionExplanation, {
    enabled: true, targetKind: 'practice', sessionId: 's1', questionId: 'q1', isCorrect: false, hasVisual: false,
  }));
  assert.ok(html.includes('Explain better'));
  assert.ok(html.includes('Why was I wrong?'));
  assert.ok(!html.includes('MASTER AI</h3>'), 'no generated panel exists until the student clicks');

  const correct = renderToStaticMarkup(React.createElement(AiQuestionExplanation, {
    enabled: true, targetKind: 'practice', sessionId: 's1', questionId: 'q1', isCorrect: true, hasVisual: false,
  }));
  assert.ok(correct.includes('Explain better'));
  assert.ok(!correct.includes('Why was I wrong?'));

  const visual = renderToStaticMarkup(React.createElement(AiQuestionExplanation, {
    enabled: true, targetKind: 'practice', sessionId: 's1', questionId: 'q1', isCorrect: false, hasVisual: true,
  }));
  assert.equal(visual, '', 'v1 does not hallucinate explanations for unseen diagrams');
});

test('the request contract never accepts a browser-supplied answer key or selected option', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');
  const parser = source.slice(source.indexOf('export function parseExplanationRequest'));
  assert.ok(!parser.includes('correctOptionKey'));
  assert.ok(!parser.includes('selectedOptionKey'));
  assert.ok(source.includes('.eq("user_id", userId)'), 'session ownership is checked server-side');
  assert.ok(source.includes('question.correct_option_key'), 'the verified key comes from the frozen server snapshot');
});

test('Gemini requests are stateless, structured, bounded, and secret-safe', () => {
  const source = readFileSync('features/ai/providers/gemini.ts', 'utf8');
  assert.ok(source.includes('store: false'));
  assert.ok(source.includes('mime_type: "application/json"'));
  assert.ok(source.includes('max_output_tokens: 500'));
  assert.ok(source.includes('timeout_ms: geminiTimeoutMs()'));
  assert.ok(!source.includes('console.log'));
});

test('daily AI quota is atomic and cannot oversell under concurrency', async () => {
  const db = await freshDb();
  try {
    const consume = () => db.query(
      `select * from consume_ai_daily_quota($1,'question_explanation',3)`, [USER],
    ).then(result => result.rows[0]);
    const results = await Promise.all(Array.from({ length: 20 }, consume));
    assert.equal(results.filter(row => row.allowed).length, 3);
    assert.equal(results.filter(row => !row.allowed).length, 17);
    const count = await db.query('select generation_count from ai_daily_usage where user_id=$1', [USER]);
    assert.equal(count.rows[0].generation_count, 3);
  } finally { await db.close(); }
});

test('concurrent duplicate explanations produce one generation claim and a reusable result', async () => {
  const db = await freshDb();
  try {
    const args = ['a'.repeat(64), 'b'.repeat(64), 'why_wrong', 'C', 'v1', 'gemini', 'model'];
    const claim = () => db.query(
      'select * from claim_ai_explanation($1,$2,$3,$4,$5,$6,$7,30,172800)', args,
    ).then(result => result.rows[0]);

    const first = await claim();
    const second = await claim();
    assert.equal(first.outcome, 'claimed');
    assert.equal(second.outcome, 'in_progress');

    const content = { summary: 's', reasoning: 'r', whyStudentAnswerIsWrong: 'w', memoryTip: null };
    await db.query('select settle_ai_explanation($1,$2::jsonb,172800)', [args[0], JSON.stringify(content)]);
    const cached = await claim();
    assert.equal(cached.outcome, 'completed');
    assert.deepEqual(cached.content, content);
  } finally { await db.close(); }
});

test('AI tables and privileged functions are inaccessible to browser roles', async () => {
  const db = await freshDb();
  try {
    const privileges = await db.query(`select
      has_table_privilege('anon','public.ai_usage','select') as anon_read,
      has_table_privilege('authenticated','public.ai_usage','insert') as user_write,
      has_table_privilege('authenticated','public.ai_explanation_cache','select') as cache_read,
      has_function_privilege('authenticated','public.consume_ai_daily_quota(uuid,text,integer)','execute') as quota_execute`);
    assert.deepEqual(privileges.rows[0], {
      anon_read: false, user_write: false, cache_read: false, quota_execute: false,
    });
    const columns = await db.query(`select column_name from information_schema.columns
      where table_schema='public' and table_name in ('ai_usage','ai_daily_usage','ai_explanation_cache')`);
    const names = columns.rows.map(row => row.column_name);
    assert.ok(!names.includes('question_text'));
    assert.ok(!names.includes('correct_option_key'));
    assert.ok(!names.includes('api_key'));
  } finally { await db.close(); }
});

