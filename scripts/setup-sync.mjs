import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  CONFIG_PATH,
  KEYCHAIN_SERVICE,
  readJson,
  writeJsonAtomic,
  writeKeychainSecret,
} from './lib/sync-common.mjs';

if (process.platform !== 'darwin') {
  console.error('This setup currently expects macOS Keychain and launchd.');
  process.exit(1);
}

const current = await readJson(CONFIG_PATH, {});
const prompt = createInterface({ input: stdin, output: stdout });

async function ask(label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await prompt.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

try {
  console.log('The X Client ID is not a secret. Tokens and the Karakeep key go into macOS Keychain.\n');
  const clientId = await ask('X OAuth 2.0 Client ID', current.x?.clientId ?? '');
  const server = await ask(
    'Karakeep server URL',
    current.karakeep?.server ?? 'https://cloud.karakeep.app',
  );
  const listId = await ask(
    'Karakeep target list ID (optional)',
    current.karakeep?.listId ?? '',
  );

  if (!clientId) throw new Error('X Client ID is required.');
  const parsedServer = new URL(server);
  if (!['https:', 'http:'].includes(parsedServer.protocol)) {
    throw new Error('Karakeep server must be an HTTP(S) URL.');
  }

  await writeJsonAtomic(CONFIG_PATH, {
    x: {
      clientId,
      userId: current.x?.userId ?? null,
      callbackUrl: 'http://127.0.0.1:8787/callback',
    },
    karakeep: {
      server: parsedServer.href.replace(/\/$/, ''),
      listId: listId || null,
    },
    sync: {
      pageSize: current.sync?.pageSize ?? 10,
      maxPages: current.sync?.maxPages ?? 10,
    },
  });

  prompt.close();
  if (process.env.KARAKEEP_API_KEY) {
    await writeKeychainSecret('karakeep-api-key', process.env.KARAKEEP_API_KEY);
  } else {
    console.log('\nEnter your Karakeep API key in the secure macOS prompt.');
    const result = spawnSync('/usr/bin/security', [
      'add-generic-password',
      '-U',
      '-s',
      KEYCHAIN_SERVICE,
      '-a',
      'karakeep-api-key',
      '-w',
    ], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Could not save the Karakeep API key.');
  }

  console.log(`\nConfiguration saved to ${CONFIG_PATH}`);
  console.log('Next: npm run sync:x-auth');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  prompt.close();
}
