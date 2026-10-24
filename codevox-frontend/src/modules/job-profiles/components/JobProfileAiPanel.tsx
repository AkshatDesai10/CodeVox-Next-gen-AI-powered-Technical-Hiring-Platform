'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { AiAdaptiveBlock } from '@/modules/job-profiles/components/AiAdaptiveBlock';
import {
  biasScreenJobProfile,
  checkDuplicateProfiles,
  compensationBenchmark,
  generateFaq,
  generateAiQuestions,
  getJobProfileAiInsights,
  nlEditJobProfile,
  suggestCompetencies,
  suggestRubricWeights,
  type JobProfileSummary,
} from '@/modules/job-profiles/lib/job-profiles-api';

export function JobProfileAiPanel(props: {
  profileId: string;
  profile: JobProfileSummary;
  onApplyCompetencies: (
    rows: Array<{ name: string; category: string; target_score: number; weight_pct: number }>,
  ) => void;
  onApplyQuestions: (rows: Array<{ prompt: string; kind: string }>) => void;
  onApplyRubricWeights?: (
    suggestions: Array<
      | { id: string; weight_pct: number }
      | { name: string; category: string; weight_pct: number; target_score: number }
    >,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const [nlInstruction, setNlInstruction] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const insightsQuery = useQuery({
    queryKey: ['job-profile-ai-insights', props.profileId],
    queryFn: () => getJobProfileAiInsights(props.profileId),
  });

  const run =
    (fn: () => Promise<unknown>, success: string) =>
    async () => {
      try {
        await fn();
        setMessage(success);
        void queryClient.invalidateQueries({ queryKey: ['job-profile', props.profileId] });
        void queryClient.invalidateQueries({ queryKey: ['job-profile-ai-insights', props.profileId] });
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'AI action failed');
      }
    };

  const competenciesMutation = useMutation({
    mutationFn: () => suggestCompetencies(props.profileId),
    onSuccess: (data) => {
      props.onApplyCompetencies(data.suggestions);
      setMessage(`Added ${data.suggestions.length} AI-suggested competencies`);
    },
  });

  const rubricMutation = useMutation({
    mutationFn: () => suggestRubricWeights(props.profileId),
    onSuccess: (data) => {
      if (props.onApplyRubricWeights) {
        props.onApplyRubricWeights(data.suggestions ?? []);
        setMessage('Rubric weights updated');
        return;
      }
      setMessage('Rubric weights suggested - use AI balance weights on the rubric section');
    },
  });

  const questionsMutation = useMutation({
    mutationFn: () => generateAiQuestions(props.profileId, 3),
    onSuccess: (data) => {
      props.onApplyQuestions(data.questions);
      setMessage(`Generated ${data.questions.length} questions`);
    },
  });

  const nlMutation = useMutation({
    mutationFn: () => nlEditJobProfile(props.profileId, nlInstruction),
    onSuccess: () => {
      setNlInstruction('');
      setMessage('NL edit applied');
      void queryClient.invalidateQueries({ queryKey: ['job-profile', props.profileId] });
    },
  });

  const insights = insightsQuery.data;

  return (
    <div className="space-y-4">
      <div className="nexus-glass-ai p-4">
        <div className="mb-3 flex items-center gap-2">
          <AssessmentMaterialIcon name="auto_awesome" className="text-[var(--nexus-secondary)]" />
          <h2 className="font-headline-md">AI assistant</h2>
        </div>
        {insights ? (
          <p className="mb-3 font-mono-data text-xs text-[var(--assessment-on-surface-variant)]">
            AI health score: <strong>{insights.health_score}%</strong>
            {insights.ai_powered ? ' | LLM connected' : ' | fallback mode (set OPENAI_API_KEY)'}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--nexus-secondary)] px-2 py-1 text-xs font-semibold"
            onClick={() => void questionsMutation.mutate()}
          >
            Generate questions
          </button>
          <button
            type="button"
            className="rounded border border-[var(--nexus-secondary)] px-2 py-1 text-xs font-semibold"
            onClick={() => void run(() => biasScreenJobProfile(props.profileId), 'Bias screen complete')()}
          >
            Bias screen
          </button>
          <button
            type="button"
            className="rounded border border-[var(--nexus-secondary)] px-2 py-1 text-xs font-semibold"
            onClick={() => void run(() => compensationBenchmark(props.profileId), 'Benchmark ready')()}
          >
            Comp benchmark
          </button>
          <button
            type="button"
            className="rounded border border-[var(--nexus-secondary)] px-2 py-1 text-xs font-semibold"
            onClick={() => void run(() => generateFaq(props.profileId), 'FAQ generated')()}
          >
            Generate FAQ
          </button>
          <button
            type="button"
            className="rounded border border-[var(--nexus-secondary)] px-2 py-1 text-xs font-semibold"
            onClick={() => void run(() => checkDuplicateProfiles(props.profileId), 'Duplicate check done')()}
          >
            Check duplicates
          </button>
        </div>
      </div>

      <AiAdaptiveBlock
        title="NL profile editing"
        description='Describe changes in plain language - e.g. "Add Kubernetes to required skills and raise seniority."'
      />
      <div className="flex gap-2">
        <input
          value={nlInstruction}
          onChange={(e) => setNlInstruction(e.target.value)}
          placeholder="Edit instruction..."
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={!nlInstruction.trim() || nlMutation.isPending}
          onClick={() => nlMutation.mutate()}
          className="rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-sm font-semibold text-white"
        >
          Apply
        </button>
      </div>

      {insights?.duplicate_matches?.length ? (
        <div className="nexus-card p-3 text-xs">
          <p className="font-label-caps mb-1">Similar profiles</p>
          {insights.duplicate_matches.map((m) => (
            <p key={m.profile_id}>
              {m.title} - {m.similarity}% match
            </p>
          ))}
        </div>
      ) : null}

      {insights?.candidate_faq?.length ? (
        <div className="nexus-card max-h-40 overflow-y-auto p-3 text-xs">
          <p className="font-label-caps mb-1">Candidate FAQ (voice-grounded)</p>
          {insights.candidate_faq.map((f) => (
            <p key={f.question} className="mb-1">
              <strong>{f.question}</strong> {f.answer}
            </p>
          ))}
        </div>
      ) : null}

      {insights?.bias_screening ? (
        <div className="nexus-card p-3 text-xs">
          <p className="font-label-caps mb-1">Bias Screening</p>
          <p className="mb-1">Score: <strong>{(insights.bias_screening as any).score ?? 'N/A'}</strong></p>
          {((insights.bias_screening as any).flags as Array<any>)?.map((f: any, idx: number) => (
            <p key={idx} className={`mb-1 ${f.severity === 'critical' ? 'text-red-600 font-bold' : f.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'}`}>
              [{f.severity.toUpperCase()}] {f.message}
            </p>
          ))}
        </div>
      ) : null}

      {insights?.compensation_benchmark ? (
        <div className="nexus-card p-3 text-xs">
          <p className="font-label-caps mb-1">Compensation Benchmark</p>
          <p className="mb-1">
            <strong>{(insights.compensation_benchmark as any).currency ?? 'USD'} {(insights.compensation_benchmark as any).band_min?.toLocaleString()} - {(insights.compensation_benchmark as any).band_max?.toLocaleString()}</strong>
            <span className="ml-2 text-gray-500">(Confidence: {(insights.compensation_benchmark as any).confidence})</span>
          </p>
          <p>{(insights.compensation_benchmark as any).market_note}</p>
        </div>
      ) : null}

      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
    </div>
  );
}
