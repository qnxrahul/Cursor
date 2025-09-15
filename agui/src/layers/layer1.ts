import { Artifact, ElementSchema } from '../types/contracts';

export function synthesizeElement(schema: ElementSchema): Artifact {
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
