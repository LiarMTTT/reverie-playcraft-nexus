import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const embedRoot = path.join(root, 'portal', 'ui-builder');
const index = await fs.readFile(path.join(embedRoot, 'index.html'), 'utf8');
if (/\b(?:src|href)="\/assets\//.test(index)) throw new Error('UI Builder assets must use relative paths');
if (/\btype=["']module["']|\bcrossorigin\b/i.test(index)) throw new Error('Opaque UI Builder embed must use classic same-document assets without CORS mode');
const entryMatch = index.match(/<script\s+defer\s+src="\.\/assets\/([^"/]+\.js)"><\/script>/);
if (!entryMatch) throw new Error('Opaque UI Builder embed classic entry missing');

const assetNames = await fs.readdir(path.join(embedRoot, 'assets'));
const jsName = entryMatch[1];
if (!assetNames.includes(jsName)) throw new Error(`UI Builder entry bundle missing: ${jsName}`);
const cssMatches = [...index.matchAll(/href="\.\/assets\/([^"/]+\.css)"/g)].map((match) => match[1]);
if (!cssMatches.length || cssMatches.some((name) => !assetNames.includes(name))) throw new Error('UI Builder stylesheet bundle missing');
const bundle = await fs.readFile(path.join(embedRoot, 'assets', jsName), 'utf8');
for (const needle of [
  'mttt.rolecard.ui-builder',
  'E_ST_WRITE_BLOCKED',
  'bindTextPath',
  'bindVisiblePath',
  'actionId',
  'data-rpn-bind-text',
  'data-rpn-bind-visible',
  'data-rpn-action',
  'data-rpn-bind-target',
  'container-type:inline-size',
  '@container',
  '@media',
]) {
  if (!bundle.includes(needle)) throw new Error(`UI Builder embed contract marker missing: ${needle}`);
}

const portalScript = await fs.readFile(path.join(root, 'portal', 'assets', 'card-studio.js'), 'utf8');
const hostScript = await fs.readFile(path.join(root, 'portal', 'assets', 'ui-builder-host.js'), 'utf8');
if (!/\.\/ui-builder-host\.js\?v=\d{4}uib\d+/.test(portalScript)) throw new Error('Portal does not import the UI Builder host bridge');
for (const needle of ['P7.3D-S0', "mode: 'host-managed'", 'allowStWrite: false', 'allowTavernHelperMutation: false', 'allowArbitraryCommand: false']) {
  if (!hostScript.includes(needle)) throw new Error(`Host bridge safety marker missing: ${needle}`);
}
if (!hostScript.includes("event.origin !== 'null'")) throw new Error('Host bridge must require the opaque sandbox origin');
if (!index.includes("Object.defineProperty(window, 'localStorage'")) throw new Error('Opaque UI Builder embed needs in-memory Storage compatibility');
console.log('[ok] UI Builder static embed contract verified');
