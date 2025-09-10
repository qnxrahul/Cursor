import { Artifact } from '../types/contracts';
export interface OptimizationReport {
    beforeMetrics: Record<string, number>;
    afterMetrics: Record<string, number>;
    diffs: Record<string, number>;
}
export declare function optimizeArtifacts(artifacts: Artifact[]): {
    artifacts: Artifact[];
    report: OptimizationReport;
};
//# sourceMappingURL=layer3.d.ts.map