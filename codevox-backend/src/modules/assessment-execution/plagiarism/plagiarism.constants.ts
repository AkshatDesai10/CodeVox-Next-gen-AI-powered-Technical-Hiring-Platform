export type PlagiarismJobPayload = {
  candidateId: string;
  candidateAssessmentId: string;
  questionId: string;
  language: string;
  sourceCode: string;
};
