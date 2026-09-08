const baseUrl = (process.env.ALOC_STATION_BASE_URL || "https://dev.aloc.com.ng/api/v1").replace(/\/+$/, "");
const apiKey = process.env.ALOC_STATION_API_KEY?.trim();

if (!apiKey) {
  console.error("ALOC_STATION_API_KEY is missing from .env.local. Do not prefix it with NEXT_PUBLIC_.");
  process.exitCode = 2;
} else {
  const response = await fetch(`${baseUrl}/subjects`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  const subjects = Array.isArray(body?.data) ? body.data : [];
  const rows = subjects.flatMap((subject) => {
    const examTypes = Array.isArray(subject?.examTypes)
      ? subject.examTypes.map((value) => String(value).toLowerCase())
      : [];
    const supported = examTypes.filter((exam) => exam === "jamb" || exam === "waec" || exam === "neco");
    if (!supported.length) return [];
    return [{
      subject: String(subject?.name ?? "unknown"),
      exams: supported.join(", "),
      questions: Number.isFinite(subject?.questionCount) ? subject.questionCount : null,
      years: subject?.yearRange?.min && subject?.yearRange?.max
        ? `${subject.yearRange.min}-${subject.yearRange.max}`
        : null,
    }];
  });

  console.log(`Status ${response.status} · discovery credits used ${response.headers.get("X-Credits-Used") ?? 0} · remaining ${response.headers.get("X-Credits-Remaining") ?? "unknown"}`);
  console.table(rows);
  console.log("Only catalogue metadata was printed. No questions, answers, API key, or student data were exposed.");
  if (!response.ok) process.exitCode = 1;
}
