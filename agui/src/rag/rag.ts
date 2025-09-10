import cosine from 'cosine-similarity';
import { BrandProfile } from '../types/contracts';

export interface IndexedDoc {
  id: string;
  brandId: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

// Tiny stub embedding: bag-of-words to vector with fixed vocab
const vocab = new Map<string, number>();
function getVector(text: string): number[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const vec: number[] = [];
  tokens.forEach((t) => {
    if (!vocab.has(t)) vocab.set(t, vocab.size);
    const idx = vocab.get(t)!;
    vec[idx] = (vec[idx] || 0) + 1;
  });
  return vec;
}

function padToSame(a: number[], b: number[]): [number[], number[]] {
  const len = Math.max(a.length, b.length);
  return [Array.from({ length: len }, (_, i) => a[i] || 0), Array.from({ length: len }, (_, i) => b[i] || 0)];
}

export class RAGIndex {
  private docs: IndexedDoc[] = [];

  ingest(docs: Array<Omit<IndexedDoc, 'embedding'>>): void {
    docs.forEach((d) => {
      this.docs.push({ ...d, embedding: getVector(d.text) });
    });
  }

  search(brandId: string, query: string, k = 5): IndexedDoc[] {
    const q = getVector(query);
    const scored = this.docs
      .filter((d) => d.brandId === brandId)
      .map((d) => {
        const [a, b] = padToSame(q, d.embedding);
        return { doc: d, score: cosine(a, b) || 0 };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, k)
      .map((s) => s.doc);
    return scored;
  }
}

export interface ContextPack {
  brand: BrandProfile;
  guidance: IndexedDoc[];
}

export function buildContextPack(index: RAGIndex, brand: BrandProfile, intent: string): ContextPack {
  const guidance = index.search(brand.brandId, intent, 5);
  return { brand, guidance };
}
