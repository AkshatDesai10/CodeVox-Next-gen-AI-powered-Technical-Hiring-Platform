'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ProfileStepper } from '@/modules/job-profiles/components/ProfileStepper';
import {
  draftJobProfileJd,
  getJobProfile,
  updateJobProfileBasics,
  updateJobProfileJd,
  type JobProfileDetail,
} from '@/modules/job-profiles/lib/job-profiles-api';
import { setupPathForProfile } from '@/modules/job-profiles/lib/job-profile-setup';

const STEPS = [
  { id: 1, label: 'Job Details' },
  { id: 2, label: 'Rubric & Stages' },
  { id: 3, label: 'Interview Questions' },
];

const DEPARTMENTS = ['Engineering', 'Design', 'Product Management', 'Sales', 'People', 'Growth'];

export function JobProfileBasicsPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = String(params?.id ?? '');

  const detailQuery = useQuery({
    queryKey: ['job-profile', id],
    queryFn: () => getJobProfile(id),
  });

  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [seniority, setSeniority] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [openings, setOpenings] = useState(1);
  const [locationMode, setLocationMode] = useState('hybrid');
  const [locationText, setLocationText] = useState('');
  const [language, setLanguage] = useState('English');
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [intro, setIntro] = useState('');
  const [responsibilities, setResponsibilities] = useState<string[]>(['']);
  const [requiredSkills, setRequiredSkills] = useState<string[]>(['']);
  const [niceSkills, setNiceSkills] = useState<string[]>(['']);
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);

  const formFingerprint = useMemo(
    () =>
      JSON.stringify({
        title,
        department,
        seniority,
        employmentType,
        openings,
        locationMode,
        locationText,
        language,
        compMin,
        compMax,
        currency,
        intro,
        responsibilities,
        requiredSkills,
        niceSkills,
        expMin,
        expMax,
      }),
    [
      title,
      department,
      seniority,
      employmentType,
      openings,
      locationMode,
      locationText,
      language,
      compMin,
      compMax,
      currency,
      intro,
      responsibilities,
      requiredSkills,
      niceSkills,
      expMin,
      expMax,
    ],
  );
  const draftSaved = savedFingerprint !== null && savedFingerprint === formFingerprint;

  useEffect(() => {
    const p = detailQuery.data?.profile;
    if (!p) return;
    setTitle(p.title);
    setDepartment(p.department ?? '');
    setSeniority(
      p.seniority_level ??
        (/junior|entry|fresher|trainee/i.test(`${p.title} ${p.slug}`) ? 'junior' : ''),
    );
    setEmploymentType(p.employment_type ?? 'full_time');
    setOpenings(p.openings_count ?? 1);
    setLocationMode(p.location_mode ?? 'hybrid');
    setLocationText(p.location_text ?? '');
    setLanguage(p.language_required ?? 'English');
    setCompMin(p.compensation_band_min != null ? String(p.compensation_band_min) : '');
    setCompMax(p.compensation_band_max != null ? String(p.compensation_band_max) : '');
    setCurrency(p.currency ?? 'INR');
    setIntro(p.candidate_facing_intro ?? '');
    setResponsibilities(p.responsibilities?.length ? p.responsibilities : ['']);
    setRequiredSkills(p.required_skills?.length ? p.required_skills : ['']);
    setNiceSkills(p.nice_to_have_skills?.length ? p.nice_to_have_skills : ['']);
    setExpMin(p.experience_min != null ? String(p.experience_min) : '');
    setExpMax(p.experience_max != null ? String(p.experience_max) : '');
  }, [detailQuery.data]);

  const biasFlags = useMemo(() => {
    const text = [...responsibilities, intro].join(' ').toLowerCase();
    const flags: Array<{ severity: 'critical' | 'warning'; label: string; message: string }> = [];
    if (/\brockstar\b|\bninja\b|\bguru\b/.test(text)) {
      flags.push({
        severity: 'critical',
        label: 'Gendered language',
        message: 'Terms like "rockstar" can discourage diverse applicants.',
      });
    }
    return flags;
  }, [responsibilities, intro]);

  const saveProfile = async (): Promise<JobProfileDetail> => {
    await updateJobProfileBasics(id, {
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
    return updateJobProfileJd(id, {
      responsibilities: responsibilities.filter(Boolean),
      required_skills: requiredSkills.filter(Boolean),
      nice_to_have_skills: niceSkills.filter(Boolean),
      experience_min: expMin ? Number(expMin) : undefined,
      experience_max: expMax ? Number(expMax) : undefined,
    });
  };

  const continueMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: (detail) => {
      queryClient.setQueryData(['job-profile', id], detail);
      router.push(setupPathForProfile(id, 2));
    },
    onError: (e: Error) => setError(e.message),
  });

  const draftMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: (detail) => {
      queryClient.setQueryData(['job-profile', id], detail);
      setError(null);
      const p = detail.profile;
      // Fingerprint from saved server payload so hydrate doesn't clear "Saved"
      setSavedFingerprint(
        JSON.stringify({
          title: p.title ?? '',
          department: p.department ?? '',
          seniority:
            p.seniority_level ??
            (/junior|entry|fresher|trainee/i.test(`${p.title} ${p.slug}`) ? 'junior' : ''),
          employmentType: p.employment_type ?? 'full_time',
          openings: p.openings_count ?? 1,
          locationMode: p.location_mode ?? 'hybrid',
          locationText: p.location_text ?? '',
          language: p.language_required ?? 'English',
          compMin: p.compensation_band_min != null ? String(p.compensation_band_min) : '',
          compMax: p.compensation_band_max != null ? String(p.compensation_band_max) : '',
          currency: p.currency ?? 'INR',
          intro: p.candidate_facing_intro ?? '',
          responsibilities: p.responsibilities?.length ? p.responsibilities : [''],
          requiredSkills: p.required_skills?.length ? p.required_skills : [''],
          niceSkills: p.nice_to_have_skills?.length ? p.nice_to_have_skills : [''],
          expMin: p.experience_min != null ? String(p.experience_min) : '',
          expMax: p.experience_max != null ? String(p.experience_max) : '',
        }),
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  const aiDraftMutation = useMutation({
    mutationFn: () => draftJobProfileJd({ title, brief: department, department }),
    onSuccess: (data) => {
      setError(null);
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
    },
    onError: (e: Error) => setError(e.message || 'AI draft failed. Please try again.'),
  });

  const updateList = (list: string[], setList: (v: string[]) => void, idx: number, value: string) => {
    const next = [...list];
    next[idx] = value;
    setList(next);
  };

  const removeListItem = (list: string[], setList: (v: string[]) => void, idx: number) => {
    if (list.length <= 1) {
      setList(['']);
      return;
    }
    setList(list.filter((_, i) => i !== idx));
  };

  const completedChecks = [
    Boolean(title.trim() && department),
    Boolean(intro.trim()),
    responsibilities.some((r) => r.trim().length > 0),
    requiredSkills.some((s) => s.trim().length > 0),
  ];
  const completedCount = completedChecks.filter(Boolean).length;
  const readinessPct = Math.round((completedCount / 4) * 100);

  if (detailQuery.isLoading) {
    return <p className="text-sm p-6 text-[var(--assessment-on-surface-variant)]">Loading job profile...</p>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="text-sm text-red-600 p-6">Failed to load job profile.</p>;
  }

  const isContinueDisabled =
    continueMutation.isPending ||
    (!requiredSkills.some((s) => s.trim().length > 0) &&
      !responsibilities.some((r) => r.trim().length > 0));

  return (
    <div className="w-full space-y-6">
      {/* Top Header / Stepper Container */}
      <div className="nexus-card p-3 px-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Step 1: Active */}
          <div className="bg-[var(--assessment-primary)] text-[var(--assessment-on-primary)] text-xs font-semibold px-4 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
            <span className="font-bold">1.</span> Job Details
          </div>
          <div className="hidden sm:block w-8 h-[1px] bg-[var(--assessment-outline-variant)]" />
          {/* Step 2 */}
          <button
            type="button"
            disabled
            className="bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] text-xs font-medium px-3.5 py-1.5 rounded-full opacity-60 cursor-not-allowed"
            title="Please click Continue at the bottom to proceed"
          >
            2. Stages Allotment
          </button>
          <div className="hidden sm:block w-8 h-[1px] bg-[var(--assessment-outline-variant)]" />
          {/* Step 3 */}
          <button
            type="button"
            disabled
            className="bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] text-xs font-medium px-3.5 py-1.5 rounded-full opacity-60 cursor-not-allowed"
            title="Please complete previous stages first"
          >
            3. Rubric &amp; Round Configuration
          </button>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <button
            type="button"
            disabled={draftMutation.isPending || draftSaved}
            onClick={() => draftMutation.mutate()}
            className={`border text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm ${
              draftSaved
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] hover:bg-[var(--assessment-surface-container-low)] text-[var(--assessment-on-surface)]'
            }`}
          >
            {draftMutation.isPending ? 'SAVING...' : draftSaved ? 'SAVED' : 'SAVE DRAFT'}
          </button>
          <button
            type="button"
            disabled={isContinueDisabled}
            onClick={() => continueMutation.mutate()}
            className="bg-[var(--assessment-primary)] hover:opacity-90 text-[var(--assessment-on-primary)] text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {continueMutation.isPending ? 'CONTINUING...' : 'CONTINUE TO STAGES'}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sub-header Meta Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-[var(--assessment-on-surface-variant)]">
        <div className="flex items-center flex-wrap gap-2">
          <Link href="/assessments/job-profiles" className="hover:text-[var(--assessment-primary)] transition-colors">
            ← All job profiles
          </Link>
          <span className="text-[var(--assessment-outline-variant)]">/</span>
          <span className="font-bold text-[var(--assessment-on-surface)] text-base">{title || 'PHP Developer Junior'}</span>
          <span className="ml-1.5 bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)] font-mono text-xs font-bold px-2.5 py-0.5 rounded tracking-wider">
            ID: {id || 'JOB-ID'}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs font-medium text-[var(--assessment-on-surface-variant)]">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Autosaved 1m ago
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-12 gap-6 items-start">
        {/* Left Column: Forms */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Card 1: Job details */}
          <section className="nexus-card p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-1">
              <h2 className="text-lg font-bold text-[var(--assessment-on-surface)]">Job details</h2>
            </div>
            <p className="text-sm text-[var(--assessment-on-surface-variant)] mb-6">
              Complete the title, JD, and skills before configuring stages and questions.
            </p>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="md:col-span-2">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                    JOB TITLE
                  </label>
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg bg-[var(--assessment-surface-container)] border border-[var(--assessment-outline-variant)] px-4 py-3 text-sm text-[var(--assessment-on-surface)] font-medium focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)] focus:border-[var(--assessment-primary)]"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] block mb-1.5">
                  DEPARTMENT
                </label>
                <div className="relative">
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full appearance-none rounded-lg bg-[var(--assessment-surface-container)] border border-[var(--assessment-outline-variant)] px-4 py-3 text-sm text-[var(--assessment-on-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)] focus:border-[var(--assessment-primary)] transition-all pr-10 cursor-pointer"
                  >
                    <option value="">Select...</option>
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="w-4 h-4 text-[var(--assessment-outline)] absolute right-3.5 top-4 pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] block mb-1.5">
                  SENIORITY
                </label>
                <div className="relative">
                  <select
                    value={seniority}
                    onChange={(e) => setSeniority(e.target.value)}
                    className="w-full appearance-none rounded-lg bg-[var(--assessment-surface-container)] border border-[var(--assessment-outline-variant)] px-4 py-3 text-sm text-[var(--assessment-on-surface)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)] focus:border-[var(--assessment-primary)] transition-all pr-10 cursor-pointer"
                  >
                    <option value="">Select...</option>
                    <option value="junior">Junior</option>
                    <option value="mid">Mid-level</option>
                    <option value="senior">Senior</option>
                    <option value="lead">Staff / Principal</option>
                  </select>
                  <svg
                    className="w-4 h-4 text-[var(--assessment-outline)] absolute right-3.5 top-4 pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Job description */}
          <section className="nexus-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--assessment-on-surface)] flex items-center gap-1.5">
                Job description <span className="text-[var(--assessment-primary)] text-sm leading-none">•</span>
              </h3>
              <button
                type="button"
                onClick={() => aiDraftMutation.mutate()}
                disabled={!title.trim() || aiDraftMutation.isPending}
                className="bg-[var(--assessment-surface-container-low)] hover:bg-[var(--assessment-surface-container)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)] text-xs font-semibold px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-colors disabled:opacity-50 shadow-sm"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                </svg>
                {aiDraftMutation.isPending ? 'Drafting...' : 'AI draft JD'}
              </button>
            </div>

            {/* Summary Description */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  SUMMARY DESCRIPTION
                </label>
                <span className="text-xs text-[var(--assessment-outline)]">Markdown supported</span>
              </div>
              <textarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                rows={3}
                placeholder="Candidate-facing intro..."
                className="w-full rounded-lg bg-[var(--assessment-surface-container)] border border-[var(--assessment-outline-variant)] p-4 text-sm text-[var(--assessment-on-surface)] placeholder-[var(--assessment-outline)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)] focus:border-[var(--assessment-primary)] transition-all resize-y"
              />
            </div>

            {/* Key Responsibilities */}
            <div className="mb-6">
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] block mb-2">
                KEY RESPONSIBILITIES
              </label>
              <div className="space-y-3 mb-3">
                {responsibilities.map((line, idx) => (
                  <div
                    key={`r-${idx}`}
                    className="flex items-center gap-3 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2.5 hover:border-[var(--assessment-outline)] transition-colors shadow-2xs"
                  >
                    <svg className="w-3.5 h-3.5 text-[var(--assessment-outline)] cursor-grab shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7-13a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                    </svg>
                    <input
                      value={line}
                      onChange={(e) =>
                        updateList(responsibilities, setResponsibilities, idx, e.target.value)
                      }
                      className="flex-1 bg-transparent border-none text-sm text-[var(--assessment-on-surface)] placeholder-[var(--assessment-outline)] focus:outline-none"
                      placeholder="Responsibility..."
                    />
                    <button
                      type="button"
                      onClick={() => removeListItem(responsibilities, setResponsibilities, idx)}
                      className="text-[var(--assessment-outline)] hover:text-[var(--assessment-on-surface)] p-1 transition-colors"
                      title="Remove responsibility"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setResponsibilities([...responsibilities, ''])}
                className="w-full py-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--nexus-secondary)] hover:text-[var(--assessment-primary)] transition-colors rounded-lg border border-dashed border-[var(--assessment-outline-variant)] hover:border-[var(--nexus-secondary)] bg-[var(--assessment-surface-container-low)]/30"
              >
                + Add responsibility
              </button>
            </div>

            {/* Required Skills & Competencies */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] block mb-2">
                REQUIRED SKILLS &amp; COMPETENCIES
              </label>
              <div className="space-y-3 mb-3">
                {requiredSkills.map((line, idx) => (
                  <div
                    key={`s-${idx}`}
                    className="flex items-center gap-3 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2.5 hover:border-[var(--assessment-outline)] transition-colors shadow-2xs"
                  >
                    <svg className="w-3.5 h-3.5 text-[var(--assessment-outline)] cursor-grab shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8.5 7a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7-13a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm0 6.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                    </svg>
                    <input
                      value={line}
                      onChange={(e) =>
                        updateList(requiredSkills, setRequiredSkills, idx, e.target.value)
                      }
                      className="flex-1 bg-transparent border-none text-sm text-[var(--assessment-on-surface)] placeholder-[var(--assessment-outline)] focus:outline-none"
                      placeholder="Required skill..."
                    />
                    <button
                      type="button"
                      onClick={() => removeListItem(requiredSkills, setRequiredSkills, idx)}
                      className="text-[var(--assessment-outline)] hover:text-[var(--assessment-on-surface)] p-1 transition-colors"
                      title="Remove skill"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRequiredSkills([...requiredSkills, ''])}
                className="w-full py-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-[var(--nexus-secondary)] hover:text-[var(--assessment-primary)] transition-colors rounded-lg border border-dashed border-[var(--assessment-outline-variant)] hover:border-[var(--nexus-secondary)] bg-[var(--assessment-surface-container-low)]/30"
              >
                + Add required skill
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Setup checklist */}
        <aside className="col-span-12 lg:col-span-4 space-y-6">
          <div className="nexus-card p-6 shadow-sm">
            <div className="flex items-center gap-2.5 mb-1">
              <svg className="w-4 h-4 text-[var(--nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <h3 className="font-bold text-lg text-[var(--assessment-on-surface)]">Setup checklist</h3>
            </div>
            <p className="text-sm text-[var(--assessment-on-surface-variant)] leading-relaxed mb-6">
              Add at least one responsibility or required skill to unlock stages configuration.
            </p>

            {/* Profile Readiness Box */}
            <div className="bg-[var(--assessment-surface-container-low)] border border-[var(--assessment-outline-variant)] rounded-xl p-5 mb-6">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-1.5">
                PROFILE READINESS
              </div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-base font-bold text-[var(--assessment-on-surface)]">
                  {readinessPct >= 75 ? 'Ready for review' : 'In progress'}
                </span>
                <span className="bg-[var(--assessment-primary)] text-white text-xs font-bold px-2.5 py-0.5 rounded">
                  {readinessPct}%
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--assessment-outline-variant)]/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--assessment-primary)] transition-all duration-300 rounded-full"
                  style={{ width: `${readinessPct}%` }}
                />
              </div>
            </div>

            {/* Checklist items */}
            <div className="space-y-4">
              {/* Check 1 */}
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                    completedChecks[0]
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'border border-[var(--assessment-outline-variant)] text-transparent'
                  }`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">Valid Job Title &amp; Department</h4>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {department || 'Engineering'} department
                  </p>
                </div>
              </div>

              {/* Check 2 */}
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                    completedChecks[1]
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'border border-[var(--assessment-outline-variant)] text-transparent'
                  }`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">Job description entered</h4>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {intro.trim() ? '1 paragraph drafted' : 'Draft pending'}
                  </p>
                </div>
              </div>

              {/* Check 3 */}
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                    completedChecks[2]
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'border border-[var(--assessment-outline-variant)] text-transparent'
                  }`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">Responsibilities configured</h4>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {responsibilities.filter((r) => r.trim()).length} item recorded
                  </p>
                </div>
              </div>

              {/* Check 4 */}
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                    completedChecks[3]
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'border border-[var(--assessment-outline-variant)] text-transparent'
                  }`}
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">Required skills listed</h4>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {requiredSkills.filter((s) => s.trim()).length} skill mapped
                  </p>
                </div>
              </div>

              {/* Check 5 (Unlocked in step 2) */}
              <div className="flex items-start gap-3 opacity-60">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--assessment-outline-variant)] text-[var(--assessment-outline)] text-xs font-semibold">
                  +
                </span>
                <div>
                  <h4 className="text-sm font-medium text-[var(--assessment-outline)]">Configure Interview Stages</h4>
                  <p className="text-xs text-[var(--assessment-outline)]">Unlocked in Step 2</p>
                </div>
              </div>
            </div>

            {/* Info notice box */}
            <div className="mt-6 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4 flex items-start gap-3">
              <svg className="w-4 h-4 text-[var(--nexus-secondary)] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">
                Stage progression rules and automated candidate pipelines will activate as soon as details are finalized.
              </p>
            </div>

            {biasFlags.length ? (
              <p className="mt-4 text-xs text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200">
                {biasFlags[0]?.message}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {error ? (
        <div className="mt-4 p-3 rounded-lg bg-[var(--assessment-error-container)]/20 border border-[var(--assessment-error)]/30 text-sm text-[var(--assessment-error)]">
          {error}
        </div>
      ) : null}

      {/* Bottom Action Footer */}
      <div className="mt-8 border-t border-[var(--assessment-outline-variant)] pt-6 pb-12 flex items-center justify-between">
        <Link
          href="/assessments/job-profiles"
          className="text-sm font-bold text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-primary)] transition-colors"
        >
          ← Back to Job Profiles
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={draftMutation.isPending || draftSaved}
            onClick={() => draftMutation.mutate()}
            className={`rounded-lg border px-6 py-2.5 text-xs font-bold transition-colors shadow-sm ${
              draftSaved
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
            }`}
          >
            {draftMutation.isPending ? 'Saving...' : draftSaved ? 'Saved' : 'Save Draft'}
          </button>
          <button
            type="button"
            disabled={isContinueDisabled}
            onClick={() => continueMutation.mutate()}
            className="rounded-lg bg-[var(--assessment-primary)] hover:opacity-90 px-6 py-2.5 text-xs font-bold text-[var(--assessment-on-primary)] flex items-center gap-2 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue to Stages
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
