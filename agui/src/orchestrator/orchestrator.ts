import { v4 as uuidv4 } from 'uuid';
import { Artifact, ComposeRequest, JobRecord } from '../types/contracts';
import { UILibrary } from '../library/library';
import { synthesizeElement } from '../layers/layer1';
import { applyGenerativeMutations } from '../layers/layer2';
import { optimizeArtifacts } from '../layers/layer3';
import { evaluateArtifacts } from '../evaluator/evaluator';
import { buildContextPack, RAGIndex } from '../rag/rag';

export class Orchestrator {
  private jobs = new Map<string, JobRecord>();
  constructor(private library: UILibrary, private rag: RAGIndex, private brands: Map<string, any>) {}

  async compose(req: ComposeRequest): Promise<string> {
    const id = uuidv4();
    const job: JobRecord = { id, status: 'queued', request: req, artifacts: [] };
    this.jobs.set(id, job);
    this.runJob(id).catch((e) => console.error('Job failed', e));
    return id;
  }

  getJob(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  private async runJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'running';
    const { brandId, intent } = job.request;
    const brand = this.brands.get(brandId);
    const context = buildContextPack(this.rag, brand, intent);

    // Reuse-first search
    const candidates = this.library.search({ brandId, query: intent, k: 3 });
    const reused = candidates.filter((c) => c.similarity > 0.2).map((c) => c.item.artifact);

    const artifacts: Artifact[] = [...reused];

    // Gap detection: if nothing suitable, synthesize one button and a card as a demo
    if (artifacts.length === 0) {
      const button = synthesizeElement({
        name: 'Button',
        propsSchema: { variant: ['primary', 'secondary'] },
        states: ['default', 'hover', 'focus', 'disabled'],
        aria: { role: 'button' },
        interactionModel: ['click', 'keyboardEnter', 'keyboardSpace'],
        responsiveRules: { minTapTarget: 44, breakpoints: ['sm', 'md', 'lg'] },
        baseTokens: { color: '{brand.color.primary.600}', radius: '{brand.radius.sm}' },
        codeArtifacts: { template: 'react-ts', style: 'css-vars' },
        tests: { unit: true, visual: true, a11y: true },
      });
      artifacts.push(button);
    }

    // Layer 2: trivial customization demo
    const customized = artifacts.map((a) =>
      applyGenerativeMutations(a, {
        target: a.id,
        ops: [
          { type: 'copyEdit', path: 'props.children', value: 'Continue' },
          { type: 'setToken', path: 'baseTokens.color', value: '{brand.color.primary.700}' },
        ],
        constraints: ['a11y.pass', 'token.allowlist', 'contrast>=4.5', 'bundleDelta<=5kb'],
      })
    );

    // Layer 3: optimize
    const { artifacts: optimized, report } = optimizeArtifacts(customized);

    // Evaluate
    const evalReport = evaluateArtifacts(optimized);

    job.artifacts = optimized.concat([
      { id: 'optimizationReport', type: 'report', name: 'optimization', content: report },
      { id: 'evaluationReport', type: 'report', name: 'evaluation', content: evalReport },
    ]);
    job.status = 'succeeded';
  }
}
