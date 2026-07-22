export const STUDIO_KNOWLEDGE_INDEX_VERSION = 1;
export const STUDIO_AGENT_CONTEXT_KEY = 'studioAgent:context:v1';
export const STUDIO_KNOWLEDGE_SOURCE_ROLES = Object.freeze(['skill', 'guideDb']);
export const STUDIO_AGENT_PATH_FIELDS = Object.freeze([
  'workspaceDirectory',
  'guideDbDirectory',
  'codexSkillsDirectory',
  'claudeSkillsDirectory',
]);

const AGENT_CONTEXT_RECORD_VERSION = 1;
const KNOWLEDGE_SOURCE_ROLE_SET = new Set(STUDIO_KNOWLEDGE_SOURCE_ROLES);

export const STUDIO_KNOWLEDGE_LIMITS = Object.freeze({
  documents: 512,
  documentCharacters: 2_000_000,
  chunks: 20_000,
  chunkCharacters: 50_000,
  topK: 20,
  excerptCharacters: 500,
  queryCharacters: 200,
});

function boundedInteger(value, fallback, maximum) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function knowledgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isDirectoryHandle(value) {
  return Boolean(value && typeof value === 'object' && value.kind === 'directory');
}

function normalizeKnowledgeSourceRole(role) {
  if (!KNOWLEDGE_SOURCE_ROLE_SET.has(role)) {
    throw knowledgeError('invalid-knowledge-source-role', `未知知识源角色：${String(role)}`);
  }
  return role;
}

function normalizeLocalPath(value, field) {
  const path = String(value ?? '').trim();
  if (path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) {
    throw knowledgeError('invalid-local-path', `${field} 不能包含控制字符，且长度不能超过 4096`);
  }
  return path;
}

export function emptyStudioAgentPaths() {
  return {
    workspaceDirectory: '',
    guideDbDirectory: '',
    codexSkillsDirectory: '',
    claudeSkillsDirectory: '',
  };
}

export function normalizeStudioAgentPaths(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.freeze(Object.fromEntries(STUDIO_AGENT_PATH_FIELDS.map((field) => (
    [field, normalizeLocalPath(source[field], field)]
  ))));
}

export function emptyStudioKnowledgeSourceHandles() {
  return { skill: null, guideDb: null };
}

function normalizeKnowledgeSourceHandles(value, { ignoreInvalid = false } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const handles = emptyStudioKnowledgeSourceHandles();
  for (const role of STUDIO_KNOWLEDGE_SOURCE_ROLES) {
    if (source[role] == null) continue;
    if (!isDirectoryHandle(source[role])) {
      if (ignoreInvalid) continue;
      throw knowledgeError('invalid-directory-handle', `${role} 不是目录句柄`);
    }
    handles[role] = source[role];
  }
  return handles;
}

export async function pickStudioKnowledgeSourceDirectory(role, {
  scope = globalThis,
  showDirectoryPicker = scope?.showDirectoryPicker,
  startIn,
} = {}) {
  const safeRole = normalizeKnowledgeSourceRole(role);
  if (typeof showDirectoryPicker !== 'function') {
    return { status: 'unsupported', role: safeRole, handle: null };
  }
  try {
    const handle = await showDirectoryPicker.call(scope, {
      id: `rpn-studio-knowledge-${safeRole}`,
      mode: 'read',
      ...(startIn ? { startIn } : {}),
    });
    if (!isDirectoryHandle(handle)) throw knowledgeError('invalid-directory-handle', '目录选择器没有返回目录句柄');
    return { status: 'selected', role: safeRole, handle };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'cancelled', role: safeRole, handle: null };
    throw error;
  }
}

export async function ensureStudioKnowledgeSourcePermission(handle, { request = false } = {}) {
  if (!isDirectoryHandle(handle)) throw knowledgeError('invalid-directory-handle', '需要有效的只读目录句柄');
  if (typeof handle.queryPermission !== 'function') return 'unsupported';
  let permission = await handle.queryPermission({ mode: 'read' });
  if (permission === 'prompt' && request && typeof handle.requestPermission === 'function') {
    permission = await handle.requestPermission({ mode: 'read' });
  }
  return ['granted', 'denied', 'prompt'].includes(permission) ? permission : 'unsupported';
}

