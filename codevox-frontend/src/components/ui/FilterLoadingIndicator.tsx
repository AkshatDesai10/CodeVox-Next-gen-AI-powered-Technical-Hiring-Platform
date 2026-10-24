import { Loader2 } from 'lucide-react';

export function FilterLoadingIndicator(props: { label?: string }) {
  return (
    <span className="ml-1 inline-flex items-center gap-1 text-[9px] font-medium text-brand">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {props.label ?? 'Updating...'}
    </span>
  );
}
