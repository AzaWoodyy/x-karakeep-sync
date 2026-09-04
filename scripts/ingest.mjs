// Normalize twitter-web-exporter JSON dumps into a deduplicated JSONL store.
// Idempotent: re-ingesting the same export preserves manual `tags` and `notes`,
// and refreshes engagement metrics on tweets already in the store.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw');
const STORE = path.join(ROOT, 'data', 'bookmarks.jsonl');

const URL_RE = /https?:\/\/[^\s]+/g;

// Twitter's legacy format: "Wed Oct 10 20:19:24 +0000 2018"
function parseDate(record) {
  const raw = record.metadata?.legacy?.created_at;
  const parsed = raw ? Date.parse(raw) : Date.parse(record.created_at ?? '');
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// The exporter drops a t.co link for its own media; those aren't outbound links.
function extractLinks(record) {
  const entities = record.metadata?.legacy?.entities;
  if (entities?.urls) {
    return entities.urls.map((u) => u.expanded_url).filter(Boolean);
  }
  return (record.full_text ?? '').match(URL_RE) ?? [];
}

function normalize(record, seenAt) {
  const id = String(record.id ?? record.metadata?.rest_id ?? '');
  if (!id) return null;

  return {
    id,
    url: record.url ?? `https://x.com/${record.screen_name}/status/${id}`,
    author: {
      handle: record.screen_name ?? null,
      name: record.name ?? null,
      id: record.user_id ?? null,
    },
    created_at: parseDate(record),
    text: record.full_text ?? '',
    links: extractLinks(record),
    media: Array.isArray(record.media) ? record.media : [],
    metrics: {
      likes: record.favorite_count ?? null,
      retweets: record.retweet_count ?? null,
      replies: record.reply_count ?? null,
      quotes: record.quote_count ?? null,
      bookmarks: record.bookmark_count ?? null,
      views: record.views_count ?? null,
    },
    thread: {
      in_reply_to: record.in_reply_to ?? null,
      quoted: record.quoted_status ?? null,
      retweeted: record.retweeted_status ?? null,
    },
    first_seen: seenAt,
    tags: [],
    notes: '',
  };
}

async function loadStore() {
  if (!existsSync(STORE)) return new Map();
  const text = await readFile(STORE, 'utf8');
  const entries = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  return new Map(entries.map((entry) => [entry.id, entry]));
}

async function main() {
  const store = await loadStore();
  const before = store.size;
  const seenAt = new Date().toISOString();

  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    console.error(`No .json exports found in ${RAW_DIR}`);
    process.exit(1);
  }

  let scanned = 0;
  let refreshed = 0;

  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(RAW_DIR, file), 'utf8'));
    const records = Array.isArray(payload) ? payload : [payload];

    for (const record of records) {
      const entry = normalize(record, seenAt);
      if (!entry) continue;
      scanned++;

      const existing = store.get(entry.id);
      if (existing) {
        // Manual curation wins; everything else is refreshed from the export.
        store.set(entry.id, {
          ...entry,
          first_seen: existing.first_seen,
          tags: existing.tags,
          notes: existing.notes,
        });
        refreshed++;
      } else {
        store.set(entry.id, entry);
      }
    }
  }

  const sorted = [...store.values()].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
  await writeFile(STORE, sorted.map((e) => JSON.stringify(e)).join('\n') + '\n');

  console.log(`Files ingested : ${files.length}`);
  console.log(`Records scanned: ${scanned}`);
  console.log(`New bookmarks  : ${store.size - before}`);
  console.log(`Refreshed      : ${refreshed}`);
  console.log(`Store total    : ${store.size} -> ${path.relative(ROOT, STORE)}`);
}

await main();
