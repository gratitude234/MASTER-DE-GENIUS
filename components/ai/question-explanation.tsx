"use client";

import { useState } from "react";
import { BrainCircuit, Sparkles, Target } from "lucide-react";

import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { asPlanLimitNotice, type PlanLimitNotice } from "@/features/billing/limit-notice";
import type {
  ExplanationResponse,
  ExplanationTargetKind,
  ExplanationType,
} from "@/features/ai/types";

interface AiQuestionExplanationProps {
  enabled: boolean;
  targetKind: ExplanationTargetKind;
  sessionId: string;
  questionId: string;
  isCorrect: boolean;
  hasVisual: boolean;
}

export function AiQuestionExplanation({
  enabled,
  targetKind,
  sessionId,
  questionId,
  isCorrect,
  hasVisual,
}: AiQuestionExplanationProps) {
  const [loading, setLoading] = useState<ExplanationType | null>(null);
  const [result, setResult] = useState<ExplanationResponse | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState<PlanLimitNotice | null>(null);

  if (!enabled || hasVisual) return null;

  async function requestExplanation(explanationType: ExplanationType) {
    setLoading(explanationType);
    setError("");
    setLimit(null);
    try {
      const response = await fetch("/api/ai/question-explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind, sessionId, questionId, explanationType }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        /*
         * Running out of the day's allowance is not a failure. It gets the
         * upgrade panel — what ran out, when it returns, what Master changes —
         * rather than a red band suggesting something went wrong.
         */
        const notice = asPlanLimitNotice(body);
        if (notice) {
          setLimit(notice);
          return;
        }
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "MASTER AI couldn’t generate an explanation right now.";
        throw new Error(message);
      }
      setResult(body as ExplanationResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "MASTER AI couldn’t generate an explanation right now.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-4 border-t border-current/10 pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading === "explain_better"}
          loadingLabel="Preparing a clearer explanation"
          disabled={loading !== null}
          iconBefore={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          onClick={() => void requestExplanation("explain_better")}
        >
          Explain better
        </Button>
        {!isCorrect ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={loading === "why_wrong"}
            loadingLabel="Explaining why your answer was wrong"
            disabled={loading !== null}
            iconBefore={<Target className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => void requestExplanation("why_wrong")}
          >
            Why was I wrong?
          </Button>
        ) : null}
      </div>

      {limit ? (
        <div className="mt-3">
          <UpgradePrompt notice={limit} />
          {/*
            The standard explanation is unaffected by any plan. Saying so here
            stops the panel reading as though written help has been taken away.
          */}
          <p className="mt-2 text-[11.5px] leading-[1.5] text-slate-500">
            Your score, the correct answer and the standard written explanation are always available on every plan.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <InlineAlert tone="warning" role="alert">
            {error} Your standard explanation is still available.
          </InlineAlert>
        </div>
      ) : null}

      {result ? (
        <section aria-live="polite" className="mt-3 rounded-xl border border-brand-200 bg-white/80 px-4 py-3.5">
          <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.06em] text-brand-600">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" /> MASTER AI
          </h3>
          <p className="mt-2 text-[13px] font-bold leading-[1.55] text-slate-950">{result.explanation.summary}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[1.65] text-slate-800">{result.explanation.reasoning}</p>
          {result.explanation.whyStudentAnswerIsWrong ? (
            <div className="mt-3 rounded-lg bg-danger-50 px-3 py-2.5">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.05em] text-danger-700">Why your option was wrong</h4>
              <p className="mt-1 text-[12.5px] leading-[1.6] text-slate-800">{result.explanation.whyStudentAnswerIsWrong}</p>
            </div>
          ) : null}
          {result.explanation.memoryTip ? (
            <p className="mt-3 text-[12.5px] leading-[1.6] text-slate-700">
              <strong className="font-bold text-brand-600">Memory tip:</strong> {result.explanation.memoryTip}
            </p>
          ) : null}
          <p className="mt-3 text-[10.5px] text-slate-500">
            AI-generated teaching support. The verified answer and score still come from MASTER.
            {result.cached ? " Reused from a recent verified explanation." : ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}

