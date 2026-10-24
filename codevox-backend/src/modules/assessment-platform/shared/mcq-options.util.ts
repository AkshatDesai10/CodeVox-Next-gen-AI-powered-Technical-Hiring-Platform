export type McqOptionRow = {
  label: string;
  text: string;
  isCorrect: boolean;
};

export function mcqOptionsFromQuestionJson(
  questionJson: Record<string, unknown> | null | undefined,
): McqOptionRow[] {
  const raw = questionJson?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((opt) => {
      const row = opt as Record<string, unknown>;
      return {
        label: String(row.label ?? row.key ?? '').trim(),
        text: String(row.text ?? row.option ?? row.value ?? '').trim(),
        isCorrect: Boolean(row.isCorrect ?? row.is_correct),
      };
    })
    .filter((opt) => opt.label || opt.text);
}
