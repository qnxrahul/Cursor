import express, { Request, Response } from 'express';
import { Orchestrator } from './orchestrator/orchestrator';
import { UILibrary } from './library/library';
import { RAGIndex } from './rag/rag';
import { ComposeRequest } from './types/contracts';

const app = express();
app.use(express.json());

// Demo in-memory data
const brands = new Map<string, any>();
brands.set('acme', {
  brandId: 'acme',
  typography: { scale: ['12', '14', '16', '20', '24'], fontFamily: 'Inter' },
  colors: { primary: { 600: '#3366FF', 700: '#254EDB' }, neutral: {} },
  spacing: [4, 8, 12, 16, 24, 32],
  a11y: { wcag: '2.2', minContrast: 4.5, tapTarget: 44 },
  tone: { style: 'confident, concise, friendly', doNots: ['jargon'] },
  tokenAllowlist: ['{brand.*}'],
});

const rag = new RAGIndex();
rag.ingest([
  { id: 'g1', brandId: 'acme', text: 'Buttons use primary 600 on light scheme and 700 on hover' },
  { id: 'g2', brandId: 'acme', text: 'Use Inter typography and spacing scale 4,8,12,16' },
]);

const library = new UILibrary();

const orchestrator = new Orchestrator(library, rag, brands);

app.post('/compose', async (req: Request, res: Response) => {
  const body = req.body as ComposeRequest;
  if (!body?.intent || !body?.brandId) return res.status(400).json({ error: 'intent and brandId required' });
  const jobId = await orchestrator.compose(body);
  res.json({ jobId });
});

app.get('/jobs/:id', (req: Request<{ id: string }>, res: Response) => {
  const job = orchestrator.getJob(req.params.id as string);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.get('/library/search', (req: Request, res: Response) => {
  const { q, brandId } = req.query as any;
  if (!q || !brandId) return res.status(400).json({ error: 'q and brandId required' });
  const results = library.search({ brandId, query: q });
  res.json({ matches: results.map((r) => ({ id: r.id, similarity: r.similarity, name: r.item.name })) });
});

app.get('/guidance/search', (req: Request, res: Response) => {
  const { q, brandId } = req.query as any;
  if (!q || !brandId) return res.status(400).json({ error: 'q and brandId required' });
  const results = rag.search(brandId, q, 5);
  res.json({ answers: results.map((d) => d.text), sources: results.map((d) => d.id) });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`AG UI sample server listening on http://localhost:${port}`);
});
