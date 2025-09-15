import { Artifact, MutationDSL } from '../types/contracts';

export function applyGenerativeMutations(artifact: Artifact, dsl: MutationDSL): Artifact {
  const updated = { ...artifact, content: JSON.parse(JSON.stringify(artifact.content)) };
  for (const op of dsl.ops) {
    if (op.type === 'copyEdit' && op.path === 'props.children') {
      (updated.content as any).code = String((updated.content as any).code).replace(/>(.*?)</, `>${op.value}<`);
    }
    if (op.type === 'setToken' && op.path.startsWith('baseTokens')) {
      (updated.content as any).tokens = { ...(updated.content as any).tokens, [op.path.split('.').pop() as string]: op.value };
    }
  }
  updated.metadata = { ...(updated.metadata || {}), mutations: dsl };
  return updated;
}
