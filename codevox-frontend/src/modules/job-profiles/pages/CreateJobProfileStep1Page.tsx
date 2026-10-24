'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { ProfileStepper } from '@/modules/job-profiles/components/ProfileStepper';
import {
  applyPipelinePreset,
  createJobProfile,
  parseJobProfileJd,
  updateJobProfileBasics,
  updateJobProfileJd,
  type PipelinePresetId,
} from '@/modules/job-profiles/lib/job-profiles-api';

const STEPS = [
  { id: 1, label: 'Basics & JD' },
  { id: 2, label: 'Stages' },
  { id: 3, label: 'Settings & Review' },
];

const DEPARTMENTS = ['Engineering', 'Design', 'Product Management', 'Sales', 'People', 'Growth'];

const PIPELINE_PRESETS: Array<{
  id: PipelinePresetId;
  title: string;
  description: string;
  stages: string;
  icon: string;
}> = [
  {
    id: 'coding_only',
    title: 'Coding test only',
    description:
      'Candidate only solves coding problems online. No voice call. Fastest option when you just need a skills check.',
    stages: 'Coding test',
    icon: 'code',
  },
  {
    id: 'unified_voice',
    title: 'Voice interview only',
    description:
      'One AI voice call. First a short screening chat, then deeper technical questions — without hanging up.',
    stages: 'Screening → Technical talk',
    icon: 'mic',
  },
  {
    id: 'coding_plus_voice',
    title: 'Coding + voice interview',
    description:
      'First a coding test, then one AI voice call (screening + technical questions). Best fit for most roles.',
    stages: 'Coding test → Voice call',
    icon: 'auto_awesome',
  },
  {
    id: 'screening_plus_full',
    title: 'Full hiring flow',
    description:
      'Resume review first, then coding test, then a full AI voice interview. Use when you want every step covered.',
    stages: 'Resume check → Coding → Voice',
    icon: 'account_tree',
  },
];

function normalizePreset(raw: unknown): PipelinePresetId {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'build_defend') return 'coding_plus_voice';
  return PIPELINE_PRESETS.some((p) => p.id === value)
    ? (value as PipelinePresetId)
    : 'coding_plus_voice';
}

