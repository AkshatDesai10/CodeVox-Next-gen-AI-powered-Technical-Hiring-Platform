'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import {
  RECRUITMENT_NAV_SECTIONS,
  type AssessmentNavItem,
} from '@/modules/assessments/constants/nav-items';

import {
  Briefcase,
  Inbox,
  Users,
  ChartColumn,
  BarChart,
  LayoutGrid,
  CircleHelp,
  CodeXml,
  FlaskConical,
  Pencil,
  ClipboardCheck,
  TrendingUp,
  Home,
  FileText,
  ListChecks,
  PlusCircle,
  CalendarClock,
} from 'lucide-react';

const LUCIDE_ICON_MAP: Record<string, React.ElementType> = {
  work: Briefcase,
  inbox: Inbox,
  groups: Users,
  view_kanban: ChartColumn,
  analytics: BarChart,
  dashboard: LayoutGrid,
  quiz: CircleHelp,
  code: CodeXml,
  science: FlaskConical,
  rate_review: Pencil,
  fact_check: ClipboardCheck,
  monitoring: TrendingUp,
  home_work: Home,
  summarize: FileText,
  assignment: ListChecks,
  add_circle: PlusCircle,
  schedule: CalendarClock,
  bar_chart: BarChart,
};

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/assessments') return pathname === '/assessments' || pathname === '/assessments/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active }: { item: AssessmentNavItem; active: boolean }) {
  const LucideIcon = LUCIDE_ICON_MAP[item.icon];

  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
        active
          ? 'bg-[rgba(22,133,255,0.18)] text-white shadow-[inset_0_0_0_1px_rgba(22,133,255,0.45)]'
          : 'text-[#A7B7CD] hover:bg-white/[0.05] hover:text-white'
      }`}
    >
      {LucideIcon ? (
        <LucideIcon className={`h-4.5 w-4.5 stroke-[2] ${active ? 'text-[#22D3EE]' : ''}`} />
      ) : (
        <AssessmentMaterialIcon name={item.icon} className="text-xl" />
      )}
      {item.label}
    </Link>
  );
}

export function RecruitmentAssessmentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const { data } = useSession();
  const userName = data?.user?.name ?? data?.user?.email ?? undefined;

  return (
    <div className="assessments-root min-h-screen bg-[var(--color-page)]">
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-[#293B57] bg-[rgba(8,20,38,0.85)] px-6 backdrop-blur-xl">
        <Link href="/assessments" className="text-lg font-bold tracking-tight text-white">
          Code<span className="cvx-text-gradient">Vox</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-[#A7B7CD]">
          <span className="hidden sm:inline">{userName ? userName : 'CodeVox Console'}</span>
          <span className="hidden rounded-full border border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.12)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#34D399] sm:inline">
            Pro
          </span>
          <button
            type="button"
            suppressHydrationWarning
            className="cvx-btn-ghost px-3 py-1.5 text-xs"
            onClick={() => signOut({ callbackUrl: '/signin' })}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-screen pt-16">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 flex-col border-r border-[#293B57] bg-[#081426] py-5 md:flex">
          <nav className="flex-1 space-y-6 overflow-y-auto px-3">
            {RECRUITMENT_NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[#6B7C96]">
                  {section.label}
                </p>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 bg-[var(--color-page)] p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
