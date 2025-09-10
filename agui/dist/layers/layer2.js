"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyGenerativeMutations = applyGenerativeMutations;
function applyGenerativeMutations(artifact, dsl) {
    const updated = { ...artifact, content: JSON.parse(JSON.stringify(artifact.content)) };
    for (const op of dsl.ops) {
        if (op.type === 'copyEdit' && op.path === 'props.children') {
            updated.content.code = String(updated.content.code).replace(/>(.*?)</, `>${op.value}<`);
        }
        if (op.type === 'setToken' && op.path.startsWith('baseTokens')) {
            updated.content.tokens = { ...updated.content.tokens, [op.path.split('.').pop()]: op.value };
        }
    }
    updated.metadata = { ...(updated.metadata || {}), mutations: dsl };
    return updated;
}
//# sourceMappingURL=layer2.js.map