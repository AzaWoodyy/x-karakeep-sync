import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  ROOT,
  STATE_PATH,
  STORE_PATH,
  fetchJson,
  getKarakeepApiKey,
  getXAccessToken,
  parseArgs,
  readConfig,
  readJson,
  writeJsonAtomic,
} from './lib/sync-common.mjs';
import { mergeBookmarks, normalizeXPage, titleForKarakeep } from './lib/x-bookmarks.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
let config;
try {
  config = await readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const pageSize = Number.parseInt(String(args['page-size'] ?? config.sync.pageSize), 10);
const maxPages = Number.parseInt(String(args['max-pages'] ?? config.sync.maxPages), 10);

if (!config.x.clientId || !config.x.userId) {
  console.error('X setup is incomplete. Run: npm run sync:x-auth');
  process.exit(1);
}
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
  console.error('--page-size must be between 1 and 100.');
  process.exit(1);
}
if (!Number.isInteger(maxPages) || maxPages < 1) {
  console.error('--max-pages must be a positive integer.');
  process.exit(1);
}

async function readStore() {
  try {
    return (await readFile(STORE_PATH, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeStore(entries) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  await rename(temporaryPath, STORE_PATH);
}

async function fetchNewBookmarks(accessToken, knownIds) {
  const incoming = new Map();
  let cursor = null;
  let boundaryFound = false;
  let returned = 0;
  let pages = 0;

  while (pages < maxPages) {
    const url = new URL(`https://api.x.com/2/users/${config.x.userId}/bookmarks`);
    url.searchParams.set('max_results', String(pageSize));
    url.searchParams.set(
      'tweet.fields',
      'attachments,author_id,created_at,entities,note_tweet,public_metrics,referenced_tweets',
    );
    url.searchParams.set('expansions', 'author_id,attachments.media_keys');
    url.searchParams.set('user.fields', 'id,name,username');
    url.searchParams.set('media.fields', 'media_key,type,url,preview_image_url');
    if (cursor) url.searchParams.set('pagination_token', cursor);

    const payload = await fetchJson(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!payload.data && payload.errors?.length) {
      throw new Error(`X returned no bookmarks: ${JSON.stringify(payload.errors)}`);
    }
    pages += 1;
    const normalized = normalizeXPage(payload);
    returned += normalized.length;

    for (const entry of normalized) {
      if (!knownIds.has(entry.id)) incoming.set(entry.id, entry);
    }
    if (normalized.some((entry) => knownIds.has(entry.id))) {
      boundaryFound = true;
      cursor = null;
      break;
    }

    cursor = payload.meta?.next_token ?? null;
    if (!cursor) break;
  }

  if (cursor && !boundaryFound) {
    throw new Error(
      `No known bookmark was found within ${maxPages} pages. No changes were saved. ` +
      `Re-run with a larger --max-pages value if you expect more than ${pageSize * maxPages} new bookmarks.`,
    );
  }

  return { entries: [...incoming.values()], pages, returned };
}

async function putInKarakeep(entry, apiKey) {
  const server = config.karakeep.server.replace(/\/$/, '');
  const created = await fetchJson(`${server}/api/v1/bookmarks`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'link',
      url: entry.url,
      title: titleForKarakeep(entry),
      createdAt: entry.created_at ?? undefined,
      source: 'api',
    }),
  });

  if (config.karakeep.listId) {
    await fetchJson(
      `${server}/api/v1/lists/${encodeURIComponent(config.karakeep.listId)}/bookmarks/${encodeURIComponent(created.id)}`,
      {
        method: 'PUT',
        headers: { authorization: `Bearer ${apiKey}` },
      },
    );
  }
}

async function uploadPending(state, storeById) {
  if (!state.pendingKarakeepIds.length) return [];
  const apiKey = await getKarakeepApiKey();
  const remaining = [];

  for (const id of state.pendingKarakeepIds) {
    const entry = storeById.get(id);
    if (!entry) {
      remaining.push(id);
      continue;
    }

    try {
      await putInKarakeep(entry, apiKey);
      console.log(`Karakeep       : added ${entry.url}`);
    } catch (error) {
      remaining.push(id);
      console.error(`Karakeep failed: ${entry.url} — ${error.message}`);
    }
  }

  return remaining;
}

try {
  let entries = await readStore();
  let storeById = new Map(entries.map((entry) => [entry.id, entry]));
  const state = await readJson(STATE_PATH, {
    pendingKarakeepIds: [],
    lastRunAt: null,
    lastSuccessAt: null,
  });
  state.pendingKarakeepIds ??= [];

  if (!dryRun && state.pendingKarakeepIds.length) {
    state.pendingKarakeepIds = await uploadPending(state, storeById);
    await writeJsonAtomic(STATE_PATH, state);
  }

  const accessToken = await getXAccessToken(config);
  const result = await fetchNewBookmarks(accessToken, new Set(storeById.keys()));
  console.log(`X API           : ${result.returned} bookmarks across ${result.pages} page(s)`);
  console.log(`New bookmarks   : ${result.entries.length}`);

  if (dryRun) {
    for (const entry of result.entries) console.log(`Would add       : ${entry.url}`);
    console.log('Dry run complete; no local or Karakeep changes were made.');
    process.exit(0);
  }

  if (result.entries.length) {
    entries = mergeBookmarks(entries, result.entries);
    state.pendingKarakeepIds = [
      ...new Set([...state.pendingKarakeepIds, ...result.entries.map((entry) => entry.id)]),
    ];

    // Record pending work first. A crash can cause a harmless retry, never a lost upload.
    await writeJsonAtomic(STATE_PATH, state);
    await writeStore(entries);
    storeById = new Map(entries.map((entry) => [entry.id, entry]));
    await execFileAsync(process.execPath, [path.join(ROOT, 'scripts/report.mjs')]);
  }

  state.pendingKarakeepIds = await uploadPending(state, storeById);
  state.lastRunAt = new Date().toISOString();
  if (!state.pendingKarakeepIds.length) state.lastSuccessAt = state.lastRunAt;
  await writeJsonAtomic(STATE_PATH, state);

  if (state.pendingKarakeepIds.length) {
    throw new Error(`${state.pendingKarakeepIds.length} Karakeep upload(s) remain pending.`);
  }

  console.log(`Store total     : ${entries.length}`);
  console.log('Sync complete.');
} catch (error) {
  console.error(`Sync failed: ${error.message}`);
  process.exitCode = 1;
}