export function createStudioAgentContextStore({
  get,
  put,
  remove,
  key = STUDIO_AGENT_CONTEXT_KEY,
}) {
  if (typeof get !== 'function' || typeof put !== 'function' || typeof remove !== 'function') {
    throw knowledgeError('invalid-context-store', 'Agent 上下文存储需要 get、put、remove 三个函数');
  }
  return Object.freeze({
    key,
    async load() {
      const record = await get(key);
      if (!record || record.version !== AGENT_CONTEXT_RECORD_VERSION) {
        return { paths: emptyStudioAgentPaths(), handles: emptyStudioKnowledgeSourceHandles() };
      }
      return {
        paths: normalizeStudioAgentPaths(record.paths),
        handles: normalizeKnowledgeSourceHandles(record.handles, { ignoreInvalid: true }),
      };
    },
    async save(value = {}) {
      const paths = normalizeStudioAgentPaths(value.paths);
      const handles = normalizeKnowledgeSourceHandles(value.handles);
      const hasPaths = STUDIO_AGENT_PATH_FIELDS.some((field) => paths[field]);
      const hasHandles = STUDIO_KNOWLEDGE_SOURCE_ROLES.some((role) => handles[role]);
      if (!hasPaths && !hasHandles) {
        await remove(key);
        return { paths, handles };
      }
      await put({ version: AGENT_CONTEXT_RECORD_VERSION, paths, handles }, key);
      return { paths, handles };
    },
    async clear() {
      await remove(key);
    },
  });
}

async function readSkillManifest(directoryHandle, directoryName, limits) {
  if (!isDirectoryHandle(directoryHandle) || typeof directoryHandle.getFileHandle !== 'function') return null;
  let fileHandle;
  try {
    fileHandle = await directoryHandle.getFileHandle('SKILL.md');
  } catch (error) {
    if (error?.name === 'NotFoundError') return null;
    throw error;
  }
  const file = await fileHandle.getFile();
  if (!file || file.size > limits.maxSkillBytes || typeof file.text !== 'function') return null;
  const text = (await file.text()).slice(0, limits.maxSkillCharacters);
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(normalizeNewlines(text))?.[1] || '';
  const frontmatterValue = (field) => {
    const lines = frontmatter.split('\n');
    const index = lines.findIndex((line) => new RegExp(`^${field}:\\s*`).test(line));
    if (index < 0) return '';
    const inline = lines[index].replace(new RegExp(`^${field}:\\s*`), '').trim();
    if (!/^[>|][+-]?$/.test(inline)) return inline.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
    const folded = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor] && !/^\s/.test(lines[cursor])) break;
      folded.push(lines[cursor].trim());
    }
    return (inline.startsWith('|') ? folded.join('\n') : folded.join(' ')).trim();
  };
  const manifestName = frontmatterValue('name') || directoryName;
  const description = frontmatterValue('description');
  return Object.freeze({
    directoryName: String(directoryName || manifestName).slice(0, 255),
    name: plainText(manifestName).slice(0, 255),
    description: plainText(description).slice(0, 1000),
    text,
  });
}

export async function inspectStudioSkillDirectory(handle, options = {}) {
  if (!isDirectoryHandle(handle) || typeof handle.entries !== 'function') {
    throw knowledgeError('invalid-directory-handle', 'Skill 源必须是可枚举的目录句柄');
  }
  const limits = {
    maxSkills: boundedInteger(options.maxSkills, 128, 256),
    maxSkillBytes: boundedInteger(options.maxSkillBytes, 128_000, 512_000),
    maxSkillCharacters: boundedInteger(options.maxSkillCharacters, 120_000, 500_000),
  };
  const skills = [];
  const rootManifest = await readSkillManifest(handle, handle.name || 'skill', limits);
  if (rootManifest) skills.push(rootManifest);
  if (!rootManifest) {
    const entries = [];
    for await (const [name, child] of handle.entries()) {
      if (child?.kind === 'directory' && !String(name).startsWith('.')) entries.push([name, child]);
      if (entries.length >= limits.maxSkills) break;
    }
    entries.sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
    for (const [name, child] of entries) {
      const manifest = await readSkillManifest(child, name, limits);
      if (manifest) skills.push(manifest);
      if (skills.length >= limits.maxSkills) break;
    }
    if (!skills.length) {
      const skillsDirectory = entries.find(([name]) => name === 'skills')?.[1] || null;
      if (skillsDirectory && typeof skillsDirectory.entries === 'function') {
        const nestedEntries = [];
        for await (const [name, child] of skillsDirectory.entries()) {
          if (child?.kind === 'directory' && !String(name).startsWith('.')) nestedEntries.push([name, child]);
          if (nestedEntries.length >= limits.maxSkills) break;
        }
        nestedEntries.sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
        for (const [name, child] of nestedEntries) {
          const manifest = await readSkillManifest(child, name, limits);
          if (manifest) skills.push(manifest);
          if (skills.length >= limits.maxSkills) break;
        }
      }
    }
  }
  return Object.freeze(skills);
}

