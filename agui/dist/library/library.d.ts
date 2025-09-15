import { Artifact } from '../types/contracts';
export interface LibraryItem {
    id: string;
    brandId: string;
    framework: 'react';
    type: 'component' | 'page';
    name: string;
    textIndex: number[];
    artifact: Artifact;
}
export declare class UILibrary {
    private items;
    ingest(item: Omit<LibraryItem, 'textIndex'> & {
        indexText?: string;
    }): void;
    search(params: {
        brandId: string;
        query: string;
        framework?: 'react';
        k?: number;
    }): Array<{
        id: string;
        similarity: number;
        item: LibraryItem;
    }>;
}
//# sourceMappingURL=library.d.ts.map