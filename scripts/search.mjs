// Full-text search across the bookmark store.
// Usage: node scripts/search.mjs "rust async" [--tag=x] [--author=handle]

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORE = path.join(ROOT, 'data', 'bookmarks.jsonl');

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v = true] = a.replace(/^--/, '').split('=');
      return [k, v];
    }),
);
const terms = argv.filter((a) => !a.startsWith('--')).join(' ').toLowerCase().split(/\s+/).filter(Boolean);

if (!existsSync(STORE)) {
  console.error('No store yet. Run: node scripts/ingest.mjs');
  process.exit(1);
}

const entries = (await readFile(STORE, 'utf8'))
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const results = entries.filter((entry) => {
  if (flags.tag && !entry.tags.includes(flags.tag)) return false;
  if (flags.author && entry.author.handle?.toLowerCase() !== String(flags.author).toLowerCase()) return false;
  if (!terms.length) return true;
  const haystack = `${entry.text} ${entry.author.handle} ${entry.tags.join(' ')} ${entry.links.join(' ')}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
});

for (const entry of results) {
  const date = entry.created_at?.slice(0, 10) ?? '—';
  const tags = entry.tags.length ? ` [${entry.tags.join(', ')}]` : '';
  console.log(`\n\x1b[36m@${entry.author.handle}\x1b[0m · ${date}${tags}`);
  console.log(`  ${entry.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  console.log(`  \x1b[2m${entry.url}\x1b[0m`);
}

console.log(`\n${results.length} / ${entries.length} bookmarks`);
