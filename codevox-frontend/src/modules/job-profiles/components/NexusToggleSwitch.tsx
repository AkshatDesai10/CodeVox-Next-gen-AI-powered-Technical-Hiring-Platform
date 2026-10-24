'use client';

export function NexusToggleSwitch(props: {
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
      className="nexus-switch"
    >
      <span className="nexus-switch-thumb" />
    </button>
  );
}
