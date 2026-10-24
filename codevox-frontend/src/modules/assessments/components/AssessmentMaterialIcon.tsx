import type { CSSProperties } from 'react';

export function AssessmentMaterialIcon(props: {
  name: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}) {
  const style: CSSProperties = {
    ...(props.size != null ? { fontSize: props.size } : {}),
    ...props.style,
  };

  return (
    <span
      className={`material-symbols-outlined ${props.className ?? ''}`}
      style={Object.keys(style).length ? style : undefined}
    >
      {props.name}
    </span>
  );
}
