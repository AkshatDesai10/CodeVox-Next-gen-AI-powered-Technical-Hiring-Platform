'use client';

export function McqEditor(props: {
  options: Array<{ label: string; text: string }>;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="workspace-code-editor-bg flex h-full min-h-0 flex-col p-6">
      <h3 className="mb-4 text-lg font-semibold text-white">Select the correct answer</h3>
      <div className="space-y-3">
        {props.options.length ? (
          props.options.map((opt) => (
            <label
              key={opt.label}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                props.value === opt.label
                  ? 'border-[var(--assessment-primary)] bg-[#1a2b55]'
                  : 'border-white/10 bg-[#1e1e1e] hover:border-white/20'
              }`}
            >
              <input
                type="radio"
                name="mcq"
                value={opt.label}
                checked={props.value === opt.label}
                disabled={props.readOnly}
                onChange={() => props.onChange(opt.label)}
                className="mt-1"
              />
              <div>
                <span className="font-bold text-[var(--assessment-primary-fixed,#dbeafe)]">
                  {opt.label}.
                </span>
                <span className="ml-2 text-white/90">{opt.text}</span>
              </div>
            </label>
          ))
        ) : (
          <p className="text-white/60">No options configured for this MCQ.</p>
        )}
      </div>
    </div>
  );
}
