import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredRegistry = String(process.env.CARD_COMPONENT_REGISTRY || '').trim();
if (!configuredRegistry) {
  throw new Error('CARD_COMPONENT_REGISTRY is required and must point to the component registry.json');
}
const sourcePath = path.resolve(configuredRegistry);
const targetPath = path.join(repoRoot, 'portal', 'assets', 'card-component-catalog.json');
const registry = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

const catalog = {
  format: 'rolecard-component-catalog',
  schemaVersion: 1,
  libraryVersion: registry.libraryVersion || '',
  sourceCardVersion: registry.sourceCardVersion || '',
  source: path.basename(sourcePath),
  modules: (registry.modules || []).map((module) => ({
    id: module.id,
    title: module.title || module.commonName || module.id,
    commonName: module.commonName || module.title || module.id,
    category: module.category || 'other',
    defaultEnabled: Boolean(module.defaultEnabled),
    dependsOn: Array.isArray(module.dependsOn) ? module.dependsOn : [],
    conflictsWith: Array.isArray(module.conflictsWith) ? module.conflictsWith : [],
    applicableScenarios: Array.isArray(module.applicableScenarios) ? module.applicableScenarios : [],
    modelVisible: Boolean(module.modelVisible),
    replacedBy: module.replacedBy || null,
    replacementStatus: module.replacementStatus || null,
    summary: String(module.notes || '').replace(/\s+/g, ' ').slice(0, 220),
  })),
  recipes: (registry.recipes || []).map((recipe) => ({
    id: recipe.id,
    title: recipe.title || recipe.id,
    file: recipe.file || '',
  })),
};

await fs.writeFile(targetPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`[ok] studio component catalog ${catalog.libraryVersion}: ${catalog.modules.length} modules`);
