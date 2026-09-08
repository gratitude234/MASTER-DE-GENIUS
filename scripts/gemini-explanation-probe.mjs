import { registerAliasHook } from './alias-hook.mjs';

registerAliasHook();

if (!process.argv.includes('--confirm-spend')) {
  console.error('Refusing to call Gemini without --confirm-spend. No request was made.');
  process.exitCode = 2;
} else {
  const { buildQuestionExplanationPrompt } = await import('../features/ai/prompts/question-explanation.ts');
  const { generateGeminiExplanation } = await import('../features/ai/providers/gemini.ts');

  const prompt = buildQuestionExplanationPrompt({
    question: {
      id: 'probe-question',
      source: { provider: 'internal', providerQuestionId: 'safe-probe' },
      examBody: 'jamb',
      subject: { id: 'probe-subject', slug: 'biology', name: 'Biology' },
      topic: { id: 'probe-topic', subjectId: 'probe-subject', slug: 'hormones', name: 'Hormones' },
      year: null,
      prompt: 'Which organ produces insulin?',
      passage: null,
      assets: [],
      options: [
        { id: 'a', key: 'A', text: 'Liver' },
        { id: 'b', key: 'B', text: 'Pancreas' },
        { id: 'c', key: 'C', text: 'Kidney' },
        { id: 'd', key: 'D', text: 'Spleen' },
      ],
      difficulty: null,
    },
    correctOptionKey: 'B',
    selectedOptionKey: 'A',
    standardExplanation: 'Insulin is produced by beta cells in the pancreas.',
  }, 'why_wrong');

  const started = Date.now();
  try {
    const result = await generateGeminiExplanation(prompt);
    console.table([{
      status: 'ok',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: Date.now() - started,
      hasSummary: Boolean(result.explanation.summary),
      hasReasoning: Boolean(result.explanation.reasoning),
      hasWrongOptionHelp: Boolean(result.explanation.whyStudentAnswerIsWrong),
      hasMemoryTip: Boolean(result.explanation.memoryTip),
    }]);
    console.log('No prompt, response text, answer value, API key, or student data was printed.');
  } catch (error) {
    // The category alone ("provider") does not distinguish a rejected key from
    // an unknown model from a malformed request, and those need different
    // fixes. `detail` carries the status and a bounded, key-redacted provider
    // message — the whole reason this probe exists is to surface it.
    console.error('Gemini probe failed safely:', error?.category || 'unknown');
    if (error?.detail) console.error('  reason:', error.detail);
    process.exitCode = 1;
  }
}
