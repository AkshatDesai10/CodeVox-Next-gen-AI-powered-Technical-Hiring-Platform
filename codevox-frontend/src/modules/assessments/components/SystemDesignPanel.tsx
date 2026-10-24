'use client';

export function SystemDesignPanel(props: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="workspace-code-editor-bg flex h-full min-h-0 flex-col">
      <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
        System Design Response
      </div>
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-2">
        <div>
          <label className="mb-2 block text-xs font-bold uppercase text-white/50">
            Architecture / Diagram (Mermaid or description)
          </label>
          <textarea
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            readOnly={props.readOnly}
            placeholder="Describe components, data flow, scaling strategy..."
            className="h-full min-h-[280px] w-full resize-none rounded-lg border border-white/10 bg-[#1e1e1e] p-4 font-mono text-sm text-white/90"
          />
        </div>
        <div className="rounded-lg border border-dashed border-white/20 p-4 text-sm text-white/60">
          <p className="font-semibold text-white/80">Evaluation focus</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>Scalability and availability</li>
            <li>Cost and operational trade-offs</li>
            <li>Security boundaries</li>
            <li>Data consistency model</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
