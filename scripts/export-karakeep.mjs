// Convert the normalized bookmark store to Netscape bookmark HTML for Karakeep.
// Usage: node scripts/export-karakeep.mjs [--limit=5] [--out=exports/karakeep-import.html]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const STORE = path.join(ROOT, 'data', 'bookmarks.jsonl');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = true] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const outputPath = path.resolve(ROOT, String(args.out ?? 'exports/karakeep-import.html'));
const limit = args.limit === undefined ? null : Number.parseInt(String(args.limit), 10);

if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit must be a positive integer');
  process.exit(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function titleFor(entry) {
  const text = entry.text.replace(/\s+/g, ' ').trim();
  const handle = entry.author.handle ? `@${entry.author.handle}` : 'X post';
  if (!text) return handle;
  return `${handle}: ${text}`.slice(0, 500);
}

function unixTimestamp(value) {
  const timestamp = Date.parse(value ?? '');
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 1000);
}

async function main() {
  if (!existsSync(STORE)) {
    console.error('No store yet. Run: npm run ingest');
    process.exit(1);
  }

  const entries = (await readFile(STORE, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  const selected = limit === null ? entries : entries.slice(0, limit);
  const bookmarks = selected.flatMap((entry) => {
    const url = safeUrl(entry.url);
    if (!url) return [];

    const addDate = unixTimestamp(entry.created_at);
    const attributes = [
      `HREF="${escapeHtml(url)}"`,
      addDate === null ? null : `ADD_DATE="${addDate}"`,
      entry.tags.length ? `TAGS="${escapeHtml(entry.tags.join(','))}"` : null,
    ].filter(Boolean);

    return [`        <DT><A ${attributes.join(' ')}>${escapeHtml(titleFor(entry))}</A>`];
  });

  const folderDate = Math.floor(Date.now() / 1000);
  const html = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${folderDate}">X Bookmarks</H3>`,
    '    <DL><p>',
    ...bookmarks,
    '    </DL><p>',
    '</DL><p>',
    '',
  ].join('\n');

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);

  const skipped = selected.length - bookmarks.length;
  console.log(`Wrote ${bookmarks.length} bookmarks -> ${path.relative(ROOT, outputPath)}`);
  if (skipped) console.log(`Skipped ${skipped} entries with invalid or unsupported URLs`);
}

await main();
