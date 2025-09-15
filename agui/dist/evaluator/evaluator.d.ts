import { Artifact } from '../types/contracts';
export interface EvaluationReport {
    accessibility: {
        violations: number;
        contrastOK: boolean;
    };
    brand: {
        tokenAdherence: number;
        violations: number;
    };
    performance: {
        bundleDeltaKb: number;
    };
}
export declare function evaluateArtifacts(artifacts: Artifact[]): EvaluationReport;
//# sourceMappingURL=evaluator.d.ts.map