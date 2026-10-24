'use client';

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { getSession, signIn } from 'next-auth/react';
import { cn } from '@/lib/cn';

type Props = {
  /** API path including leading slash, e.g. `/time-entries/export` */
  path: string;
  /** Query string without `?` */
  query?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** Button label; defaults to "Excel" in toolbar segment mode */
  label?: string;
  /**
   * - `toolbar`: standalone control for headers
   * - `segment`: inside {@link PageToolbarExports} group
   * - `compact`: tight placement in dense filter rows
   */
  variant?: 'toolbar' | 'segment' | 'compact';
};

export function ExportExcelButton({
  path,
  query,
  disabled,
  className,
  title,
  label,
  variant = 'toolbar',
}: Props) {
  const [busy, setBusy] = useState(false);
  const displayLabel =
    label ?? (variant === 'segment' || variant === 'compact' ? 'Excel' : 'Export Excel');

  const onExport = async () => {
    setBusy(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
      const session = await getSession();
      let token = session?.access_token;
      if (!token) {
        await signIn(undefined, { callbackUrl: '/', redirect: true });
        const again = await getSession();
        token = again?.access_token;
      }
      if (!token) throw new Error('Not signed in');

      const qs = query?.trim() ? `?${query.trim()}` : '';
      const res = await fetch(`${baseUrl}${path}${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status === 401) {
          await signIn(undefined, { callbackUrl: '/', redirect: true });
        }
        throw new Error(text || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition');
      let filename = `export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => void onExport()}
      title={title ?? 'Download spreadsheet (.xlsx)'}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:pointer-events-none disabled:opacity-50',
        variant === 'toolbar' &&
          'rounded-lg border border-slate-200/90 bg-[var(--assessment-surface-container)] px-3.5 py-2 text-sm text-slate-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40',
        variant === 'segment' &&
          'bg-[var(--assessment-surface-container)] px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
        variant === 'compact' &&
          'rounded-lg border border-slate-200/90 bg-[var(--assessment-surface-container)] px-2.5 py-1.5 text-xs text-slate-700 shadow-sm hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-slate-600 dark:bg-slate-900',
        className,
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" aria-hidden />
      ) : (
        <FileSpreadsheet
          className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-500"
          aria-hidden
        />
      )}
      <span>{busy ? 'Exporting...' : displayLabel}</span>
    </button>
  );
}
