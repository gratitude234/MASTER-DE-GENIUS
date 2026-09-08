const CONFIRMATION = '--confirm-spend';
const baseUrl = (process.env.ALOC_STATION_BASE_URL || 'https://dev.aloc.com.ng/api/v1').replace(/\/+$/, '');
const apiKey = process.env.ALOC_STATION_API_KEY?.trim();

if (!process.argv.includes(CONFIRMATION)) {
  console.error(`Refusing to spend provider credits. Re-run with ${CONFIRMATION} after reviewing the four probes.`);
  process.exitCode = 2;
} else if (!apiKey) {
  console.error('ALOC_STATION_API_KEY is missing from .env.local. Do not prefix it with NEXT_PUBLIC_.');
  process.exitCode = 2;
} else {
  const probes = [
    {
      name: 'JAMB L1 random 10',
      method: 'GET',
      path: '/questions?subject=mathematics&examType=jamb&random=true&limit=10',
    },
    {
      name: 'JAMB assessment 40',
      method: 'POST',
      path: '/assessments/generate',
      body: { subject: 'mathematics', examType: 'jamb', preset: 'jamb_standard_40', shuffleOptions: true, seed: `master-probe-jamb-${Date.now()}` },
    },
    {
      name: 'WAEC assessment 50',
      method: 'POST',
      path: '/assessments/generate',
      body: { subject: 'mathematics', examType: 'waec', preset: 'waec_standard_50', shuffleOptions: true, seed: `master-probe-waec-${Date.now()}` },
    },
    {
      name: 'NECO government L1 random 10',
     method: 'GET',
      path: '/questions?subject=government&examType=neco&random=true&limit=10',
    },
  ];

  const integer = (value) => {
    if (!value) return null;
    const parsed = Number.parseInt(value.replace(/,/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const returnedCount = (body) => {
    if (Array.isArray(body?.data)) return body.data.length;
    if (Array.isArray(body?.data?.questions)) return body.data.questions.length;
    return body?.data ? 1 : 0;
  };

  const results = [];
  for (const probe of probes) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}${probe.path}`, {
      method: probe.method,
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
        ...(probe.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: probe.body ? JSON.stringify(probe.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch {}
    results.push({
      probe: probe.name,
      status: response.status,
      questionsReturned: returnedCount(body),
      creditsUsed: integer(response.headers.get('X-Credits-Used')) ?? body?.meta?.creditsUsed ?? null,
      creditsRemaining: integer(response.headers.get('X-Credits-Remaining')) ?? body?.meta?.creditsRemaining ?? null,
      durationMs: Date.now() - startedAt,
      hasAnswerKey: Array.isArray(body?.data)
        ? body.data.some((item) => item?.correctAnswer != null || item?.answer != null)
        : Array.isArray(body?.data?.questions)
          ? body.data.questions.some((item) => item?.correctAnswer != null || item?.answer != null)
          : false,
      error: response.ok ? null : String(body?.error ?? body?.message ?? 'No provider detail').slice(0, 160),
    });
  }

  console.table(results);
  console.log('No question text, answer value, API key, or student data was printed.');
}
