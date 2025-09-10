"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeElement = synthesizeElement;
function synthesizeElement(schema) {
    const id = `comp_${schema.name}_${Math.random().toString(36).slice(2, 8)}`;
    const content = {
        framework: 'react',
        code: `export function ${schema.name}(props: any){return (<button role="${schema.aria['role'] ?? 'button'}">${schema.name}</button>);}`,
        tokens: schema.baseTokens,
    };
    return {
        id,
        type: 'component',
        name: schema.name,
        content,
        metadata: { schema },
    };
}
//# sourceMappingURL=layer1.js.map