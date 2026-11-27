import { mkdir, access, writeFile } from 'node:fs/promises';
const target = new URL('../src/data/history.private.json', import.meta.url);
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
try { await access(target); } catch {
  await writeFile(target, JSON.stringify({ source: 'Setwise', syncedAt: null, sessions: [] }, null, 2));
}
