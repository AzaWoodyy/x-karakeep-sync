// Render the JSONL store as a browsable markdown catalog.
// Usage: node scripts/report.mjs [--by=month|author|tag] [--tag=x] [--since=YYYY-MM-DD]

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORE = path.join(ROOT, 'data', 'bookmarks.jsonl');
const OUT = path.join(ROOT, 'index.md');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = true] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const groupBy = args.by ?? 'month';

function bucket(entry) {
  if (groupBy === 'author') return entry.author.handle ?? 'unknown';
  if (groupBy === 'tag') return entry.tags.length ? entry.tags.join(', ') : 'untagged';
  return entry.created_at ? entry.created_at.slice(0, 7) : 'undated';
}

function excerpt(text, max = 220) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function main() {
  if (!existsSync(STORE)) {
    console.error('No store yet. Run: node scripts/ingest.mjs');
    process.exit(1);
  }

  let entries = (await readFile(STORE, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  if (args.tag) entries = entries.filter((e) => e.tags.includes(args.tag));
  if (args.since) entries = entries.filter((e) => (e.created_at ?? '') >= args.since);

  const groups = new Map();
  for (const entry of entries) {
    const key = bucket(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const tagCounts = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const lines = [
    '# Tech watch — X bookmarks',
    '',
    `${entries.length} bookmarks · grouped by ${groupBy} · generated ${new Date().toISOString().slice(0, 10)}`,
    '',
  ];

  if (tagCounts.size) {
    const tags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, n]) => `\`${tag}\` (${n})`)
      .join(' · ');
    lines.push(`**Tags:** ${tags}`, '');
  }

  for (const key of [...groups.keys()].sort().reverse()) {
    const items = groups.get(key);
    lines.push(`## ${key} (${items.length})`, '');

    for (const entry of items) {
      const handle = entry.author.handle ? `@${entry.author.handle}` : 'unknown';
      const date = entry.created_at?.slice(0, 10) ?? '—';
      lines.push(`- **[${handle}](${entry.url})** · ${date}${entry.tags.length ? ` · ${entry.tags.map((t) => `\`${t}\``).join(' ')}` : ''}`);
      lines.push(`  > ${excerpt(entry.text)}`);
      for (const link of entry.links.slice(0, 3)) lines.push(`  - ${link}`);
      if (entry.notes) lines.push(`  - _${entry.notes}_`);
      lines.push('');
    }
  }

  await writeFile(OUT, lines.join('\n'));
  console.log(`Wrote ${entries.length} bookmarks in ${groups.size} groups -> ${path.relative(ROOT, OUT)}`);
}

await main();
