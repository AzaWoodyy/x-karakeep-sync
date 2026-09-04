import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

import {
  CONFIG_PATH,
  fetchJson,
  parseArgs,
  readConfig,
  readJson,
  writeJsonAtomic,
  writeKeychainSecret,
} from './lib/sync-common.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
let config;
try {
  config = await readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!config.x.clientId) {
  console.error('X Client ID is missing. Run: npm run sync:setup');
  process.exit(1);
}

const callback = new URL(config.x.callbackUrl);
if (!['127.0.0.1', 'localhost'].includes(callback.hostname)) {
  console.error('The OAuth callback must use localhost.');
  process.exit(1);
}

const state = randomBytes(24).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizeUrl = new URL('https://x.com/i/oauth2/authorize');
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: config.x.clientId,
  redirect_uri: callback.href,
  scope: 'bookmark.read tweet.read users.read offline.access',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

let settleCallback;
const callbackResult = new Promise((resolve, reject) => {
  settleCallback = { resolve, reject };
});

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url, callback.origin);
  if (requestUrl.pathname !== callback.pathname) {
    response.writeHead(404).end('Not found');
    return;
  }

  const returnedState = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const oauthError = requestUrl.searchParams.get('error');

  if (oauthError) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`X authorization failed: ${oauthError}. You can close this tab.`);
    settleCallback.reject(new Error(`X authorization failed: ${oauthError}`));
    return;
  }
  if (!code || returnedState !== state) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Invalid OAuth callback. You can close this tab.');
    settleCallback.reject(new Error('Invalid OAuth callback or state mismatch.'));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<h1>X authorization received</h1><p>You can close this tab and return to the terminal.</p>');
  settleCallback.resolve(code);
});

const timeout = setTimeout(() => {
  settleCallback.reject(new Error('Timed out waiting for X authorization.'));
}, 5 * 60_000);

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(callback.port || 80), callback.hostname, resolve);
  });

  console.log(`Open this URL to authorize the app:\n\n${authorizeUrl.href}\n`);
  if (!args['no-open']) await execFileAsync('/usr/bin/open', [authorizeUrl.href]);

  const code = await callbackResult;
  const tokenPayload = await fetchJson('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.x.clientId,
      redirect_uri: callback.href,
      code_verifier: verifier,
    }),
  });

  const tokens = {
    accessToken: tokenPayload.access_token,
    refreshToken: tokenPayload.refresh_token ?? null,
    expiresAt: Date.now() + tokenPayload.expires_in * 1000,
    scope: tokenPayload.scope,
    tokenType: tokenPayload.token_type,
  };
  await writeKeychainSecret('x-oauth-tokens', JSON.stringify(tokens));

  const me = await fetchJson('https://api.x.com/2/users/me', {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  const rawConfig = await readJson(CONFIG_PATH, {});
  rawConfig.x = { ...rawConfig.x, userId: me.data.id };
  await writeJsonAtomic(CONFIG_PATH, rawConfig);

  console.log(`Authorized X account @${me.data.username ?? me.data.id}.`);
  console.log('Next: npm run sync -- --dry-run');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await new Promise((resolve) => server.close(resolve));
}
