"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAGIndex = void 0;
exports.buildContextPack = buildContextPack;
const cosine_similarity_1 = __importDefault(require("cosine-similarity"));
// Tiny stub embedding: bag-of-words to vector with fixed vocab
const vocab = new Map();
function getVector(text) {
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const vec = [];
    tokens.forEach((t) => {
        if (!vocab.has(t))
            vocab.set(t, vocab.size);
        const idx = vocab.get(t);
        vec[idx] = (vec[idx] || 0) + 1;
    });
    return vec;
}
function padToSame(a, b) {
    const len = Math.max(a.length, b.length);
    return [Array.from({ length: len }, (_, i) => a[i] || 0), Array.from({ length: len }, (_, i) => b[i] || 0)];
}
class RAGIndex {
    constructor() {
        this.docs = [];
    }
    ingest(docs) {
        docs.forEach((d) => {
            this.docs.push({ ...d, embedding: getVector(d.text) });
        });
    }
    search(brandId, query, k = 5) {
        const q = getVector(query);
        const scored = this.docs
            .filter((d) => d.brandId === brandId)
            .map((d) => {
            const [a, b] = padToSame(q, d.embedding);
            return { doc: d, score: (0, cosine_similarity_1.default)(a, b) || 0 };
        })
            .sort((x, y) => y.score - x.score)
            .slice(0, k)
            .map((s) => s.doc);
        return scored;
    }
}
exports.RAGIndex = RAGIndex;
function buildContextPack(index, brand, intent) {
    const guidance = index.search(brand.brandId, intent, 5);
    return { brand, guidance };
}
//# sourceMappingURL=rag.js.map