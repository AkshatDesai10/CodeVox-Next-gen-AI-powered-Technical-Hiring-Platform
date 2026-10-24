import type { ReactNode } from 'react';
import { AssessmentShellClient } from './AssessmentShellClient';

export function AssessmentShell(props: { children: ReactNode; userName?: string }) {
  return <AssessmentShellClient userName={props.userName}>{props.children}</AssessmentShellClient>;
}
