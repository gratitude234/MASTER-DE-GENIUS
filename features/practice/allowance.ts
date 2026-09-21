import type { PracticeSessionQuestionView } from "@/features/practice/types";
import type { StudentQuestion } from "@/features/questions/types";

/**
 * Which unanswered questions of an in-progress session a Free student may see.
 *
 * Answered questions are always shown — they are the student's own work, and
 * reviewing them costs nothing. A question held for the student when the
 * session was built is always shown: it already counts against the allowance
 * and is guaranteed answerable.
 *
 * What is left is a session that was built without holds — before this release,
 * or while the student had Master — whose frozen paper may be far larger than
 * today's allowance. Of those questions, only as many as the student can still
 * answer today (`budget`) are delivered, in paper order. The rest are withheld
 * on the server: the browser receives an empty placeholder, so a locked question
 * cannot be read from the page source, the offline copy or the network tab.
 *
 * Nothing is mutated. The frozen snapshot, the answers and the score are all
 * untouched; tomorrow's allowance, or Master, simply delivers more of it.
 */
export function lockBeyondAllowance(
  questions: PracticeSessionQuestionView[],
  held: ReadonlySet<string>,
  budget: number,
): PracticeSessionQuestionView[] {
  let remaining = Math.max(0, Math.floor(budget));

  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((view) => {
      if (view.selectedOptionKey) return view;
      if (held.has(view.id)) return { ...view, held: true };
      if (remaining > 0) {
        remaining -= 1;
        return view;
      }
      return { ...view, locked: true, feedback: null, question: lockedQuestion(view.question) };
    });
}

/** Keeps only what the runner needs to label the slot. No stem, options, passage or media. */
export function lockedQuestion(question: StudentQuestion): StudentQuestion {
  return {
    id: "locked",
    source: { provider: "locked", providerQuestionId: "" },
    examBody: question.examBody,
    subject: question.subject,
    topic: null,
    year: null,
    instruction: null,
    prompt: "",
    passage: null,
    assets: [],
    options: [],
    difficulty: null,
  };
}
