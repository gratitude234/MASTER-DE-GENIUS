import "server-only";

import { AlocQuestionProvider } from "@/features/questions/providers/aloc";
import { AlocStationQuestionProvider } from "@/features/questions/providers/aloc-station";
import { InternalQuestionProvider } from "@/features/questions/providers/internal";
import { SdashQuestionProvider } from "@/features/questions/providers/sdash";
import type { QuestionProvider } from "@/features/questions/providers/types";
import type { QuestionProviderId } from "@/features/questions/types";

const providers: Partial<Record<QuestionProviderId, QuestionProvider>> = {
  internal: new InternalQuestionProvider(),
  aloc: new AlocQuestionProvider(),
  aloc_station: new AlocStationQuestionProvider(),
  // Serves the four WAEC science subjects ALOC Station has no verified
  // inventory for. It is never a deployment's global provider: which exam and
  // subject reach it is decided by `features/questions/routing.ts`.
  sdash: new SdashQuestionProvider(),
};

export function getQuestionProvider(id?: string): QuestionProvider {
  // Trimmed to match how the practice and exam services already read this, so a
  // stray space in a deployment variable cannot make the registry disagree with
  // the callers about which provider is active.
  const providerId = (id?.trim() || process.env.QUESTION_PROVIDER?.trim() || "internal") as QuestionProviderId;
  const provider = providers[providerId];

  if (!provider) {
    throw new Error(
      `Question provider "${providerId}" is not implemented in this build. Available providers: ${Object.keys(providers).join(", ")}.`,
    );
  }

  return provider;
}
