import { BrandProfile } from '../types/contracts';
export interface IndexedDoc {
    id: string;
    brandId: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
}
export declare class RAGIndex {
    private docs;
    ingest(docs: Array<Omit<IndexedDoc, 'embedding'>>): void;
    search(brandId: string, query: string, k?: number): IndexedDoc[];
}
export interface ContextPack {
    brand: BrandProfile;
    guidance: IndexedDoc[];
}
export declare function buildContextPack(index: RAGIndex, brand: BrandProfile, intent: string): ContextPack;
//# sourceMappingURL=rag.d.ts.map