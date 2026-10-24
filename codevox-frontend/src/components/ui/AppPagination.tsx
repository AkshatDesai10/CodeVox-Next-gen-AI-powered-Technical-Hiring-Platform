'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;

function getVisiblePages(page: number, totalPages: number): number[] {
  if (totalPages <= 1) return [1];
  const pages = new Set<number>([1, totalPages]);
  for (let i = page - 1; i <= page + 1; i++) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }
  return [...pages].sort((a, b) => a - b);
}

function withEllipsis(pages: number[]): Array<number | 'ellipsis'> {
  const out: Array<number | 'ellipsis'> = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) out.push('ellipsis');
    out.push(pages[i]);
  }
  return out;
}

function NavIconControl(props: {
  label: string;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = cn(
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-600 no-underline',
    'transition-colors hover:border-slate-200 hover:bg-[var(--assessment-surface-container)] hover:text-slate-900',
    'disabled:pointer-events-none disabled:opacity-35',
  );

  if (props.href && !props.disabled) {
    return (
      <Link href={props.href} aria-label={props.label} title={props.label} className={className}>
        {props.children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className={className}
    >
      {props.children}
    </button>
  );
}

function PageNumberControl(props: {
  page: number;
  current: number;
  href?: string;
  onClick?: () => void;
}) {
  const active = props.page === props.current;
  const className = cn(
    'flex h-7 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 text-[10px] font-semibold transition-colors no-underline',
    active ? 'bg-brand text-white shadow-sm' : 'text-slate-700 hover:bg-slate-50',
  );

  if (props.href && !active) {
    return (
      <li>
        <Link
          href={props.href}
          aria-label={`Page ${props.page}`}
          className={className}
        >
          {props.page}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-label={`Page ${props.page}`}
        aria-current={active ? 'page' : undefined}
        disabled={active}
        onClick={props.onClick}
        className={className}
      >
        {props.page}
      </button>
    </li>
  );
}

export type AppPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Singular label, e.g. "issue" → "issues" when count ≠ 1 */
  itemLabel?: string;
  /** Override plural form when the default `${itemLabel}s` is wrong */
  itemLabelPlural?: string;
  className?: string;
  pageSizes?: readonly number[] | null;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageHref?: (page: number) => string;
  pageSizeHref?: (size: number) => string;
};

export function AppPagination(props: AppPaginationProps) {
  const {
    page,
    pageSize,
    total,
    totalPages,
    itemLabel = 'item',
    itemLabelPlural,
    className,
    pageSizes = DEFAULT_PAGE_SIZES,
    onPageChange,
    onPageSizeChange,
    pageHref,
    pageSizeHref,
  } = props;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const plural =
    total === 1 ? itemLabel : (itemLabelPlural ?? `${itemLabel}s`);
  const pageItems = withEllipsis(getVisiblePages(page, totalPages));
  const showNav = totalPages > 1;
  const showPageSizes =
    pageSizes != null &&
    pageSizes.length > 0 &&
    (onPageSizeChange != null || pageSizeHref != null);

  const goToPage = (p: number) => {
    if (onPageChange) onPageChange(p);
  };

  const hrefForPage = (p: number) => pageHref?.(p);

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-t border-slate-200 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <p className="text-[11px] text-slate-600">
        {total === 0 ? (
          `No ${plural}`
        ) : (
          <>
            Showing <span className="font-semibold text-slate-900">{from}</span>
            {' - '}
            <span className="font-semibold text-slate-900">{to}</span> of{' '}
            <span className="font-semibold text-slate-900">{total}</span> {plural}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        {showPageSizes ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Rows
            </span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] p-0.5 shadow-sm">
              {pageSizes.map((n) => {
                const active = pageSize === n;
                const sizeClass = cn(
                  'min-w-[2.25rem] rounded-md px-2 py-1 text-[10px] font-semibold transition-colors no-underline',
                  active
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                );
                const sizeHref = pageSizeHref?.(n);
                if (sizeHref && !active) {
                  return (
                    <Link key={n} href={sizeHref} className={sizeClass}>
                      {n}
                    </Link>
                  );
                }
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={active}
                    className={sizeClass}
                    onClick={() => onPageSizeChange?.(n)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {showNav ? (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] p-0.5 shadow-sm">
              <NavIconControl
                label="First page"
                disabled={page <= 1}
                href={page > 1 ? hrefForPage(1) : undefined}
                onClick={() => goToPage(1)}
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </NavIconControl>
              <NavIconControl
                label="Previous page"
                disabled={page <= 1}
                href={page > 1 ? hrefForPage(page - 1) : undefined}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </NavIconControl>
            </div>

            <ol className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] px-1 py-0.5 shadow-sm">
              {pageItems.map((item, i) =>
                item === 'ellipsis' ? (
                  <li
                    key={`ellipsis-${i}`}
                    className="flex h-7 w-6 items-center justify-center text-[10px] text-slate-400"
                    aria-hidden
                  >
                    ...
                  </li>
                ) : (
                  <PageNumberControl
                    key={item}
                    page={item}
                    current={page}
                    href={item !== page ? hrefForPage(item) : undefined}
                    onClick={() => goToPage(item)}
                  />
                ),
              )}
            </ol>

            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] p-0.5 shadow-sm">
              <NavIconControl
                label="Next page"
                disabled={page >= totalPages}
                href={page < totalPages ? hrefForPage(page + 1) : undefined}
                onClick={() => goToPage(page + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </NavIconControl>
              <NavIconControl
                label="Last page"
                disabled={page >= totalPages}
                href={page < totalPages ? hrefForPage(totalPages) : undefined}
                onClick={() => goToPage(totalPages)}
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </NavIconControl>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

