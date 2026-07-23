import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const modelPath = path.join(root, 'portal', 'assets', 'worldbook-workbench-model.js');
const removedKernelPath = path.join(root, 'portal', 'assets', 'worldbook-manager-kernel.js');
const studioPath = path.join(root, 'portal', 'assets', 'card-studio.js');
const studioCssPath = path.join(root, 'portal', 'assets', 'card-studio.css');
const rolecardImportAnalysisPath = path.join(root, 'portal', 'assets', 'rolecard-import-analysis.js');
const rolecardExportPlanPath = path.join(root, 'portal', 'assets', 'rolecard-export-plan.js');
const workshopPath = path.join(root, 'portal', 'assets', 'workshop-studio.js');
const localWorkspacePath = path.join(root, 'portal', 'assets', 'studio-local-workspace.js');
const studioAiPath = path.join(root, 'portal', 'assets', 'studio-ai.js');
const studioMcpPath = path.join(root, 'portal', 'assets', 'studio-mcp.js');
const studioKnowledgePath = path.join(root, 'portal', 'assets', 'studio-knowledge.js');
const componentWorkshopPath = path.join(root, 'portal', 'assets', 'component-workshop.js');
const portalPath = path.join(root, 'portal', 'index.html');
const portalScriptPath = path.join(root, 'portal', 'assets', 'portal.js');
const componentPreviewCssPath = path.join(root, 'portal', 'assets', 'component-preview.css');
const componentCatalogPath = path.join(root, 'portal', 'assets', 'card-component-catalog.json');
const modelSource = readFileSync(modelPath, 'utf8');
const studioSource = readFileSync(studioPath, 'utf8');
const studioCssSource = readFileSync(studioCssPath, 'utf8');
const rolecardImportAnalysisSource = readFileSync(rolecardImportAnalysisPath, 'utf8');
const rolecardExportPlanSource = readFileSync(rolecardExportPlanPath, 'utf8');
const workshopSource = readFileSync(workshopPath, 'utf8');
const localWorkspaceSource = readFileSync(localWorkspacePath, 'utf8');
const studioAiSource = readFileSync(studioAiPath, 'utf8');
const studioMcpSource = readFileSync(studioMcpPath, 'utf8');
const studioKnowledgeSource = readFileSync(studioKnowledgePath, 'utf8');
const componentWorkshopSource = readFileSync(componentWorkshopPath, 'utf8');
const portalSource = readFileSync(portalPath, 'utf8');
const portalScriptSource = readFileSync(portalScriptPath, 'utf8');
const componentPreviewCssSource = readFileSync(componentPreviewCssPath, 'utf8');
const componentCatalog = JSON.parse(readFileSync(componentCatalogPath, 'utf8'));

