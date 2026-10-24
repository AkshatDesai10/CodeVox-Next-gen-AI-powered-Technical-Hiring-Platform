'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { ProfileStepper } from '@/modules/job-profiles/components/ProfileStepper';
import {
  createJobProfile,
  draftJobProfileJd,
  updateJobProfileBasics,
  updateJobProfileJd,
} from '@/modules/job-profiles/lib/job-profiles-api';

const STEPS = [
  { id: 1, label: 'Basics & JD' },
  { id: 2, label: 'Stages' },
  { id: 3, label: 'Settings & Review' },
];

const DEPARTMENTS = ['Engineering', 'Design', 'Product Management', 'Sales', 'People', 'Growth'];

export function CreateJobProfileStep1Page() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [seniority, setSeniority] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [openings, setOpenings] = useState(1);
  const [locationMode, setLocationMode] = useState('hybrid');
  const [locationText, setLocationText] = useState('');
  const language = 'English';
  const compMin = '';
  const compMax = '';
  const currency = 'INR';
  const [intro, setIntro] = useState('');
  const [responsibilities, setResponsibilities] = useState<string[]>(['']);
  const [requiredSkills, setRequiredSkills] = useState<string[]>(['']);
  const [niceSkills, setNiceSkills] = useState<string[]>(['']);
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const extractedCompetencies = useMemo(
    () => [...requiredSkills, ...niceSkills].filter(Boolean),
    [requiredSkills, niceSkills],
  );

  const biasFlags = useMemo(() => {
    const text = [...responsibilities, intro].join(' ').toLowerCase();
    const flags: Array<{ severity: 'critical' | 'warning'; label: string; message: string; fix: () => void }> = [];
    if (/\brockstar\b|\bninja\b|\bguru\b/.test(text)) {
      flags.push({
        severity: 'critical',
        label: 'Gendered language',
        message: 'Terms like "rockstar" can discourage diverse applicants. Consider neutral phrasing.',
        fix: () =>
          setResponsibilities(
            responsibilities.map((r) => r.replace(/\brockstar\b/gi, 'high-performing').replace(/\bninja\b/gi, 'skilled')),
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
  }, [responsibilities, intro, expMax]);

  const inclusivityScore = Math.max(40, 100 - biasFlags.length * 14);

  const saveProfile = async () => {
    setError(null);
    if (!title.trim()) {
      throw new Error('Enter a job title.');
    }
    let id = profileId;
    if (!id) {
      const created = await createJobProfile({
        title: title.trim(),
        department: department || undefined,
      });
      if (!created?.profile?.id) throw new Error('Server did not return a profile id.');
      id = created.profile.id;
      setProfileId(id);
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
    onSuccess: (id) => router.push(`/assessments/job-profiles/${id}/configure`),
    onError: (e: Error) => setError(e.message),
  });

  const draftMutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: () => setError(null),
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

  return (
    <div className="w-full">
        <ProfileStepper steps={STEPS} activeStep={1} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 space-y-6 lg:col-span-9">
            <section className="nexus-card p-6">
              <h2 className="font-headline-md mb-2">Job basics</h2>
              <p className="mb-6 text-sm text-[var(--assessment-on-surface-variant)]">
                Enter the role details below, then configure assessment stages and settings.
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
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] p-4 text-sm"
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
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] p-4 text-sm"
                  />
                </div>
              </div>
            </section>

            <section className="nexus-card relative overflow-hidden p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-headline-md">Job description</h2>
                <button
                  type="button"
                  disabled={!title || aiDraftMutation.isPending}
                  onClick={() => aiDraftMutation.mutate()}
                  className="nexus-btn-secondary flex items-center gap-2 rounded-full px-6 py-2 text-sm font-semibold shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  <AssessmentMaterialIcon name="auto_awesome" size={18} />
                  {aiDraftMutation.isPending ? 'Drafting...' : 'Draft with AI'}
                </button>
              </div>

              <div className="min-h-[320px] rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 focus-within:ring-2 focus-within:ring-[var(--assessment-primary-container)]">
                <h3 className="mb-2 font-bold">Role overview</h3>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={3}
                  placeholder="Summarize the role for candidates..."
                  className="mb-6 w-full resize-none border-none p-0 text-sm text-[var(--assessment-on-surface-variant)] focus:ring-0"
                />
                <h3 className="mb-2 font-bold">Key responsibilities</h3>
                <ul className="mb-4 space-y-2">
                  {responsibilities.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-2 text-[var(--nexus-outline)]">-</span>
                      <input
                        value={r}
                        onChange={(e) => updateList(responsibilities, setResponsibilities, i, e.target.value)}
                        className="flex-1 border-b border-transparent py-1 text-sm text-[var(--assessment-on-surface-variant)] focus:border-[var(--assessment-outline-variant)] focus:outline-none"
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
                      Add skills below or draft with AI
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="font-label-caps mb-2 block text-[var(--assessment-on-surface-variant)]">
                    Required skills
                  </label>
                  {requiredSkills.map((s, i) => (
                    <input
                      key={i}
                      value={s}
                      onChange={(e) => updateList(requiredSkills, setRequiredSkills, i, e.target.value)}
                      className="mb-2 w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setRequiredSkills([...requiredSkills, ''])}
                    className="text-xs font-semibold text-[var(--assessment-primary)]"
                  >
                    + Add skill
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                      Exp. min
                    </label>
                    <input
                      value={expMin}
                      onChange={(e) => setExpMin(e.target.value)}
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="font-label-caps mb-1 block text-[var(--assessment-on-surface-variant)]">
                      Exp. max
                    </label>
                    <input
                      value={expMax}
                      onChange={(e) => setExpMax(e.target.value)}
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="col-span-12 space-y-6 lg:col-span-3">
            <div className="nexus-card p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <AssessmentMaterialIcon name="security_update_good" size={20} className="text-[var(--nexus-secondary)]" />
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
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--assessment-on-surface-variant)]">Basics &amp; JD</span>
                  <AssessmentMaterialIcon name="check_circle" size={18} className="text-[var(--assessment-primary)]" />
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

        <div className="mt-6 flex justify-end gap-4 border-t border-[var(--assessment-outline-variant)] py-6">
          <button
            type="button"
            disabled={!title.trim() || draftMutation.isPending}
            onClick={() => draftMutation.mutate()}
            className="rounded-lg px-6 py-2 font-title-sm text-[var(--assessment-on-surface-variant)] transition-colors hover:bg-[var(--assessment-surface-container-high)]"
          >
            Save as draft
          </button>
          <button
            type="button"
            disabled={!title.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="nexus-btn-primary flex items-center gap-2 rounded-lg px-6 py-2 font-title-sm shadow-md transition-all hover:shadow-lg disabled:opacity-50"
          >
            Continue to stages
            <AssessmentMaterialIcon name="arrow_forward" size={18} />
          </button>
        </div>
    </div>
  );
}
