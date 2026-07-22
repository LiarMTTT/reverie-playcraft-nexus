import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredBuilderRoot = String(process.env.UI_BUILDER_ROOT || '').trim();
if (!configuredBuilderRoot) {
  throw new Error('UI_BUILDER_ROOT is required and must point to the standalone UI Builder source directory');
}
const builderRoot = path.resolve(configuredBuilderRoot);
const builderDist = path.join(builderRoot, 'dist');
const portalRoot = path.join(root, 'portal');
const target = path.join(portalRoot, 'ui-builder');
const resolvedTarget = path.resolve(target);

if (!resolvedTarget.startsWith(path.resolve(portalRoot) + path.sep)) throw new Error('UI Builder embed target escapes portal');
await fs.access(path.join(builderRoot, 'package.json'));

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this script through npm run sync:ui-builder');
const { stdout, stderr } = await execFileAsync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: builderRoot,
  windowsHide: true,
  maxBuffer: 4 * 1024 * 1024,
});
if (stdout.trim()) process.stdout.write(stdout);
if (stderr.trim()) process.stderr.write(stderr);

await fs.access(path.join(builderDist, 'index.html'));
const sourceIndex = await fs.readFile(path.join(builderDist, 'index.html'), 'utf8');
if (!sourceIndex.includes("Object.defineProperty(window, 'localStorage'")) {
  throw new Error('UI Builder dist is missing the opaque-sandbox Storage compatibility layer');
}
const moduleEntryPattern = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'](\.\/assets\/[^"']+\.js)["'])[^>]*><\/script>/i;
const entryMatch = sourceIndex.match(moduleEntryPattern);
if (!entryMatch) throw new Error('UI Builder dist module entry could not be adapted for the opaque sandbox');
const adaptedIndex = sourceIndex
  .replace(moduleEntryPattern, `<script defer src="${entryMatch[1]}"></script>`)
  .replace(/\s+crossorigin(?:=(?:"[^"]*"|'[^']*'))?/gi, '');
if (/\btype=["']module["']|\bcrossorigin\b/i.test(adaptedIndex)) {
  throw new Error('UI Builder opaque-sandbox adaptation left a module or CORS entry behind');
}
await fs.rm(resolvedTarget, { recursive: true, force: true });
await fs.cp(builderDist, resolvedTarget, { recursive: true });
await fs.writeFile(path.join(resolvedTarget, 'index.html'), adaptedIndex, 'utf8');
console.log(`[ok] UI Builder embedded at ${resolvedTarget}`);
