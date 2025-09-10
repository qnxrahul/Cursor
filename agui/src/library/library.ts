import { Artifact } from '../types/contracts';
import cosine from 'cosine-similarity';

export interface LibraryItem {
  id: string;
  brandId: string;
  framework: 'react';
  type: 'component' | 'page';
  name: string;
  textIndex: number[];
  artifact: Artifact;
}

const vocab = new Map<string, number>();
function vectorize(text: string): number[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const vec: number[] = [];
  tokens.forEach((t) => {
    if (!vocab.has(t)) vocab.set(t, vocab.size);
    const idx = vocab.get(t)!;
    vec[idx] = (vec[idx] || 0) + 1;
  });
  return vec;
}

function pad(a: number[], b: number[]): [number[], number[]] {
  const len = Math.max(a.length, b.length);
  return [Array.from({ length: len }, (_, i) => a[i] || 0), Array.from({ length: len }, (_, i) => b[i] || 0)];
}

export class UILibrary {
  private items: LibraryItem[] = [];

  ingest(item: Omit<LibraryItem, 'textIndex'> & { indexText?: string }): void {
    const text = item.indexText ?? `${item.name} ${JSON.stringify(item.artifact.content)}`;
    this.items.push({ ...item, textIndex: vectorize(text) });
  }

  search(params: { brandId: string; query: string; framework?: 'react'; k?: number }): Array<{ id: string; similarity: number; item: LibraryItem }>{
    const { brandId, query, k = 5 } = params;
    const q = vectorize(query);
    const scored = this.items
      .filter((i) => i.brandId === brandId)
      .map((i) => {
        const [a, b] = pad(q, i.textIndex);
        return { id: i.id, similarity: cosine(a, b) || 0, item: i };
      })
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, k);
    return scored;
  }
}
