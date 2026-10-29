'use client';

export function CodeVoxToggleSwitch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      id={props.id}
      role="switch"
      aria-checked={props.checked}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="codevox-switch"
    >
      <span className="codevox-switch-thumb" />
    </button>
  );
}
