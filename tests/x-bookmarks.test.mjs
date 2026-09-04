import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeBookmarks, normalizeXPage, titleForKarakeep } from '../scripts/lib/x-bookmarks.mjs';

const payload = {
  data: [{
    id: '123',
    author_id: '456',
    created_at: '2026-09-04T08:00:00.000Z',
    text: 'A useful link https://t.co/short',
    entities: { urls: [{ url: 'https://t.co/short', expanded_url: 'https://example.com/full' }] },
    attachments: { media_keys: ['media-1'] },
    public_metrics: { like_count: 4, retweet_count: 2 },
    referenced_tweets: [{ type: 'quoted', id: '999' }],
  }],
  includes: {
    users: [{ id: '456', username: 'example', name: 'Example' }],
    media: [{ media_key: 'media-1', type: 'photo', url: 'https://example.com/image.jpg' }],
  },
};

test('normalizes an X API bookmark into the local schema', () => {
  const [entry] = normalizeXPage(payload, '2026-09-04T09:00:00.000Z');
  assert.equal(entry.id, '123');
  assert.equal(entry.url, 'https://x.com/example/status/123');
  assert.deepEqual(entry.links, ['https://example.com/full']);
  assert.equal(entry.media[0].original, 'https://example.com/image.jpg');
  assert.equal(entry.thread.quoted, '999');
  assert.equal(entry.metrics.likes, 4);
});

test('merge preserves manually curated fields', () => {
  const [incoming] = normalizeXPage(payload, '2026-09-04T09:00:00.000Z');
  const existing = {
    ...incoming,
    text: 'old text',
    first_seen: '2025-01-01T00:00:00.000Z',
    tags: ['research'],
    notes: 'Keep this',
  };
  const [merged] = mergeBookmarks([existing], [incoming]);
  assert.equal(merged.text, incoming.text);
  assert.equal(merged.first_seen, existing.first_seen);
  assert.deepEqual(merged.tags, ['research']);
  assert.equal(merged.notes, 'Keep this');
});

test('Karakeep titles are compact and identify the author', () => {
  const [entry] = normalizeXPage(payload);
  assert.equal(titleForKarakeep(entry), '@example: A useful link https://t.co/short');
});