assert.doesNotMatch(portalSource, /\bdata-route-load-state\b/u, '入口不得保留可能永久占屏的路由加载门');
const initialPageTags = [...portalSource.matchAll(/<section\b[^>]*\bdata-page="[^"]+"[^>]*>/gu)].map((match) => match[0]);
assert.ok(initialPageTags.length >= 5, '入口必须识别全部顶层 data-page');
const initialGuideTag = initialPageTags.find((tag) => /\bdata-page="guide"/u.test(tag)) || '';
assert.ok(initialGuideTag, '入口必须保留 guide 回退页');
assert.doesNotMatch(initialGuideTag, /\bhidden\b/u, 'portal.js 接管前 guide 回退页必须可见');
for (const tag of initialPageTags.filter((candidate) => candidate !== initialGuideTag)) {
  assert.match(tag, /\bhidden\b/u, `portal.js 接管前所有 data-page 都必须隐藏：${tag}`);
}

assert.equal(existsSync(removedKernelPath), false, 'Runtime 世界书内核不得进入 RPN Web');
for (const forbidden of [
  'TavernHelper',
  'updateWorldbookWith',
  'createWorldbookManager',
  'window.parent',
  'window.WorldbookManagerKernel',
  'window.createWorldbookManager',
  'indexedDB',
  'localStorage',
]) {
  assert.equal(modelSource.includes(forbidden), false, 'Web 世界书模型包含禁止能力：' + forbidden);
}
assert.match(studioSource, /from '\.\/worldbook-workbench-model\.js\?v=[^']+';/);
assert.equal(studioSource.includes('worldbook-manager-kernel.js'), false);
assert.match(studioSource, /parts\[1\] === 'mine'/, '制卡工作台外层路由必须显示“我的发布”');
assert.match(studioSource, /from '\.\/studio-local-workspace\.js\?v=[^']+';/);
assert.match(studioSource, /from '\.\/studio-ai\.js\?v=[^']+';/);
assert.match(studioSource, /from '\.\/studio-mcp\.js\?v=[^']+';/);
assert.match(studioSource, /from '\.\/studio-api-profiles\.js\?v=[^']+';/);
assert.match(studioSource, /from '\.\/studio-agent-orchestrator\.js\?v=[^']+';/);
assert.match(studioSource, /from '\.\/studio-knowledge\.js\?v=[^']+';/);
assert.match(studioSource, /import \{ analyzeRolecardImport \} from '\.\/rolecard-import-analysis\.js\?v=[^']+';/, '制卡工作台必须通过独立纯分析器生成角色卡导入报告');
assert.match(studioSource, /import \{ createRolecardExportPlan \} from '\.\/rolecard-export-plan\.js\?v=[^']+';/, '制卡工作台必须通过带版本的纯计划模块生成装配预检');
for (const staticModule of ['card-studio', 'workshop-studio', 'component-workshop']) {
  assert.match(
    portalSource,
    new RegExp(`<script type="module" src="\\.\\/assets\\/${staticModule}\\.js\\?v=[^"]+"><\\/script>`, 'u'),
    `${staticModule} 必须在入口静态加载，避免 release WebView2 动态导入悬挂`,
  );
}
for (const staticStyle of ['component-preview', 'card-studio', 'workshop-studio', 'component-workshop']) {
  assert.match(
    portalSource,
    new RegExp(`<link rel="stylesheet" href="\\.\\/assets\\/${staticStyle}\\.css\\?v=[^"]+">`, 'u'),
    `${staticStyle} 必须在入口静态加载，避免运行时样式 Promise 阻塞路由`,
  );
}
assert.match(
  studioSource,
  /function startCardStudio\(\)[\s\S]{0,180}if \(!cardStudioInitPromise\) cardStudioInitPromise = init\(\);[\s\S]{0,80}return cardStudioInitPromise;/u,
  '制卡工作台与设置中心必须共享同一个按需初始化 Promise',
);
assert.match(
  studioSource,
  /function activateCardStudio\(route = currentPortalRoute\(\)\)[\s\S]{0,220}route !== 'studio' \|\| cardStudioInitPromise[\s\S]{0,120}startCardStudio\(\)\.catch/u,
  '制卡工作台必须等到首次进入 #studio 后才按需初始化',
);
assert.match(
  studioSource,
  /window\.addEventListener\('rpn:open-settings',[\s\S]{0,180}startCardStudio\(\)[\s\S]{0,120}openStudioAiSettings/u,
  '全局设置入口必须复用制卡工作台的单次按需初始化流程',
);
assert.match(
  workshopSource,
  /function activateWorkshopStudio\(route = currentPortalRoute\(\)\)[\s\S]{0,360}workshopStudioRoutes\.has\(currentStudioRoute\(\)\)[\s\S]{0,180}workshopStudioInitialized = true;[\s\S]{0,80}init\(\);/u,
  '星月二创工坊只能在 #studio 的资源库子路由首次激活',
);
assert.match(
  componentWorkshopSource,
  /function activateComponentWorkshop\(\)[\s\S]{0,240}root\.dataset\.cwsInitialized === 'true'[\s\S]{0,180}initComponentWorkshop\(root\);/u,
  '组件工坊只能在首次进入 #workshop 后渲染并请求发现列表',
);
for (const routeAwareSource of [studioSource, workshopSource, componentWorkshopSource]) {
  assert.match(
    routeAwareSource,
    /window\.addEventListener\('portal:routechange', \(event\) =>/u,
    '静态模块必须通过 portal:routechange 激活，不能在指南页直接执行隐藏工作台',
  );
}
for (const delayedSource of [studioSource, workshopSource]) {
  assert.match(
    delayedSource,
    /return location\.hash\.replace\([^;]+[\s\S]{0,100}\|\| document\.body\.dataset\.route/u,
    '延迟初始化必须优先识别直达 hash，不能被尚未同步的 body 路由阻断',
  );
}
assert.doesNotMatch(
  portalScriptSource,
  /routeModuleLoaders|routeModulePromises|routeStyleUrls|routeStylePromises|loadRouteModule|loadRouteStyle|loadActiveRouteModules|renderRouteGate/u,
  'portal.js 不得恢复运行时资源加载门',
);
assert.doesNotMatch(portalScriptSource, /async function renderRoute\(/u, '顶层路由切换不得等待异步资源');
assert.match(
  portalScriptSource,
  /function renderRoute\(\)[\s\S]{0,420}page\.hidden = page\.dataset\.page !== route;/u,
  '顶层路由必须同步切换目标页面可见性',
);
assert.match(rolecardExportPlanSource, /export function createRolecardExportPlan\(/, '纯计划模块必须导出唯一计划入口');

const componentPreviewStart = portalSource.indexOf('<section class="page-shell component-preview-page"');
const studioPageStart = portalSource.indexOf('<section class="page-shell studio-page"', componentPreviewStart);
assert.ok(componentPreviewStart >= 0 && studioPageStart > componentPreviewStart, '缺少前端组件预览页面');
const componentPreviewSource = portalSource.slice(componentPreviewStart, studioPageStart);
assert.equal((portalSource.match(/data-page="play"/g) || []).length, 1, '#play 必须只对应一个页面');
assert.match(portalSource, /href="#play" data-route-link="play">前端组件预览<\/a>/, '#play 导航必须使用前端组件预览语义');
assert.match(
  componentPreviewSource,
  /data-page="play"[^>]*aria-labelledby="component-preview-title"[^>]*>[\s\S]*<h1 id="component-preview-title" tabindex="-1">/,
  '前端组件预览必须保留通用路由焦点契约',
);
assert.match(componentPreviewSource, /首版只提供只读视觉样例/, '首版必须明确只读预览边界');
assert.match(componentPreviewSource, /href="#studio\/frontend"/, '组件预览必须提供组件工坊入口');
assert.match(componentPreviewSource, /href="#studio\/design"/, '组件预览必须提供 UI Builder 入口');
assert.match(componentPreviewSource, /外部 <code>registry\.json<\/code> 仍是真相源/, '组件预览必须声明外部注册表真相源');
assert.equal((componentPreviewSource.match(/data-component-preview-card=/g) || []).length, 3, '首版必须保持三类静态组件样例');
assert.ok(componentPreviewSource.includes(`<dd>v${componentCatalog.libraryVersion}</dd>`), '组件预览快照版本必须与内置目录一致');
assert.ok(componentPreviewSource.includes(`<dd>${componentCatalog.modules.length} 项</dd>`), '组件预览数量必须与内置目录一致');
assert.match(portalScriptSource, /const validRoutes = new Set\(\[[^\]]*'play'/, '#play 兼容路由不得移除');
assert.match(portalScriptSource, /play:\s*'前端组件预览 · Reverie Playcraft Nexus'/, '#play 文档标题必须使用新语义');
assert.match(portalSource, /\.\/assets\/component-preview\.css\?v=[^"']+/, '前端组件预览静态样式必须带缓存版本');
assert.match(componentPreviewCssSource, /\.component-preview-page\s*\{[\s\S]*?width:/, '前端组件预览必须拥有独立宽度布局');
assert.match(componentPreviewCssSource, /body\[data-route="play"\] \.site-header\s*\{[\s\S]*?--workspace-max/, '组件预览页头必须与宽工作区对齐');
assert.match(componentPreviewCssSource, /body\[data-route="play"\] \.site-footer\s*\{[\s\S]*?--workspace-max/, '组件预览页脚必须与宽工作区对齐');
for (const retiredAsset of [
  'xingyue-play.css',
  'xingyue-orb.css',
  'xingyue-floating.css',
  'xingyue-play.js',
  'xingyue-orb.js',
  'xingyue-floating.js',
]) {
  assert.equal(portalSource.includes(retiredAsset), false, `前端入口不得继续加载历史星月指南资源：${retiredAsset}`);
}

const guidePathStart = portalSource.indexOf('<section class="section-block guide-path-section"');
const guidePathEnd = portalSource.indexOf('</section>', guidePathStart);
assert.ok(guidePathStart >= 0 && guidePathEnd > guidePathStart, '制卡指南缺少五阶段学习路径');
const guidePathSource = portalSource.slice(guidePathStart, guidePathEnd);
for (const stageLabel of ['角色卡结构', '导入与拆卡', '变量链', '组件化与前端', '验证与导出']) {
  assert.match(guidePathSource, new RegExp(`<span>${stageLabel}</span>`), `制卡指南缺少阶段：${stageLabel}`);
}
assert.equal((guidePathSource.match(/class="guide-path-card(?:\s[^"]*)?"/g) || []).length, 5, '制卡指南必须保持五阶段路径');
for (const route of ['project', 'card', 'worldbook', 'mvu', 'frontend', 'design', 'workflow', 'check']) {
  assert.match(guidePathSource, new RegExp(`href="#studio/${route}"`), `制卡指南缺少工作台入口：${route}`);
}
for (const variableChainLabel of ['Schema 与变量根', '初始值', '更新方言与规则', '世界书与前端消费者', 'Check']) {
  assert.ok(guidePathSource.includes(variableChainLabel), `制卡指南变量链缺少：${variableChainLabel}`);
}

assert.match(studioSource, /const ROUTES = new Set\(\[[^\]]*'tutorial'[^\]]*\]\)/, '工作台教程必须注册为独立子路由');
assert.match(studioSource, /tutorial:\s*\['工作台教程'/, 'Agent 上下文必须识别工作台教程');
assert.match(portalSource, /data-rcs-route-link="tutorial"/, '工作台顶栏必须提供教程入口');
assert.match(portalSource, /data-rcs-view="tutorial"/, '工作台必须提供独立教程页面');
for (const chapter of ['start', 'map', 'storage', 'import', 'agent', 'export']) {
  assert.match(portalSource, new RegExp(`data-rcs-tutorial-target="rcs-tutorial-${chapter}"`), `工作台教程缺少章节入口：${chapter}`);
}
assert.match(studioSource, /\$\$\('\[data-rcs-tutorial-target\]'\)[\s\S]{0,360}scrollIntoView\(\{ block: 'start' \}\)/, '教程章节入口必须在当前路由内滚动定位');
const vibePageStart = portalSource.indexOf('<section class="page-shell vibe-page"');
assert.ok(vibePageStart > guidePathStart && vibePageStart < componentPreviewStart, 'Vibe Coding 新手避坑必须位于制卡指南外的独立页面');
const vibePageSource = portalSource.slice(vibePageStart, componentPreviewStart);
assert.equal((portalSource.match(/data-page="vibe"/g) || []).length, 1, '#vibe 必须只对应一个页面');
assert.match(portalSource, /href="#vibe" data-route-link="vibe">新手避坑<\/a>/, '主导航必须提供独立 #vibe Tab');
assert.match(vibePageSource, /data-page="vibe"[^>]*aria-labelledby="vibe-guide-title"/, '#vibe 必须保留独立页面与标题契约');
assert.match(vibePageSource, /<h1 id="vibe-guide-title" tabindex="-1">/, '#vibe 必须提供路由焦点目标');
assert.doesNotMatch(vibePageSource, /<span class="vibe-guide-summary-copy">[\s\S]*?<h1/, '#vibe 的 h1 不得放进只允许短语内容的 span');
assert.match(portalScriptSource, /const validRoutes = new Set\(\[[^\]]*'vibe'/, '#vibe 必须注册为顶层路由');
assert.match(portalScriptSource, /vibe:\s*'Vibe Coding 新手避坑 · Reverie Playcraft Nexus'/, '#vibe 文档标题必须使用独立语义');
assert.ok(vibePageSource.includes('https://github.com/LiarMTTT/TavernWeave'), '新手页必须指向 TavernWeave 仓库真相源');
assert.ok(vibePageSource.includes('由 9 个专用 Skill 分担'), '新手页必须解释 TavernWeave 阵列而非旧单 Skill');
assert.ok(vibePageSource.includes('每次只加载当前模块对应的一个主 Skill'), '新手页必须明确单路由单主 Skill 的上下文边界');

const tavernWeaveConstantsSource = studioSource.slice(
  studioSource.indexOf('const TAVERNWEAVE_SKILL_NAMES'),
  studioSource.indexOf('const capabilityProfiles'),
);
const tavernWeaveRoutingSource = studioSource.slice(
  studioSource.indexOf('function studioSkillByName'),
  studioSource.indexOf('function stripSkillInvocation'),
);
const tavernWeaveRoutingHarness = Function(`
  ${tavernWeaveConstantsSource}
  let studioSkills = [];
  let activeRoute = 'project';
  let activeReviewKind = 'text';
  let agentMode = 'claude';
  let aiSettings = { selectedSkillName: '' };
  const currentReviewAgentItem = () => null;
  ${tavernWeaveRoutingSource}
  const invoke = (skills, skillName, mode = 'claude', selectedSkillName = '') => {
    studioSkills = skills;
    aiSettings = { selectedSkillName };
    return skillInvocation(skillName, mode);
  };
  return {
    noSource: invoke([], 'tavern-card-builder'),
    unrelatedSource: invoke([{ name: 'unrelated-skill' }], 'tavern-card-builder'),
    legacyBuilder: invoke([{ name: 'tavern-card-builder' }], 'tavern-card-builder'),
    legacyClaudeSpecialist: invoke([{ name: 'tavern-card-builder' }], 'sillytavern-embedded-ui'),
    legacyCodexSpecialist: invoke([{ name: 'tavern-card-builder' }], 'code-quality-workflow', 'codex'),
    weaveArray: invoke([{ name: 'tavern-card-builder' }, { name: 'sillytavern-card-components' }], 'sillytavern-card-components'),
    codex: invoke([], 'code-quality-workflow', 'codex'),
    thirdPartyClaude: invoke([{ name: 'my-card-skill' }], 'tavern-card-builder', 'claude', 'my-card-skill'),
    thirdPartyCodex: invoke([{ name: 'my-card-skill' }], 'tavern-card-builder', 'codex', 'my-card-skill'),
  };
`)();
assert.equal(tavernWeaveRoutingHarness.noSource, '/tavernweave-agent-skills:tavern-card-builder', '未授权本机目录时 Claude 必须默认新版插件命名空间');
assert.equal(tavernWeaveRoutingHarness.unrelatedSource, '/tavernweave-agent-skills:tavern-card-builder', '无关 Skill 不得误触发旧 standalone 调用');
assert.equal(tavernWeaveRoutingHarness.legacyBuilder, '/tavern-card-builder', '只发现旧单 builder 时必须保留 standalone 兼容调用');
assert.equal(tavernWeaveRoutingHarness.legacyClaudeSpecialist, '/tavern-card-builder', '旧 Claude standalone 安装缺少专用 Skill 时必须回退 builder');
assert.equal(tavernWeaveRoutingHarness.legacyCodexSpecialist, '请使用 $tavern-card-builder。', '旧 Codex standalone 安装缺少专用 Skill 时必须回退 builder');
assert.equal(tavernWeaveRoutingHarness.weaveArray, '/tavernweave-agent-skills:sillytavern-card-components', 'TavernWeave 阵列必须使用 Claude 插件命名空间');
assert.equal(tavernWeaveRoutingHarness.codex, '请使用 $code-quality-workflow。', 'Codex 必须保持 $skill-name 调用');
assert.equal(tavernWeaveRoutingHarness.thirdPartyClaude, '/my-card-skill', 'Claude 第三方 Skill 必须使用独立 /skill-name 调用');
assert.equal(tavernWeaveRoutingHarness.thirdPartyCodex, '请使用 $my-card-skill。', 'Codex 第三方 Skill 必须使用 $skill-name 调用');
const selectedStudioSkillSource = studioSource.slice(
  studioSource.indexOf('function selectedStudioSkill('),
  studioSource.indexOf('function skillInvocation'),
);
assert.match(selectedStudioSkillSource, /if \(aiSettings\.selectedSkillName\) return studioSkillByName\(selectedName\)/, '用户固定第三方 Skill 时只能精确选择，不得静默回退 TavernWeave');
const renderStudioSkillSelectionSource = studioSource.slice(
  studioSource.indexOf('function renderStudioSkillSelection'),
  studioSource.indexOf('async function selectStudioSkill'),
);
assert.match(renderStudioSkillSelectionSource, /const effective = selectedStudioSkill\(\)/, '自动 Skill 状态必须读取实际生效的兼容路由');
assert.match(renderStudioSkillSelectionSource, /兼容回退/, '目标 Skill 缺失时界面必须披露实际回退而非宣称未加载目标已生效');
const studioWorkbenchSkillMessagesSource = studioSource.slice(
  studioSource.indexOf('function studioWorkbenchSkillMessages'),
  studioSource.indexOf('function directAiTask'),
);
assert.match(studioWorkbenchSkillMessagesSource, /const skill = selectedStudioSkill\(skillName\)/, '内置 Agent 必须从用户选择的唯一 Skill 组装提示');
assert.match(studioWorkbenchSkillMessagesSource, /if \(!skill\?\.text\) return \[\]/, '用户选择的 Skill 不可用时不得注入其他 Skill');
const skillApiDisclosure = '授权、路径、其他文件与脚本不会上传；只有用户运行内置 Agent / AI 解释时，当前选中 SKILL.md 正文会随该次请求发送到所选 API。';
assert.match(
  vibePageSource,
  /授权、路径、其他文件与脚本不会上传；只有用户运行内置 Agent \/ AI 解释时，当前选中 <code>SKILL\.md<\/code> 正文会随该次请求发送到所选 API。/,
  '新手 Skill 授权说明必须披露当前 SKILL.md 正文会发送到所选 API',
);
assert.ok(studioSource.includes(skillApiDisclosure), '工作台 Skill 就绪状态必须披露当前 SKILL.md 正文会发送到所选 API');
assert.equal(portalSource.includes('目录内容只驻留本页内存'), false, 'Skill 隐私文案不得继续声称全部目录内容只驻留本页');
assert.equal(studioSource.includes('目录内容只驻留本页内存'), false, '动态 Skill 状态不得继续声称全部目录内容只驻留本页');
const refreshKnowledgeSource = studioSource.slice(
  studioSource.indexOf('async function refreshStudioKnowledgeSources'),
  studioSource.indexOf('async function pickStudioKnowledgeSource'),
);
assert.match(refreshKnowledgeSource, /roles\.includes\('skill'\)[\s\S]{0,40}studioKnowledgeTask = ''/, 'Skill 源变化必须立即使旧 Wiki 外置任务包失效');
assert.match(refreshKnowledgeSource, /roles\.includes\('skill'\)[\s\S]{0,180}renderAssistant\(\)/, 'Skill 源切换、失权或扫描失败后必须立即刷新外置任务包');
const saveStudioAgentPathsKnowledgeTaskSource = studioSource.slice(
  studioSource.indexOf('async function saveStudioAgentPaths'),
  studioSource.indexOf('function clearStudioKnowledgeDerived'),
);
assert.match(saveStudioAgentPathsKnowledgeTaskSource, /studioKnowledgeTask = '';[\s\S]{0,160}renderAssistant\(\)/, '外置路径变化必须清除含旧路径的 Wiki 任务包并刷新界面');

assert.match(portalSource, /<input(?=[^>]*data-rcs-worldbook-file)(?=[^>]*\bmultiple\b)[^>]*>/, '世界书文件选择器必须支持多文件');
assert.match(portalSource, /data-rcs-import-worldbook data-rcs-worldbook-import-mode="append">融合多个世界书<\/button>/, '总览必须提供显式多世界书融合入口');
assert.match(portalSource, /data-rcs-entry-editor-empty/, '空世界书必须渲染明确的编辑区空态');
assert.ok(portalSource.includes('<article aria-label="正则脚本">'), '正则资源 article 必须有可访问名称');
assert.ok(portalSource.includes('<article aria-label="酒馆助手 ScriptTree">'), '酒馆助手资源 article 必须有可访问名称');
assert.ok(studioSource.includes('一次导入一份或多份 ST 世界书 JSON'), '世界书左栏空态不得在渲染后退回单文件文案');
assert.match(studioSource, /Promise\.all\(files\.map\(parseWorldbookImportFile\)\)/, '多世界书必须先完成整批解析再写入');
assert.match(studioSource, /type:\s*'worldbook-import'[\s\S]{0,240}files:\s*files\.map/, '多世界书必须只记录一条批次历史并保留文件名');
const entryTypingPlanStart = studioSource.indexOf('function entryTypingRenderPlan');
const entryTypingPlanEnd = studioSource.indexOf('\n  function updateEntryNameUi', entryTypingPlanStart);
assert.ok(entryTypingPlanStart >= 0 && entryTypingPlanEnd > entryTypingPlanStart, '世界书连续输入必须有独立渲染计划');
const entryTypingRenderPlan = Function(`
  ${studioSource.slice(entryTypingPlanStart, entryTypingPlanEnd)}
  return entryTypingRenderPlan;
`)();
assert.deepEqual(entryTypingRenderPlan('content', ''), { updateName: false, refreshList: false }, '正文输入不得重建空搜索列表');
assert.deepEqual(entryTypingRenderPlan('name', ''), { updateName: true, refreshList: false }, '名称输入只应局部更新当前列表项');
assert.deepEqual(entryTypingRenderPlan('name', 'needle'), { updateName: true, refreshList: true }, '搜索生效时名称输入必须最终重筛');
assert.equal(entryTypingRenderPlan('keys', ''), null, '非连续输入字段必须保留完整重建路径');
const entryTypingRefreshSource = studioSource.slice(
  studioSource.indexOf('function scheduleEntryTypingRefresh'),
  studioSource.indexOf('\n  function makeTextBlock', entryTypingPlanEnd),
);
assert.match(entryTypingRefreshSource, /clearTimeout\(entryTypingRefreshTimer\)[\s\S]*setTimeout\(/, '连续输入派生刷新必须合并');
assert.match(entryTypingRefreshSource, /if \(refreshList\) renderEntryList\(\)/, '只有必要时才允许连续输入重建列表');
assert.doesNotMatch(entryTypingRefreshSource, /fillEntryEditor\(\)/, '延迟刷新不得重填编辑器并重置光标');
for (const call of ['renderEntryValidation', 'renderActivationPreview', 'renderModuleStates', 'renderAssistant']) {
  assert.ok(entryTypingRefreshSource.includes(`${call}(`), `连续输入结束后必须最终刷新 ${call}`);
}
const updateEntryFieldSource = studioSource.slice(
  studioSource.indexOf('function updateEntryField'),
  studioSource.indexOf('\n  function duplicateEntry'),
);
const entryTypingFastPath = updateEntryFieldSource.slice(0, updateEntryFieldSource.indexOf('\n    renderEntryList();'));
assert.match(entryTypingFastPath, /markDirty\([\s\S]*if \(typingPlan\)[\s\S]*scheduleEntryTypingRefresh\([\s\S]*return;/, '连续输入必须先进入自动保存再走局部快路径');
assert.doesNotMatch(entryTypingFastPath, /fillEntryEditor\(\)/, '名称与正文输入不得同步重填编辑器');
const worldbookFingerprintSource = studioSource.slice(
  studioSource.indexOf('function worldbookFusionFingerprint'),
  studioSource.indexOf('async function parseWorldbookImportFile'),
);
const worldbookFingerprint = Function(`
  const safeJsonClone = structuredClone;
  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  ${worldbookFingerprintSource}
  return worldbookFusionFingerprint;
`)();
const fingerprintEntry = {
  uid: 1,
  name: '同名条目',
  content: '相同正文',
  meta: { studioPassthrough: { surface: 'standalone', raw: { uid: 1, futureField: { vendor: 1 } } } },
};
const sameRawDifferentUid = structuredClone(fingerprintEntry);
sameRawDifferentUid.uid = 2;
sameRawDifferentUid.meta.studioPassthrough.raw.uid = 2;
assert.equal(worldbookFingerprint(fingerprintEntry), worldbookFingerprint(sameRawDifferentUid), '完整 raw 仅 UID 不同时允许判为重复');
const differentUnknownField = structuredClone(sameRawDifferentUid);
differentUnknownField.meta.studioPassthrough.raw.futureField.vendor = 2;
assert.notEqual(worldbookFingerprint(fingerprintEntry), worldbookFingerprint(differentUnknownField), '未知字段不同时不得误判为完全重复');
for (const hook of [
  'data-rcs-extension-import="regex"',
  'data-rcs-extension-export="regex"',
  'data-rcs-extension-import="tavern-helper"',
  'data-rcs-extension-export="tavern-helper"',
  'data-rcs-extension-status',
]) assert.ok(portalSource.includes(hook), `扩展资源往返缺少结构接线：${hook}`);
assert.equal((portalSource.match(/data-rcs-extension-file=/g) || []).length, 2, '正则与酒馆助手必须使用独立多文件输入');
assert.match(studioSource, /parseRolecardExtensionAssetPayload\(raw, kind\)/, '扩展资源必须通过纯数据 codec 解析');
assert.match(studioSource, /mergeRolecardExtensionAssetItems\(currentItems, incoming/, '扩展资源必须显式处理重复与同 ID 冲突');
assert.match(studioSource, /applyRolecardExtensionAssets\([\s\S]{0,180}project\.cardExtensions/, '角色卡装配必须写回项目管理的扩展资源');
assert.match(studioSource, /function assertUnambiguousCardExtensions\([\s\S]{0,500}多个[\s\S]{0,160}容器/, '扩展资源多容器歧义必须显式阻断，不能静默忽略');
assert.match(studioSource, /items\.length > 1 && !outputHandle[\s\S]{0,500}未触发可能被浏览器拦截的连续下载/, '多个 ScriptTree 在没有产出目录时不得伪报连续下载成功');
const workspaceImportGateSource = studioSource.slice(
  studioSource.indexOf('async function runWorkspaceImport'),
  studioSource.indexOf('function fillStudioAgentPathFields'),
);
assert.match(workspaceImportGateSource, /if \(workspaceImportBusy\) throw/, '并发工作区导入必须被单一事务门拒绝');
assert.match(workspaceImportGateSource, /root\.inert = true[\s\S]*aria-busy[\s\S]*finally[\s\S]*root\.inert = previousInert/, '导入落盘期间必须锁定工作区编辑，并在成功或失败后恢复');
const importRootAttributes = new Map();
const importRoot = {
  inert: false,
  getAttribute: (name) => importRootAttributes.has(name) ? importRootAttributes.get(name) : null,
  setAttribute: (name, value) => importRootAttributes.set(name, String(value)),
  removeAttribute: (name) => importRootAttributes.delete(name),
};
const importGate = Function('root', `
  let workspaceImportBusy = false;
  ${workspaceImportGateSource}
  return runWorkspaceImport;
`)(importRoot);
let finishImport;
const pendingImport = importGate('世界书', () => new Promise((resolve) => { finishImport = resolve; }));
assert.equal(importRoot.inert, true, '导入候选落盘未完成时工作区必须不可编辑');
assert.equal(importRootAttributes.get('aria-busy'), 'true');
await assert.rejects(() => importGate('正则', async () => {}), /另一项导入仍在进行/);
finishImport('done');
assert.equal(await pendingImport, 'done');
assert.equal(importRoot.inert, false, '导入完成后必须恢复原 inert 状态');
assert.equal(importRootAttributes.has('aria-busy'), false, '导入完成后必须恢复原 aria-busy 状态');
await assert.rejects(() => importGate('失败样本', async () => { throw new Error('expected-import-failure'); }), /expected-import-failure/);
assert.equal(importRoot.inert, false, '失败导入也必须解除工作区锁定');
assert.ok((studioSource.match(/runWorkspaceImport\(/g) || []).length >= 8, '角色卡、世界书、扩展、项目备份、恢复点与新建工作区必须共用事务门');
assert.match(studioSource, /runWorkspaceImport\('新建工作区', startNewWorkspace\)/, '新建空白工作区的恢复点写入期间也必须锁定编辑');

const embeddedWorldbookBlock = studioSource.slice(
  studioSource.indexOf('const embeddedPosition'),
  studioSource.indexOf('function buildRolecardJson'),
);
const standaloneCanonical = {
  uid: 9,
  keys: ['新关键词'],
  secondaryKeys: ['次关键词'],
  name: '融合条目',
  content: '融合正文',
  strategyType: 'selective',
  selective: true,
  order: 120,
  enabled: true,
  positionType: 'after_character_definition',
  depth: 4,
  probability: 100,
  scanDepth: 'same_as_global',
  group: '',
  groupOverride: false,
  groupWeight: 100,
  useGroupScoring: false,
  sticky: 0,
  cooldown: 0,
  delay: 0,
  caseSensitive: null,
  matchWholeWords: null,
  recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
  meta: {
    studioPassthrough: {
      surface: 'standalone',
      raw: {
        uid: 2,
        key: ['旧关键词'],
        order: 1,
        automationId: 'automation-keep',
        outletName: 'outlet-keep',
        futureField: { vendor: 7 },
        extensions: { vendor_extension: { keep: true } },
      },
      originalBehavior: { preventIncoming: false, preventOutgoing: false, caseSensitive: null, matchWholeWords: null },
    },
  },
};
const embeddedProject = {
  entry: { source: { rawCard: null } },
  card: { name: '融合卡' },
  worldbook: { book: { name: '融合世界书', description: '', rawOriginalData: {} }, entries: [standaloneCanonical] },
};
const embeddedWorldbook = Function('project', 'cardAdapter', `
  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const safeJsonClone = structuredClone;
  const cardDataFromRaw = () => ({});
  const normalizeUid = (value) => Number(value);
  ${embeddedWorldbookBlock}
  return embeddedWorldbook;
`)(embeddedProject, {
  fromCanonical: (entry) => ({
    key: [...entry.keys], keysecondary: [...entry.secondaryKeys], comment: entry.name, content: entry.content,
    constant: false, selective: entry.selective, selectiveLogic: 0, order: entry.order, disable: !entry.enabled,
    extensions: { position: 1, role: 0 },
  }),
});
const embeddedEntry = embeddedWorldbook().entries[0];
assert.equal(embeddedEntry.id, 9);
assert.deepEqual(embeddedEntry.keys, ['新关键词']);
assert.equal(Object.hasOwn(embeddedEntry, 'uid'), false, '独立世界书 UID 不得作为过期别名污染嵌入条目');
assert.equal(Object.hasOwn(embeddedEntry, 'key'), false, '独立世界书 key 不得作为过期别名污染嵌入条目');
assert.equal(embeddedEntry.automationId, 'automation-keep', '未映射 automation 字段必须透传');
assert.equal(embeddedEntry.outletName, 'outlet-keep', '未映射 outlet 字段必须透传');
assert.deepEqual(embeddedEntry.futureField, { vendor: 7 }, '独立世界书未知顶层字段必须透传');
assert.deepEqual(embeddedEntry.extensions.vendor_extension, { keep: true }, '独立世界书未知 extensions 字段必须透传');
assert.match(studioSource, /已触发浏览器下载[^`]*请在下载列表确认/, '浏览器下载回退不得伪报已完成');

const workspaceOverviewStart = portalSource.indexOf('<section class="rcs-workspace-overview">');
const workspaceOverviewEnd = portalSource.indexOf('</section>', workspaceOverviewStart);
const importAnalysisMarkupStart = portalSource.indexOf('<section class="rcs-import-analysis"');
const localFoldersStart = portalSource.indexOf('<section class="rcs-local-folders"');
assert.ok(
  workspaceOverviewStart >= 0
    && workspaceOverviewEnd > workspaceOverviewStart
    && importAnalysisMarkupStart > workspaceOverviewEnd
    && localFoldersStart > importAnalysisMarkupStart,
  '导入分析必须位于工作区总览之后、本机目录设置之前',
);
const importAnalysisMarkup = portalSource.slice(importAnalysisMarkupStart, localFoldersStart);
for (const hook of [
  'data-rcs-import-analysis',
  'data-rcs-import-analysis-empty',
  'data-rcs-import-analysis-content',
  'data-rcs-import-analysis-summary',
  'data-rcs-import-analysis-list="editable"',
  'data-rcs-import-analysis-list="sources"',
  'data-rcs-import-analysis-list="preserved"',
  'data-rcs-import-analysis-list="candidates"',
]) assert.ok(importAnalysisMarkup.includes(hook), `导入分析缺少结构接线：${hook}`);
assert.equal((importAnalysisMarkup.match(/data-rcs-import-analysis-list=/g) || []).length, 4, '导入分析必须保持四组只读清单');
const candidateMarkupStart = importAnalysisMarkup.indexOf('data-rcs-import-analysis-group="candidates"');
const candidateMarkupEnd = importAnalysisMarkup.indexOf('</section>', candidateMarkupStart);
assert.ok(candidateMarkupStart >= 0 && candidateMarkupEnd > candidateMarkupStart, '导入分析缺少组件候选分组');
assert.doesNotMatch(
  importAnalysisMarkup.slice(candidateMarkupStart, candidateMarkupEnd),
  /data-rcs-component-id/,
  '导入分析候选不得复用真实组件选型按钮',
);

const loadComponentCatalogSource = studioSource.slice(
  studioSource.indexOf('async function loadComponentCatalog'),
  studioSource.indexOf('const componentTreeGroups'),
);
assert.match(studioSource, /let componentCatalogStatus = 'loading'/, '组件目录必须显式记录加载中状态');
assert.match(loadComponentCatalogSource, /componentCatalogStatus = 'ready'/, '组件目录成功后必须进入 ready 状态');
assert.match(loadComponentCatalogSource, /componentCatalogStatus = 'error'/, '组件目录失败后必须进入 error 状态');

const importAnalysisRenderStart = studioSource.indexOf('function importAnalysisItem');
const importAnalysisRenderEnd = studioSource.indexOf('function renderProjectDashboard', importAnalysisRenderStart);
assert.ok(importAnalysisRenderStart >= 0 && importAnalysisRenderEnd > importAnalysisRenderStart, '无法提取导入分析渲染边界');
const importAnalysisRenderSource = studioSource.slice(importAnalysisRenderStart, importAnalysisRenderEnd);
assert.match(importAnalysisRenderSource, /\.replaceChildren\(/, '导入分析清单必须使用 replaceChildren 安全替换');
assert.match(importAnalysisRenderSource, /\.textContent\s*=/, '导入分析文字必须通过 textContent 渲染');
assert.match(importAnalysisRenderSource, /componentCatalogStatus === 'error'[\s\S]*组件目录暂不可用/, '组件目录错误不得冒充真实零候选');
assert.match(importAnalysisRenderSource, /componentCatalogStatus === 'loading'[\s\S]*组件目录读取中/, '导入分析必须保留目录加载中状态');
for (const forbiddenCapability of [
  /innerHTML/,
  /insertAdjacentHTML/,
  /\beval\s*\(/,
  /new Function/,
  /\bfetch\s*\(/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /\bidb(?:Get|Put|Delete|Batch|Open)?\s*\(/i,
  /persistWorkspaceAtomic/,
  /saveProjectNow/,
  /markDirty\s*\(/,
  /createWritable\s*\(/,
]) assert.doesNotMatch(importAnalysisRenderSource, forbiddenCapability, `导入分析渲染包含越界能力：${forbiddenCapability}`);
for (const forbiddenMutation of [
  /selectedComponents\s*=/,
  /selectedComponents\.(?:push|splice|add|delete)\s*\(/,
  /project\.state(?:\.[\w$]+)?\s*=/,
  /toggleComponent\s*\(/,
  /setStateKind\s*\(/,
  /updateStateField\s*\(/,
]) assert.doesNotMatch(importAnalysisRenderSource, forbiddenMutation, `导入分析不得修改组件或状态：${forbiddenMutation}`);

const renderProjectDashboardSource = studioSource.slice(
  studioSource.indexOf('function renderProjectDashboard'),
  studioSource.indexOf('function renderToolbar'),
);
assert.match(renderProjectDashboardSource, /renderImportAnalysis\(\)/, '项目总览刷新时必须同步刷新导入分析');

assert.match(rolecardImportAnalysisSource, /export function analyzeRolecardImport\(/, '角色卡纯分析器必须导出唯一分析入口');
for (const forbiddenAnalyzerCapability of [
  /\bdocument\b/,
  /\bwindow\b/,
  /\bHTMLElement\b/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /\bidb(?:Get|Put|Delete|Batch|Open)?\s*\(/i,
  /\beval\s*\(/,
  /new Function/,
  /window\.TavernHelper/,
  /globalThis\.TavernHelper/,
  /\bTavernHelper\s*\./,
  /window\.Mvu/,
  /createWritable\s*\(/,
]) assert.doesNotMatch(rolecardImportAnalysisSource, forbiddenAnalyzerCapability, `角色卡纯分析器包含越界能力：${forbiddenAnalyzerCapability}`);
assert.doesNotMatch(rolecardImportAnalysisSource, /selectedComponents|project\.state/, '角色卡纯分析器不得自动选择组件或修改工作台状态');
assert.match(studioSource, /DB_AI_SETTINGS_KEY = 'studioAi:settings:v1'/);
assert.match(studioSource, /DB_AIRP_LIBRARY_KEY = 'studioAi:airpLibrary:v1'/);
const persistedAiSettings = studioSource.slice(
  studioSource.indexOf('function studioAiSettingsStorageValue'),
  studioSource.indexOf('async function cacheAirpLibraryIfAllowed'),
);
assert.match(persistedAiSettings, /version:\s*4/, 'AI 设置必须以 v4 payload 保存服务商预设、多 API、路由与 Skill 选择');
assert.match(persistedAiSettings, /apiProfiles:/, 'AI 设置必须持久化 API 配置档');
assert.match(persistedAiSettings, /activeApiId:/, 'AI 设置必须保留 activeApiId 兼容镜像');
assert.match(persistedAiSettings, /routingMode:/, 'AI 设置必须持久化单模型或委派模式');
assert.match(persistedAiSettings, /enabledApiIds:/, 'AI 设置必须持久化多配置启用范围');
assert.match(persistedAiSettings, /roleBindings:/, 'AI 设置必须持久化 primary、worker 与 reviewer 绑定');
assert.match(persistedAiSettings, /selectedSkillName:/, 'AI 设置必须持久化用户选择的第三方 Skill');
assert.equal(/apiKey|api_key|Authorization/.test(persistedAiSettings), false, 'AI 设置持久化不得包含 API Key');
assert.equal(/sessionKey/i.test(persistedAiSettings), false, '页面内存 Key Map 不得进入持久化 payload');
assert.match(studioSource, /const aiApiKey = \$\('\[data-rcs-ai-api-key\]'\)/);
assert.match(studioSource, /let aiSessionKeys = new Map\(\)/, 'API Key 必须按 API 配置档隔离在页面内存 Map');
assert.match(studioSource, /let codingPlanSessionKeys = new Map\(\)/, 'Coding Plan Key 必须使用独立页面内存 Map');
assert.match(studioSource, /studioAiKeyMap\(profile\)\.get\(profile\.id\)/, '读取 Key 时必须按凭证类别和配置档标识');
assert.match(studioSource, /studioAiKeyMap\(profile\)\.set\(profile\.id,\s*typedKey\)/, '保存 Key 时必须按凭证类别和配置档标识');
const activeStudioAiProfileSource = studioSource.slice(
  studioSource.indexOf('function activeStudioAiProfile'),
  studioSource.indexOf('function isStudioAiProfileReady'),
);
assert.match(activeStudioAiProfileSource, /roleBindings\?\.primary/, '运行时必须只以 primary 绑定选择主模型');
assert.doesNotMatch(activeStudioAiProfileSource, /activeApiId/, 'activeApiId 只能作为持久化兼容镜像，不得成为静默运行时回退');
const switchStudioAiCredentialKindSource = studioSource.slice(
  studioSource.indexOf('function switchStudioAiCredentialKind'),
  studioSource.indexOf('function switchStudioAiCodingPlanPreset'),
);
assert.match(switchStudioAiCredentialKindSource, /codingPlanSessionKeys\.delete\(existing\.id\)/, '从 Coding Plan 切换凭证类型必须销毁旧 Plan Key');
assert.match(switchStudioAiCredentialKindSource, /aiSessionKeys\.delete\(existing\.id\)/, '从普通 API 切换凭证类型必须销毁旧 API Key');
assert.match(portalSource, /data-rcs-ai-api-key aria-label="API Key"/, 'API Key 输入框必须拥有独立可访问名称');
const activateStudioAiProfileSource = studioSource.slice(
  studioSource.indexOf('async function activateStudioAiProfile'),
  studioSource.indexOf('async function disableStudioAiProfile'),
);
assert.match(activateStudioAiProfileSource, /studioAiConnectionFormDirty\(profile\)/, '未保存的 API 表单不得启用旧配置值');
assert.match(studioSource, /function clearStudioAiSessionKey[\s\S]{0,700}renderStudioAiProfileManager\(\)/, '清除 Key 后必须刷新 API 配置按钮状态');
assert.match(studioSource, /let aiModelRequestController = null/, '模型列表请求必须受页面生命周期控制');
assert.match(studioSource, /client\.listModels\(\{ signal: controller\.signal \}\)/);
const studioAiTransportSource = studioSource.slice(
  studioSource.indexOf('function studioAiTransportOptions'),
  studioSource.indexOf('\n  function renderAiModels'),
);
assert.match(studioAiTransportSource, /typeof invoke !== 'function'[\s\S]*return \{\}/, 'Web 预览必须保留浏览器 fetch 边界');
assert.match(studioAiTransportSource, /createDesktopAiFetch\(\{ invoke \}\)/, '正式桌面必须使用受控原生 AI 通道');
assert.match(studioAiTransportSource, /allowLoopbackHttp:\s*true/, '只有桌面原生 AI 通道可访问回环 HTTP 服务');
const studioAiConnectionRequestSource = studioSource.slice(
  studioSource.indexOf('async function runStudioAiConnectionRequest'),
  studioSource.indexOf('\n  function cancelStudioAiModelRequest'),
);
assert.match(studioAiConnectionRequestSource, /kind === 'inference'/);
assert.match(studioAiConnectionRequestSource, /client\.createChatCompletion\([\s\S]*Reply with OK\./, '测试推理必须发送最小真实生成请求');
assert.match(studioAiConnectionRequestSource, /client\.listModels\(\{ signal: controller\.signal \}\)/, '刷新模型必须保持独立可选能力');
assert.doesNotMatch(
  studioAiConnectionRequestSource.slice(
    studioAiConnectionRequestSource.indexOf('function testStudioAiInference'),
  ),
  /listModels/,
  '测试推理不得再以模型列表代表连接可用性',
);
assert.match(portalSource, /data-rcs-ai-test[^>]*>测试推理连接</, '设置页必须明确测试会执行真实推理');
assert.match(studioSource, /function closeStudioAiSettings[\s\S]{0,180}cancelStudioAiModelRequest\(\)/);
assert.match(studioSource, /pagehide[\s\S]{0,360}aiSessionKeys\.clear\(\)[\s\S]{0,120}aiApiKey\.value = ''/, '离页时必须销毁所有配置档的页面内存 Key');
assert.match(studioSource, /pagehide[\s\S]{0,400}aiSessionKeys\.clear\(\)[\s\S]{0,120}codingPlanSessionKeys\.clear\(\)/, '离页时必须同时销毁普通 Key 与 Coding Plan Key');
assert.match(studioSource, /pagehide[\s\S]{0,320}cancelStudioAiModelRequest\(\)[\s\S]{0,220}renderStudioAiConnectionSummary\(\)/);
assert.match(studioSource, /function closeStudioAiSettings[\s\S]{0,420}apiKey\.value = ''/, '关闭设置必须清空 Key 输入节点');
const loadStudioAiStateSource = studioSource.slice(
  studioSource.indexOf('async function loadStudioAiState'),
  studioSource.indexOf('function studioAiSettingsErrorDetail'),
);
assert.match(loadStudioAiStateSource, /storedSettings\?\.version === 1/, '必须识别旧 v1 AI 设置');
assert.match(loadStudioAiStateSource, /storedSettings\?\.version === 2/, '必须识别旧 v2 多配置 AI 设置');
assert.match(loadStudioAiStateSource, /storedSettings\?\.version === 3/, '必须识别当前 v3 路由与 Skill AI 设置');
assert.match(loadStudioAiStateSource, /storedSettings\.baseUrl/, 'v1 迁移必须保留 Base URL');
assert.match(loadStudioAiStateSource, /storedSettings\.model/, 'v1 迁移必须保留模型');
assert.match(loadStudioAiStateSource, /apiProfiles[:,]/, 'v1 连接必须迁移为 API 配置档');
assert.match(loadStudioAiStateSource, /activeApiId[:,]/, 'v1 连接迁移后必须成为 primary 兼容启用 API');
assert.match(loadStudioAiStateSource, /routingMode:\s*'single'/, 'v1/v2 必须迁移为显式单模型路由');
assert.match(loadStudioAiStateSource, /roleBindings:\s*\{\s*primary:\s*activeApiId,\s*worker:\s*'',\s*reviewer:\s*''\s*\}/, 'v1/v2 必须把 activeApiId 镜像为 primary 且不虚构子角色');
assert.match(studioSource, /prepareLocalWorkspaceWriteHandle\('cache'\)/, 'AIRP 导入用户手势内必须预授权缓存目录');
assert.match(studioSource, /unsupportedInChatPrompts/, '直连 AIRP 必须显式报告跳过的 In-Chat 提示');
assert.match(studioSource, /inspectAirpPreset\(record\.preset/);
assert.match(studioSource, /content\.textContent = entry\.content/);
assert.match(studioSource, /assembleAirpPrompt\(record\?\.preset, \{[\s\S]{0,120}orderCharacterId:/, '启用 AIRP 时直连生成必须使用当前顺序组，未启用时允许基础调用');
assert.match(studioSource, /let airpSettingsDraft = \{/, 'AIRP 设置必须使用独立草稿，切换预览不能直接改动当前启用预设');
const saveAirpSettingsSource = studioSource.slice(
  studioSource.indexOf('async function saveAirpSettings'),
  studioSource.indexOf('function discardAirpSettings'),
);
assert.match(saveAirpSettingsSource, /persistStudioAiSettings\(\{[\s\S]*selectedAirpId:\s*airpSettingsDraft\.selectedAirpId[\s\S]*airpOrderCharacterId:\s*airpSettingsDraft\.airpOrderCharacterId/, '保存操作必须把 AIRP 草稿作为下一持久化状态');
assert.match(saveAirpSettingsSource, /await persistStudioAiSettings[\s\S]*aiSettings\s*=\s*persisted/, 'AIRP 必须持久化成功后才提交运行态');
assert.match(studioSource, /async function disableAirpSettings\(\)[\s\S]{0,500}selectedAirpId:\s*''[\s\S]{0,120}airpOrderCharacterId:\s*''/, 'AIRP 必须可独立停用且不删除预设库');
assert.match(studioSource, /function discardAirpSettings[\s\S]{0,500}airpSettingsDraft[\s\S]{0,240}aiSettings\.selectedAirpId/, '放弃操作必须从当前启用 AIRP 恢复草稿');
const generateStudioAiSource = studioSource.slice(
  studioSource.indexOf('async function generateStudioAiCandidate'),
  studioSource.indexOf('function cancelStudioAiRequest'),
);
assert.match(generateStudioAiSource, /activeStudioAiProfile\(\)/, '直连生成必须读取唯一启用的 API 配置档');
assert.match(generateStudioAiSource, /selectedAirpRecord\(\)/, '直连生成必须读取已提交的 AIRP');
assert.doesNotMatch(generateStudioAiSource, /!profile\s*\|\|\s*!record\s*\|\|\s*!model/, '未启用 AIRP 不得阻止 API 生成');
assert.match(generateStudioAiSource, /aiSettings\.airpOrderCharacterId/, '直连生成必须读取已提交的 AIRP 顺序组');
assert.doesNotMatch(generateStudioAiSource, /airpSettingsDraft/, 'AIRP 草稿不得直接进入生成链路');
assert.match(generateStudioAiSource, /parseAgentTurnResponse\(completion\.text,\s*\{\s*allowProposal:\s*true\s*\}\)/, '条目生成必须显式开启白名单 JSON 提案解析');
assert.match(generateStudioAiSource, /text:\s*result\.proposal\.content/, '只有提案 content 可以进入待批准正文');
assert.doesNotMatch(generateStudioAiSource, /text:\s*completion\.text/, '模型整段回答不得直接成为世界书正文提案');
assert.match(generateStudioAiSource, /updateAgentEvent\(operationEvent\.id/, '提案生成必须结算进行中的操作记录');

const sendStudioAgentSource = studioSource.slice(
  studioSource.indexOf('async function sendStudioAgentMessage'),
  studioSource.indexOf('async function generateStudioAiCandidate'),
);
for (const forbiddenWrite of ['entry.content =', 'markDirty(', 'persistWorkspaceAtomic(', 'writeStudioLocal', 'createWritable(', 'approveStudioAgentProposal(']) {
  assert.equal(sendStudioAgentSource.includes(forbiddenWrite), false, `Agent 对话回合不得直接写项目：${forbiddenWrite}`);
}
assert.match(sendStudioAgentSource, /if \(aiRequestController\) return;/, 'Agent 对话必须阻止重入');
assert.match(sendStudioAgentSource, /if \(agentMode !== 'internal'\)/, '外置模式不得进入内置 Agent 对话链');
assert.match(sendStudioAgentSource, /\+\+aiGenerationSequence/);
assert.match(sendStudioAgentSource, /new AbortController\(\)/);
assert.match(sendStudioAgentSource, /sequence !== aiGenerationSequence \|\| controller !== aiRequestController/, '迟到响应不得进入 Agent 时间线');
assert.match(sendStudioAgentSource, /updateAgentEvent\(operationEvent\.id/, 'Agent 对话必须结算进行中的操作记录');
assert.match(sendStudioAgentSource, /const reviewHandoffActive = Boolean\(reviewAgentItemId \|\| reviewAgentDraft \|\| reviewAgentPlanFingerprint\)/, '审查交接必须作为显式发送分支识别');
assert.match(sendStudioAgentSource, /reviewAgentPlanFingerprint === currentReviewFingerprint[\s\S]*Boolean\(currentReviewAgentItem\(\)\)/, '审查发送前必须同时核对计划指纹和当前条目');
assert.match(sendStudioAgentSource, /if \(reviewHandoffActive && !reviewOnly\) \{[\s\S]{0,260}resetReviewAgentHandoff\(\)[\s\S]{0,260}return;/, '失效审查交接必须在调用 API 前闭合拒绝');
assert.ok(
  sendStudioAgentSource.indexOf('if (reviewHandoffActive && !reviewOnly)') < sendStudioAgentSource.indexOf('const profile = activeStudioAiProfile()'),
  '失效审查交接必须先于 API 配置与最终组装返回',
);
assert.match(sendStudioAgentSource, /const turnContext = studioAgentTurnContext\(\{[\s\S]{0,120}reviewOnly,[\s\S]{0,120}reviewFingerprint: currentReviewFingerprint/, '最终 Agent 组装必须显式传入 reviewOnly 边界');
assert.match(sendStudioAgentSource, /const \{ markerValues, snapshot, workspaceMessages \} = turnContext/, '最终 Agent 组装必须只消费受控回合上下文');
assert.match(sendStudioAgentSource, /markerValues,[\s\S]{0,1200}\.\.\.workspaceMessages,[\s\S]{0,240}\.\.\.contextSelection\.messages,[\s\S]{0,160}studioAgentTurnContract\(snapshot\)/, '最终 AIRP 组装必须使用受控 marker、工作区、预算历史和固定 snapshot');
assert.match(sendStudioAgentSource, /baseEstimate = estimateAgentTokens\(baseAssembled\.messages\)[\s\S]{0,500}agentConversationMessages\(\{ reservedTokens: baseEstimate \}\)/, '普通回合必须先计算固定上下文，再按剩余 Token 预算选择历史');
assert.match(sendStudioAgentSource, /if \(contextSelection\.blocked\)[\s\S]{0,500}本次内容没有发送/, '超过上下文预算时必须在 API 调用前明确拒绝');
assert.match(sendStudioAgentSource, /substitutions: reviewOnly[\s\S]{0,100}\{ char: '待审条目', user: '审查者' \}[\s\S]{0,100}project\.card\.name/, '审查回合必须使用固定 substitutions，普通回合才可读取卡名');
assert.match(sendStudioAgentSource, /if \(reviewOnly\) resetReviewAgentHandoff\(\)/, '审查回合启动后必须消费并清空一次性交接');
assert.match(sendStudioAgentSource, /if \(aiSettings\.routingMode === 'delegated'\)[\s\S]{0,1500}prepareDelegatedStudioAgentTurn\(/, '委派发送必须只进入 primary 规划阶段');

const prepareDelegatedSource = studioSource.slice(
  studioSource.indexOf('async function prepareDelegatedStudioAgentTurn'),
  studioSource.indexOf('async function approveStudioAgentPlan'),
);
assert.match(prepareDelegatedSource, /prepareStudioAgentTaskPlan\(/, '第一阶段必须调用纯规划入口');
assert.doesNotMatch(prepareDelegatedSource, /runApprovedStudioAgentPlan\(/, '批准前不得调用 worker、reviewer 或汇总入口');
assert.match(prepareDelegatedSource, /status[\s\S]{0,80}pending|state:\s*'pending'/, '规划完成后必须停在待批准状态');

const approveDelegatedSource = studioSource.slice(
  studioSource.indexOf('async function approveStudioAgentPlan'),
  studioSource.indexOf('function rejectStudioAgentPlan'),
);
assert.match(approveDelegatedSource, /studioAgentPlanIsCurrent\(\)[\s\S]{0,500}return;/, '批准前必须重新核对会话与完整上下文指纹');
assert.match(approveDelegatedSource, /runApprovedStudioAgentPlan\(/, '只有批准处理器可以进入 worker/reviewer 执行与 primary 汇总');
assert.match(approveDelegatedSource, /onReceipt:\s*appendStudioAgentReceipt/, '委派执行收据必须进入 Agent 时间线');

const orchestrationBoundarySource = studioSource.slice(
  studioSource.indexOf('function studioAgentOrchestrationBoundary'),
  studioSource.indexOf('function createStudioAgentOrchestrationTurn'),
);
for (const boundedCapability of ['MCP', 'Shell', 'Git', '文件', 'SillyTavern', '递归']) {
  assert.ok(orchestrationBoundarySource.includes(boundedCapability), `委派提示缺少安全边界：${boundedCapability}`);
}

const directAiMarkerValuesSource = studioSource.slice(
  studioSource.indexOf('function directAiMarkerValues'),
  studioSource.indexOf('function currentAiModel'),
);
const studioAgentTurnContextSource = studioSource.slice(
  studioSource.indexOf('function studioAgentTurnContext'),
  studioSource.indexOf('async function sendStudioAgentMessage'),
);
const agentTurnContextHarness = Function(`
  let activeRoute = 'worldbook';
  const project = {
    project: { id: 'project-1' },
    card: {
      description: 'SENSITIVE_DESCRIPTION',
      personality: 'SENSITIVE_PERSONALITY',
      scenario: 'SENSITIVE_SCENARIO',
      mesExample: 'SENSITIVE_EXAMPLE',
    },
  };
  function activeEntry() {
    return { name: 'SENSITIVE_ENTRY', content: 'SENSITIVE_WORLD_INFO', positionType: 'before_character_definition' };
  }
  function directAiTask() {
    return 'SENSITIVE_WORKSPACE_CONTEXT';
  }
  function agentContextSnapshot() {
    return { projectId: 'project-1', route: 'worldbook', entryUid: 9, entryName: 'SENSITIVE_ENTRY', before: 'SENSITIVE_WORLD_INFO', fingerprint: 'normal' };
  }
  ${directAiMarkerValuesSource}
  ${studioAgentTurnContextSource}
  return {
    review: studioAgentTurnContext({ reviewOnly: true, reviewFingerprint: 'review-fingerprint' }),
    normal: studioAgentTurnContext(),
  };
`)();
assert.deepEqual(agentTurnContextHarness.review.workspaceMessages, [], '审查回合不得夹带普通工作区上下文');
assert.ok(
  Object.values(agentTurnContextHarness.review.markerValues).every((value) => Array.isArray(value) && value.length === 0),
  '审查回合的全部 AIRP marker 必须为空数组',
);
for (const emptyReviewMarker of ['charDescription', 'charPersonality', 'scenario', 'dialogueExamples', 'worldInfoBefore', 'worldInfoAfter', 'chatHistory', 'personaDescription']) {
  assert.deepEqual(agentTurnContextHarness.review.markerValues[emptyReviewMarker], [], `审查回合 marker ${emptyReviewMarker} 必须为空`);
}
assert.deepEqual(agentTurnContextHarness.review.snapshot, {
  projectId: 'project-1',
  route: 'check',
  entryUid: null,
  entryName: '审查对照',
  before: '',
  fingerprint: 'review-fingerprint',
}, '审查 snapshot 必须永久绑定 check 且不携带世界书正文');
assert.equal(JSON.stringify(agentTurnContextHarness.review).includes('SENSITIVE_'), false, '审查最终上下文不得泄漏卡片 marker 或旧对话');
assert.match(agentTurnContextHarness.normal.workspaceMessages[0].content, /SENSITIVE_WORKSPACE_CONTEXT/, '普通 Agent 回合必须携带当前工作区只读上下文');
assert.equal(agentTurnContextHarness.normal.markerValues.charDescription.content, 'SENSITIVE_DESCRIPTION', '普通 Agent marker 行为不得改变');

const externalReviewHandoffSource = studioSource.slice(
  studioSource.indexOf('function handoffSelectedReviewItem'),
  studioSource.indexOf('function renderReviewComparison'),
);
assert.match(
  externalReviewHandoffSource,
  /externalReviewAgentPrompt\(item\)/,
  '外置审查任务包只能由固定技能调用与当前选中条目组成',
);
assert.doesNotMatch(externalReviewHandoffSource, /assistantPrompt\(\)/, '外置审查任务不得夹带完整项目、驾驶员同步或本机路径');

const externalReviewPromptSource = studioSource.slice(
  studioSource.indexOf('function externalReviewAgentPrompt'),
  studioSource.indexOf('function resetReviewAgentHandoff'),
);
const externalReviewPromptHarness = Function(`
  let agentMode = 'claude';
  let activeRoute = 'check';
  let activeReviewKind = 'text';
  let reviewAgentPlanFingerprint = 'review-fingerprint';
  let lastExportPlan = { review: { fingerprint: 'review-fingerprint' } };
  const reviewItem = { id: 'selected-review-item' };
  const reviewAgentTask = (item) => 'ONLY_SELECTED:' + item.id;
  const currentReviewAgentItem = () => reviewItem;
  const assistantPrompt = () => 'SENSITIVE_FULL_PROJECT_AND_PATHS';
  const skillInvocation = (skillName) => agentMode === 'claude'
    ? '/tavernweave-agent-skills:' + skillName
    : '请使用 $' + skillName + '。';
  ${externalReviewPromptSource}
  const validClaudeText = currentExternalAgentPrompt();
  activeReviewKind = 'code';
  const validClaudeCode = currentExternalAgentPrompt();
  agentMode = 'codex';
  const validCodexCode = currentExternalAgentPrompt();
  lastExportPlan.review.fingerprint = 'stale-fingerprint';
  const stale = currentExternalAgentPrompt();
  return { validClaudeText, validClaudeCode, validCodexCode, stale };
`)();
assert.match(externalReviewPromptHarness.validClaudeText, /^\/tavernweave-agent-skills:tavern-card-builder[\s\S]*ONLY_SELECTED:selected-review-item$/, 'Claude 文字审查必须路由到 TavernWeave 制卡入口');
assert.match(externalReviewPromptHarness.validClaudeCode, /^\/tavernweave-agent-skills:code-quality-workflow[\s\S]*ONLY_SELECTED:selected-review-item$/, 'Claude 代码审查必须路由到 TavernWeave 代码质量 Skill');
assert.match(externalReviewPromptHarness.validCodexCode, /^请使用 \$code-quality-workflow。[\s\S]*ONLY_SELECTED:selected-review-item$/, 'Codex 代码审查必须路由到对应 $skill-name');
assert.equal(externalReviewPromptHarness.validClaudeText.includes('SENSITIVE_'), false, '有效审查交接不得回退到完整项目 prompt');
assert.equal(externalReviewPromptHarness.validClaudeCode.includes('SENSITIVE_'), false, '代码审查不得回退到完整项目 prompt');
assert.equal(externalReviewPromptHarness.validCodexCode.includes('SENSITIVE_'), false, '有效审查交接不得因模式切换泄漏完整项目 prompt');
assert.equal(externalReviewPromptHarness.stale, 'SENSITIVE_FULL_PROJECT_AND_PATHS', '审查计划失效后应恢复普通外置任务包');

const sendStudioAgentMessageSource = studioSource.slice(
  studioSource.indexOf('async function sendStudioAgentMessage'),
  studioSource.indexOf('async function generateStudioAiCandidate'),
);
assert.match(sendStudioAgentMessageSource, /const skillMessages = studioWorkbenchSkillMessages\(\);/, '内置请求必须在清空审查交接前冻结本轮主 Skill');
assert.equal((sendStudioAgentMessageSource.match(/studioWorkbenchSkillMessages\(\)/g) || []).length, 1, '预算估算与真实请求必须复用同一份主 Skill 消息');
assert.ok((sendStudioAgentMessageSource.match(/\.\.\.skillMessages/g) || []).length >= 2, '预算估算与真实请求都必须使用冻结的主 Skill 消息');
const explainStudioKnowledgeSkillSource = studioSource.slice(
  studioSource.indexOf('async function explainStudioKnowledge'),
  studioSource.indexOf('function renderAgentMode'),
);
assert.match(
  explainStudioKnowledgeSkillSource,
  /extraMessages:\s*\[[\s\S]{0,160}studioWorkbenchSkillMessages\('sillytavern-api-reference'\)[\s\S]{0,160}studioKnowledgeExplanationContract\(\)/,
  '内置知识解释必须与外置任务包一致，只注入 TavernWeave API 主 Skill 与只读证据契约',
);
assert.match(
  studioSource.slice(studioSource.indexOf('function renderAssistant'), studioSource.indexOf('function setStudioKnowledgeStatus')),
  /\[data-rcs-ai-prompt\][\s\S]{0,120}currentExternalAgentPrompt\(\)/,
  'renderAssistant 必须在 Agent 模式切换时保留有效的最小审查任务包',
);

const renderRouteSource = studioSource.slice(
  studioSource.indexOf('function renderRoute'),
  studioSource.indexOf('function setSourceMode'),
);
const createReviewRouteHarness = Function(`
  return function createHarness(nextRoute) {
    let activeRoute = 'check';
    let reviewAgentItemId = 'review-item';
    let reviewAgentDraft = 'review-task';
    let reviewAgentPlanFingerprint = 'review-fingerprint';
    let resets = 0;
    const root = { classList: { toggle() {} } };
    const finishStudioLayoutResize = () => {};
    const currentSubroute = () => nextRoute;
    const $$ = () => [];
    const $ = () => null;
    const resetReviewAgentHandoff = () => {
      resets += 1;
      reviewAgentItemId = '';
      reviewAgentDraft = '';
      reviewAgentPlanFingerprint = '';
    };
    const renderWorldbook = () => {};
    const renderStateForm = () => {};
    const renderComponentCatalog = () => {};
    const renderWorkflow = () => {};
    const ensureUiBuilderHost = () => {};
    const renderChecks = () => {};
    const renderAssistant = () => {};
    let lastCheck = null;
    ${renderRouteSource}
    renderRoute();
    return { activeRoute, reviewAgentItemId, reviewAgentDraft, reviewAgentPlanFingerprint, resets };
  };
`)();
assert.deepEqual(createReviewRouteHarness('card'), {
  activeRoute: 'card',
  reviewAgentItemId: '',
  reviewAgentDraft: '',
  reviewAgentPlanFingerprint: '',
  resets: 1,
}, '离开检查页必须立即清空审查交接和草稿');
assert.equal(createReviewRouteHarness('check').resets, 0, '停留检查页不得误清理有效审查交接');

const persistUiBuilderSnapshotSource = studioSource.slice(
  studioSource.indexOf('async function persistUiBuilderSnapshot'),
  studioSource.indexOf('function downloadUiBuilderArtifact'),
);
const runUiBuilderPersistHarness = Function(`
  return async function runHarness({ current, snapshot }) {
    let invalidations = 0;
    let saves = 0;
    const project = {
      project: { id: 'project-1', updatedAt: null },
      frontend: { builder: structuredClone(current), status: 'editing' },
    };
    const uiBuilderHostGeneration = 7;
    const activeRoute = 'card';
    const normalizeUiBuilderSnapshot = (value) => structuredClone(value);
    const sha256Bytes = async (bytes) => new TextDecoder().decode(bytes);
    const nowIso = () => '2026-07-22T00:00:00.000Z';
    const invalidateValidation = () => { invalidations += 1; };
    const saveProjectNow = async () => { saves += 1; };
    const renderModuleStates = () => {};
    const renderUiBuilderContext = () => {};
    const renderProjectDashboard = () => {};
    const renderWorkflow = () => {};
    ${persistUiBuilderSnapshotSource}
    const result = await persistUiBuilderSnapshot(snapshot, { generation: 7, workspaceId: 'project-1' });
    return { invalidations, saves, result, builder: project.frontend.builder };
  };
`)();
const unchangedBuilderProject = { schemaVersion: 1, nodes: [{ id: 'node-1' }] };
const unchangedBuilderTokens = { schemaVersion: 1, overrides: { accent: '#fff' } };
const unchangedBuilderSerialized = JSON.stringify({ project: unchangedBuilderProject, tokens: unchangedBuilderTokens });
const unchangedBuilderResult = await runUiBuilderPersistHarness({
  current: {
    revision: 1,
    sha256: unchangedBuilderSerialized,
    project: unchangedBuilderProject,
    tokens: unchangedBuilderTokens,
    lastArtifact: { artifactId: 'artifact-only' },
  },
  snapshot: {
    revision: 2,
    project: unchangedBuilderProject,
    tokens: unchangedBuilderTokens,
  },
});
assert.equal(unchangedBuilderResult.invalidations, 0, '只变化 revision 或保留 lastArtifact 时不得使检查失效');
assert.equal(unchangedBuilderResult.saves, 1, '相同 UI Builder 内容仍应沿用既有保存链');
assert.equal(unchangedBuilderResult.builder.lastArtifact.artifactId, 'artifact-only', '快照保存必须继续保留 lastArtifact');
const changedBuilderResult = await runUiBuilderPersistHarness({
  current: {
    revision: 1,
    sha256: unchangedBuilderSerialized,
    project: unchangedBuilderProject,
    tokens: unchangedBuilderTokens,
    lastArtifact: null,
  },
  snapshot: {
    revision: 2,
    project: unchangedBuilderProject,
    tokens: { schemaVersion: 1, overrides: { accent: '#000' } },
  },
});
assert.equal(changedBuilderResult.invalidations, 1, 'UI Builder project/tokens 真实变化必须使旧检查和审查失效');

const resetUiBuilderDraftSource = studioSource.slice(
  studioSource.indexOf('async function resetUiBuilderDraft'),
  studioSource.indexOf('function projectFingerprint'),
);
const runUiBuilderResetHarness = Function(`
  return async function runHarness(hasDesignSource) {
    let invalidations = 0;
    const window = { confirm: () => true };
    const project = {
      project: { updatedAt: null },
      frontend: {
        builder: hasDesignSource ? { project: { schemaVersion: 1, nodes: [] } } : { project: null },
        selectedComponents: [],
        status: 'editing',
      },
    };
    const activeRoute = 'card';
    const flushUiBuilderHost = async () => {};
    const invalidateUiBuilderHost = () => {};
    const createEmptyBuilderState = () => ({ project: null, tokens: null });
    const nowIso = () => '2026-07-22T00:00:00.000Z';
    const invalidateValidation = () => { invalidations += 1; };
    const saveProjectNow = async () => {};
    const renderModuleStates = () => {};
    const renderUiBuilderContext = () => {};
    const renderWorkflow = () => {};
    const ensureUiBuilderHost = () => {};
    const showToast = () => {};
    ${resetUiBuilderDraftSource}
    await resetUiBuilderDraft();
    return invalidations;
  };
`)();
assert.equal(await runUiBuilderResetHarness(true), 1, '重置已有 UI Builder 设计源稿必须使旧检查失效');
assert.equal(await runUiBuilderResetHarness(false), 0, '空白 UI Builder 重置不得制造虚假检查失效');
const handleUiBuilderArtifactSource = studioSource.slice(
  studioSource.indexOf('async function handleUiBuilderArtifact'),
  studioSource.indexOf('function ensureUiBuilderHost'),
);
assert.doesNotMatch(handleUiBuilderArtifactSource, /invalidateValidation\s*\(/, '仅更新 lastArtifact 不得使检查与审查失效');
assert.match(generateStudioAiSource, /if \(agentMode !== 'internal'\)/, '外置模式不得进入内置提案生成链');
const agentModeSource = studioSource.slice(
  studioSource.indexOf('function renderAgentMode'),
  studioSource.indexOf('function defaultStudioLayout'),
);
for (const modeCapability of ['function renderAgentMode', 'function applyAgentMode', 'function requestAgentMode', 'function applyPendingAgentMode']) {
  assert.ok(agentModeSource.includes(modeCapability), `Agent 模式缺少 ${modeCapability}`);
}
assert.match(agentModeSource, /const active = mode === agentMode/, '待切换目标不得伪装成当前选中模式');
assert.match(agentModeSource, /const waiting = mode === pendingAgentMode/);
assert.match(agentModeSource, /button\.setAttribute\('aria-checked', String\(active\)\)/);
assert.match(agentModeSource, /button\.dataset\.pending = String\(waiting\)/);
assert.match(agentModeSource, /externalPanel\.hidden = agentMode === 'internal'/);
assert.match(agentModeSource, /composer\.hidden = agentMode !== 'internal'/);
assert.doesNotMatch(agentModeSource, /localStorage|sessionStorage|idb|persistStudio/, 'Agent 模式保持页内状态，不得新增持久化');
const requestAgentModeSource = agentModeSource.slice(
  agentModeSource.indexOf('function requestAgentMode'),
  agentModeSource.indexOf('function applyPendingAgentMode'),
);
assert.match(requestAgentModeSource, /if \(aiRequestController\)[\s\S]*pendingAgentMode = mode[\s\S]*已排队/, '忙碌时必须只登记待切换模式');
assert.doesNotMatch(requestAgentModeSource, /\.abort\(|cancelStudioAiRequest/, '选择 Agent 模式不得强制停止当前操作');
assert.equal((studioSource.match(/settleStudioAiRequest\(controller\);/g) || []).length, 7, '对话、Plan、委派、提案、知识解释与摘要续聊必须统一进入结算路径');
const settleStudioAiRequestSource = studioSource.slice(
  studioSource.indexOf('function settleStudioAiRequest'),
  studioSource.indexOf('function cancelStudioAiRequest'),
);
assert.match(settleStudioAiRequestSource, /if \(aiRequestController !== controller\) return false/, '旧请求迟到不得结算当前模式');
assert.match(settleStudioAiRequestSource, /aiRequestController = null[\s\S]*aiRequestKind = ''[\s\S]*applyPendingAgentMode\(\)/, '当前请求必须先清空 controller，再消费待切换模式');
assert.match(studioSource, /pagehide[\s\S]{0,180}pendingAgentMode = ''[\s\S]{0,120}aiRequestController\?\.abort/, '离页不得遗留待切换动作');
const stageExternalStudioAiSource = studioSource.slice(
  studioSource.indexOf('function stageExternalStudioAiResponse'),
  studioSource.indexOf('function rawCardStorageKey'),
);
assert.match(stageExternalStudioAiSource, /if \(agentMode === 'internal'\)/, '内置模式不得建立外置 AI 返回提案');
const copyExternalTaskSource = studioSource.slice(
  studioSource.indexOf("$('[data-rcs-copy-prompt]').addEventListener"),
  studioSource.indexOf("$('[data-rcs-apply-ai-response]').addEventListener"),
);
assert.match(copyExternalTaskSource, /if \(agentMode === 'internal'\)/, '内置模式不得复制外置任务包');
const bindRadioKeyboardSource = studioSource.slice(
  studioSource.indexOf('function bindRadioKeyboard'),
  studioSource.indexOf('function bindEvents'),
);
assert.match(bindRadioKeyboardSource, /'Home', 'End'/, 'Agent 模式键盘选择必须支持 Home 与 End');

const saveStudioAgentPathsSource = studioSource.slice(
  studioSource.indexOf('async function saveStudioAgentPaths'),
  studioSource.indexOf('function clearStudioKnowledgeDerived'),
);
assert.match(saveStudioAgentPathsSource, /studioAgentContextStore\.save/, '本机路径必须使用独立的 IndexedDB Agent 上下文记录');
assert.match(saveStudioAgentPathsSource, /normalizeStudioAgentPaths/, '本机路径保存前必须规范化');
assert.doesNotMatch(saveStudioAgentPathsSource, /project\.|localStorage|sessionStorage|persistWorkspaceAtomic/, '本机绝对路径不得写入项目或 Web Storage');
const projectBackupSource = studioSource.slice(
  studioSource.indexOf('function projectBackupData'),
  studioSource.indexOf('async function exportProject'),
);
assert.doesNotMatch(projectBackupSource, /studioAgentPaths|studioKnowledgeHandles|studioAgentContext/, '项目备份不得包含本机 Agent 路径或目录句柄');
const externalAgentPathSource = studioSource.slice(
  studioSource.indexOf('function externalAgentPathContext'),
  studioSource.indexOf('function assistantPrompt'),
);
assert.match(externalAgentPathSource, /if \(agentMode === 'internal'\) return null/, '内置 Agent 不得获得本机绝对路径');
assert.match(externalAgentPathSource, /codexSkillsDirectory/);
assert.match(externalAgentPathSource, /claudeSkillsDirectory/);
assert.match(externalAgentPathSource, /guideDbDirectory/);
assert.doesNotMatch(sendStudioAgentSource, /studioAgentPaths|externalAgentPathContext/, '内置 Agent 对话不得读取本机绝对路径');

const clearStudioKnowledgeDerivedSource = studioSource.slice(
  studioSource.indexOf('function clearStudioKnowledgeDerived'),
  studioSource.indexOf('async function scanStudioKnowledgeSource'),
);
const scanStudioKnowledgeSourceSource = studioSource.slice(
  studioSource.indexOf('async function scanStudioKnowledgeSource'),
  studioSource.indexOf('async function refreshStudioKnowledgeSources'),
);
assert.match(clearStudioKnowledgeDerivedSource, /studioSkills = \[\]/, 'Skill 失权后必须清空旧 SKILL.md');
assert.match(clearStudioKnowledgeDerivedSource, /studioKnowledgeIndex = createStudioKnowledgeIndex\(\[\]\)/, 'DB 失权后必须清空旧索引');
assert.match(clearStudioKnowledgeDerivedSource, /studioKnowledgeResults = \[\][\s\S]*studioKnowledgeExplanation = ''[\s\S]*studioKnowledgeTask = ''/, 'DB 失权后必须清空结果、解释与任务包');
assert.match(scanStudioKnowledgeSourceSource, /if \(!\['granted', 'unsupported'\]\.includes\(permission\)\) \{[\s\S]*clearStudioKnowledgeDerived\(role\)[\s\S]*return;/, 'prompt 或 denied 时必须先清空旧知识源派生状态');

const deniedKnowledgeHarness = Function(`
  let studioKnowledgeHandles = { skill: { kind: 'directory' }, guideDb: { kind: 'directory' } };
  let studioKnowledgePermissions = { skill: 'granted', guideDb: 'granted' };
  let studioKnowledgeSourceErrors = { skill: '', guideDb: '' };
  let studioSkills = [{ name: 'stale-skill', text: 'stale' }];
  let studioKnowledgeIndex = { documentCount: 1, chunkCount: 1, chunks: [{ text: 'stale' }] };
  let studioKnowledgeIndexedAt = 'stale';
  let studioKnowledgeResults = [{ excerpt: 'stale' }];
  let activeStudioKnowledgeResult = 0;
  let studioKnowledgeExplanation = 'stale';
  let studioKnowledgeTask = 'stale';
  let studioKnowledgeStatus = '';
  let studioKnowledgeStatusTone = '';
  const createStudioKnowledgeIndex = () => ({ documentCount: 0, chunkCount: 0, chunks: [] });
  const ensureStudioKnowledgeSourcePermission = async () => 'denied';
  ${clearStudioKnowledgeDerivedSource}
  ${scanStudioKnowledgeSourceSource}
  return {
    async revoke(role) {
      await scanStudioKnowledgeSource(role);
      return {
        skillCount: studioSkills.length,
        documentCount: studioKnowledgeIndex.documentCount,
        resultCount: studioKnowledgeResults.length,
        explanation: studioKnowledgeExplanation,
        task: studioKnowledgeTask,
        status: studioKnowledgeStatus,
      };
    },
  };
`)();
const revokedGuideDb = await deniedKnowledgeHarness.revoke('guideDb');
assert.deepEqual(revokedGuideDb, {
  skillCount: 1,
  documentCount: 0,
  resultCount: 0,
  explanation: '',
  task: '',
  status: '开发指南 DB 的只读权限已拒绝；旧索引已从本页内存清除。',
});
const revokedSkill = await deniedKnowledgeHarness.revoke('skill');
assert.equal(revokedSkill.skillCount, 0, 'Skill 失权后不得继续进入内置 Agent');

const dockViewSource = studioSource.slice(
  studioSource.indexOf('function renderDockView'),
  studioSource.indexOf('function runStudioKnowledgeSearch'),
);
for (const dockCapability of ['function renderDockView', 'function setDockView', 'function toggleDockView']) {
  assert.ok(dockViewSource.includes(dockCapability), `共享浮窗缺少 ${dockCapability}`);
}
assert.match(dockViewSource, /element\.hidden = wiki/);
assert.doesNotMatch(dockViewSource, /\.abort\(|cancelStudioAiRequest|settleStudioAiRequest|pendingAgentMode\s*=|agentEvents\s*=/, 'Agent / Wiki 切页不得停止或重置 Agent');

const explainStudioKnowledgeSource = studioSource.slice(
  studioSource.indexOf('async function explainStudioKnowledge'),
  studioSource.indexOf('function renderAgentMode'),
);
assert.match(explainStudioKnowledgeSource, /if \(aiRequestController\) return/, '知识解释必须复用单请求锁');
assert.match(explainStudioKnowledgeSource, /if \(agentMode !== 'internal'\)[\s\S]*studioKnowledgeExternalTask/, '外置模式必须生成任务包而不是调用内置 API');
assert.match(explainStudioKnowledgeSource, /aiRequestController = new AbortController\(\)/);
assert.match(explainStudioKnowledgeSource, /aiRequestKind = 'knowledge'/);
assert.match(explainStudioKnowledgeSource, /sequence !== aiGenerationSequence \|\| controller !== aiRequestController/, '迟到的知识解释不得写入 Wiki');
assert.match(explainStudioKnowledgeSource, /settleStudioAiRequest\(controller\)/, '知识解释必须进入现有 Agent 结算链');
for (const forbiddenWrite of ['entry.content =', 'markDirty(', 'persistWorkspaceAtomic(', 'createWritable(', 'writeStudioLocal']) {
  assert.equal(explainStudioKnowledgeSource.includes(forbiddenWrite), false, `知识解释不得写项目或磁盘：${forbiddenWrite}`);
}

function extractAgentModeFunction(name, nextName) {
  const start = studioSource.indexOf(`function ${name}`);
  const end = studioSource.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `无法提取 Agent 模式函数 ${name}`);
  return studioSource.slice(start, end);
}

const createAgentModeHarness = Function(`
  return function createAgentModeHarness({ busy = false } = {}) {
    const AGENT_MODES = Object.freeze({
      internal: { label: '内置 Agent', description: 'internal' },
      codex: { label: 'Codex', description: 'codex' },
      claude: { label: 'Claude Code', description: 'claude' },
    });
    let agentMode = 'internal';
    let pendingAgentMode = '';
    let aiRequestController = busy ? { id: 1 } : null;
    let aiRequestKind = busy ? 'chat' : '';
    const activeController = aiRequestController;
    const toasts = [];
    const events = [];
    const statuses = [];
    const panel = { open: false };
    let assistantRenders = 0;
    let modeRenders = 0;
    let availabilityRenders = 0;
    const $ = () => panel;
    function renderAssistant() { assistantRenders += 1; }
    function renderAgentMode() { modeRenders += 1; }
    function renderStudioAiAvailability() { availabilityRenders += 1; }
    function appendAgentEvent(type, text) { events.push({ type, text }); }
    function setStudioAiStatus(text, kind) { statuses.push({ text, kind }); }
    function showToast(text) { toasts.push(text); }
    ${extractAgentModeFunction('applyAgentMode', 'requestAgentMode')}
    ${extractAgentModeFunction('requestAgentMode', 'applyPendingAgentMode')}
    ${extractAgentModeFunction('applyPendingAgentMode', 'defaultStudioLayout')}
    ${extractAgentModeFunction('settleStudioAiRequest', 'cancelStudioAiRequest')}
    function snapshot() {
      return {
        agentMode,
        pendingAgentMode,
        busy: Boolean(aiRequestController),
        toasts: [...toasts],
        events: [...events],
        statuses: [...statuses],
        assistantRenders,
        modeRenders,
        availabilityRenders,
        panelOpen: panel.open,
      };
    }
    return {
      request(mode) { requestAgentMode(mode); return snapshot(); },
      settle() {
        const settled = settleStudioAiRequest(activeController);
        return { settled, ...snapshot() };
      },
      settleOther() { return { settled: settleStudioAiRequest({ id: 'late' }), ...snapshot() }; },
    };
  };
`)();

const busyModeHarness = createAgentModeHarness({ busy: true });
const queuedCodex = busyModeHarness.request('codex');
assert.equal(queuedCodex.agentMode, 'internal', '忙碌时当前模式必须继续生效');
assert.equal(queuedCodex.pendingAgentMode, 'codex');
assert.match(queuedCodex.toasts.at(-1), /当前操作结束后切换到 Codex/);
const queuedClaude = busyModeHarness.request('claude');
assert.equal(queuedClaude.pendingAgentMode, 'claude', '忙碌时改选必须替换待切换目标');
const cancelledQueue = busyModeHarness.request('internal');
assert.equal(cancelledQueue.agentMode, 'internal');
assert.equal(cancelledQueue.pendingAgentMode, '', '忙碌时重选当前模式必须取消待切换');
assert.match(cancelledQueue.toasts.at(-1), /已取消待切换/);

const deferredModeHarness = createAgentModeHarness({ busy: true });
deferredModeHarness.request('codex');
const staleModeSettle = deferredModeHarness.settleOther();
assert.equal(staleModeSettle.settled, false);
assert.equal(staleModeSettle.agentMode, 'internal');
assert.equal(staleModeSettle.pendingAgentMode, 'codex');
assert.equal(staleModeSettle.busy, true, '旧 controller 不得清空当前请求');
const deferredApplied = deferredModeHarness.settle();
assert.equal(deferredApplied.settled, true);
assert.equal(deferredApplied.agentMode, 'codex');
assert.equal(deferredApplied.pendingAgentMode, '');
assert.equal(deferredApplied.events.length, 1, '待切换模式完成后必须只记录一次真实切换');
assert.equal(deferredApplied.toasts.length, 2, '排队与真实切换必须分别给出一次气泡提示');
assert.match(deferredApplied.toasts.at(-1), /当前操作已结束，已切换到 Codex/);
const deferredSecondSettle = deferredModeHarness.settle();
assert.equal(deferredSecondSettle.settled, false);
assert.equal(deferredSecondSettle.events.length, 1, '重复结算不得再次切换');

const immediateModeHarness = createAgentModeHarness();
const immediateClaude = immediateModeHarness.request('claude');
assert.equal(immediateClaude.agentMode, 'claude');
assert.equal(immediateClaude.pendingAgentMode, '');
assert.match(immediateClaude.toasts.at(-1), /已切换到 Claude Code/);
const approveStudioAgentSource = studioSource.slice(
  studioSource.indexOf('function approveStudioAgentProposal'),
  studioSource.indexOf('function rejectStudioAgentProposal'),
);
for (const localBinding of ['projectId', 'entryUid', 'before', 'fingerprint']) {
  assert.ok(studioSource.slice(
    studioSource.indexOf('function agentProposalIsCurrent'),
    studioSource.indexOf('function stageStudioAgentProposal'),
  ).includes(localBinding), `Agent 批准前缺少本地上下文校验：${localBinding}`);
}
assert.match(approveStudioAgentSource, /agentProposalIsCurrent\(proposal\)/);
assert.match(approveStudioAgentSource, /entry\.content = proposal\.text/);
assert.match(approveStudioAgentSource, /markDirty\(/);
const appendAgentEventSource = studioSource.slice(
  studioSource.indexOf('function appendAgentEvent'),
  studioSource.indexOf('function ensureStudioAgentSession'),
);
for (const secretSource of ['aiSessionKeys', 'apiKey', 'Authorization', '.headers', '.stack', '.cause']) {
  assert.equal(appendAgentEventSource.includes(secretSource), false, `Agent 记录不得读取敏感请求字段：${secretSource}`);
}
assert.match(studioSource, /copy\.textContent = event\.text/, 'Agent 输出必须以 textContent 渲染');
assert.doesNotMatch(sendStudioAgentSource, /innerHTML|insertAdjacentHTML/);
assert.match(studioSource, /function invalidateStudioAgentProposal[\s\S]{0,700}updateAgentEvent\(proposal\.eventId/, '提案失效必须闭环更新原 change 事件');
assert.match(studioSource, /function stageStudioAgentProposal[\s\S]{0,500}invalidateStudioAgentProposal/, '新提案不得静默覆盖旧提案');
const agentCapabilitySource = studioSource.slice(
  studioSource.indexOf('function studioAgentTurnContract'),
  studioSource.indexOf('function rawCardStorageKey'),
);
for (const forbiddenCapability of [/window\.parent/, /postMessage\s*\(/, /eval\s*\(/, /new Function/, /child_process/, /node:fs/, /createWritable\s*\(/, /fetch\s*\(/]) {
  assert.doesNotMatch(agentCapabilitySource, forbiddenCapability, `M3-A Web Agent 包含越界能力：${forbiddenCapability}`);
}
const firstMaxWidthMedia = studioCssSource.indexOf('@media (max-width:');
assert.ok(firstMaxWidthMedia >= 0, '现有桌面工作台样式应保留历史断点');
assert.doesNotMatch(studioCssSource.slice(firstMaxWidthMedia), /\.rcs-agent-/, 'M3-A 不得新增 Agent 窄屏规则');
assert.doesNotMatch(studioCssSource.slice(firstMaxWidthMedia), /\.rcs-wiki-/, '知识 Wiki 不得新增 Studio 窄屏规则');
assert.doesNotMatch(studioCssSource.slice(firstMaxWidthMedia), /\.rcs-sidebar-resize/, '侧栏调整不得新增窄屏专用规则');
const agentShellRuleStart = studioCssSource.indexOf('.rcs-agent-shell {');
const agentShellRule = studioCssSource.slice(agentShellRuleStart, studioCssSource.indexOf('}', agentShellRuleStart) + 1);
assert.match(agentShellRule, /position:\s*fixed/, 'Agent 外置会话栏与对话主窗必须共同脱离页面文档流');
assert.match(agentShellRule, /left:\s*20px/);
assert.match(agentShellRule, /right:\s*20px/);
assert.match(agentShellRule, /bottom:\s*20px/);
assert.match(agentShellRule, /display:\s*flex/, 'Agent 会话管理与对话主窗必须并列布局');
assert.match(agentShellRule, /z-index:\s*120/, 'Agent 浮窗组必须高于站点粘性顶栏，最大高度下仍可操作');
const agentDockRuleStart = studioCssSource.indexOf('.rcs-agent-dock {');
const agentDockRule = studioCssSource.slice(agentDockRuleStart, studioCssSource.indexOf('}', agentDockRuleStart) + 1);
assert.match(agentDockRule, /position:\s*relative/, 'Agent 对话主窗必须作为外置会话栏的并列面板');
assert.match(agentDockRule, /top:\s*auto/);
assert.match(agentDockRule, /left:\s*auto/);
assert.match(agentDockRule, /right:\s*auto/);
assert.match(agentDockRule, /bottom:\s*auto/);
assert.match(agentDockRule, /transform:\s*none/, 'Agent 对话主窗不得再用自身位移覆盖外置会话栏');
const agentSessionSheetRuleStart = studioCssSource.indexOf('\n.rcs-agent-session-sheet {');
const agentSessionSheetRule = studioCssSource.slice(agentSessionSheetRuleStart, studioCssSource.indexOf('}', agentSessionSheetRuleStart) + 1);
assert.match(agentSessionSheetRule, /position:\s*relative/, '会话管理必须占据对话主窗外部的独立布局位置');
assert.match(agentSessionSheetRule, /flex:\s*0\s+1\s+360px/);
assert.match(agentSessionSheetRule, /min-width:\s*300px/);
const agentResizeRuleStart = studioCssSource.indexOf('\n.rcs-root .rcs-agent-resize {');
const agentResizeRule = studioCssSource.slice(agentResizeRuleStart, studioCssSource.indexOf('}', agentResizeRuleStart) + 1);
for (const topRightResizeAnchor of [/right:\s*2px/, /top:\s*2px/, /bottom:\s*auto/, /cursor:\s*nesw-resize/]) {
  assert.match(agentResizeRule, topRightResizeAnchor, '底部抽屉的组合尺寸把手必须位于右上角');
}
const sidebarResizeRuleStart = studioCssSource.indexOf('\n.rcs-root .rcs-sidebar-resize {');
const sidebarResizeRule = studioCssSource.slice(sidebarResizeRuleStart, studioCssSource.indexOf('}', sidebarResizeRuleStart) + 1);
assert.match(sidebarResizeRule, /cursor:\s*col-resize/, '侧栏把手必须显示水平调节光标');
assert.match(sidebarResizeRule, /touch-action:\s*none/, '侧栏把手必须接管触摸拖动');
assert.match(studioCssSource, /\n\.rcs-agent-dock-head\s*\{[\s\S]{0,220}padding:\s*10px 38px 10px 14px/, '标题栏必须避让右上角尺寸把手');
assert.doesNotMatch(studioCssSource, /[^{}]*assistant-(?:open|closed)[^{}]*\.rcs-body\s*\{/, 'Agent 开合不得改变工作台布局');
const closedAgentVisibilityRuleStart = studioCssSource.indexOf('.rcs-root.assistant-closed .rcs-agent-current,');
const closedAgentVisibilityRule = studioCssSource.slice(
  closedAgentVisibilityRuleStart,
  studioCssSource.indexOf('}', closedAgentVisibilityRuleStart) + 1,
);
for (const closedSelector of [
  '.rcs-root.assistant-closed .rcs-agent-current',
  '.rcs-root.assistant-closed .rcs-wiki-current',
  '.rcs-root.assistant-closed .rcs-dock-tabs',
  '.rcs-root.assistant-closed [data-rcs-ai-settings-open]',
  '.rcs-root.assistant-closed .rcs-agent-display',
  '.rcs-root.assistant-closed .rcs-wiki-panel',
  '.rcs-root.assistant-closed .rcs-agent-composer',
  '.rcs-root.assistant-closed .rcs-agent-dock > .rcs-ai-status',
  '.rcs-root.assistant-closed .rcs-agent-resize',
]) assert.ok(closedAgentVisibilityRule.includes(closedSelector), `收起态隐藏规则必须包含 ${closedSelector}`);
assert.match(closedAgentVisibilityRule, /\{\s*display:\s*none;\s*\}/, '收起态隐藏选择器必须共同绑定 display:none');
assert.match(studioCssSource, /\.rcs-root\.assistant-closed \.rcs-agent-dock\s*\{[\s\S]{0,260}width:\s*max-content;[\s\S]{0,140}height:\s*auto;/, '收起态必须只保留紧凑把手');
const closedAgentDockRuleStart = studioCssSource.indexOf('.rcs-root.assistant-closed .rcs-agent-dock {');
const closedAgentDockRule = studioCssSource.slice(closedAgentDockRuleStart, studioCssSource.indexOf('}', closedAgentDockRuleStart) + 1);
for (const closedAnchor of [/top:\s*auto/, /left:\s*auto/, /right:\s*20px/, /bottom:\s*20px/, /transform:\s*none/]) {
  assert.match(closedAgentDockRule, closedAnchor, 'Agent 收起态必须回到右下角把手');
}
assert.match(portalSource, /class="rcs-root assistant-closed"/, '首屏必须直接以收起态渲染，避免浮窗闪现');
assert.equal((portalSource.match(/class="rcs-agent-dock"/g) || []).length, 1, 'Agent 与知识 Wiki 必须共用唯一固定浮窗壳');
assert.match(portalSource, /data-rcs-dock-tab="agent"/);
assert.match(portalSource, /data-rcs-dock-tab="wiki"/);
assert.doesNotMatch(studioCssSource, /\.rcs-root\.design-active[^\{]*\.rcs-agent-dock[^\{]*\{[^}]*display:\s*none/, 'UI Builder 路由不得隐藏 Agent 抽屉');
const setAssistantOpenSource = studioSource.slice(
  studioSource.indexOf('function setAssistantOpen'),
  studioSource.indexOf('function fillAllForms'),
);
assert.match(setAssistantOpenSource, /toggle\.setAttribute\('aria-expanded', String\(expanded\)\)/, '抽屉内部把手必须同步 aria-expanded');
assert.match(setAssistantOpenSource, /activeDockView === 'wiki'/, '共享浮窗把手必须按当前 Agent 或 Wiki 视图更新名称');
assert.match(setAssistantOpenSource, /data-rcs-wiki-toggle/, '共享浮窗开合必须同步 Wiki 工具栏入口');
assert.equal((portalSource.match(/data-rcs-ai-toggle/g) || []).length, 2, '顶栏与教程必须各有一个 AI 协作入口');
assert.equal((portalSource.match(/data-rcs-wiki-toggle/g) || []).length, 2, '顶栏与教程必须各有一个知识 Wiki 入口');
assert.match(setAssistantOpenSource, /\$\$\('\[data-rcs-ai-toggle\]'\)\.forEach/, '所有 AI 协作入口必须同步展开状态');
assert.match(setAssistantOpenSource, /\$\$\('\[data-rcs-wiki-toggle\]'\)\.forEach/, '所有知识 Wiki 入口必须同步展开状态');
assert.match(studioSource, /\$\$\('\[data-rcs-ai-toggle\]'\)\.forEach\([\s\S]{0,180}addEventListener\('click'/, '所有 AI 协作入口必须绑定交互');
assert.match(studioSource, /\$\$\('\[data-rcs-wiki-toggle\]'\)\.forEach\([\s\S]{0,180}addEventListener\('click'/, '所有知识 Wiki 入口必须绑定交互');
assert.match(studioSource, /LAYOUT_KEY = 'mttt-rolecard-studio-layout-v1'/);
assert.match(studioSource, /LAYOUT_VERSION = 1/);
const layoutSource = studioSource.slice(
  studioSource.indexOf('function defaultStudioLayout'),
  studioSource.indexOf('function setAssistantOpen'),
);
for (const layoutCapability of [
  'function studioLayoutLimits',
  'function computeStudioLayoutLimits',
  'function clampStudioLayoutValue',
  'function clampStudioLayoutRecord',
  'function normalizeStudioLayout',
  'function loadStudioLayoutPreferences',
  'function persistStudioLayoutPreferences',
  'function beginStudioLayoutResize',
  'function updateStudioLayoutResize',
  'function finishStudioLayoutResize',
  'function adjustStudioLayoutWithKeyboard',
]) assert.ok(layoutSource.includes(layoutCapability), `布局调整缺少 ${layoutCapability}`);
assert.match(layoutSource, /deltaX \* 2/);
assert.match(layoutSource, /candidate\.agentHeight -= deltaY/, '底部抽屉上拖必须增高且底边保持固定');
assert.match(layoutSource, /event\.key === 'ArrowUp'\) candidate\.agentHeight \+= step/);
assert.match(layoutSource, /event\.key === 'ArrowDown'\) candidate\.agentHeight -= step/);
assert.match(layoutSource, /setPointerCapture/);
assert.match(layoutSource, /releasePointerCapture/);
assert.match(layoutSource, /pointercancel/);
assert.match(layoutSource, /lostpointercapture/);
assert.match(layoutSource, /event\.shiftKey \? 24 : 8/);
assert.match(layoutSource, /浏览器未能记住/, '持久化失败不得误报已记住');
const persistLayoutSource = layoutSource.slice(
  layoutSource.indexOf('function persistStudioLayoutPreferences'),
  layoutSource.indexOf('function applyStudioLayout'),
);
for (const persistedLayoutField of ['version: LAYOUT_VERSION', 'agentWidth:', 'agentHeight:', 'sidebarWidth:', 'sidebarCollapsed:']) {
  assert.ok(persistLayoutSource.includes(persistedLayoutField), `尺寸偏好缺少 ${persistedLayoutField}`);
}
for (const forbiddenLayoutField of ['project', 'agentEvents', 'aiSessionKeys', 'apiKey', 'activeApiId', 'assistant-open', 'assistant-closed', 'left:', 'top:']) {
  assert.equal(persistLayoutSource.includes(forbiddenLayoutField), false, `尺寸偏好不得保存 ${forbiddenLayoutField}`);
}
assert.match(studioCssSource, /grid-template-columns:\s*var\(--rcs-sidebar-width, 228px\) minmax\(0, 1fr\)/, '侧栏宽度必须由独立布局变量控制');
assert.match(studioSource, /function renderRoute[\s\S]{0,140}finishStudioLayoutResize\(null, \{ persist: true, announce: false \}\)/, '切换工作台路由前必须结束尺寸拖动');
assert.match(studioSource, /window\.addEventListener\('resize'[\s\S]{0,260}loadStudioLayoutPreferences\(\)[\s\S]{0,120}applyStudioLayout\(\)/, '视口变化后必须重新约束已保存尺寸');
assert.match(studioSource, /window\.addEventListener\('blur'[\s\S]{0,160}revert: true/, '窗口失焦必须取消并回滚未完成拖动');

function extractLayoutFunction(name, nextName) {
  const start = studioSource.indexOf(`function ${name}`);
  const end = studioSource.indexOf(`function ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `无法提取布局函数 ${name}`);
  return studioSource.slice(start, end);
}

const applyStudioLayoutSource = extractLayoutFunction('applyStudioLayout', 'toggleStudioSidebar');
assert.match(applyStudioLayoutSource, /const agentShell = \$\('\[data-rcs-agent-shell\]'\)/, 'Agent 尺寸变量必须挂在浮窗组外壳');
assert.match(applyStudioLayoutSource, /agentShell\.style\.setProperty\('--rcs-agent-width'/, 'Agent 外壳必须接收用户宽度');
assert.match(applyStudioLayoutSource, /agentShell\.style\.setProperty\('--rcs-agent-height'/, 'Agent 外壳必须接收用户高度，不能写到无法向上继承的 Dock');

const layoutMath = Function(`
  const LAYOUT_MARGIN = 24;
  const AGENT_MIN_WIDTH = 620;
  const AGENT_MIN_HEIGHT = 420;
  const AGENT_MAX_WIDTH = 1200;
  const AGENT_MAX_HEIGHT = 900;
  const SIDEBAR_MIN_WIDTH = 176;
  const SIDEBAR_MAX_WIDTH = 360;
  const MAIN_MIN_WIDTH = 600;
  ${extractLayoutFunction('computeStudioLayoutLimits', 'studioLayoutLimits')}
  ${extractLayoutFunction('clampStudioLayoutValue', 'clampStudioLayoutRecord')}
  ${extractLayoutFunction('clampStudioLayoutRecord', 'normalizeStudioLayout')}
  return { computeStudioLayoutLimits, clampStudioLayoutRecord };
`)();
const desktopLayoutLimits = layoutMath.computeStudioLayoutLimits(1265, 720, 1235);
assert.deepEqual(desktopLayoutLimits, {
  agentMinWidth: 620,
  agentMaxWidth: 1200,
  agentMinHeight: 420,
  agentMaxHeight: 672,
  sidebarMinWidth: 176,
  sidebarMaxWidth: 360,
});
assert.deepEqual(layoutMath.computeStudioLayoutLimits(1920, 1080, 1872), {
  agentMinWidth: 620,
  agentMaxWidth: 1200,
  agentMinHeight: 420,
  agentMaxHeight: 900,
  sidebarMinWidth: 176,
  sidebarMaxWidth: 360,
}, '1920 × 1080 正式桌面基线必须允许完整 Agent 与侧栏尺寸范围');
const lowHeightLayoutLimits = layoutMath.computeStudioLayoutLimits(1366, 600, 1318);
assert.deepEqual(lowHeightLayoutLimits, {
  agentMinWidth: 620,
  agentMaxWidth: 1200,
  agentMinHeight: 420,
  agentMaxHeight: 552,
  sidebarMinWidth: 176,
  sidebarMaxWidth: 360,
}, '1366 × 600 低高度视口必须把 Agent 高度限制在可见区域内');
const smallLayoutLimits = layoutMath.computeStudioLayoutLimits(400, 300, 372);
assert.ok(smallLayoutLimits.agentMinWidth <= smallLayoutLimits.agentMaxWidth);
assert.ok(smallLayoutLimits.agentMinHeight <= smallLayoutLimits.agentMaxHeight);
assert.ok(smallLayoutLimits.sidebarMinWidth <= smallLayoutLimits.sidebarMaxWidth);
assert.equal(smallLayoutLimits.agentMaxWidth, 352);
assert.equal(smallLayoutLimits.agentMaxHeight, 272);
const layoutDefaults = { agentWidth: 708, agentHeight: 504, sidebarWidth: 210, sidebarCollapsed: false };
assert.deepEqual(
  layoutMath.clampStudioLayoutRecord({ agentWidth: Infinity, agentHeight: 'bad', sidebarWidth: 999 }, layoutDefaults, desktopLayoutLimits),
  { agentWidth: 708, agentHeight: 504, sidebarWidth: 360, sidebarCollapsed: false },
  '坏尺寸偏好必须回退并夹取到有效范围',
);
assert.deepEqual(
  layoutMath.clampStudioLayoutRecord({ agentWidth: 0, agentHeight: 0, sidebarWidth: 0 }, layoutDefaults, desktopLayoutLimits),
  { agentWidth: 620, agentHeight: 420, sidebarWidth: 176, sidebarCollapsed: false },
  '过小尺寸必须夹取到桌面下限',
);
assert.equal(
  layoutMath.clampStudioLayoutRecord({ ...layoutDefaults, sidebarCollapsed: true }, layoutDefaults, desktopLayoutLimits).sidebarCollapsed,
  true,
  '侧栏缩略态必须在现有布局偏好中持久化',
);

const createLayoutGeometryHarness = Function(`
  return function createLayoutGeometryHarness() {
    const defaults = { agentWidth: 700, agentHeight: 500, sidebarWidth: 210, sidebarCollapsed: false };
    const limits = {
      agentMinWidth: 620,
      agentMaxWidth: 1200,
      agentMinHeight: 420,
      agentMaxHeight: 552,
      sidebarMinWidth: 176,
      sidebarMaxWidth: 360,
    };
    let studioLayout = { ...defaults };
    let layoutResizeSession = {
      kind: 'agent',
      pointerId: 7,
      startX: 100,
      startY: 100,
      startLayout: { ...studioLayout },
      moved: false,
    };
    let applyCount = 0;
    let persistCount = 0;
    let announceCount = 0;
    let preventCount = 0;
    ${extractLayoutFunction('clampStudioLayoutValue', 'clampStudioLayoutRecord')}
    ${extractLayoutFunction('clampStudioLayoutRecord', 'normalizeStudioLayout')}
    function normalizeStudioLayout(value) { return clampStudioLayoutRecord(value, defaults, limits); }
    function applyStudioLayout() { applyCount += 1; }
    function persistStudioLayoutPreferences() { persistCount += 1; return true; }
    function announceStudioLayout() { announceCount += 1; }
    ${extractLayoutFunction('updateStudioLayoutResize', 'finishStudioLayoutResize')}
    ${extractLayoutFunction('adjustStudioLayoutWithKeyboard', 'bindStudioLayoutResizeHandle')}
    function snapshot() {
      return {
        studioLayout: { ...studioLayout },
        moved: layoutResizeSession.moved,
        applyCount,
        persistCount,
        announceCount,
        preventCount,
      };
    }
    return {
      drag(deltaX, deltaY) {
        updateStudioLayoutResize({
          pointerId: 7,
          clientX: 100 + deltaX,
          clientY: 100 + deltaY,
          preventDefault() { preventCount += 1; },
        });
        return snapshot();
      },
      key(key, shiftKey = false) {
        adjustStudioLayoutWithKeyboard({
          key,
          shiftKey,
          preventDefault() { preventCount += 1; },
        }, 'agent');
        return snapshot();
      },
    };
  };
`)();
const pointerGeometry = createLayoutGeometryHarness().drag(20, -30);
assert.deepEqual(pointerGeometry.studioLayout, {
  agentWidth: 740,
  agentHeight: 530,
  sidebarWidth: 210,
  sidebarCollapsed: false,
}, '右上角把手右移 20 / 上移 30 时必须水平扩宽 40、向上增高 30');
assert.equal(pointerGeometry.moved, true);
assert.equal(pointerGeometry.applyCount, 1);
assert.equal(pointerGeometry.preventCount, 1);

const keyboardGeometry = createLayoutGeometryHarness();
assert.equal(keyboardGeometry.key('ArrowUp').studioLayout.agentHeight, 508, 'ArrowUp 必须向上扩展底部抽屉');
const keyboardDownGeometry = keyboardGeometry.key('ArrowDown');
assert.equal(keyboardDownGeometry.studioLayout.agentHeight, 500, 'ArrowDown 必须向下收缩底部抽屉');
assert.equal(keyboardDownGeometry.persistCount, 2);
assert.equal(keyboardDownGeometry.announceCount, 2);
const normalizedPointerGeometry = createLayoutGeometryHarness().drag(1000, -1000);
assert.equal(normalizedPointerGeometry.studioLayout.agentWidth, 1200, '拖动必须通过 normalize 夹取 Agent 最大宽度');
assert.equal(normalizedPointerGeometry.studioLayout.agentHeight, 552, '拖动必须通过 normalize 夹取 600px 低高度上限');
const normalizedKeyboardGeometry = createLayoutGeometryHarness();
for (let index = 0; index < 40; index += 1) normalizedKeyboardGeometry.key('ArrowUp', true);
assert.equal(normalizedKeyboardGeometry.key('ArrowUp', true).studioLayout.agentHeight, 552, '键盘调整必须通过 normalize 夹取低高度上限');

const createLayoutLifecycleHarness = Function(`
  return function createLayoutLifecycleHarness() {
    let layoutResizeSession = null;
    let studioLayout = null;
    let captured = true;
    let applyCount = 0;
    let persistCount = 0;
    let announceCount = 0;
    let releaseCount = 0;
    let removedResizeState = false;
    const listeners = {};
    const handle = {
      addEventListener(type, listener) { listeners[type] = listener; },
      hasPointerCapture() { return captured; },
      releasePointerCapture() { captured = false; releaseCount += 1; },
    };
    const root = {
      removeAttribute(name) {
        if (name === 'data-layout-resize') removedResizeState = true;
      },
    };
    const $ = () => handle;
    function beginStudioLayoutResize() {}
    function updateStudioLayoutResize() {}
    function adjustStudioLayoutWithKeyboard() {}
    function applyStudioLayout() { applyCount += 1; }
    function persistStudioLayoutPreferences() { persistCount += 1; return true; }
    function announceStudioLayout() { announceCount += 1; }
    ${extractLayoutFunction('finishStudioLayoutResize', 'adjustStudioLayoutWithKeyboard')}
    ${extractLayoutFunction('bindStudioLayoutResizeHandle', 'setAssistantOpen')}
    bindStudioLayoutResizeHandle('[data-resize]', 'agent');
    function prepare({ startLayout, currentLayout, moved = true, pointerId = 7 }) {
      studioLayout = { ...currentLayout };
      layoutResizeSession = { kind: 'agent', handle, pointerId, startLayout: { ...startLayout }, moved };
    }
    function snapshot() {
      return {
        studioLayout: { ...studioLayout },
        sessionActive: Boolean(layoutResizeSession),
        captured,
        applyCount,
        persistCount,
        announceCount,
        releaseCount,
        removedResizeState,
      };
    }
    return {
      prepare,
      fire(type, pointerId = 7) { listeners[type]({ pointerId }); return snapshot(); },
      finish(options) { finishStudioLayoutResize(null, options); return snapshot(); },
    };
  };
`)();
const lifecycleStart = { agentWidth: 700, agentHeight: 500, sidebarWidth: 210 };
const lifecycleCurrent = { agentWidth: 820, agentHeight: 580, sidebarWidth: 210 };

const cancelLifecycle = createLayoutLifecycleHarness();
cancelLifecycle.prepare({ startLayout: lifecycleStart, currentLayout: lifecycleCurrent });
assert.deepEqual(cancelLifecycle.fire('pointercancel'), {
  studioLayout: lifecycleStart,
  sessionActive: false,
  captured: false,
  applyCount: 1,
  persistCount: 0,
  announceCount: 0,
  releaseCount: 1,
  removedResizeState: true,
}, 'pointercancel 必须回滚且不得持久化');

const lostCaptureLifecycle = createLayoutLifecycleHarness();
lostCaptureLifecycle.prepare({ startLayout: lifecycleStart, currentLayout: lifecycleCurrent });
assert.deepEqual(lostCaptureLifecycle.fire('lostpointercapture'), {
  studioLayout: lifecycleCurrent,
  sessionActive: false,
  captured: false,
  applyCount: 0,
  persistCount: 1,
  announceCount: 0,
  releaseCount: 1,
  removedResizeState: true,
}, 'lostpointercapture 必须保留最终尺寸、持久化并清理捕获');

const blurLifecycle = createLayoutLifecycleHarness();
blurLifecycle.prepare({ startLayout: lifecycleStart, currentLayout: lifecycleCurrent });
assert.deepEqual(blurLifecycle.finish({ persist: false, announce: false, revert: true }), {
  studioLayout: lifecycleStart,
  sessionActive: false,
  captured: false,
  applyCount: 1,
  persistCount: 0,
  announceCount: 0,
  releaseCount: 1,
  removedResizeState: true,
}, '窗口失焦必须回滚并清理拖拽会话');

const routeLifecycle = createLayoutLifecycleHarness();
routeLifecycle.prepare({ startLayout: lifecycleStart, currentLayout: lifecycleCurrent });
assert.deepEqual(routeLifecycle.finish({ persist: true, announce: false }), {
  studioLayout: lifecycleCurrent,
  sessionActive: false,
  captured: false,
  applyCount: 0,
  persistCount: 1,
  announceCount: 0,
  releaseCount: 1,
  removedResizeState: true,
}, '路由切换必须保留最终尺寸、持久化并清理捕获');

for (const hook of [
  'data-rcs-folder-pick="workspace"',
  'data-rcs-folder-pick="cache"',
  'data-rcs-folder-pick="output"',
  'data-rcs-folders-checkpoint',
  'data-rcs-folders-clear',
  'data-rcs-ai-base-url',
  'data-rcs-ai-api-key',
  'data-rcs-ai-settings-open',
  'data-rcs-ai-settings-dialog',
  'data-rcs-ai-settings-close',
  'data-rcs-ai-settings-tab="connection"',
  'data-rcs-ai-settings-tab="airp"',
  'data-rcs-ai-settings-save',
  'data-rcs-ai-profile-select',
  'data-rcs-ai-profile-name',
  'data-rcs-ai-profile-new',
  'data-rcs-ai-profile-delete',
  'data-rcs-ai-profile-activate',
  'data-rcs-ai-profile-disable',
  'data-rcs-ai-profile-active-state',
  'data-rcs-ai-key-reveal',
  'data-rcs-ai-key-clear',
  'data-rcs-ai-connection-summary',
  'data-rcs-airp-import',
  'data-rcs-airp-list',
  'data-rcs-airp-order-group',
  'data-rcs-airp-parameters',
  'data-rcs-airp-entry-list',
  'data-rcs-airp-unreferenced',
  'data-rcs-airp-current-summary',
  'data-rcs-airp-settings-status',
  'data-rcs-airp-disable',
  'data-rcs-airp-discard',
  'data-rcs-airp-save',
  'class="rcs-agent-dock"',
  'data-rcs-agent-timeline',
  'data-rcs-agent-input',
  'data-rcs-agent-send',
  'data-rcs-agent-stop',
  'data-rcs-agent-approve',
  'data-rcs-agent-reject',
  'data-rcs-agent-mode-panel',
  'data-rcs-agent-mode-summary',
  'data-rcs-agent-mode="internal"',
  'data-rcs-agent-mode="codex"',
  'data-rcs-agent-mode="claude"',
  'data-rcs-agent-mode-state',
  'data-rcs-agent-external-panel',
  'data-rcs-agent-path="workspaceDirectory"',
  'data-rcs-agent-path="guideDbDirectory"',
  'data-rcs-agent-path="codexSkillsDirectory"',
  'data-rcs-agent-path="claudeSkillsDirectory"',
  'data-rcs-knowledge-source-pick="skill"',
  'data-rcs-knowledge-source-pick="guideDb"',
  'data-rcs-wiki-toggle',
  'data-rcs-dock-tab="agent"',
  'data-rcs-dock-tab="wiki"',
  'data-rcs-wiki-query',
  'data-rcs-wiki-results',
  'data-rcs-wiki-explain',
  'data-rcs-wiki-stop',
  'data-rcs-agent-resize',
  'data-rcs-sidebar-resize',
  'data-rcs-sidebar-toggle',
  'data-rcs-card-field="systemPrompt"',
  'data-rcs-card-field="postHistoryInstructions"',
  'data-rcs-alternate-list',
  'data-rcs-alternate-add',
  'data-rcs-workflow-layout-reset',
  'data-rcs-workflow-layout',
  'class="rcs-workflow-canvas-viewport"',
  'data-rcs-workflow-inspector-toggle',
  'data-rcs-workflow-node-label',
  'data-rcs-workflow-node-description',
  'data-rcs-workflow-node-reset',
  'data-rcs-assembly-plan-status',
  'data-rcs-assembly-plan-fingerprint',
  'data-rcs-assembly-count="write"',
  'data-rcs-assembly-count="preserve"',
  'data-rcs-assembly-count="normalize"',
  'data-rcs-assembly-count="project-only"',
  'data-rcs-assembly-count="blocker"',
  'data-rcs-assembly-list="write"',
  'data-rcs-assembly-list="preserve"',
  'data-rcs-assembly-list="normalize"',
  'data-rcs-assembly-list="project-only"',
  'data-rcs-variable-reference-summary',
  'data-rcs-variable-reference-issues',
  'data-rcs-assembly-diff-list',
  'data-rcs-review',
  'data-rcs-review-status',
  'data-rcs-review-tab="text"',
  'data-rcs-review-tab="code"',
  'data-rcs-review-list',
  'data-rcs-review-original',
  'data-rcs-review-current',
  'data-rcs-review-agent',
]) assert.ok(portalSource.includes(hook), `制卡工作台缺少接线 ${hook}`);

const reviewCheckViewStart = portalSource.indexOf('<section class="rcs-view" data-rcs-view="check"');
const reviewCheckViewEnd = portalSource.indexOf('<section class="rcs-view rcs-publish-view"', reviewCheckViewStart);
assert.ok(reviewCheckViewStart >= 0 && reviewCheckViewEnd > reviewCheckViewStart, '无法提取检查页审查边界');
const reviewCheckViewSource = portalSource.slice(reviewCheckViewStart, reviewCheckViewEnd);
assert.match(reviewCheckViewSource, /class="rcs-review-compare"[^>]*data-rcs-review/, '审查与对照必须位于检查页内');
assert.ok(reviewCheckViewSource.indexOf('data-rcs-review') > reviewCheckViewSource.indexOf('class="rcs-check-layout"'), '审查与对照必须作为检查页全宽区域放在双栏检查布局之后');
assert.doesNotMatch(reviewCheckViewSource, /class="rcs-review-detail"[^>]*aria-live/, '完整原文与候选不得作为 live region 反复向读屏器播报');
const reviewWorldbookStart = portalSource.indexOf('<section class="rcs-view" data-rcs-view="worldbook"');
const reviewWorldbookEnd = portalSource.indexOf('<section class="rcs-view" data-rcs-view="mvu"', reviewWorldbookStart);
assert.doesNotMatch(portalSource.slice(reviewWorldbookStart, reviewWorldbookEnd), /data-rcs-review/, '世界书编辑页不得混入审查与对照区域');

const reviewUiSource = studioSource.slice(
  studioSource.indexOf('function reviewItemId'),
  studioSource.indexOf('function runProjectChecks'),
);
assert.match(reviewUiSource, /function renderReviewComparison\(plan\)/, '检查页必须从装配计划渲染审查对照');
assert.match(reviewUiSource, /\$\('\[data-rcs-review-original\]'\)\.textContent\s*=[\s\S]*reviewTextValue\(item\.original\)/, '导入原文必须通过 textContent 惰性渲染');
assert.match(reviewUiSource, /\$\('\[data-rcs-review-current\]'\)\.textContent\s*=[\s\S]*reviewTextValue\(item\.current\)/, '当前候选必须通过 textContent 惰性渲染');
assert.match(reviewUiSource, /list\.replaceChildren\(\.\.\.rows\)/, '审查条目列表必须安全替换节点');
assert.match(reviewUiSource, /originalState === 'absent'[\s\S]*导入原文中不存在/, '新增条目必须显式区分导入原文不存在');
assert.match(reviewUiSource, /currentRemoved[\s\S]*当前候选中不存在/, '移除条目必须显式区分当前候选不存在');
assert.match(reviewUiSource, /部分原文不可用/, '部分对照必须明示原文边界');
assert.doesNotMatch(reviewUiSource, /\.slice\(0,\s*\d+\)/, '审查正文不得按字符或条数截断');
for (const forbiddenReviewCapability of [
  /innerHTML/,
  /insertAdjacentHTML/,
  /\beval\s*\(/,
  /new Function/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /TavernHelper/,
  /createWritable\s*\(/,
  /markDirty\s*\(/,
]) assert.doesNotMatch(reviewUiSource, forbiddenReviewCapability, `审查 UI 包含越界能力：${forbiddenReviewCapability}`);
assert.doesNotMatch(studioSource, /(?:DB_REVIEW|REVIEW_STORAGE|REVIEW_KEY)/, '审查选择与 Agent 交接不得新增持久化键');
const reviewAgentTaskSource = reviewUiSource.slice(
  reviewUiSource.indexOf('function reviewAgentTask'),
  reviewUiSource.indexOf('function externalReviewAgentPrompt'),
);
assert.match(reviewAgentTaskSource, /reviewAgentPayload\(item\)/, 'Agent 审查任务只能由当前选中条目建立');
assert.doesNotMatch(reviewAgentTaskSource, /lastCheck|lastExportPlan|project\./, 'Agent 审查任务不得夹带整卡、完整检查或其他项目字段');
const reviewHandoffSource = reviewUiSource.slice(
  reviewUiSource.indexOf('function handoffSelectedReviewItem'),
  reviewUiSource.indexOf('function renderReviewComparison'),
);
assert.match(reviewHandoffSource, /input\.value = reviewAgentDraft/, '显式交接必须先填入现有 Agent 输入框');
assert.doesNotMatch(reviewHandoffSource, /sendStudioAgentMessage\s*\(/, '交给 Agent 审查不得自动发送');
assert.match(reviewUiSource, /if \(reviewAgentDraft && input\) input\.value = ''/, '项目变化必须清除已预填且可能被编辑过的旧审查草稿');
const reviewAgentContractSource = studioSource.slice(
  studioSource.indexOf('function studioAgentTurnContract'),
  studioSource.indexOf('async function sendStudioAgentMessage'),
);
assert.match(reviewAgentContractSource, /snapshot\.route === 'worldbook'[\s\S]*当前模块只允许只读回答。直接返回给用户的正文，不要使用 JSON/, '非世界书 Agent 回合必须使用纯文本回复');
assert.match(reviewAgentContractSource, /如确实需要替换当前世界书条目正文[\s\S]*只返回一个 JSON 对象/, '只有世界书提案回合可以要求结构化 JSON');
assert.match(studioAiSource, /function parseAgentTurnResponse\(value,\s*\{\s*allowProposal\s*=\s*false\s*\}/, 'Agent 解析器必须默认禁止提案');
assert.match(sendStudioAgentSource, /const proposalAllowed = snapshot\.route === 'worldbook' && snapshot\.entryUid !== null;[\s\S]{0,160}parseAgentTurnResponse\(completion\.text,\s*\{\s*allowProposal:\s*proposalAllowed\s*\}\)/, '普通对话解析器必须由本地世界书现场决定是否接受提案');
assert.match(studioSource, /const parsed = parseAgentTurnResponse\(completion\.text,\s*\{\s*allowProposal:\s*false\s*\}\);[\s\S]{0,120}studioKnowledgeExplanation = parsed\.reply/, '知识 Wiki 必须按只读模式清理模型格式包裹');
assert.match(studioSource, /data-rcs-review-tab[\s\S]{0,1400}ArrowLeft[\s\S]{0,100}ArrowRight[\s\S]{0,100}Home[\s\S]{0,100}End/, '审查分类页签必须提供完整键盘导航');
assert.match(studioSource, /data-rcs-review-list[\s\S]{0,220}closest\('\[data-rcs-review-item\]'\)[\s\S]{0,120}selectReviewItem/, '审查条目列表必须通过事件委托选择条目');
assert.match(studioSource, /data-rcs-review-agent[^\n]*addEventListener\('click', handoffSelectedReviewItem\)/, 'Agent 审查按钮必须显式接线');
assert.match(studioSource, /function renderAssemblyPlan[\s\S]{0,3000}renderReviewComparison\(null\)/, '装配计划失效时必须同步清空审查对照');
assert.match(studioSource, /function renderAssemblyPlan[\s\S]{0,6500}renderReviewComparison\(plan\)/, '装配计划生成时必须同步刷新审查对照');
const reviewPaneCss = studioCssSource.match(/\.rcs-review-panes pre\s*\{([^}]*)\}/)?.[1] || '';
const reviewWorkspaceCss = studioCssSource.match(/\.rcs-review-workspace\s*\{([^}]*)\}/)?.[1] || '';
const reviewListCss = studioCssSource.match(/\.rcs-review-list\s*\{([^}]*)\}/)?.[1] || '';
const reviewDetailCss = studioCssSource.match(/\.rcs-review-detail\s*\{([^}]*)\}/)?.[1] || '';
const reviewEmptyCss = studioCssSource.match(/\.rcs-review-empty\s*\{([^}]*)\}/)?.[1] || '';
assert.match(reviewWorkspaceCss, /min-height:\s*clamp\(315px,\s*45dvh,\s*390px\)/, '审查工作区必须在 1080p 保持基线并允许低高度压缩');
assert.match(reviewListCss, /max-height:\s*min\(560px,\s*55dvh\)/, '审查列表必须按低高度视口限高并独立滚动');
assert.match(reviewDetailCss, /min-height:\s*clamp\(315px,\s*45dvh,\s*390px\)/);
assert.match(reviewEmptyCss, /min-height:\s*clamp\(315px,\s*45dvh,\s*390px\)/);
assert.match(reviewPaneCss, /min-height:\s*clamp\(220px,\s*32dvh,\s*300px\)/, '审查正文必须允许在 600px 高视口压缩');
assert.match(reviewPaneCss, /max-height:\s*min\(460px,\s*48dvh\)/, '长审查正文必须按桌面视口动态限高');
assert.match(reviewPaneCss, /overflow:\s*auto/, '长审查正文必须独立滚动');
assert.match(reviewPaneCss, /white-space:\s*pre-wrap/, '审查正文必须安全保留换行并避免横向撑破');

assert.match(studioSource, /function prepareRolecardExport\(\)/, '角色卡交付必须共享唯一装配预检门');
assert.equal((studioSource.match(/const plan = prepareRolecardExport\(\);/g) || []).length, 3, 'JSON、PNG 与世界书必须全部经过同一装配预检门');
assert.match(studioSource, /if \(!plan \|\| plan\.status === 'blocked' \|\| \(checkResult\.counts\.error \|\| 0\) > 0\)/, '预检阻断必须拒绝角色卡交付');
const m3jProjectBackupSource = studioSource.slice(studioSource.indexOf('function projectBackupData'), studioSource.indexOf('function prepareRolecardExport'));
assert.doesNotMatch(m3jProjectBackupSource, /prepareRolecardExport/, '项目备份必须在角色卡装配阻断时仍可导出');

const agentModeMarkup = portalSource.slice(
  portalSource.indexOf('data-rcs-agent-mode-panel'),
  portalSource.indexOf('</details>', portalSource.indexOf('data-rcs-agent-mode-panel')),
);
assert.equal((agentModeMarkup.match(/aria-checked="true"/g) || []).length, 1, '首屏只能有一个真实启用的 Agent 模式');
assert.match(agentModeMarkup, /data-rcs-agent-mode="internal"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-rcs-agent-mode="internal"/, '刷新后必须安全默认内置 Agent');
assert.equal(portalSource.includes('data-rcs-ai-platform'), false, '旧 Codex / Claude 平台选择器不得残留');
assert.match(agentModeMarkup, /data-rcs-project-settings-label="fixed"/, 'Agent 模式区必须保留明确的项目与分工设置标签');
assert.match(studioCssSource, /\.rcs-agent-mode button\[data-pending="true"\]::after\s*\{[^}]*content:\s*'待切换'/, '待切换目标必须提供可见文字提示');

const studioSidebarSource = portalSource.slice(
  portalSource.indexOf('<aside class="rcs-sidebar"'),
  portalSource.indexOf('</aside>', portalSource.indexOf('<aside class="rcs-sidebar"')),
);
assert.match(studioSidebarSource, /data-rcs-sidebar-resize[\s\S]{0,180}role="separator"|role="separator"[\s\S]{0,180}data-rcs-sidebar-resize/, '侧栏调整把手必须位于侧栏内并使用 separator 语义');
assert.match(studioSidebarSource, /data-rcs-sidebar-toggle[^>]*aria-controls="rcs-studio-sidebar"/, '侧栏缩略按钮必须声明控制目标');
assert.match(studioSidebarSource, /data-rcs-sidebar-toggle[^>]*aria-expanded="true"/, '侧栏缩略按钮必须使用披露控件语义');
assert.doesNotMatch(studioSidebarSource, /data-rcs-sidebar-toggle[^>]*aria-pressed=/, '侧栏开合不得把收起态表达为已按下');
for (const [route, compactLabel, title] of [
  ['project', '项目', '项目总览'],
  ['card', '卡片', '卡片基础'],
  ['worldbook', '世界', '世界书'],
  ['mvu', '状态', '状态机制'],
  ['frontend', '组件', '组件工坊'],
  ['design', '界面', '前端设计'],
  ['workflow', '流程', '工作流蓝图'],
  ['check', '检查', '检查与导出'],
]) {
  assert.match(studioSidebarSource, new RegExp(`data-rcs-route-link="${route}"[^>]*title="${title}"[^>]*><span>${compactLabel}</span>`), `${route} 缩略导航必须使用可理解的语义标签`);
}
assert.doesNotMatch(studioSidebarSource, /<span>0[1-8]<\/span>/, '创作模块缩略导航不得退回抽象编号');
const expandedSidebarShortLabelRule = (
  studioCssSource.match(/(?:^|\n)\.rcs-root:not\(\.sidebar-collapsed\) \.rcs-module-nav a > span\s*\{([^}]*)\}/)?.[1]
  || studioCssSource.match(/(?:^|\n)\.rcs-module-nav a > span\s*\{([^}]*)\}/)?.[1]
  || ''
);
assert.match(expandedSidebarShortLabelRule, /display:\s*none/, '侧栏展开时不得同时显示缩略标签与完整导航文案');
const collapsedSidebarDetailRuleStart = studioCssSource.indexOf('.rcs-root.sidebar-collapsed .rcs-module-nav a > div,');
assert.ok(collapsedSidebarDetailRuleStart >= 0, '侧栏折叠态必须声明完整导航内容的隐藏规则');
const collapsedSidebarDetailRule = studioCssSource.slice(
  collapsedSidebarDetailRuleStart,
  studioCssSource.indexOf('}', collapsedSidebarDetailRuleStart) + 1,
);
assert.match(collapsedSidebarDetailRule, /\.rcs-root\.sidebar-collapsed \.rcs-module-nav a > i/, '侧栏折叠时状态徽标必须与完整文案一起隐藏');
assert.match(collapsedSidebarDetailRule, /display:\s*none/, '侧栏折叠时必须隐藏完整导航内容');
const collapsedSidebarShortLabelRule = studioCssSource.match(/(?:^|\n)\.rcs-root\.sidebar-collapsed \.rcs-module-nav a > span\s*\{([^}]*)\}/)?.[1] || '';
assert.match(collapsedSidebarShortLabelRule, /display:\s*(?:block|inline|inline-block)/, '侧栏折叠时必须显式恢复缩略标签');
const sharedStudioButtonRule = studioCssSource.match(/(?:^|\n)\.rcs-button,\s*\n\.rcs-icon-button\s*\{([^}]*)\}/)?.[1] || '';
assert.match(sharedStudioButtonRule, /display:\s*inline-flex/, '工作台通用按钮必须使用可居中的弹性布局');
assert.match(sharedStudioButtonRule, /align-items:\s*center/, '工作台通用按钮文字必须垂直居中');
assert.match(sharedStudioButtonRule, /justify-content:\s*center/, '工作台通用按钮文字必须水平居中');
assert.match(sharedStudioButtonRule, /text-align:\s*center/, '工作台通用按钮必须保留多行文字居中兜底');
const narrowStudioMediaStart = studioCssSource.indexOf('@media (max-width: 900px)');
const narrowStudioMediaEnd = studioCssSource.indexOf('@media (max-width: 700px)', narrowStudioMediaStart);
assert.ok(narrowStudioMediaStart >= 0 && narrowStudioMediaEnd > narrowStudioMediaStart, '工作台必须保留 900px 桌面窄宽断点');
const narrowStudioMedia = studioCssSource.slice(narrowStudioMediaStart, narrowStudioMediaEnd);
const narrowExpandedNavRule = (
  narrowStudioMedia.match(/\.rcs-root:not\(\.sidebar-collapsed\) \.rcs-module-nav a\s*\{([^}]*)\}/)?.[1]
  || narrowStudioMedia.match(/(?:^|\n)\s*\.rcs-module-nav a\s*\{([^}]*)\}/)?.[1]
  || ''
);
assert.match(narrowExpandedNavRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)(?:\s+auto)?/, '900px 桌面窄宽下展开导航不得为隐藏的缩略标签保留空列');
assert.doesNotMatch(narrowExpandedNavRule, /grid-template-columns:[^;]*\b(?:24|28)px\b/, '900px 桌面窄宽下不得残留缩略标签固定列');
assert.match(studioSource, /function toggleStudioSidebar[\s\S]{0,420}persistStudioLayoutPreferences\(\)/, '侧栏缩略态必须沿用现有布局偏好并即时保存');
assert.match(studioSource, /sidebarToggle\.setAttribute\('aria-expanded', String\(!studioLayout\.sidebarCollapsed\)\)/, '侧栏 aria-expanded 必须与展开状态一致');
assert.match(portalSource, /data-rcs-agent-resize[^>]*aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"/, 'Agent 尺寸把手必须提供键盘替代');
assert.equal(portalSource.includes('data-rcs-card-field="groupOnlyGreetings"'), false, '群聊专用开场不得继续暴露在工作台界面');
assert.match(studioSource, /function renderAlternateGreetings[\s\S]{0,2200}dataset\.rcsAlternateRemove/, '候选开局必须渲染为可逐条增删的气泡编辑器');
assert.match(studioSource, /function removeAlternateGreeting[\s\S]{0,700}window\.confirm[\s\S]{0,700}data-rcs-alternate-add/, '删除非空候选开局必须确认，清空列表后焦点必须回到新增按钮');
assert.match(studioSource, /function finishWorkflowNodeDrag[\s\S]{0,1600}setWorkflowNodePosition/, '工作流节点拖动结束后必须保存位置');
assert.match(studioSource, /function finishWorkflowNodeDrag[\s\S]{0,1900}setWorkflowNodePosition[\s\S]{0,500}renderWorkflow\(\)/, '工作流节点拖动完成后必须立即刷新重置按钮与自定义位置摘要');
assert.match(studioSource, /function finishWorkflowNodeDrag[\s\S]{0,700}if \(revert\)[\s\S]{0,240}renderWorkflow\(\)/, '取消节点拖动必须同时恢复节点与画布尺寸');
assert.match(studioSource, /function moveWorkflowNodeWithKeyboard[\s\S]{0,1200}ArrowLeft[\s\S]{0,600}renderWorkflow\(\)/, '工作流节点必须提供键盘移动替代');
assert.match(studioSource, /function moveWorkflowNodeWithKeyboard[\s\S]{0,520}selectWorkflowNode\(nodeItem\.id\)/, '键盘移动前必须同步选中节点与详情面板');
assert.match(studioSource, /function resetCurrentWorkflowLayout[\s\S]{0,600}layoutOverrides/, '工作流画布必须能够重置当前布局');
assert.match(studioCssSource, /--workflow-editor-height:\s*clamp\(460px,\s*calc\(100dvh - 255px\),\s*1080px\)/, '工作流画布必须兼顾 600px 低高度与 4K 高度上限');
assert.doesNotMatch(studioCssSource, /--workflow-editor-height:[^;]*820px/, '工作流画布不得恢复固定高度上限');
assert.match(studioCssSource, /--rcs-builder-frame-min:\s*clamp\(480px,\s*60dvh,\s*640px\)/, 'UI Builder 必须在 1080p 保持基线并允许低高度压缩');
assert.match(studioCssSource, /grid-template-rows:\s*auto\s+minmax\(var\(--rcs-builder-frame-min\),\s*1fr\)\s+auto/, 'UI Builder 主行必须消费统一高度变量');
assert.match(studioCssSource, /\.rcs-builder-frame-shell\s*\{[^}]*min-height:\s*var\(--rcs-builder-frame-min\)/, 'UI Builder iframe 外壳必须与主行共享高度边界');
const studioRootLayoutRule = studioCssSource.match(/(?:^|\n)\.rcs-root\s*\{([^}]*)\}/)?.[1] || '';
assert.match(studioRootLayoutRule, /height:\s*100%/, '工作台根容器必须填满桌面壳层可用高度');
assert.match(studioRootLayoutRule, /min-height:\s*0/, '工作台根容器必须允许在低高度桌面壳层内收缩');
assert.match(studioRootLayoutRule, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/, '工作台根容器必须把剩余高度交给主操作区');
const studioBodyLayoutRule = studioCssSource.match(/(?:^|\n)\.rcs-body\s*\{([^}]*)\}/)?.[1] || '';
assert.match(studioBodyLayoutRule, /min-height:\s*0/, '工作台主体必须允许在壳层剩余高度内收缩');
assert.doesNotMatch(studioBodyLayoutRule, /max\(730px/, '工作台主体不得恢复强制 730px 最小高度');
const workflowLayoutCss = studioCssSource.match(/\.rcs-workflow-layout\s*\{([^}]*)\}/)?.[1] || '';
assert.match(workflowLayoutCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)/, '工作流画布必须占满主列');
assert.doesNotMatch(workflowLayoutCss, /grid-template-columns:[^;]*workflow-inspector-width/, '覆盖式节点编辑器不得继续挤占画布列宽');
assert.match(studioCssSource, /\.rcs-workflow-canvas-viewport\s*\{[^}]*position:\s*relative/, '覆盖式节点编辑器必须锚定在画布视口内');
assert.match(studioCssSource, /@media \(min-width: 901px\)[\s\S]{0,1800}\.rcs-workflow-inspector\s*\{[^}]*position:\s*absolute/, '桌面节点编辑器必须作为覆盖式 Dock，不得缩窄画布');
assert.match(studioCssSource, /data-inspector-collapsed="true"[\s\S]{0,120}--workflow-inspector-width:\s*54px/, '节点编辑器收起后必须只保留窄把手');
assert.match(studioCssSource, /data-inspector-collapsed="true"[\s\S]{0,100}\.rcs-workflow-inspector[\s\S]{0,80}height:\s*54px/, '节点编辑器收起后不得继续保留整条空白栏');
assert.match(studioCssSource, /\.rcs-workflow-node-editor textarea[\s\S]{0,320}min-height:\s*150px/, '节点内容必须使用可操作的多行编辑框');
assert.match(portalSource, /data-rcs-workflow-node-label[^>]*aria-describedby="rcs-workflow-node-edit-status"|aria-describedby="rcs-workflow-node-edit-status"[^>]*data-rcs-workflow-node-label/, '节点标题错误状态必须与输入框建立无障碍关联');
assert.match(studioSource, /function toggleWorkflowInspector[\s\S]{0,260}scheduleWorkflowEdges\(\)/, '节点编辑器开合后必须重绘连线');
assert.match(studioSource, /function updateCurrentWorkflowNodeText[\s\S]{0,4200}markDirty\(\{ invalidateSync: false, invalidateValidation: false \}\)/, '节点文字编辑必须自动保存且不污染角色卡同步或检查状态');
assert.match(studioSource, /function resetCurrentWorkflowNodeText[\s\S]{0,500}delete workflowNodeOverrideBucket/, '节点编辑器必须允许恢复生成内容');
assert.match(studioSource, /function exportCurrentWorkflow[\s\S]{0,600}workflowExportFile\(workflowDocumentWithOverrides\(document\)\)/, '独立蓝图导出必须合并节点文字编辑');
assert.match(studioSource, /function resetCurrentWorkflow[\s\S]{0,900}nodeOverrides\[engine\] = \{\}/, '清除蓝图必须同步清除节点文字与布局 override');

const aiSettingsDialogSource = portalSource.slice(
  portalSource.indexOf('<dialog class="rcs-project-dialog rcs-ai-settings-dialog"'),
  portalSource.indexOf('</dialog>', portalSource.indexOf('<dialog class="rcs-project-dialog rcs-ai-settings-dialog"')),
);
const aiSettingsDialogCss = studioCssSource.match(/\.rcs-project-dialog\.rcs-ai-settings-dialog\s*\{([^}]*)\}/u)?.[1] || '';
assert.match(aiSettingsDialogCss, /width:\s*1240px/u, '设置窗口桌面宽度必须固定，切换 Tab 不得改变外框');
assert.match(aiSettingsDialogCss, /height:\s*780px/u, '设置窗口桌面高度必须固定，切换 Tab 不得改变外框');
assert.match(aiSettingsDialogCss, /max-width:\s*calc\(100vw - 40px\)/u, '设置窗口必须按可用视口简单收缩');
assert.match(aiSettingsDialogCss, /max-height:\s*calc\(100dvh - 40px\)/u, '设置窗口必须按可用视口高度简单收缩');
const assistantPanelSource = portalSource.slice(
  portalSource.indexOf('<section class="rcs-agent-dock"'),
  portalSource.indexOf('<nav class="rcs-mobile-nav"', portalSource.indexOf('<section class="rcs-agent-dock"')),
);
assert.match(aiSettingsDialogSource, /服务商预设（可选）/u, '设置页必须明确服务商预设不是必选项');
assert.match(aiSettingsDialogSource, /AIRP 是可选项/u, '设置页必须明确 AIRP 不是必选项');
for (const settingsOnlyHook of ['data-rcs-ai-base-url', 'data-rcs-ai-api-key', 'data-rcs-ai-model', 'data-rcs-airp-file']) {
  assert.ok(aiSettingsDialogSource.includes(settingsOnlyHook), `AI 设置弹窗缺少 ${settingsOnlyHook}`);
  assert.equal(assistantPanelSource.includes(settingsOnlyHook), false, `常驻 Agent Dock 不得暴露 ${settingsOnlyHook}`);
  assert.equal(portalSource.match(new RegExp(`${settingsOnlyHook}(?=[\\s>])`, 'g'))?.length, 1, `${settingsOnlyHook} 必须保持唯一`);
}
for (const format of [
  'openai-compatible',
  'openai-responses',
  'anthropic-messages',
  'google-gemini',
  'cohere-v2',
  'dashscope-native',
  'ollama-native',
]) {
  assert.match(aiSettingsDialogSource, new RegExp(`<option value="${format}">`), `原生 API 格式下拉缺少 ${format}`);
}
assert.match(aiSettingsDialogSource, /<span>原生 API 格式<\/span><select data-rcs-ai-api-format>/, '原生 API 格式下拉必须使用清晰可见的标签');
for (const routingHook of [
  'data-rcs-ai-settings-tab="routing"',
  'data-rcs-ai-settings-panel="routing"',
  'data-rcs-ai-routing-mode',
  'data-rcs-ai-routing-profiles',
  'data-rcs-ai-role-binding="primary"',
  'data-rcs-ai-role-binding="worker"',
  'data-rcs-ai-role-binding="reviewer"',
]) assert.ok(aiSettingsDialogSource.includes(routingHook), `路由与 Plan 设置缺少 ${routingHook}`);
for (const credentialHook of [
  'data-rcs-ai-credential-kind',
  'value="sessionApiKey"',
  'value="sessionCodingPlanKey"',
  'data-rcs-ai-coding-plan-preset',
  'value="aliyun"',
  'value="minimax"',
  'value="glm"',
  'value="kimi"',
]) assert.ok(aiSettingsDialogSource.includes(credentialHook), `Coding Plan 接入缺少 ${credentialHook}`);
for (const mcpHook of [
  'data-rcs-ai-settings-tab="mcp"',
  'data-rcs-ai-settings-panel="mcp"',
  'data-rcs-mcp-native-state',
  'data-rcs-mcp-server-select',
  'data-rcs-mcp-executable',
  'data-rcs-mcp-args',
  'data-rcs-mcp-cwd',
  'data-rcs-mcp-env-names',
  'data-rcs-mcp-env-values',
  'data-rcs-mcp-operation',
  'data-rcs-mcp-prepare',
  'data-rcs-mcp-execute',
  'data-rcs-mcp-cancel',
  'data-rcs-mcp-summary-text',
  'data-rcs-mcp-result-text',
  'data-rcs-mcp-attach',
]) assert.ok(aiSettingsDialogSource.includes(mcpHook), `MCP 设置缺少 ${mcpHook}`);
assert.ok(
  aiSettingsDialogSource.includes('当前仅支持手动 <code>tools/list</code> 与 <code>tools/call</code> 的 stdio 流程。HTTP / SSE 与模型自动工具循环留待后续版本；Web 预览不能执行本机进程。'),
  'MCP 设置必须明确当前仅支持手动 stdio，且 Web 预览不可执行',
);
assert.ok(
  aiSettingsDialogSource.includes('启动参数仅本页会话，不会写入 IndexedDB；参数与环境值都需每次会话载入。'),
  'MCP 设置必须明确启动参数与环境值都只在本页会话载入',
);
assert.match(studioMcpSource, /invoke\('desktop_mcp_prepare', \{ request \}\)/, 'MCP prepare 必须使用受限 camelCase 桥参数');
assert.match(studioMcpSource, /invoke\('desktop_mcp_execute', \{ intentId: id \}\)/, 'MCP execute 必须使用 camelCase intentId');
assert.match(studioMcpSource, /invoke\('desktop_mcp_cancel', \{ intentId: id \}\)/, 'MCP cancel 必须使用 camelCase intentId');
assert.match(studioMcpSource, /receipt\.approvedAt[\s\S]*receipt\.immutableDigest/, '原生批准回执必须按 Rust camelCase 字段校验');
assert.match(studioMcpSource, /Number\.isSafeInteger\(receipt\.approvedAt\)/, '批准时间必须按 Rust u64 毫秒值校验');
const normalizeMcpServerConfigSource = studioMcpSource.slice(
  studioMcpSource.indexOf('function normalizeMcpServerConfig'),
  studioMcpSource.indexOf('function normalizeMcpServerRegistry'),
);
assert.doesNotMatch(normalizeMcpServerConfigSource, /\bargs\s*:/, 'MCP 规范化配置不得接纳启动参数');
const mcpServerStorageSource = studioMcpSource.slice(
  studioMcpSource.indexOf('function mcpServerStorageValue'),
  studioMcpSource.indexOf('function normalizeToolArguments'),
);
assert.doesNotMatch(mcpServerStorageSource, /\bargs\s*:/, 'MCP IndexedDB 值不得包含启动参数');
const createMcpPrepareRequestSource = studioMcpSource.slice(
  studioMcpSource.indexOf('function createMcpPrepareRequest'),
  studioMcpSource.indexOf('function createDesktopMcpBridge'),
);
assert.match(createMcpPrepareRequestSource, /args:\s*normalizeMcpArgs\(args\)/, 'MCP prepare 必须从独立页内参数构造请求');

const renderStudioMcpSource = studioSource.slice(
  studioSource.indexOf('function renderStudioMcpSettings'),
  studioSource.indexOf('async function runStudioMcpMutation'),
);
assert.match(renderStudioMcpSource, /prepare\.disabled = !desktop/, 'Web 预览必须硬禁用 MCP prepare');
assert.match(renderStudioMcpSource, /execute\.disabled = !desktop/, 'Web 预览必须硬禁用 MCP execute');
assert.match(renderStudioMcpSource, /summaryText\.textContent = studioMcpSummaryText/, 'MCP 原生摘要必须只以 textContent 渲染');
assert.match(renderStudioMcpSource, /resultText\.textContent = studioMcpLastResult/, 'MCP 结果必须只以 textContent 渲染');
assert.doesNotMatch(renderStudioMcpSource, /innerHTML|insertAdjacentHTML/, 'MCP 摘要与结果不得进入 HTML 解释器');

const prepareStudioMcpSource = studioSource.slice(
  studioSource.indexOf('async function prepareStudioMcpOperation'),
  studioSource.indexOf('async function executePreparedStudioMcpOperation'),
);
assert.match(prepareStudioMcpSource, /bridge\.prepare\(request\)/, 'MCP 必须先 prepare 并展示原生摘要');
assert.doesNotMatch(prepareStudioMcpSource, /bridge\.execute/, 'prepare 阶段不得自动执行 MCP');
const executeStudioMcpSource = studioSource.slice(
  studioSource.indexOf('async function executePreparedStudioMcpOperation'),
  studioSource.indexOf('async function cancelStudioMcpOperation'),
);
assert.match(executeStudioMcpSource, /bridge\.execute\(intent\.summary\.intentId\)/, '只有显式执行按钮才能提交已准备 intent');
assert.match(executeStudioMcpSource, /hasNativeApprovalReceipt\(result/, 'MCP 执行结果必须校验原生批准回执');

const mcpSummarySource = studioSource.slice(
  studioSource.indexOf('function studioMcpSummaryText'),
  studioSource.indexOf('function renderStudioMcpSettings'),
);
for (const summaryField of ['executable', 'args', 'cwd', 'envNames', 'operation', 'tool', 'arguments']) {
  assert.match(mcpSummarySource, new RegExp(`\\b${summaryField}:`), `MCP 摘要缺少 ${summaryField}`);
}
assert.doesNotMatch(mcpSummarySource, /request\.env\b/, 'MCP 摘要不得显示环境值');

const mcpAttachmentSource = studioSource.slice(
  studioSource.indexOf('function studioMcpAttachmentMessages'),
  studioSource.indexOf('function clearStudioMcpEphemeralState'),
);
assert.match(mcpAttachmentSource, /role: 'user'/, 'MCP 结果附件只能作为 user 上下文');
assert.doesNotMatch(mcpAttachmentSource, /role: 'system'/, 'MCP 结果附件不得升级为 system 上下文');
assert.match(studioSource, /if \(mcpAttachmentMessages\.length\) consumeStudioMcpAttachment\(\)/, 'MCP 结果附件必须在下一次已发送请求中一次性消费');
assert.match(studioSource, /formatMcpResultForContext\(record\.result, \{ maxCharacters: 24_000 \}\)/, 'MCP Agent 附件必须限制为 24k 字符');
assert.match(studioSource, /window\.addEventListener\('pagehide'[\s\S]{0,420}clearStudioMcpEphemeralState\(\)/, '页面离开必须清除 MCP 环境、intent、结果与附件');
assert.match(studioSource, /(?:const|let) studioMcpSessionArgs = new Map\(\)/, 'MCP 启动参数必须使用独立的本页 Map');
assert.match(studioSource, /(?:const|let) studioMcpSessionEnvironments = new Map\(\)/, 'MCP 环境值必须使用独立的本页 Map');
assert.match(studioSource, /const DB_MCP_SERVERS_KEY = 'studioMcp:servers:v1'/, 'MCP 无密钥配置必须使用独立持久化键');
const fillStudioMcpServerFormSource = studioSource.slice(
  studioSource.indexOf('function fillStudioMcpServerForm'),
  studioSource.indexOf('function studioMcpSummaryText'),
);
assert.match(fillStudioMcpServerFormSource, /studioMcpArgs\(server\)/, '选择 MCP 服务时必须从本页 Map 恢复启动参数');
const loadStudioMcpStateSource = studioSource.slice(
  studioSource.indexOf('async function loadStudioMcpState'),
  studioSource.indexOf('async function saveStudioMcpServer'),
);
assert.match(loadStudioMcpStateSource, /mcpServerStorageValue\(studioMcpServers\)[\s\S]*idbPut\(normalized, DB_MCP_SERVERS_KEY\)/, '载入旧 MCP 配置时必须回写并移除旧 args');
const saveStudioMcpServerSource = studioSource.slice(
  studioSource.indexOf('async function saveStudioMcpServer'),
  studioSource.indexOf('function startNewStudioMcpServer'),
);
assert.match(saveStudioMcpServerSource, /studioMcpSessionArgs\.set\(draft\.id, args\)/, '保存 MCP 服务时参数只能写入本页 Map');
const deleteStudioMcpServerSource = studioSource.slice(
  studioSource.indexOf('async function deleteStudioMcpServer'),
  studioSource.indexOf('function loadStudioMcpSessionEnvironment'),
);
assert.match(deleteStudioMcpServerSource, /studioMcpSessionArgs\.delete\(server\.id\)/, '删除 MCP 服务时必须同步清除本页参数');
const clearStudioMcpEphemeralStateSource = studioSource.slice(
  studioSource.indexOf('function clearStudioMcpEphemeralState'),
  studioSource.indexOf('const airpMarkerLabels'),
);
assert.match(clearStudioMcpEphemeralStateSource, /studioMcpSessionArgs\.clear\(\)/, '页面离开必须清空 MCP 启动参数');
const invalidateStudioMcpSource = studioSource.slice(
  studioSource.indexOf('function invalidateStudioMcpPreparedIntent'),
  studioSource.indexOf('async function prepareStudioMcpOperation'),
);
assert.match(invalidateStudioMcpSource, /clearEnvironment = false/, 'MCP 配置失效必须显式区分是否清除页内环境');
assert.match(invalidateStudioMcpSource, /studioMcpSessionEnvironments\.delete\(server\.id\)/, 'MCP 配置失效时必须可清除对应页内环境值');
const closeStudioAiSettingsSource = studioSource.slice(
  studioSource.indexOf('function closeStudioAiSettings'),
  studioSource.indexOf('async function runStudioAiSettingsMutation'),
);
assert.doesNotMatch(closeStudioAiSettingsSource, /clearStudioMcpEphemeralState|cancelStudioMcpOperation/, '关闭设置弹窗不得暗中取消 MCP intent');
for (const planHook of [
  'data-rcs-agent-plan',
  'data-rcs-agent-plan-tasks',
  'data-rcs-agent-plan-approve',
  'data-rcs-agent-plan-reject',
]) assert.ok(assistantPanelSource.includes(planHook), `Agent 两阶段批准面板缺少 ${planHook}`);
assert.match(portalSource, /data-rcs-agent-skill-select/, 'Agent 上下文必须提供第三方主 Skill 下拉选择');
assert.equal(portalSource.includes('data-rcs-airp-select'), false, '旧 AIRP 下拉框不得残留');

for (const cardFieldMapping of [
  /systemPrompt: String\(data\.system_prompt/,
  /postHistoryInstructions: String\(data\.post_history_instructions/,
  /groupOnlyGreetings: Array\.isArray\(data\.group_only_greetings\)/,
  /system_prompt: project\.card\.systemPrompt/,
  /post_history_instructions: project\.card\.postHistoryInstructions/,
  /card\.data\.group_only_greetings = \[\.\.\.project\.card\.groupOnlyGreetings\]/,
]) assert.match(studioSource, cardFieldMapping, 'chara_card_v3 核心字段必须完成导入导出接线');

assert.match(localWorkspaceSource, /createStudioLocalWorkspaceHandleStore/);
assert.match(localWorkspaceSource, /requestPermission/);
assert.match(localWorkspaceSource, /createWritable/);
assert.equal(localWorkspaceSource.includes('removeEntry'), false, '清除目录授权不得删除磁盘内容');
assert.match(studioKnowledgeSource, /mode:\s*'read'/, 'Skill 与开发指南目录只能申请只读权限');
assert.match(studioKnowledgeSource, /createStudioAgentContextStore/);
assert.match(studioKnowledgeSource, /readStudioKnowledgeDocuments/);
for (const forbiddenKnowledgeCapability of [
  'createWritable',
  'removeEntry',
  "mode: 'readwrite'",
  'localStorage',
  'sessionStorage',
  'document.cookie',
  'innerHTML',
  'insertAdjacentHTML',
  'eval(',
  'new Function',
  'fetch(',
]) assert.equal(studioKnowledgeSource.includes(forbiddenKnowledgeCapability), false, `知识适配层包含越界能力：${forbiddenKnowledgeCapability}`);
for (const forbiddenStorage of ['localStorage', 'sessionStorage', 'document.cookie']) {
  assert.equal(studioAiSource.includes(forbiddenStorage), false, `AI 客户端不得使用 ${forbiddenStorage}`);
}
assert.match(studioAiSource, /removedSensitiveFields/);
assert.match(studioAiSource, /unsupportedInChatPrompts/);

assert.match(portalSource, /data-wsp-view="mine"/);
assert.match(portalSource, /data-wsp-local-publish/);
assert.match(portalSource, /data-wsp-login/);
assert.equal(portalSource.includes('Workshop Gateway'), false, '玩家文案不得暴露后端维护名称');
assert.match(portalSource, /data-page="workshop"/);
assert.match(portalSource, /data-cws-root/);
assert.match(portalSource, /data-route-link="workshop">创意工坊<\/a>/);
assert.match(portalSource, /data-rcs-route-link="frontend"[\s\S]{0,100}<strong>组件工坊<\/strong>/);
assert.match(portalSource, /#studio\/remix\/discover/);
assert.match(componentWorkshopSource, /\/api\/component-workshop\/packages/);
assert.match(componentWorkshopSource, /href="#studio\/remix"/);
assert.doesNotMatch(componentWorkshopSource, /card-component-catalog\.json|官方验证快照|official-registry/);
assert.match(studioSource, /card-component-catalog\.json/);
assert.equal(componentWorkshopSource.includes('/api/workshop/'), false, '创意工坊组件域不得调用星月作品域 API');
for (const previewTarget of ['html', 'st-html']) {
  assert.match(portalSource, new RegExp(`data-rcs-builder-preview="${previewTarget}"`), `UI Builder 缺少 ${previewTarget} 预览入口`);
}
assert.equal((portalSource.match(/data-rcs-builder-preview="(?:html|st-html)"/g) || []).length, 2, 'UI Builder 必须仅提供独立 HTML 与 ST HTML 两个预览入口');
assert.match(studioSource, /\$\$\('\[data-rcs-builder-preview\]'\)\.forEach[\s\S]{0,420}requestArtifact\(button\.dataset\.rcsBuilderPreview,\s*'preview'\)/, '两个预览入口必须把各自 target 交给同一产物链');
assert.match(studioSource, /function renderUiBuilderPreviewTarget\(artifact\)[\s\S]{0,160}artifact\.target === 'st-html'/, '预览弹窗必须显式区分 ST 挂载候选');
const builderEditorFrame = portalSource.match(/<iframe(?=[^>]*data-rcs-builder-frame(?:\s|>))[^>]*>/)?.[0] || '';
const builderPreviewFrame = portalSource.match(/<iframe(?=[^>]*data-rcs-builder-preview-frame(?:\s|>))[^>]*>/)?.[0] || '';
assert.match(builderEditorFrame, /sandbox="allow-scripts allow-downloads"/, '内嵌编辑器只能运行脚本并下载显式产物');
assert.match(builderPreviewFrame, /sandbox="allow-scripts"/, '导出预览只能运行固定 srcdoc 脚本');
assert.doesNotMatch(`${builderEditorFrame}\n${builderPreviewFrame}`, /allow-same-origin/, '编辑器与导出预览均不得与 RPN 登录凭证共享 origin');
const previewViewportOptions = {
  '1920x1080': [1920, 1080],
  '2560x1440': [2560, 1440],
  '3440x1440': [3440, 1440],
  '3840x1600': [3840, 1600],
  '3840x2160': [3840, 2160],
  '5120x2160': [5120, 2160],
};
assert.match(portalSource, /data-rcs-builder-preview-viewport[^>]*>[\s\S]*?<option value="auto">[^<]+<\/option>/, '导出预览必须保留跟随窗口的自动视口');
for (const [viewport, [width, height]] of Object.entries(previewViewportOptions)) {
  assert.match(portalSource, new RegExp(`<option value="${viewport}"`), `预览选择器缺少 ${viewport}`);
  assert.match(studioSource, new RegExp(`'${viewport}': \\[${width}, ${height}\\]`), `预览尺寸映射缺少 ${viewport}`);
}
assert.match(portalSource, /data-rcs-builder-preview-viewport-shell[^>]*data-viewport="auto"/, '导出预览 iframe 必须位于可滚动测试视口内');
assert.match(studioSource, /function applyUiBuilderPreviewViewport[\s\S]{0,1100}shell\.style\.setProperty\('--rcs-preview-viewport-width',[\s\S]{0,120}shell\.style\.setProperty\('--rcs-preview-viewport-height'/, '视口选择必须写入固定宽高变量');
assert.match(studioSource, /data-rcs-builder-preview-viewport[^\n]*addEventListener\('change'[\s\S]{0,120}applyUiBuilderPreviewViewport/, '测试视口选择器必须即时应用尺寸');
assert.match(studioCssSource, /\.rcs-builder-preview-viewport\s*\{[^}]*overflow:\s*auto/, '固定 2K/4K 测试视口必须在弹窗内滚动');
assert.match(studioCssSource, /data-viewport-fixed="true"[^}]*width:\s*var\(--rcs-preview-viewport-width\)[^}]*height:\s*var\(--rcs-preview-viewport-height\)/, '固定测试视口必须把选择尺寸应用到 iframe');
assert.match(
  studioSource,
  /message\.type === 'preview\.unloading'[\s\S]{0,180}endUiSimulationPreview\(\)[\s\S]{0,180}未继续发送状态/,
  '模拟预览离开固定 srcdoc 时，父页必须先关闭会话并停止发送状态',
);

assert.match(workshopSource, /const tokenStorageKey = 'xingyue-workshop-token';/);
assert.match(workshopSource, /crypto\.getRandomValues\(bytes\)/);
assert.match(workshopSource, /crypto\.subtle\.digest\('SHA-256'/);
assert.match(workshopSource, /'\/api\/workshop\/login-handoff\/start'/);
assert.match(workshopSource, /'\/api\/workshop\/login-handoff'/);
assert.match(workshopSource, /loginUrl\.searchParams\.set\('handoff'/);
assert.equal(workshopSource.includes("searchParams.set('return'"), false, 'RPN 登录不得携带公网 return');
assert.doesNotMatch(workshopSource, /postMessage\s*\([^\n]*token/i, 'RPN 登录不得通过 postMessage 传 token');
assert.match(workshopSource, /credentials: 'omit'/);
assert.match(workshopSource, /headers\.Authorization = `Bearer \$\{token\}`/);
assert.match(workshopSource, /'\/api\/workshop\/me'/);
assert.match(workshopSource, /'\/api\/workshop\/logout'/);
assert.match(workshopSource, /'\/api\/workshop\/me\/packages'/);
assert.match(workshopSource, /method: updating \? 'PUT' : 'POST'/);
assert.match(workshopSource, /method: 'DELETE'/);
assert.match(workshopSource, /'X-Package-Revision'/);
for (const publishOption of [
  /allowLegacyFactors: false/,
  /allowLegacyExtensions: false/,
  /allowLegacyCharacterAliases: false/,
  /portableMediaOnly: true/,
]) {
  assert.match(workshopSource, publishOption, 'RPN 发布前校验必须与 Gateway 严格契约一致');
}
assert.match(workshopSource, /Boolean\(state\.publishPackage\)/, '发布按钮只能由严格校验结果启用');
for (const status of ['pending', 'approved', 'rejected', 'withdrawn']) {
  assert.match(workshopSource, new RegExp(`${status}:`), `我的发布缺少 ${status} 状态`);
}
assert.equal(workshopSource.includes('/api/admin/'), false, 'RPN 不得接入管理员审核');
assert.equal(workshopSource.includes('/api/workshop/uploads/'), false, 'RPN 当前阶段不得接入整卡或媒体上传');
for (const storageCall of workshopSource.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]+)\)/g)) {
  assert.equal(storageCall[1].split(',')[0].trim(), 'tokenStorageKey', 'RPN 不得持久化昵称、头像或原始 Discord ID');
}

const model = await import(pathToFileURL(modelPath).href + '?test=' + Date.now());
assert.deepEqual(
  Object.keys(model).sort(),
  ['cardAdapter', 'makeCanonical', 'previewActivation', 'validateCanonical'].sort(),
);

const base = model.makeCanonical();
assert.deepEqual(
  {
    enabled: base.enabled,
    strategyType: base.strategyType,
    scanDepth: base.scanDepth,
    positionType: base.positionType,
    role: base.role,
    depth: base.depth,
    probability: base.probability,
    recursion: base.recursion,
  },
  {
    enabled: true,
    strategyType: 'constant',
    scanDepth: 'same_as_global',
    positionType: 'before_character_definition',
    role: 'system',
    depth: 4,
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
  },
);

const cardEntry = {
  uid: 12,
  comment: '关键词条目',
  key: ['星月'],
  keysecondary: ['学院'],
  selective: true,
  selectiveLogic: 3,
  constant: false,
  vectorized: false,
  disable: false,
  content: '正文',
  order: 88,
  probability: 100,
  extensions: {
    position: 4,
    role: 2,
    depth: 7,
    scan_depth: 5,
    group: '测试组',
    group_override: true,
    group_weight: 42,
    use_group_scoring: true,
    case_sensitive: false,
    match_whole_words: false,
    worldbookManager: { studioRouting: 'plain' },
  },
};
const canonical = model.cardAdapter.toCanonical(cardEntry);
assert.deepEqual(
  {
    uid: canonical.uid,
    name: canonical.name,
    strategyType: canonical.strategyType,
    secondaryLogic: canonical.secondaryLogic,
    positionType: canonical.positionType,
    role: canonical.role,
    depth: canonical.depth,
    group: canonical.group,
    meta: canonical.meta,
  },
  {
    uid: 12,
    name: '关键词条目',
    strategyType: 'selective',
    secondaryLogic: 'and_all',
    positionType: 'at_depth',
    role: 'assistant',
    depth: 7,
    group: '测试组',
    meta: { studioRouting: 'plain' },
  },
);
const roundTrip = model.cardAdapter.fromCanonical(canonical);
assert.equal(roundTrip.extensions.position, 4);
assert.equal(roundTrip.extensions.role, 2);
assert.equal(roundTrip.extensions.match_whole_words, false);
assert.equal(roundTrip.uid, 12);

const invalid = model.validateCanonical([
  model.makeCanonical({
    name: '无效条目',
    strategyType: 'selective',
    keys: ['中文'],
    matchWholeWords: null,
    positionType: 'at_depth',
    depth: -1,
  }),
]);
assert.deepEqual(invalid.errors.map((issue) => issue.rule), ['V3', 'V6']);

const validProgramOnly = model.makeCanonical({
  name: '受管条目',
  enabled: false,
  meta: {
    source: 'rpn-remix',
    kind: 'workshop_package',
    packageId: 'demo',
    packageType: 'worldbook',
    packageTarget: 'card',
    programOnly: true,
    contentHash: 'a'.repeat(64),
    revision: '1',
    installedAt: '2026-07-18T00:00:00.000Z',
  },
});
assert.equal(model.validateCanonical([validProgramOnly]).ok, true);

const activation = model.previewActivation([
  model.makeCanonical({
    uid: 1,
    name: '传播源',
    strategyType: 'selective',
    keys: ['seed'],
    matchWholeWords: false,
    content: 'sprout',
    recursion: { prevent_incoming: true, prevent_outgoing: false, delay_until: null },
  }),
  model.makeCanonical({
    uid: 2,
    name: '递归目标',
    strategyType: 'selective',
    keys: ['sprout'],
    matchWholeWords: false,
    recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
  }),
  model.makeCanonical({ uid: 3, name: '禁用', enabled: false }),
  model.makeCanonical({ uid: 4, name: '向量', strategyType: 'vectorized' }),
  model.makeCanonical({ uid: 5, name: '概率', probability: 50 }),
  {
    uid: 6,
    name: '运行期兼容输入',
    enabled: true,
    strategy: {
      type: 'selective',
      keys: ['seed'],
      keys_secondary: { logic: 'and_any', keys: [] },
      scan_depth: 'same_as_global',
    },
    position: { type: 'after_character_definition', role: 'system', depth: 4, order: 100 },
    content: '',
    probability: 100,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    effect: { sticky: null, cooldown: null, delay: null },
    extra: {},
  },
], { text: 'seed' });
assert.deepEqual(activation.active.map((item) => [item.uid, item.depth]), [[1, 0], [2, 1], [6, 0]]);
assert.deepEqual(activation.inactive.map((item) => item.reason), ['disabled']);
assert.deepEqual(
  activation.indeterminate.map((item) => item.reason),
  ['vectorized_requires_st', 'probabilistic'],
);

console.log('[ok] RPN Web worldbook and workshop boundaries verified');
