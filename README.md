# tech-watch

Local catalog of my X (Twitter) bookmarks.

Extraction is done in the browser with [twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter)
(no API key, no cost, no ~800-bookmark cap). This repo normalizes those exports into a
deduplicated store I can search, tag, and browse.

## One-time browser setup

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Install the script:
   https://github.com/prinsss/twitter-web-exporter/releases/latest/download/twitter-web-exporter.user.js
3. Open https://x.com/i/bookmarks — a floating control panel appears on the left.

## Each export

1. **Scroll to the very bottom of the bookmarks page.** The script can only capture what the
   web app actually loads, so anything you haven't scrolled past is not in the export.
2. Open the panel → Bookmarks module → Export.
3. Format **JSON**, and tick **Include all metadata** — this preserves the raw
   `legacy.created_at` and the expanded (non-`t.co`) URLs that `ingest.mjs` prefers.
4. Drop the downloaded `.json` into `raw/`.

## Then

```sh
npm run ingest    # raw/*.json -> data/bookmarks.jsonl (deduplicated, idempotent)
npm run report    # -> index.md
npm run search -- "rust async"
```

## Store

`data/bookmarks.jsonl` — one JSON object per line, newest first, keyed by tweet id.

Re-ingesting is safe and repeatable: engagement metrics are refreshed from the newest export,
while `tags`, `notes`, and `first_seen` are preserved. Curate by editing those fields directly
in the JSONL; nothing you write there is overwritten.

### Options

```sh
node scripts/report.mjs --by=author         # group by author instead of month
node scripts/report.mjs --by=tag
node scripts/report.mjs --since=2026-01-01
node scripts/search.mjs --tag=rust
node scripts/search.mjs --author=pgsql_hacker
```

`raw/*.json` is gitignored — the exports are disposable, the store is the artifact.
