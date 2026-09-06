import "server-only";

import { AlocQuestionProvider } from "@/features/questions/providers/aloc";
import { InternalQuestionProvider } from "@/features/questions/providers/internal";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { QuestionProviderId } from "@/features/questions/types";

const providers: Partial<Record<QuestionProviderId, QuestionProvider>> = {
  internal: new InternalQuestionProvider(),
  aloc: new AlocQuestionProvider(),
  // sdash is intentionally reserved and unimplemented.
};

export function getQuestionProvider(id?: string): QuestionProvider {
  const providerId = (id ?? process.env.QUESTION_PROVIDER ?? "internal") as QuestionProviderId;
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(
      `Question provider "${providerId}" is not implemented in this build. Available providers: ${Object.keys(providers).join(", ")}.`,
    );
  }

  return provider;
}
