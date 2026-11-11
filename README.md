# x-karakeep-sync

Local catalog and automatic Karakeep archive of my X (Twitter) bookmarks.

The normal workflow reads bookmarks through the official X API, keeps a deduplicated local
store, and copies new links to Karakeep. It is append-only: removing an X bookmark never
deletes its archived copy. Browser exports remain available as a recovery path.

## Automatic X → Karakeep sync

### 1. Create the X app

In the [X Developer Console](https://developer.x.com/):

1. Create a project/app and enable OAuth 2.0.
2. Choose **Native App** (a public PKCE client).
3. Set the callback URI exactly to `http://127.0.0.1:8787/callback`.
4. Give it read access. The authorization flow requests only `bookmark.read`, `tweet.read`,
   `users.read`, and `offline.access`.
5. Copy the OAuth 2.0 **Client ID**. An app bearer token is not sufficient for private
   bookmarks.

X bills bookmark reads as owned reads. The sync fetches ten bookmarks per page by default and
stops as soon as it reaches a bookmark already in the local store.

### 2. Configure and authorize

Find the target Karakeep list ID at the end of its URL, then run:

```sh
npm run sync:setup
npm run sync:x-auth
```

Setup stores the non-secret settings under `.sync/`. The Karakeep key and rotating X OAuth
tokens are stored in macOS Keychain under `app.tech-watch.sync` (the project's original name,
kept so existing installs keep working); they are never committed. Secrets are written through
`security`'s standard input, never as command-line arguments.

### 3. Test and enable the daily run

```sh
npm run sync -- --dry-run       # calls X, but writes nothing
npm run sync                    # first live sync
npm run sync:install            # every day at 08:15 local time
npm run sync:status
```

Choose a different time when installing if needed:

```sh
npm run sync:install -- --hour=18 --minute=30
```

Scheduler output is written under `.sync/logs/`. To remove only the schedule (not bookmarks or
credentials), run `npm run sync:uninstall`.

The sync is safe to retry. Karakeep returns the existing bookmark for duplicate URLs, list
attachment is idempotent, and interrupted uploads remain queued in `.sync/state.json`.

## Manual recovery import

### One-time browser setup

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Install the script:
   https://github.com/prinsss/twitter-web-exporter/releases/latest/download/twitter-web-exporter.user.js
3. Open https://x.com/i/bookmarks — a floating control panel appears on the left.

### Each export

1. **Scroll to the very bottom of the bookmarks page.** The script can only capture what the
   web app actually loads, so anything you haven't scrolled past is not in the export.
2. Open the panel → Bookmarks module → Export.
3. Format **JSON**, and tick **Include all metadata** — this preserves the raw
   `legacy.created_at` and the expanded (non-`t.co`) URLs that `ingest.mjs` prefers.
4. Drop the downloaded `.json` into `raw/`.

### Import and inspect

```sh
npm run ingest    # raw/*.json -> data/bookmarks.jsonl (deduplicated, idempotent)
npm run report    # -> index.md
npm run search -- "rust async"
npm run export:karakeep -- --limit=5 --out=exports/karakeep-test.html
```

The Karakeep export uses Netscape bookmark HTML, which can be uploaded from
Karakeep's Settings → Import/Export page. Omit `--limit=5` to export the full store.

## Store

`data/bookmarks.jsonl` — one JSON object per line, newest first, keyed by tweet id. This file
and the generated `index.md` contain private bookmark data and are intentionally gitignored.

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

`raw/*.json`, `data/*.jsonl`, `index.md`, `.sync/`, and `exports/*.html` are all gitignored so
the repository can be public without publishing bookmark data or local configuration.

## License

[MIT](LICENSE)
