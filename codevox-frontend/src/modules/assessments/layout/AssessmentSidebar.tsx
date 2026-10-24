'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePermissions } from '@/contexts/permissions-context';
import { ASSESSMENT_NAV_SECTIONS } from '@/modules/assessments/constants/nav-items';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

function isActive(path: string, href: string) {
  if (href === '/assessments') return path === '/assessments';
  // Exact-only for Classroom CCTV dashboard so child routes don't highlight it
  if (href === '/assessments/classroom-attendance') return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function AssessmentSidebar() {
  const pathname = usePathname() ?? '';
  const { canAny, isLoading } = usePermissions();

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 flex-col border-r border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)] py-4 shadow-lg md:flex">
      

      <nav className="flex-1 space-y-6 overflow-y-auto px-2">
        {ASSESSMENT_NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => {
            if (!item.permission) return true;
            if (isLoading) return false;
            const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
            return canAny(keys);
          });
          if (items.length === 0) return null;

          return (
            <div key={section.label}>
              <p className="mb-2 px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--assessment-on-surface-variant)]">
                {section.label}
              </p>
              <div className="space-y-9">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`mx-2 flex items-center gap-3 rounded-lg p-3 text-sm transition-all ${
                        active
                          ? 'bg-[var(--assessment-primary-container)] font-bold text-white'
                          : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
                      }`}
                    >
                      <AssessmentMaterialIcon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
