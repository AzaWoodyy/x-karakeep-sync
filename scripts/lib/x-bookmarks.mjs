function collectUrls(post) {
  const urls = [
    ...(post.entities?.urls ?? []),
    ...(post.note_tweet?.entities?.urls ?? []),
  ];
  return [...new Set(urls.map((item) => item.expanded_url ?? item.url).filter(Boolean))];
}

function mediaFor(post, mediaByKey) {
  return (post.attachments?.media_keys ?? []).flatMap((key) => {
    const media = mediaByKey.get(key);
    if (!media) return [];
    return [{
      type: media.type ?? null,
      url: media.url ?? media.preview_image_url ?? null,
      thumbnail: media.preview_image_url ?? null,
      original: media.url ?? null,
    }];
  });
}

function referencedId(post, type) {
  return post.referenced_tweets?.find((reference) => reference.type === type)?.id ?? null;
}

export function normalizeXPage(payload, seenAt = new Date().toISOString()) {
  const usersById = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]));
  const mediaByKey = new Map((payload.includes?.media ?? []).map((media) => [media.media_key, media]));

  return (payload.data ?? []).map((post) => {
    const author = usersById.get(post.author_id);
    const handle = author?.username ?? null;
    const metrics = post.public_metrics ?? {};

    return {
      id: String(post.id),
      url: handle
        ? `https://x.com/${handle}/status/${post.id}`
        : `https://x.com/i/web/status/${post.id}`,
      author: {
        handle,
        name: author?.name ?? null,
        id: post.author_id ?? null,
      },
      created_at: post.created_at ?? null,
      text: post.note_tweet?.text ?? post.text ?? '',
      links: collectUrls(post),
      media: mediaFor(post, mediaByKey),
      metrics: {
        likes: metrics.like_count ?? null,
        retweets: metrics.retweet_count ?? null,
        replies: metrics.reply_count ?? null,
        quotes: metrics.quote_count ?? null,
        bookmarks: metrics.bookmark_count ?? null,
        views: metrics.impression_count ?? null,
      },
      thread: {
        in_reply_to: referencedId(post, 'replied_to'),
        quoted: referencedId(post, 'quoted'),
        retweeted: referencedId(post, 'retweeted'),
      },
      first_seen: seenAt,
      tags: [],
      notes: '',
    };
  });
}

export function mergeBookmarks(existingEntries, incomingEntries) {
  const merged = new Map(existingEntries.map((entry) => [entry.id, entry]));

  for (const entry of incomingEntries) {
    const existing = merged.get(entry.id);
    merged.set(entry.id, existing
      ? {
          ...entry,
          first_seen: existing.first_seen,
          tags: existing.tags ?? [],
          notes: existing.notes ?? '',
        }
      : entry);
  }

  return [...merged.values()].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
}

export function titleForKarakeep(entry) {
  const text = entry.text.replace(/\s+/g, ' ').trim();
  const prefix = entry.author.handle ? `@${entry.author.handle}` : 'X post';
  return (text ? `${prefix}: ${text}` : prefix).slice(0, 1000);
}