export async function readStudioKnowledgeDocuments(handle, options = {}) {
  if (!isDirectoryHandle(handle) || typeof handle.entries !== 'function') {
    throw knowledgeError('invalid-directory-handle', '开发指南 DB 必须是可枚举的目录句柄');
  }
  const maxDocuments = boundedInteger(options.maxDocuments, 96, 512);
  const maxFileBytes = boundedInteger(options.maxFileBytes, 512_000, 2_000_000);
  const maxTotalBytes = boundedInteger(options.maxTotalBytes, 4_000_000, 16_000_000);
  const fileEntries = [];
  for await (const [name, child] of handle.entries()) {
    if (child?.kind !== 'file' || String(name).startsWith('.') || !/\.(?:md|markdown)$/i.test(name)) continue;
    fileEntries.push([name, child]);
    if (fileEntries.length >= maxDocuments) break;
  }
  fileEntries.sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  const documents = [];
  let totalBytes = 0;
  for (const [fileName, fileHandle] of fileEntries) {
    const file = await fileHandle.getFile();
    if (!file || typeof file.text !== 'function' || file.size > maxFileBytes || totalBytes + file.size > maxTotalBytes) continue;
    const text = await file.text();
    totalBytes += file.size;
    documents.push(Object.freeze({ fileName, text }));
  }
  return Object.freeze({ documents: Object.freeze(documents), totalBytes });
}

