import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { ROOT, SYNC_DIR, parseArgs } from './lib/sync-common.mjs';

const execFileAsync = promisify(execFile);
const LABEL = 'app.tech-watch.sync';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const DOMAIN = `gui/${process.getuid()}`;
const args = parseArgs(process.argv.slice(3));
const command = process.argv[2] ?? 'status';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function isLoaded() {
  try {
    await execFileAsync('/bin/launchctl', ['print', `${DOMAIN}/${LABEL}`]);
    return true;
  } catch {
    return false;
  }
}

async function install() {
  const hour = Number.parseInt(String(args.hour ?? 8), 10);
  const minute = Number.parseInt(String(args.minute ?? 15), 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('--hour must be 0–23.');
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('--minute must be 0–59.');

  const logsDir = path.join(SYNC_DIR, 'logs');
  await mkdir(path.dirname(PLIST_PATH), { recursive: true });
  await mkdir(logsDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(ROOT, 'scripts/sync-x-karakeep.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(ROOT)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(path.join(logsDir, 'sync.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(logsDir, 'sync-error.log'))}</string>
</dict>
</plist>
`;

  if (await isLoaded()) {
    await execFileAsync('/bin/launchctl', ['bootout', `${DOMAIN}/${LABEL}`]);
  }
  await writeFile(PLIST_PATH, plist);
  await execFileAsync('/bin/launchctl', ['bootstrap', DOMAIN, PLIST_PATH]);
  console.log(`Installed daily sync for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`);
  console.log(`Logs: ${path.join(logsDir, 'sync.log')}`);
}

async function uninstall() {
  if (await isLoaded()) {
    await execFileAsync('/bin/launchctl', ['bootout', `${DOMAIN}/${LABEL}`]);
  }
  try {
    await unlink(PLIST_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log('Daily sync schedule removed. Local bookmarks and credentials were not deleted.');
}

async function status() {
  if (!(await isLoaded())) {
    console.log('Daily sync is not installed.');
    return;
  }
  const { stdout } = await execFileAsync('/bin/launchctl', ['print', `${DOMAIN}/${LABEL}`]);
  const lastExit = stdout.match(/last exit code = (\d+)/)?.[1] ?? 'not run yet';
  console.log(`Daily sync is installed (${PLIST_PATH}).`);
  console.log(`Last exit code: ${lastExit}`);
}

try {
  if (command === 'install') await install();
  else if (command === 'uninstall') await uninstall();
  else if (command === 'status') await status();
  else throw new Error('Usage: node scripts/schedule.mjs install|status|uninstall [--hour=8 --minute=15]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
