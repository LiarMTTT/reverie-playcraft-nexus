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

const remapSources = [
  [root, '/rpn/source'],
  [process.env.CARGO_HOME, '/rpn/cargo-home'],
  [process.env.RUSTUP_HOME, '/rpn/rustup-home'],
  [process.env.USERPROFILE || process.env.HOME, '/rpn/build-home'],
].filter(([source]) => String(source ?? '').trim());
const encodedRustFlags = [
  process.env.CARGO_ENCODED_RUSTFLAGS,
  ...remapSources.map(([source, target]) => `--remap-path-prefix=${path.resolve(source)}=${target}`),
].filter(Boolean).join('\x1f');
const buildEnvironment = {
  ...process.env,
  CI: process.env.CI || 'true',
  CARGO_ENCODED_RUSTFLAGS: encodedRustFlags,
};

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
  env: buildEnvironment,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(packageJson.version ?? '').trim();
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`package.json version is not a stable semver: ${version}`);
}

const nsisDirectory = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const installers = fs.readdirSync(nsisDirectory)
  .filter((name) => name.endsWith('.exe') && name.includes(`_${version}_`));
if (installers.length !== 1) {
  throw new Error(`Expected one v${version} NSIS installer, found ${installers.length}`);
}

const sourceInstaller = path.join(nsisDirectory, installers[0]);
const sourceSignature = `${sourceInstaller}.sig`;
if (!fs.existsSync(sourceSignature)) {
  throw new Error(`Signed updater artifact is missing for ${installers[0]}`);
}

const assetName = `RPN_${version}_windows_x86_64-setup.exe`;
const assetsDirectory = path.join(root, 'src-tauri', 'target', 'release', 'release-assets');
fs.mkdirSync(assetsDirectory, { recursive: true });
fs.copyFileSync(sourceInstaller, path.join(assetsDirectory, assetName));
fs.copyFileSync(sourceSignature, path.join(assetsDirectory, `${assetName}.sig`));

const endpoint = configuredUpdater.endpoints[0];
const releaseBase = endpoint.replace(
  /\/releases\/latest\/download\/latest\.json$/,
  `/releases/download/v${version}`,
);
if (releaseBase === endpoint) {
  throw new Error('Updater endpoint does not use the supported GitHub latest.json layout');
}

const latest = {
  version,
  notes: `Reverie Playcraft Nexus ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sourceSignature, 'utf8').trim(),
      url: `${releaseBase}/${assetName}`,
    },
  },
};
fs.writeFileSync(
  path.join(assetsDirectory, 'latest.json'),
  `${JSON.stringify(latest, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(assetsDirectory, 'rpn-updater-public.key'),
  process.env.RPN_UPDATER_PUBLIC_KEY.trim(),
  'utf8',
);

console.log(`[ok] Signed release assets prepared for v${version}`);
