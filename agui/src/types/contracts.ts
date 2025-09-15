export type Breakpoint = 'sm' | 'md' | 'lg';

export interface ElementSchema {
  name: string;
  propsSchema: Record<string, unknown>;
  states: string[];
  aria: Record<string, unknown>;
  interactionModel: string[];
  responsiveRules: {
    minTapTarget: number;
    breakpoints: Breakpoint[];
  };
  baseTokens: Record<string, unknown>;
  codeArtifacts: {
    template: 'react-ts';
    style: 'css-vars';
  };
  tests: {
    unit: boolean;
    visual: boolean;
    a11y: boolean;
  };
}

export interface BrandProfile {
  brandId: string;
  typography: {
    scale: string[];
    fontFamily: string;
  };
  colors: Record<string, unknown>;
  spacing: number[];
  a11y: {
    wcag: string;
    minContrast: number;
    tapTarget: number;
  };
  tone: {
    style: string;
    doNots: string[];
  };
  tokenAllowlist: string[];
}

export interface MutationOperation {
  type: 'setToken' | 'adjustSpacing' | 'copyEdit';
  path: string;
  value?: unknown;
  delta?: number;
}

export interface MutationDSL {
  target: string;
  ops: MutationOperation[];
  constraints: string[];
}

export type ArtifactType = 'component' | 'page' | 'report';

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

export interface ComposeRequest {
  intent: string;
  brandId: string;
  constraints?: Record<string, unknown>;
  seedLibraryIds?: string[];
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  id: string;
  status: JobStatus;
  request: ComposeRequest;
  artifacts: Artifact[];
  error?: string;
}