function normalizeNewlines(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function plainText(value) {
  return normalizeNewlines(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:`{3,}|~{3,}).*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^\s{0,3}>[ \t]?/gm, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])[ \t]+/gm, '')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/[`*~]/g, '')
    .replace(/[|]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayFileName(value) {
  const clean = normalizeNewlines(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || '未命名文档').slice(0, 512);
}

function titleFromFileName(fileName) {
  const leaf = fileName.split(/[\\/]/).pop() || fileName;
  return plainText(leaf.replace(/\.(?:md|markdown)$/i, '')) || '未命名文档';
}

function atxHeading(line) {
  const match = /^(?: {0,3})(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
  if (!match) return null;
  const text = plainText(match[2]);
  return text ? { level: match[1].length, text, consumed: 1 } : null;
}

function setextHeading(lines, index) {
  if (index + 1 >= lines.length || !lines[index].trim()) return null;
  const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(lines[index + 1]);
  if (!underline) return null;
  const text = plainText(lines[index]);
  return text ? { level: underline[1][0] === '=' ? 1 : 2, text, consumed: 2 } : null;
}

function splitPlainText(value, maximum) {
  if (value.length <= maximum) return [value];
  const parts = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maximum);
    if (end < value.length) {
      const segment = value.slice(start, end);
      const candidates = [
        segment.lastIndexOf('。'),
        segment.lastIndexOf('！'),
        segment.lastIndexOf('？'),
        segment.lastIndexOf('；'),
        segment.lastIndexOf(' '),
      ];
      const naturalEnd = Math.max(...candidates);
      if (naturalEnd >= Math.floor(maximum * 0.5)) end = start + naturalEnd + 1;
    }
    const part = value.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}

function normalizedSearchText(value) {
  return plainText(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function tokenize(value) {
  const segments = normalizedSearchText(value).match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) || [];
  const tokens = [];
  for (const segment of segments) {
    tokens.push(segment);
    if (!/^\p{Script=Han}+$/u.test(segment)) continue;
    const characters = [...segment];
    if (characters.length <= 2) continue;
    for (let index = 0; index < characters.length - 1 && tokens.length < 64; index += 1) {
      tokens.push(characters.slice(index, index + 2).join(''));
    }
  }
  return [...new Set(tokens)].slice(0, 64);
}

function safeHeadingPath(value, title) {
  const heading = plainText(value) || title;
  const titlePrefix = `${title} › `;
  return heading.startsWith(titlePrefix) ? heading.slice(titlePrefix.length) : heading;
}

/**
 * 将一份 Markdown 拆成只含纯文本的知识块。该函数不解析或执行 HTML。
 */
export function parseStudioKnowledgeMarkdown(fileName, markdown, options = {}) {
  const safeFileName = displayFileName(fileName);
  const fallbackTitle = titleFromFileName(safeFileName);
  const maxDocumentCharacters = boundedInteger(
    options.maxDocumentCharacters,
    STUDIO_KNOWLEDGE_LIMITS.documentCharacters,
    STUDIO_KNOWLEDGE_LIMITS.documentCharacters,
  );
  const maxChunkCharacters = boundedInteger(
    options.maxChunkCharacters,
    STUDIO_KNOWLEDGE_LIMITS.chunkCharacters,
    STUDIO_KNOWLEDGE_LIMITS.chunkCharacters,
  );
  const maxChunks = boundedInteger(
    options.maxChunks,
    STUDIO_KNOWLEDGE_LIMITS.chunks,
    STUDIO_KNOWLEDGE_LIMITS.chunks,
  );
  const source = normalizeNewlines(markdown).slice(0, maxDocumentCharacters);
  const lines = source.split('\n');
  let firstContentLine = 0;
  if (lines[0]?.trim() === '---') {
    const frontMatterEnd = lines.findIndex((line, index) => (
      index > 0 && (line.trim() === '---' || line.trim() === '...')
    ));
    if (frontMatterEnd > 0) firstContentLine = frontMatterEnd + 1;
  }
  const sections = [];
  const headingPath = [];
  let documentTitle = fallbackTitle;
  let foundDocumentTitle = false;
  let currentHeading = fallbackTitle;
  let currentExplicitHeading = false;
  let bodyLines = [];
  let fence = null;

  const flush = () => {
    if (!bodyLines.some((line) => line.trim()) && !currentExplicitHeading) {
      bodyLines = [];
      return;
    }
    const body = plainText(bodyLines.join('\n'));
    const searchableText = body || currentHeading;
    for (const part of splitPlainText(searchableText, maxChunkCharacters)) {
      if (sections.length >= maxChunks) break;
      sections.push({ heading: currentHeading, text: part });
    }
    bodyLines = [];
  };

  for (let index = firstContentLine; index < lines.length && sections.length < maxChunks; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      bodyLines.push(line);
      continue;
    }

    const heading = fence ? null : (atxHeading(line) || setextHeading(lines, index));
    if (!heading) {
      bodyLines.push(line);
      continue;
    }

    flush();
    if (heading.consumed === 2) index += 1;
    if (!foundDocumentTitle && heading.level === 1) {
      documentTitle = heading.text;
      foundDocumentTitle = true;
    }
    headingPath.length = heading.level - 1;
    headingPath[heading.level - 1] = heading.text;
    currentHeading = headingPath.filter(Boolean).join(' › ') || heading.text;
    currentExplicitHeading = true;
  }
  flush();

  if (!sections.length) sections.push({ heading: fallbackTitle, text: fallbackTitle });
  return Object.freeze(sections.slice(0, maxChunks).map((section, index) => Object.freeze({
    id: `${safeFileName}:${index + 1}`,
    fileName: safeFileName,
    title: documentTitle,
    heading: safeHeadingPath(section.heading, documentTitle),
    text: section.text,
  })));
}

/**
 * 构建可结构化克隆的内存索引；不读取目录，也不保留 File/Handle 对象。
 */
export function createStudioKnowledgeIndex(documents, options = {}) {
  if (!Array.isArray(documents)) throw new TypeError('知识文档必须是数组');
  const maxDocuments = boundedInteger(
    options.maxDocuments,
    STUDIO_KNOWLEDGE_LIMITS.documents,
    STUDIO_KNOWLEDGE_LIMITS.documents,
  );
  const maxChunks = boundedInteger(
    options.maxChunks,
    STUDIO_KNOWLEDGE_LIMITS.chunks,
    STUDIO_KNOWLEDGE_LIMITS.chunks,
  );
  const chunks = [];
  let documentCount = 0;

  for (const entry of documents.slice(0, maxDocuments)) {
    if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') {
      throw new TypeError('每份知识文档都必须包含 fileName 和字符串 text');
    }
    documentCount += 1;
    const parsed = parseStudioKnowledgeMarkdown(entry.fileName, entry.text, {
      ...options,
      maxChunks: maxChunks - chunks.length,
    });
    for (const chunk of parsed) {
      if (chunks.length >= maxChunks) break;
      chunks.push(Object.freeze({
        ...chunk,
        normalizedTitle: normalizedSearchText(chunk.title),
        normalizedHeading: normalizedSearchText(chunk.heading),
        normalizedText: normalizedSearchText(chunk.text),
      }));
    }
    if (chunks.length >= maxChunks) break;
  }

  return Object.freeze({
    version: STUDIO_KNOWLEDGE_INDEX_VERSION,
    documentCount,
    chunkCount: chunks.length,
    chunks: Object.freeze(chunks),
  });
}

function occurrenceCount(haystack, needle, cap = 8) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (count < cap) {
    const found = haystack.indexOf(needle, offset);
    if (found < 0) break;
    count += 1;
    offset = found + Math.max(needle.length, 1);
  }
  return count;
}

