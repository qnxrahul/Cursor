import { ComposeRequest, JobRecord } from '../types/contracts';
import { UILibrary } from '../library/library';
import { RAGIndex } from '../rag/rag';
export declare class Orchestrator {
    private library;
    private rag;
    private brands;
    private jobs;
    constructor(library: UILibrary, rag: RAGIndex, brands: Map<string, any>);
    compose(req: ComposeRequest): Promise<string>;
    getJob(id: string): JobRecord | undefined;
    private runJob;
}
//# sourceMappingURL=orchestrator.d.ts.map