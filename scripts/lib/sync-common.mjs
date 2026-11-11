import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SYNC_DIR = path.join(ROOT, '.sync');
export const CONFIG_PATH = path.join(SYNC_DIR, 'config.json');
export const STATE_PATH = path.join(SYNC_DIR, 'state.json');
export const STORE_PATH = path.join(ROOT, 'data', 'bookmarks.jsonl');
export const KEYCHAIN_SERVICE = 'app.tech-watch.sync';

export async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function readConfig() {
  const config = await readJson(CONFIG_PATH, null);
  if (!config) {
    throw new Error(`Sync is not configured. Run: npm run sync:setup`);
  }

  return {
    x: {
      clientId: process.env.X_CLIENT_ID ?? config.x?.clientId,
      userId: process.env.X_USER_ID ?? config.x?.userId,
      callbackUrl: config.x?.callbackUrl ?? 'http://127.0.0.1:8787/callback',
    },
    karakeep: {
      server: process.env.KARAKEEP_SERVER_ADDR ?? config.karakeep?.server ?? 'https://cloud.karakeep.app',
      listId: process.env.KARAKEEP_LIST_ID ?? config.karakeep?.listId ?? null,
    },
    sync: {
      pageSize: config.sync?.pageSize ?? 10,
      maxPages: config.sync?.maxPages ?? 10,
    },
  };
}

export async function readKeychainSecret(account) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      account,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function quoteSecurityArgument(value) {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

// The secret goes through stdin (`security -i`) rather than argv, where `ps` could read it.
export async function writeKeychainSecret(account, value) {
  if (/[\r\n]/.test(value)) throw new Error('Keychain secrets cannot contain line breaks.');

  const command = [
    'add-generic-password',
    '-U',
    '-s',
    quoteSecurityArgument(KEYCHAIN_SERVICE),
    '-a',
    quoteSecurityArgument(account),
    '-w',
    quoteSecurityArgument(value),
  ].join(' ');

  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && !stderr.trim()) resolve();
      else reject(new Error(`Could not save "${account}" in macOS Keychain: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(`${command}\n`);
  });
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: {
      accept: 'application/json',
      ...options.headers,
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new Error(`${response.status} ${response.statusText} from ${url}: ${detail}`);
  }

  return payload;
}

export async function getXTokens() {
  const fromEnvironment = process.env.X_OAUTH_TOKENS;
  const serialized = fromEnvironment ?? (await readKeychainSecret('x-oauth-tokens'));
  if (!serialized) {
    throw new Error('X is not authorized. Run: npm run sync:x-auth');
  }

  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error('The stored X OAuth token is invalid. Run: npm run sync:x-auth');
  }
}

export async function getXAccessToken(config) {
  let tokens = await getXTokens();
  const expiresSoon = !tokens.expiresAt || tokens.expiresAt <= Date.now() + 60_000;
  if (!expiresSoon) return tokens.accessToken;

  if (!tokens.refreshToken) {
    throw new Error('The X token expired without a refresh token. Re-run: npm run sync:x-auth');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: config.x.clientId,
  });
  const refreshed = await fetchJson('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  tokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    scope: refreshed.scope ?? tokens.scope,
    tokenType: refreshed.token_type ?? tokens.tokenType,
  };
  await writeKeychainSecret('x-oauth-tokens', JSON.stringify(tokens));
  return tokens.accessToken;
}

export async function getKarakeepApiKey() {
  const key = process.env.KARAKEEP_API_KEY ?? (await readKeychainSecret('karakeep-api-key'));
  if (!key) {
    throw new Error('Karakeep API key is missing. Run: npm run sync:setup');
  }
  return key;
}

export function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((argument) => {
      const [key, value = true] = argument.replace(/^--/, '').split('=');
      return [key, value];
    }),
  );
}