function scoreChunk(chunk, phrase, tokens) {
  let score = 0;
  const distinctHeading = chunk.normalizedHeading !== chunk.normalizedTitle;
  if (chunk.normalizedTitle === phrase) score += 140;
  else if (chunk.normalizedTitle.includes(phrase)) score += 80;
  if (distinctHeading && chunk.normalizedHeading === phrase) score += 130;
  else if (distinctHeading && chunk.normalizedHeading.includes(phrase)) score += 70;
  score += occurrenceCount(chunk.normalizedText, phrase) * 25;

  let matchedTokens = 0;
  for (const token of tokens) {
    let matched = false;
    if (chunk.normalizedTitle === token) { score += 30; matched = true; }
    else if (chunk.normalizedTitle.includes(token)) { score += 16; matched = true; }
    if (distinctHeading && chunk.normalizedHeading === token) { score += 28; matched = true; }
    else if (distinctHeading && chunk.normalizedHeading.includes(token)) { score += 18; matched = true; }
    const bodyMatches = occurrenceCount(chunk.normalizedText, token, 5);
    if (bodyMatches) { score += bodyMatches * 5; matched = true; }
    if (matched) matchedTokens += 1;
  }
  if (tokens.length && matchedTokens === tokens.length) score += 20;
  return score;
}

function excerptFor(chunk, phrase, tokens, maximum) {
  const text = chunk.text || chunk.heading;
  if (text.length <= maximum) return text;
  const normalized = chunk.normalizedText;
  let anchor = normalized.indexOf(phrase);
  if (anchor < 0) {
    for (const token of tokens) {
      anchor = normalized.indexOf(token);
      if (anchor >= 0) break;
    }
  }
  if (anchor < 0) anchor = 0;
  const start = Math.max(0, Math.min(text.length - maximum, anchor - Math.floor(maximum * 0.35)));
  const excerpt = text.slice(start, start + maximum).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${start + maximum < text.length ? '…' : ''}`;
}

/**
 * 对内存索引进行确定性关键词检索，返回供 Wiki 用 textContent 渲染的纯数据。
 */
export function searchStudioKnowledge(index, query, options = {}) {
  if (!index || index.version !== STUDIO_KNOWLEDGE_INDEX_VERSION || !Array.isArray(index.chunks)) {
    throw new TypeError('知识索引无效或版本不受支持');
  }
  const phrase = normalizedSearchText(query).slice(0, STUDIO_KNOWLEDGE_LIMITS.queryCharacters);
  if (!phrase) return [];
  const tokens = tokenize(phrase);
  if (!tokens.length) return [];
  const topK = boundedInteger(options.topK, 8, STUDIO_KNOWLEDGE_LIMITS.topK);
  const excerptCharacters = boundedInteger(
    options.excerptCharacters,
    240,
    STUDIO_KNOWLEDGE_LIMITS.excerptCharacters,
  );

  return index.chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, phrase, tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.chunk.fileName.localeCompare(right.chunk.fileName, 'zh-CN')
      || left.chunk.heading.localeCompare(right.chunk.heading, 'zh-CN')
      || left.chunk.id.localeCompare(right.chunk.id, 'zh-CN')
    ))
    .slice(0, topK)
    .map(({ chunk, score }) => Object.freeze({
      fileName: chunk.fileName,
      heading: chunk.heading,
      excerpt: excerptFor(chunk, phrase, tokens, excerptCharacters),
      score,
    }));
}
