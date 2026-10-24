'use client';

import type { ResumeAlignment } from '@/modules/autonomous-interview/types/interview-report';

type Props = {
  alignment: ResumeAlignment;
};

export function SkillAlignmentGrid({ alignment }: Props) {
  const verifiedCount = alignment.verified?.length ?? 0;
  const struggledCount = alignment.skipped_due_to_struggles?.length ?? 0;
  const unassessedCount = alignment.un_assessed_due_to_time?.length ?? 0;

  return (
    <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-space-xl shadow-sm">
      <div className="flex items-center justify-between mb-space-md flex-wrap gap-4">
        <div>
          <h3 className="font-headline-md text-headline-md font-bold text-on-surface">Skill Alignment Grid</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">Resume claim verification against live telemetry and dynamic coding evaluation</p>
        </div>
        <div className="flex items-center gap-space-sm text-label-sm font-label-sm">
          <span className="flex items-center gap-1 text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> {verifiedCount} Verified
          </span>
          <span className="flex items-center gap-1 text-amber-700">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span> {struggledCount} Struggled
          </span>
          <span className="flex items-center gap-1 text-slate-500">
            <span className="w-2 h-2 rounded-full bg-slate-400"></span> {unassessedCount} Unassessed
          </span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
        {alignment.verified?.map((skill) => (
          <div key={skill} className="flex items-center justify-between p-space-sm rounded-lg border border-outline-variant/40 bg-surface-bright">
            <span className="font-body-md text-body-md font-medium text-on-surface truncate pr-2">{skill}</span>
            <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-label-sm text-label-sm font-semibold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span> Verified
            </span>
          </div>
        ))}

        {alignment.skipped_due_to_struggles?.map((skill) => (
          <div key={skill} className="flex items-center justify-between p-space-sm rounded-lg border border-amber-200 bg-amber-50/30">
            <span className="font-body-md text-body-md font-medium text-on-surface truncate pr-2">{skill}</span>
            <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-label-sm text-label-sm font-semibold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span> Struggled
            </span>
          </div>
        ))}

        {alignment.un_assessed_due_to_time?.map((skill) => (
          <div key={skill} className="flex items-center justify-between p-space-sm rounded-lg border border-outline-variant/40 bg-surface-bright">
            <span className="font-body-md text-body-md font-medium text-on-surface truncate pr-2">{skill}</span>
            <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300 font-label-sm text-label-sm font-semibold uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Un-assessed
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