export function CreateJobProfileStep1Page() {
  const router = useRouter();
  const [jdPaste, setJdPaste] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [seniority, setSeniority] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [openings, setOpenings] = useState(1);
  const [locationMode, setLocationMode] = useState('hybrid');
  const [locationText, setLocationText] = useState('');
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [currency, setCurrency] = useState('INR');
  const language = 'English';
  const [intro, setIntro] = useState('');
  const [responsibilities, setResponsibilities] = useState<string[]>(['']);
  const [requiredSkills, setRequiredSkills] = useState<string[]>(['']);
  const [niceSkills, setNiceSkills] = useState<string[]>(['']);
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [pipelinePreset, setPipelinePreset] = useState<PipelinePresetId>('coding_plus_voice');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsedOnce, setParsedOnce] = useState(false);

  const extractedCompetencies = useMemo(
    () => [...requiredSkills, ...niceSkills].filter(Boolean),
    [requiredSkills, niceSkills],
  );

  const biasFlags = useMemo(() => {
    const text = [...responsibilities, intro, jdPaste].join(' ').toLowerCase();
    const flags: Array<{
      severity: 'critical' | 'warning';
      label: string;
      message: string;
      fix: () => void;
    }> = [];
    if (/\brockstar\b|\bninja\b|\bguru\b/.test(text)) {
      flags.push({
        severity: 'critical',
        label: 'Gendered language',
        message: 'Terms like "rockstar" can discourage diverse applicants. Consider neutral phrasing.',
        fix: () =>
          setResponsibilities(
            responsibilities.map((r) =>
              r.replace(/\brockstar\b/gi, 'high-performing').replace(/\bninja\b/gi, 'skilled'),
            ),
          ),
      });
    }
    const yearsMatch = text.match(/(\d+)\+?\s*years/);
    if (yearsMatch && Number(yearsMatch[1]) >= 10) {
      flags.push({
        severity: 'warning',
        label: 'Experience bias',
        message: `"${yearsMatch[0]}" is highly specific. Consider "significant experience" to widen the pool.`,
        fix: () => setExpMax('8'),
      });
    }
    return flags;
  }, [responsibilities, intro, jdPaste, expMax]);

  const inclusivityScore = Math.max(40, 100 - biasFlags.length * 14);

  const saveProfile = async () => {
    setError(null);
    if (!title.trim()) {
      throw new Error('Enter a job title (or generate from a pasted JD).');
    }
    let id = profileId;
    if (!id) {
      const created = await createJobProfile({
        title: title.trim(),
        department: department || undefined,
        pipeline_preset: pipelinePreset,
      });
      if (!created?.profile?.id) throw new Error('Server did not return a profile id.');
      id = created.profile.id;
      setProfileId(id);
    } else {
      await applyPipelinePreset(id, pipelinePreset);
    }
    await updateJobProfileBasics(id, {
      title,
      department,
      seniority_level: seniority,
      employment_type: employmentType,
      openings_count: openings,
      location_mode: locationMode,
      location_text: locationText,
      language_required: language,
      compensation_band_min: compMin ? Number(compMin) : undefined,
      compensation_band_max: compMax ? Number(compMax) : undefined,
      currency,
      candidate_facing_intro: intro,
    });
    await updateJobProfileJd(id, {
      responsibilities: responsibilities.filter(Boolean),
      required_skills: requiredSkills.filter(Boolean),
      nice_to_have_skills: niceSkills.filter(Boolean),
      experience_min: expMin ? Number(expMin) : undefined,
      experience_max: expMax ? Number(expMax) : undefined,
    });
    return id;
  };

  const createMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: (id) => router.push(`/assessments/job-profiles/${id}/configure?step=stages`),
    onError: (e: Error) => setError(e.message),
  });

  const draftMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: () => setError(null),
    onError: (e: Error) => setError(e.message),
  });

  const parseMutation = useMutation({
    mutationFn: () => parseJobProfileJd({ jd_text: jdPaste }),
    onSuccess: (data) => {
      setError(null);
      setParsedOnce(true);
      if (data.title) setTitle(String(data.title));
      if (data.department) {
        const dept = String(data.department);
        setDepartment(DEPARTMENTS.includes(dept) ? dept : dept);
      }
      if (data.seniority_level) setSeniority(String(data.seniority_level));
      if (data.employment_type) setEmploymentType(String(data.employment_type));
      if (data.openings_count != null && Number.isFinite(Number(data.openings_count))) {
        setOpenings(Math.max(1, Math.trunc(Number(data.openings_count))));
      }
      if (data.location_mode) setLocationMode(String(data.location_mode));
      if (data.location_text != null) setLocationText(String(data.location_text));
      if (data.compensation_band_min != null && Number.isFinite(Number(data.compensation_band_min))) {
        setCompMin(String(data.compensation_band_min));
      }
      if (data.compensation_band_max != null && Number.isFinite(Number(data.compensation_band_max))) {
        setCompMax(String(data.compensation_band_max));
      }
      if (data.currency) setCurrency(String(data.currency));
      if (data.candidate_facing_intro) setIntro(String(data.candidate_facing_intro));

      const responsibilitiesNext = Array.isArray(data.responsibilities)
        ? data.responsibilities.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const requiredNext = Array.isArray(data.required_skills)
        ? data.required_skills.map((s) => String(s).trim()).filter(Boolean)
        : [];
      const niceNext = Array.isArray(data.nice_to_have_skills)
        ? data.nice_to_have_skills.map((s) => String(s).trim()).filter(Boolean)
        : [];
      setResponsibilities(responsibilitiesNext.length ? responsibilitiesNext : ['']);
      setRequiredSkills(requiredNext.length ? requiredNext : ['']);
      setNiceSkills(niceNext.length ? niceNext : ['']);
      if (data.experience_min != null && Number.isFinite(Number(data.experience_min))) {
        setExpMin(String(data.experience_min));
      }
      if (data.experience_max != null && Number.isFinite(Number(data.experience_max))) {
        setExpMax(String(data.experience_max));
      }
      setPipelinePreset(normalizePreset(data.recommended_pipeline));
    },
    onError: (e: Error) => setError(e.message || 'Could not parse JD. Please try again.'),
  });

  const updateList = (list: string[], setList: (v: string[]) => void, idx: number, value: string) => {
    const next = [...list];
    next[idx] = value;
    setList(next);
  };

  const selectedPresetMeta = PIPELINE_PRESETS.find((p) => p.id === pipelinePreset);

  return (
    <div className="w-full">
      <ProfileStepper steps={STEPS} activeStep={1} />

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 space-y-6 lg:col-span-9">
          <section className="nexus-card overflow-hidden p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-label-caps mb-1 text-[var(--assessment-on-surface-variant)]">
                  Magic Job Creator
                </p>
                <h2 className="font-headline-md">Paste job description</h2>
                <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
                  Drop in a full JD and generate structured fields plus a recommended interview pipeline.
                </p>
              </div>
              <button
                type="button"
                disabled={!jdPaste.trim() || parseMutation.isPending}
                onClick={() => parseMutation.mutate()}
                className="nexus-btn-primary inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-50"
              >
                <AssessmentMaterialIcon name="auto_awesome" size={18} />
                {parseMutation.isPending ? 'Generating…' : 'Generate with AI'}
              </button>
            </div>
            <textarea
              value={jdPaste}
              onChange={(e) => setJdPaste(e.target.value.slice(0, 20_000))}
              rows={10}
              placeholder="Paste the full job description here…"
              className="w-full resize-y rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 text-sm text-[var(--assessment-on-surface)] placeholder:text-[var(--assessment-on-surface-variant)] focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--assessment-primary-container)]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--assessment-on-surface-variant)]">
              <span>{jdPaste.length.toLocaleString()} / 20,000 characters</span>
              {parsedOnce ? (
                <span className="inline-flex items-center gap-1 text-[var(--assessment-primary)]">
                  <AssessmentMaterialIcon name="check_circle" size={14} />
                  Fields updated from AI parse — edit anything below
                </span>
              ) : null}
            </div>
          </section>



          <section className="nexus-card p-6">
            <h2 className="font-headline-md mb-2">Job basics</h2>
            <p className="mb-6 text-sm text-[var(--assessment-on-surface-variant)]">
              Review or edit role details, then continue to configure stages.
            </p>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Job title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Senior Software Engineer"
                  className="nexus-input"
                />
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Department
                </label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="nexus-input"
                >
                  <option value="">Select...</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {department && !DEPARTMENTS.includes(department) ? (
                    <option value={department}>{department}</option>
                  ) : null}
                </select>
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Seniority
                </label>
                <select
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                  className="nexus-input"
                >
                  <option value="">Select...</option>
                  <option value="junior">Junior</option>
                  <option value="mid">Mid-level</option>
                  <option value="senior">Senior</option>
                  <option value="lead">Staff / Principal</option>
                  {seniority &&
                  !['junior', 'mid', 'senior', 'lead'].includes(seniority) ? (
                    <option value={seniority}>{seniority}</option>
                  ) : null}
                </select>
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Employment type
                </label>
                <div className="nexus-toggle-group flex gap-2">
                  {[
                    { value: 'full_time', label: 'Full-time' },
                    { value: 'contract', label: 'Contract' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEmploymentType(opt.value)}
                      className={`flex-1 rounded-lg border py-2 text-sm transition-colors ${
                        employmentType === opt.value
                          ? 'active border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed,#dbeafe)] text-[var(--assessment-primary)]'
                          : 'border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="font-label-caps mb-2 block text-[var(--assessment-on-surface-variant)]">
                  Location policy
                </label>
                <div className="flex flex-wrap gap-6">
                  {[
                    { value: 'remote', label: 'Remote' },
                    { value: 'hybrid', label: 'Hybrid' },
                    { value: 'onsite', label: 'On-site' },
                  ].map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="loc"
                        checked={locationMode === opt.value}
                        onChange={() => setLocationMode(opt.value)}
                        className="text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)]"
                      />
                      <span className="text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Location
                </label>
                <input
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                  placeholder="e.g. San Francisco, CA or Remote"
                  className="codevox-input"
                />
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Openings
                </label>
                <input
                  type="number"
                  min={1}
                  value={openings}
                  onChange={(e) => setOpenings(Number(e.target.value))}
                  className="codevox-input"
                />
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Comp. min
                </label>
                <input
                  value={compMin}
                  onChange={(e) => setCompMin(e.target.value)}
                  placeholder="e.g. 800000"
                  className="codevox-input"
                />
              </div>
              <div>
                <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                  Comp. max ({currency})
                </label>
                <input
                  value={compMax}
                  onChange={(e) => setCompMax(e.target.value)}
                  placeholder="e.g. 1800000"
                  className="codevox-input"
                />
              </div>
            </div>
          </section>

          <section className="nexus-card relative overflow-hidden p-6">
            <h2 className="font-headline-md mb-6">Job description</h2>

            <div className="min-h-[280px] rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 focus-within:ring-2 focus-within:ring-[var(--assessment-primary-container)]">
              <h3 className="mb-2 font-bold">Role overview</h3>
              <textarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                rows={3}
                placeholder="Summarize the role for candidates..."
                className="mb-6 w-full resize-none border-none bg-transparent p-0 text-sm text-[var(--assessment-on-surface-variant)] focus:ring-0"
              />
              <h3 className="mb-2 font-bold">Key responsibilities</h3>
              <ul className="mb-4 space-y-2">
                {responsibilities.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2 text-[var(--nexus-outline)]">-</span>
                    <input
                      value={r}
                      onChange={(e) => updateList(responsibilities, setResponsibilities, i, e.target.value)}
                      className="flex-1 border-b border-transparent bg-transparent py-1 text-sm text-[var(--assessment-on-surface-variant)] focus:border-[var(--assessment-outline-variant)] focus:outline-none"
                      placeholder="Responsibility..."
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setResponsibilities([...responsibilities, ''])}
                className="text-xs font-semibold text-[var(--assessment-primary)]"
              >
                + Add responsibility
              </button>

              {biasFlags.length > 0 ? (
                <div className="nexus-glass-ai mt-6 rounded-lg p-4">
                  <p className="font-mono-data flex items-center gap-2 text-sm italic text-[var(--nexus-secondary)]">
                    <AssessmentMaterialIcon name="spark" size={16} />
                    AI suggestion: review bias flags in the sidebar before publishing.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-6">
              <p className="font-label-caps mb-2 text-[var(--assessment-on-surface-variant)]">
                Auto-extracted competencies
              </p>
              <div className="flex flex-wrap gap-2">
                {extractedCompetencies.length ? (
                  extractedCompetencies.map((skill) => (
                    <span
                      key={skill}
                      className="flex items-center gap-1 rounded border border-[var(--assessment-primary-container)] bg-[var(--assessment-surface-container-high)] px-2 py-1 text-sm text-[var(--assessment-primary)]"
                    >
                      {skill}
                      <AssessmentMaterialIcon name="check" size={14} />
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[var(--assessment-on-surface-variant)]">
                    Add skills below or generate from a pasted JD
                  </span>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div className="rounded-xl border border-violet-500/20 bg-[#120726] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <label className="font-label-caps block text-violet-300">
                    Required skills ({requiredSkills.filter(Boolean).length})
                  </label>
                  <button
                    type="button"
                    onClick={() => setRequiredSkills([...requiredSkills, ''])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#55E63B] hover:text-[#45c72f] transition-colors"
                  >
                    <AssessmentMaterialIcon name="add" size={14} />
                    Add skill
                  </button>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {requiredSkills.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={s}
                        onChange={(e) => updateList(requiredSkills, setRequiredSkills, i, e.target.value)}
                        placeholder="e.g. React, Node.js, System Design"
                        className="codevox-input !py-2 !px-3 text-sm flex-1 !bg-[#160A30] !text-white !border-violet-500/25 focus:!border-violet-400"
                      />
                      {requiredSkills.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRequiredSkills(requiredSkills.filter((_, idx) => idx !== i))}
                          className="rounded-lg p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove skill"
                        >
                          <AssessmentMaterialIcon name="close" size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-violet-500/20 bg-[#120726] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <label className="font-label-caps block text-violet-300">
                    Nice to have ({niceSkills.filter(Boolean).length})
                  </label>
                  <button
                    type="button"
                    onClick={() => setNiceSkills([...niceSkills, ''])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#55E63B] hover:text-[#45c72f] transition-colors"
                  >
                    <AssessmentMaterialIcon name="add" size={14} />
                    Add skill
                  </button>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {niceSkills.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={s}
                        onChange={(e) => updateList(niceSkills, setNiceSkills, i, e.target.value)}
                        placeholder="e.g. Kubernetes, Redis, GraphQL"
                        className="codevox-input !py-2 !px-3 text-sm flex-1 !bg-[#160A30] !text-white !border-violet-500/25 focus:!border-violet-400"
                      />
                      {niceSkills.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setNiceSkills(niceSkills.filter((_, idx) => idx !== i))}
                          className="rounded-lg p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Remove skill"
                        >
                          <AssessmentMaterialIcon name="close" size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-violet-500/20 bg-[#120726] p-4">
              <label className="font-label-caps mb-3 block text-violet-300">
                Experience Requirements (Years)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Minimum Experience (Years)</label>
                  <input
                    value={expMin}
                    type="number"
                    min={0}
                    placeholder="e.g. 3"
                    onChange={(e) => setExpMin(e.target.value)}
                    className="codevox-input !py-2.5 !px-3 text-sm !bg-[#160A30] !text-white !border-violet-500/25 focus:!border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Maximum Experience (Years)</label>
                  <input
                    value={expMax}
                    type="number"
                    min={0}
                    placeholder="e.g. 7"
                    onChange={(e) => setExpMax(e.target.value)}
                    className="codevox-input !py-2.5 !px-3 text-sm !bg-[#160A30] !text-white !border-violet-500/25 focus:!border-violet-400"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="nexus-card p-6">
            <h2 className="font-headline-md mb-1">Interview pipeline</h2>
            <p className="mb-5 text-sm text-[var(--assessment-on-surface-variant)]">
              Choose how candidates progress. Default follows the AI recommendation when available.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PIPELINE_PRESETS.map((preset) => {
                const selected = pipelinePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setPipelinePreset(preset.id)}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      selected
                        ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed,#ede9fe)] text-[var(--assessment-on-surface)] shadow-sm ring-1 ring-[var(--assessment-primary)]'
                        : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] hover:border-[var(--assessment-primary)]/40'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <AssessmentMaterialIcon
                        name={preset.icon}
                        size={18}
                        className={selected ? 'text-[var(--assessment-primary)]' : undefined}
                      />
                      <span className="text-sm font-semibold">{preset.title}</span>
                    </div>
                    <p className="mb-3 text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
                      {preset.description}
                    </p>
                    <p className="text-xs font-medium text-[var(--assessment-primary)]">
                      {preset.stages}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="col-span-12 space-y-6 lg:col-span-3">
          <div className="nexus-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <AssessmentMaterialIcon
                name="security_update_good"
                size={20}
                className="text-[var(--nexus-secondary)]"
              />
              <h3 className="font-title-sm">Bias analysis</h3>
            </div>
            <div className="space-y-4">
              {biasFlags.length ? (
                biasFlags.map((flag) => (
                  <div
                    key={flag.label}
                    className={`nexus-bias-flag ${flag.severity === 'critical' ? 'critical' : 'warning'}`}
                  >
                    <p
                      className={`font-label-caps mb-1 ${flag.severity === 'critical' ? 'text-[var(--assessment-error,#dc2626)]' : 'text-[var(--nexus-secondary)]'}`}
                    >
                      {flag.label}
                    </p>
                    <p className="text-sm">{flag.message}</p>
                    <button
                      type="button"
                      onClick={flag.fix}
                      className="mt-2 text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
                    >
                      Apply fix
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                  No bias patterns detected in the current JD text.
                </p>
              )}
              <div className="border-t border-[var(--assessment-outline-variant)] pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-label-caps">Inclusivity score</span>
                  <span className="font-title-sm text-[var(--nexus-secondary)]">{inclusivityScore}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                  <div
                    className="h-full bg-[var(--nexus-secondary)]"
                    style={{ width: `${inclusivityScore}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="nexus-card bg-[var(--assessment-surface-container-low)] p-6">
            <h3 className="font-title-sm mb-4">Pipeline preview</h3>
            <p className="mb-2 text-sm font-medium text-[var(--assessment-on-surface)]">
              {selectedPresetMeta?.title ?? 'Coding + voice interview'}
            </p>
            <p className="mb-2 text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
              {selectedPresetMeta?.description}
            </p>
            <p className="mb-4 text-xs font-medium text-[var(--assessment-primary)]">
              {selectedPresetMeta?.stages}
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--assessment-on-surface-variant)]">Basics &amp; JD</span>
                <AssessmentMaterialIcon
                  name="check_circle"
                  size={18}
                  className="text-[var(--assessment-primary)]"
                />
              </div>
              <div className="flex items-center justify-between text-sm opacity-50">
                <span className="text-[var(--assessment-on-surface-variant)]">Stages</span>
                <AssessmentMaterialIcon name="radio_button_unchecked" size={18} />
              </div>
              <div className="flex items-center justify-between text-sm opacity-50">
                <span className="text-[var(--assessment-on-surface-variant)]">Settings &amp; Review</span>
                <AssessmentMaterialIcon name="radio_button_unchecked" size={18} />
              </div>
            </div>
          </div>
        </aside>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 flex flex-col-reverse justify-end gap-3 border-t border-[var(--assessment-outline-variant)] py-6 sm:flex-row sm:gap-4">
        <button
          type="button"
          disabled={!title.trim() || draftMutation.isPending}
          onClick={() => draftMutation.mutate()}
          className="rounded-lg px-6 py-2 font-title-sm text-[var(--assessment-on-surface-variant)] transition-colors hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="button"
          disabled={!title.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
          className="nexus-btn-primary flex items-center justify-center gap-2 rounded-lg px-6 py-2 font-title-sm shadow-md transition-all hover:shadow-lg disabled:opacity-50"
        >
          Continue to stages
          <AssessmentMaterialIcon name="arrow_forward" size={18} />
        </button>
      </div>
    </div>
  );
}
