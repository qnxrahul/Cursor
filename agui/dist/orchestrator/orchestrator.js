"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const uuid_1 = require("uuid");
const layer1_1 = require("../layers/layer1");
const layer2_1 = require("../layers/layer2");
const layer3_1 = require("../layers/layer3");
const evaluator_1 = require("../evaluator/evaluator");
const rag_1 = require("../rag/rag");
class Orchestrator {
    constructor(library, rag, brands) {
        this.library = library;
        this.rag = rag;
        this.brands = brands;
        this.jobs = new Map();
    }
    async compose(req) {
        const id = (0, uuid_1.v4)();
        const job = { id, status: 'queued', request: req, artifacts: [] };
        this.jobs.set(id, job);
        this.runJob(id).catch((e) => console.error('Job failed', e));
        return id;
    }
    getJob(id) {
        return this.jobs.get(id);
    }
    async runJob(id) {
        const job = this.jobs.get(id);
        if (!job)
            return;
        job.status = 'running';
        const { brandId, intent } = job.request;
        const brand = this.brands.get(brandId);
        const context = (0, rag_1.buildContextPack)(this.rag, brand, intent);
        // Reuse-first search
        const candidates = this.library.search({ brandId, query: intent, k: 3 });
        const reused = candidates.filter((c) => c.similarity > 0.2).map((c) => c.item.artifact);
        const artifacts = [...reused];
        // Gap detection: if nothing suitable, synthesize one button and a card as a demo
        if (artifacts.length === 0) {
            const button = (0, layer1_1.synthesizeElement)({
                name: 'Button',
                propsSchema: { variant: ['primary', 'secondary'] },
                states: ['default', 'hover', 'focus', 'disabled'],
                aria: { role: 'button' },
                interactionModel: ['click', 'keyboardEnter', 'keyboardSpace'],
                responsiveRules: { minTapTarget: 44, breakpoints: ['sm', 'md', 'lg'] },
                baseTokens: { color: '{brand.color.primary.600}', radius: '{brand.radius.sm}' },
                codeArtifacts: { template: 'react-ts', style: 'css-vars' },
                tests: { unit: true, visual: true, a11y: true },
            });
            artifacts.push(button);
        }
        // Layer 2: trivial customization demo
        const customized = artifacts.map((a) => (0, layer2_1.applyGenerativeMutations)(a, {
            target: a.id,
            ops: [
                { type: 'copyEdit', path: 'props.children', value: 'Continue' },
                { type: 'setToken', path: 'baseTokens.color', value: '{brand.color.primary.700}' },
            ],
            constraints: ['a11y.pass', 'token.allowlist', 'contrast>=4.5', 'bundleDelta<=5kb'],
        }));
        // Layer 3: optimize
        const { artifacts: optimized, report } = (0, layer3_1.optimizeArtifacts)(customized);
        // Evaluate
        const evalReport = (0, evaluator_1.evaluateArtifacts)(optimized);
        job.artifacts = optimized.concat([
            { id: 'optimizationReport', type: 'report', name: 'optimization', content: report },
            { id: 'evaluationReport', type: 'report', name: 'evaluation', content: evalReport },
        ]);
        job.status = 'succeeded';
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map