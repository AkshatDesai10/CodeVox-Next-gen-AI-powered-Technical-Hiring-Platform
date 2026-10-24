export type LlmTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
};

export type ChatJsonDetailedResult<T> = {
  data: T;
  usage: LlmTokenUsage;
  model: string;
};

export function emptyLlmUsage(): LlmTokenUsage {
  return { promptTokens: null, completionTokens: null };
}

export function usageFromOpenAi(
  usage:
    | {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
      }
    | null
    | undefined,
): LlmTokenUsage {
  if (!usage || typeof usage !== 'object') return emptyLlmUsage();
  const prompt = usage.prompt_tokens ?? usage.promptTokens;
  const completion = usage.completion_tokens ?? usage.completionTokens;
  return {
    promptTokens: typeof prompt === 'number' && Number.isFinite(prompt) ? Math.floor(prompt) : null,
    completionTokens:
      typeof completion === 'number' && Number.isFinite(completion) ? Math.floor(completion) : null,
  };
}
