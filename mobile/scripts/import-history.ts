import { readFile, writeFile } from 'node:fs/promises';
import { parseSnapshot } from '../src/history';
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run import-history -- /absolute/path/to/setwise-export.json');
const input = JSON.parse(await readFile(path, 'utf8'));
const snapshot = parseSnapshot({ ...input, source: 'Setwise', syncedAt: new Date().toISOString() });
await writeFile(new URL('../src/data/history.private.json', import.meta.url), JSON.stringify(snapshot, null, 2));
console.info(`Imported ${snapshot.sessions.length} completed workouts into the private mobile snapshot. No journal changes.`);
