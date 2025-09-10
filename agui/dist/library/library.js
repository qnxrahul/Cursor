"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UILibrary = void 0;
const cosine_similarity_1 = __importDefault(require("cosine-similarity"));
const vocab = new Map();
function vectorize(text) {
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
function pad(a, b) {
    const len = Math.max(a.length, b.length);
    return [Array.from({ length: len }, (_, i) => a[i] || 0), Array.from({ length: len }, (_, i) => b[i] || 0)];
}
class UILibrary {
    constructor() {
        this.items = [];
    }
    ingest(item) {
        const text = item.indexText ?? `${item.name} ${JSON.stringify(item.artifact.content)}`;
        this.items.push({ ...item, textIndex: vectorize(text) });
    }
    search(params) {
        const { brandId, query, k = 5 } = params;
        const q = vectorize(query);
        const scored = this.items
            .filter((i) => i.brandId === brandId)
            .map((i) => {
            const [a, b] = pad(q, i.textIndex);
            return { id: i.id, similarity: (0, cosine_similarity_1.default)(a, b) || 0, item: i };
        })
            .sort((x, y) => y.similarity - x.similarity)
            .slice(0, k);
        return scored;
    }
}
exports.UILibrary = UILibrary;
//# sourceMappingURL=library.js.map