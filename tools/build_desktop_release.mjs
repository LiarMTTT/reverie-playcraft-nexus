import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REQUIRED = [
  'RPN_UPDATER_PUBLIC_KEY',
  'RPN_UPDATER_ENDPOINT',
  'TAURI_SIGNING_PRIVATE_KEY',
];

for (const name of REQUIRED) {
  if (!String(process.env[name] ?? '').trim()) {
    throw new Error(`Signed desktop release requires ${name}`);
  }
}

if (!process.env.RPN_UPDATER_ENDPOINT.trim().startsWith('https://')) {
  throw new Error('RPN_UPDATER_ENDPOINT must use HTTPS');
}

const root = path.resolve(import.meta.dirname, '..');
const releaseConfigPath = path.join(root, 'src-tauri', 'tauri.release.conf.json');
const releaseConfig = JSON.parse(fs.readFileSync(releaseConfigPath, 'utf8'));
const configuredUpdater = releaseConfig.plugins?.updater;
if (String(configuredUpdater?.pubkey ?? '').trim() !== process.env.RPN_UPDATER_PUBLIC_KEY.trim()) {
  throw new Error('RPN_UPDATER_PUBLIC_KEY must match tauri.release.conf.json');
}
if (configuredUpdater?.endpoints?.[0] !== process.env.RPN_UPDATER_ENDPOINT.trim()) {
  throw new Error('RPN_UPDATER_ENDPOINT must match tauri.release.conf.json');
}

const executable = process.platform === 'win32'
  ? path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'cargo-tauri.exe')
  : 'cargo-tauri';
const result = spawnSync(executable, [
  'build',
  '--bundles',
  'nsis',
  '--features',
  'release-updater',
  '--config',
  'src-tauri/tauri.release.conf.json',
], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
