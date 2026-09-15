"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { saveQuestionAction } from "@/features/admin/actions/operations";
import { cn } from "@/lib/utils";

const KEYS = ["A", "B", "C", "D", "E"] as const;

export interface QuestionEditorProps {
  catalog: {
    exams: { id: string; code: string; name: string }[];
    subjects: { id: string; slug: string; name: string; examIds: string[] }[];
    topics: { id: string; subjectId: string; name: string }[];
  };
  questionId?: string;
  initial?: {
    examBodyId: string;
    subjectId: string;
    topicId: string | null;
    year: number | null;
    difficulty: string | null;
    questionText: string;
    explanation: string | null;
    options: string[];
    correctOptionKey: string;
    status: string;
  };
  /** Editing an active question changes what students are being served. */
  isActive?: boolean;
  hasPassage?: boolean;
}

export function QuestionEditor({ catalog, questionId, initial, isActive = false, hasPassage = false }: QuestionEditorProps) {
  const router = useRouter();
  const id = useId();
  const [examBodyId, setExamBodyId] = useState(initial?.examBodyId ?? catalog.exams[0]?.id ?? "");
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? "");
  const [topicId, setTopicId] = useState(initial?.topicId ?? "");
  const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "");
  const [questionText, setQuestionText] = useState(initial?.questionText ?? "");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [options, setOptions] = useState<string[]>(() => KEYS.map((_, index) => initial?.options[index] ?? ""));
  const [correct, setCorrect] = useState(initial?.correctOptionKey ?? "A");
  const [status, setStatus] = useState(initial?.status && ["draft", "pending_review", "active"].includes(initial.status) ? initial.status : "draft");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const subjects = useMemo(() => catalog.subjects.filter((subject) => subject.examIds.includes(examBodyId)), [catalog.subjects, examBodyId]);
  const topics = useMemo(() => catalog.topics.filter((topic) => topic.subjectId === subjectId), [catalog.topics, subjectId]);
  const needsReason = Boolean(questionId) && isActive;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveQuestionAction(questionId ?? null, {
        examBodyId, subjectId, topicId: topicId || null, year, difficulty: difficulty || null,
        questionText, explanation, options, correctOptionKey: correct, status, reason: reason || null,
      });
      if (!result.ok) {
        setMessage({ tone: "danger", text: result.error });
        return;
      }
      setReason("");
      if (!questionId && result.data?.id) {
        router.push(`/admin/questions/${result.data.id}`);
        return;
      }
      setMessage({ tone: "success", text: result.message });
      router.refresh();
    });
  }

  const label = "block text-[12px] font-semibold text-slate-800";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor={`${id}-exam`} className={label}>
          Exam
          <Select id={`${id}-exam`} size="md" containerClassName="mt-1.5" value={examBodyId} onChange={(event) => { setExamBodyId(event.target.value); setSubjectId(""); setTopicId(""); }} disabled={hasPassage}>
            {catalog.exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
          </Select>
        </label>
        <label htmlFor={`${id}-subject`} className={label}>
          Subject
          <Select id={`${id}-subject`} size="md" containerClassName="mt-1.5" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); }} disabled={hasPassage} required>
            <option value="">Choose a subject</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </Select>
        </label>
        <label htmlFor={`${id}-topic`} className={label}>
          Topic
          <Select id={`${id}-topic`} size="md" containerClassName="mt-1.5" value={topicId} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">No topic</option>
            {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label htmlFor={`${id}-year`} className={label}>
            Year
            <input id={`${id}-year`} inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Any" className={cn(fieldClasses({ size: "md" }), "mt-1.5")} />
          </label>
          <label htmlFor={`${id}-difficulty`} className={label}>
            Difficulty
            <Select id={`${id}-difficulty`} size="md" containerClassName="mt-1.5" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="">Unset</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </label>
        </div>
      </div>
      {hasPassage ? <p className="text-[11.5px] text-slate-500">This question belongs to a reading passage, so its exam and subject are fixed.</p> : null}

      <label htmlFor={`${id}-text`} className={label}>
        Question
        <textarea id={`${id}-text`} value={questionText} onChange={(event) => setQuestionText(event.target.value)} rows={4} maxLength={5000} required className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
      </label>

      <fieldset>
        <legend className="text-[12px] font-semibold text-slate-800">Options — select the correct answer</legend>
        <div className="mt-1.5 space-y-2">
          {KEYS.map((key, index) => (
            <div key={key} className="flex items-start gap-2">
              <label className={cn("mt-1 flex h-9 w-12 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border text-[12px] font-bold", correct === key ? "border-success-600 bg-success-50 text-success-700" : "border-slate-200 text-slate-600")}>
                <input type="radio" name={`${id}-correct`} value={key} checked={correct === key} onChange={() => setCorrect(key)} className="sr-only" />
                {key}
                <span className="sr-only">{correct === key ? "(correct answer)" : "mark as correct"}</span>
              </label>
              <input
                aria-label={`Option ${key}`}
                value={options[index]}
                onChange={(event) => setOptions((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
                maxLength={2000}
                placeholder={index < 2 ? "Required" : "Optional"}
                className={fieldClasses({ size: "md" })}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`${id}-explanation`} className={label}>
        Explanation
        <textarea id={`${id}-explanation`} value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} maxLength={5000} placeholder="Shown to students after they answer" className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-status`} className={label}>
          Save as
          <Select id={`${id}-status`} size="md" containerClassName="mt-1.5" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="draft">Draft — not served</option>
            <option value="pending_review">Pending review — not served</option>
            <option value="active">Active — served to students</option>
          </Select>
        </label>
        {questionId ? (
          <label htmlFor={`${id}-reason`} className={label}>
            Reason for this edit{needsReason ? "" : " (optional)"}
            <input id={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} required={needsReason} minLength={needsReason ? 5 : undefined} className={cn(fieldClasses({ size: "md" }), "mt-1.5")} />
          </label>
        ) : null}
      </div>
      {needsReason ? <p className="text-[11.5px] text-slate-500">This question is live. Saving moves it out of circulation and back in one step; sessions already started keep the version they were given.</p> : null}

      {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
      <Button type="submit" variant="dark" loading={pending}>{questionId ? "Save question" : "Create question"}</Button>
    </form>
  );
}
