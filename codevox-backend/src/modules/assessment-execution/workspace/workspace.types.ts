export type WorkspaceFileNode = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileNode[];
};

export type WorkspaceSession = {
  candidateAssessmentId: string;
  language: string;
  image: string;
  workDir: string;
  containerName: string;
  entryFile: string;
  createdAt: number;
  lastActiveAt: number;
};

export type WorkspaceProvisionResult = {
  candidateAssessmentId: string;
  status: 'ready' | 'error';
  containerName: string;
  entryFile: string;
  files: WorkspaceFileNode[];
};

export type WorkspaceFileMap = Record<string, string>;
