import { profileDelegationAllowed } from "./studio-api-profiles.js";

const ROUTING_ROLES = ["primary", "worker", "reviewer"];
const TASK_ROLES = new Set(["worker", "reviewer"]);
const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);
const PLAN_ROOT_KEYS = new Set(["tasks"]);
const PLAN_TASK_KEYS = new Set(["id", "title", "role", "instruction"]);
const CODING_PLAN_CREDENTIAL_CLASSES = new Set([
  "codingplan",
  "codingplankey",
  "sessioncodingplankey",
]);

export const STUDIO_AGENT_ROUTING_ROLES = Object.freeze([...ROUTING_ROLES]);
export const STUDIO_AGENT_TASK_ROLES = Object.freeze([...TASK_ROLES]);
export const STUDIO_AGENT_ORCHESTRATOR_LIMITS = Object.freeze({
  maxTasks: 4,
  maxDepth: 1,
  maxConcurrency: 2,
  maxPlanCharacters: 100_000,
  maxInstructionCharacters: 20_000,
  maxTitleCharacters: 160,
});

export class StudioAgentOrchestratorError extends Error {
  constructor(code, message, { receipts = [] } = {}) {
    super(message);
    this.name = "StudioAgentOrchestratorError";
    this.code = code;
    this.receipts = Object.freeze([...receipts]);
  }
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCredentialClass(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function isCodingPlanProfile(profile) {
  if (profile && profileDelegationAllowed(profile) === false) {
    return true;
  }
  return [profile?.credentialKind, profile?.credentialClass]
    .map(normalizeCredentialClass)
    .some((value) => CODING_PLAN_CREDENTIAL_CLASSES.has(value));
}

function freezeIssue(code, extra = {}) {
  return Object.freeze({ code, ...extra });
}

function buildProfileMap(profiles) {
  const map = new Map();
  if (!Array.isArray(profiles)) {
    return map;
  }
  for (const profile of profiles) {
    const id = cleanId(profile?.id);
    if (id && !map.has(id)) {
      map.set(id, profile);
    }
  }
  return map;
}

export function normalizeStudioAgentRoutingSettings(value = {}, { profiles = [] } = {}) {
  const profileMap = buildProfileMap(profiles);
  const issues = [];
  const enabledApiIds = [];
  const seenEnabledIds = new Set();
  const requestedEnabledIds = Array.isArray(value?.enabledApiIds) ? value.enabledApiIds : [];

  for (const candidate of requestedEnabledIds) {
    const id = cleanId(candidate);
    if (!id || seenEnabledIds.has(id)) {
      continue;
    }
    seenEnabledIds.add(id);
    if (!profileMap.has(id)) {
      issues.push(freezeIssue("unknown-enabled-profile", { profileId: id }));
      continue;
    }
    enabledApiIds.push(id);
  }

  const enabledSet = new Set(enabledApiIds);
  const requestedBindings = value?.roleBindings && typeof value.roleBindings === "object"
    ? value.roleBindings
    : {};
  const roleBindings = {};

  for (const role of ROUTING_ROLES) {
    const profileId = cleanId(requestedBindings[role]);
    roleBindings[role] = "";
    if (!profileId) {
      continue;
    }
    const profile = profileMap.get(profileId);
    if (!profile) {
      issues.push(freezeIssue("unknown-bound-profile", { role, profileId }));
      continue;
    }
    if (!enabledSet.has(profileId)) {
      issues.push(freezeIssue("binding-not-enabled", { role, profileId }));
      continue;
    }
    if (role !== "primary" && isCodingPlanProfile(profile)) {
      issues.push(freezeIssue("coding-plan-fanout-forbidden", { role, profileId }));
      continue;
    }
    roleBindings[role] = profileId;
  }

  return Object.freeze({
    enabledApiIds: Object.freeze(enabledApiIds),
    roleBindings: Object.freeze(roleBindings),
    issues: Object.freeze(issues),
  });
}

function invalidPlan(message) {
  throw new StudioAgentOrchestratorError("invalid-plan", message);
}

function assertExactKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      invalidPlan(`${label} 包含不允许的字段：${key}`);
    }
  }
}

export function parseStudioAgentTaskPlan(rawPlan) {
  if (typeof rawPlan !== "string" || !rawPlan.trim()) {
    invalidPlan("规划器必须返回非空 JSON 文本。");
  }
  if (rawPlan.length > STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxPlanCharacters) {
    invalidPlan("规划器 JSON 超出长度限制。");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawPlan);
  } catch {
    invalidPlan("规划器输出必须是纯 JSON，不能包含 Markdown 或额外文本。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidPlan("任务计划根节点必须是对象。");
  }
  assertExactKeys(parsed, PLAN_ROOT_KEYS, "任务计划");
  if (!Array.isArray(parsed.tasks)) {
    invalidPlan("任务计划必须包含 tasks 数组。");
  }
  if (parsed.tasks.length < 1 || parsed.tasks.length > STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxTasks) {
    invalidPlan(`任务数量必须在 1 到 ${STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxTasks} 之间。`);
  }

  const ids = new Set();
  const tasks = parsed.tasks.map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      invalidPlan(`第 ${index + 1} 个任务必须是扁平对象。`);
    }
    assertExactKeys(task, PLAN_TASK_KEYS, `第 ${index + 1} 个任务`);
    const id = cleanId(task.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
      invalidPlan(`第 ${index + 1} 个任务的 id 无效。`);
    }
    if (ids.has(id)) {
      invalidPlan(`任务 id 重复：${id}`);
    }
    ids.add(id);
    if (!TASK_ROLES.has(task.role)) {
      invalidPlan(`任务 ${id} 的 role 只能是 worker 或 reviewer。`);
    }
    if (typeof task.instruction !== "string" || !task.instruction.trim()) {
      invalidPlan(`任务 ${id} 缺少 instruction。`);
    }
    if (task.instruction.length > STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxInstructionCharacters) {
      invalidPlan(`任务 ${id} 的 instruction 超出长度限制。`);
    }
    if (task.title !== undefined && (typeof task.title !== "string" || !task.title.trim())) {
      invalidPlan(`任务 ${id} 的 title 必须是非空字符串。`);
    }
    const title = task.title === undefined ? id : task.title.trim();
    if (title.length > STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxTitleCharacters) {
      invalidPlan(`任务 ${id} 的 title 超出长度限制。`);
    }
    return Object.freeze({
      id,
      title,
      role: task.role,
      instruction: task.instruction,
    });
  });

  return Object.freeze({
    depth: STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxDepth,
    tasks: Object.freeze(tasks),
  });
}

function safeError(error, fallbackCode = "completion-failed") {
  const code = typeof error?.code === "string" && error.code.trim()
    ? error.code.trim().slice(0, 80)
    : fallbackCode;
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim().slice(0, 500)
    : "模型调用失败。";
  return Object.freeze({ code, message });
}

function freezeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }
  const copy = {};
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      copy[key] = value;
    }
  }
  return Object.freeze(copy);
}

function freezeTaskResult(result) {
  return Object.freeze({
    ...result,
    usage: freezeUsage(result.usage),
    error: result.error ? Object.freeze({ ...result.error }) : null,
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1) {
    throw new StudioAgentOrchestratorError("invalid-messages", "消息构建器必须返回非空数组。");
  }
  return messages.map((message, index) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new StudioAgentOrchestratorError("invalid-messages", `第 ${index + 1} 条消息无效。`);
    }
    if (!MESSAGE_ROLES.has(message.role)) {
      throw new StudioAgentOrchestratorError("invalid-messages", `第 ${index + 1} 条消息 role 无效。`);
    }
    if (typeof message.content !== "string" || !message.content.trim()) {
      throw new StudioAgentOrchestratorError("invalid-messages", `第 ${index + 1} 条消息 content 无效。`);
    }
    return Object.freeze({ role: message.role, content: message.content });
  });
}

function assertProfileReady(profile, role) {
  if (!profile) {
    throw new StudioAgentOrchestratorError("missing-role-binding", `${role} 未绑定可用 API 配置。`);
  }
  if (typeof profile.model !== "string" || !profile.model.trim()) {
    throw new StudioAgentOrchestratorError("missing-model", `${role} 绑定的 API 配置缺少模型。`);
  }
}

function throwIfAborted(signal, receipts) {
  if (signal?.aborted) {
    throw new StudioAgentOrchestratorError("cancelled", "Agent 运行已取消。", { receipts });
  }
}

function defaultRunId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `agent-run-${Date.now().toString(36)}-${randomPart}`;
}

function validateApprovedPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    invalidPlan("待执行计划必须是 prepareStudioAgentTaskPlan 返回的对象。");
  }
  assertExactKeys(plan, new Set(["depth", "tasks"]), "待执行计划");
  if (plan.depth !== STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxDepth) {
    invalidPlan("待执行计划必须是一层任务计划。");
  }
  try {
    return parseStudioAgentTaskPlan(JSON.stringify({ tasks: plan.tasks }));
  } catch (error) {
    if (error instanceof StudioAgentOrchestratorError) {
      throw error;
    }
    invalidPlan("待执行计划无法序列化。");
  }
}

function createOrchestratorRuntime({
  routing,
  profiles = [],
  input = null,
  createClient,
  createMessages,
  signal,
  onReceipt,
  now = () => new Date().toISOString(),
  runId = defaultRunId(),
  initialReceipts = [],
} = {}) {
  if (typeof createClient !== "function" || typeof createMessages !== "function") {
    throw new StudioAgentOrchestratorError(
      "invalid-runner-dependency",
      "必须注入 createClient 与 createMessages。",
    );
  }

  const profileMap = buildProfileMap(profiles);
  const normalizedRouting = normalizeStudioAgentRoutingSettings(routing, { profiles });
  const inheritedIssues = Array.isArray(routing?.issues) ? routing.issues : [];
  const forbiddenFanout = [...normalizedRouting.issues, ...inheritedIssues].find(
    (issue) => issue.code === "coding-plan-fanout-forbidden",
  );
  if (forbiddenFanout) {
    throw new StudioAgentOrchestratorError(
      "coding-plan-fanout-forbidden",
      "Coding Plan 配置只能作为 primary，不能用于 worker 或 reviewer。",
    );
  }

  const primaryProfileId = normalizedRouting.roleBindings.primary;
  const primaryProfile = profileMap.get(primaryProfileId);
  assertProfileReady(primaryProfile, "primary");

  const receipts = Array.isArray(initialReceipts) ? [...initialReceipts] : [];
  if (receipts.some((receipt) => receipt?.runId !== runId)) {
    throw new StudioAgentOrchestratorError(
      "invalid-initial-receipts",
      "初始回执必须属于当前 runId。",
    );
  }
  let receiptSequence = receipts.reduce(
    (maximum, receipt) => Math.max(maximum, Number.isInteger(receipt?.sequence) ? receipt.sequence : 0),
    0,
  );
  const emitReceipt = (event) => {
    receiptSequence += 1;
    const receipt = Object.freeze({
      eventId: `${runId}:${receiptSequence}`,
      runId,
      sequence: receiptSequence,
      at: String(now()),
      phase: event.phase,
      state: event.state,
      role: event.role,
      profileId: event.profileId || "",
      taskId: event.taskId || "",
      title: event.title || "",
      message: event.message || "",
      model: event.model || "",
      usage: freezeUsage(event.usage),
    });
    receipts.push(receipt);
    if (typeof onReceipt === "function") {
      try {
        onReceipt(receipt);
      } catch {
        // Timeline observers must not change orchestration behavior.
      }
    }
    return receipt;
  };

  const invokeCompletion = async ({ phase, role, profile, context }) => {
    throwIfAborted(signal, receipts);
    assertProfileReady(profile, role);
    const client = await createClient(profile, { phase, role });
    if (!client || typeof client.createChatCompletion !== "function") {
      throw new StudioAgentOrchestratorError(
        "invalid-client",
        `${role} 的客户端不支持文本补全。`,
      );
    }
    const messages = normalizeMessages(await createMessages({
      phase,
      role,
      profile,
      input,
      routing: normalizedRouting,
      ...context,
    }));
    throwIfAborted(signal, receipts);
    const response = await client.createChatCompletion(
      { model: profile.model.trim(), messages },
      { signal },
    );
    throwIfAborted(signal, receipts);
    if (typeof response?.text !== "string" || !response.text.trim()) {
      throw new StudioAgentOrchestratorError("invalid-completion", `${role} 返回了空文本。`);
    }
    return Object.freeze({
      text: response.text,
      model: typeof response.model === "string" ? response.model : profile.model.trim(),
      usage: freezeUsage(response.usage),
    });
  };

  return Object.freeze({
    profileMap,
    normalizedRouting,
    primaryProfileId,
    primaryProfile,
    receipts,
    emitReceipt,
    invokeCompletion,
    signal,
    runId,
  });
}

export async function prepareStudioAgentTaskPlan(options = {}) {
  const runtime = createOrchestratorRuntime(options);
  const {
    normalizedRouting,
    primaryProfileId,
    primaryProfile,
    receipts,
    emitReceipt,
    invokeCompletion,
    signal,
    runId,
  } = runtime;

  emitReceipt({
    phase: "planner",
    state: "started",
    role: "primary",
    profileId: primaryProfileId,
    message: "主模型正在拆分任务。",
  });

  let plan;
  try {
    const planning = await invokeCompletion({
      phase: "planner",
      role: "primary",
      profile: primaryProfile,
      context: {},
    });
    plan = parseStudioAgentTaskPlan(planning.text);
    emitReceipt({
      phase: "planner",
      state: "succeeded",
      role: "primary",
      profileId: primaryProfileId,
      message: `已生成 ${plan.tasks.length} 个一级任务。`,
      model: planning.model,
      usage: planning.usage,
    });
  } catch (error) {
    const aborted = signal?.aborted;
    const safe = safeError(error, aborted ? "cancelled" : "planner-failed");
    emitReceipt({
      phase: "planner",
      state: aborted ? "cancelled" : "failed",
      role: "primary",
      profileId: primaryProfileId,
      message: aborted ? "任务规划已取消。" : safe.message,
    });
    if (aborted) {
      throwIfAborted(signal, receipts);
    }
    throw new StudioAgentOrchestratorError(
      safe.code,
      safe.message,
      { receipts },
    );
  }

  return Object.freeze({
    runId,
    status: "awaiting-approval",
    routing: normalizedRouting,
    plan,
    receipts: Object.freeze([...receipts]),
  });
}

export async function runApprovedStudioAgentPlan({
  plan: approvedPlan,
  concurrency = STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxConcurrency,
  ...options
} = {}) {
  const plan = validateApprovedPlan(approvedPlan);
  const runtime = createOrchestratorRuntime(options);
  const {
    profileMap,
    normalizedRouting,
    primaryProfileId,
    primaryProfile,
    receipts,
    emitReceipt,
    invokeCompletion,
    signal,
    runId,
  } = runtime;

  const taskResults = new Array(plan.tasks.length);
  let nextTaskIndex = 0;
  const requestedConcurrency = Number.isInteger(concurrency) ? concurrency : 1;
  const workerCount = Math.min(
    plan.tasks.length,
    Math.max(1, Math.min(STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxConcurrency, requestedConcurrency)),
  );

  const runTask = async (task, index) => {
    const profileId = normalizedRouting.roleBindings[task.role];
    const profile = profileMap.get(profileId);
    emitReceipt({
      phase: "task",
      state: "started",
      role: task.role,
      profileId,
      taskId: task.id,
      title: task.title,
      message: "子任务已开始。",
    });

    try {
      throwIfAborted(signal, receipts);
      if (isCodingPlanProfile(profile)) {
        throw new StudioAgentOrchestratorError(
          "coding-plan-fanout-forbidden",
          "Coding Plan 配置不能执行子任务。",
        );
      }
      const completion = await invokeCompletion({
        phase: "task",
        role: task.role,
        profile,
        context: { plan, task },
      });
      const result = freezeTaskResult({
        index,
        id: task.id,
        title: task.title,
        role: task.role,
        profileId,
        state: "succeeded",
        text: completion.text,
        model: completion.model,
        usage: completion.usage,
        error: null,
      });
      emitReceipt({
        phase: "task",
        state: "succeeded",
        role: task.role,
        profileId,
        taskId: task.id,
        title: task.title,
        message: "子任务已完成。",
        model: completion.model,
        usage: completion.usage,
      });
      return result;
    } catch (error) {
      const aborted = signal?.aborted;
      const safe = safeError(error, aborted ? "cancelled" : "task-failed");
      emitReceipt({
        phase: "task",
        state: aborted ? "cancelled" : "failed",
        role: task.role,
        profileId,
        taskId: task.id,
        title: task.title,
        message: aborted ? "子任务已取消。" : safe.message,
      });
      return freezeTaskResult({
        index,
        id: task.id,
        title: task.title,
        role: task.role,
        profileId,
        state: aborted ? "cancelled" : "failed",
        text: "",
        model: "",
        usage: null,
        error: safe,
      });
    }
  };

  const workerLoop = async () => {
    while (nextTaskIndex < plan.tasks.length && !signal?.aborted) {
      const index = nextTaskIndex;
      nextTaskIndex += 1;
      taskResults[index] = await runTask(plan.tasks[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
  if (signal?.aborted) {
    for (let index = 0; index < plan.tasks.length; index += 1) {
      if (taskResults[index]) {
        continue;
      }
      const task = plan.tasks[index];
      const profileId = normalizedRouting.roleBindings[task.role];
      taskResults[index] = freezeTaskResult({
        index,
        id: task.id,
        title: task.title,
        role: task.role,
        profileId,
        state: "cancelled",
        text: "",
        model: "",
        usage: null,
        error: Object.freeze({ code: "cancelled", message: "子任务已取消。" }),
      });
      emitReceipt({
        phase: "task",
        state: "cancelled",
        role: task.role,
        profileId,
        taskId: task.id,
        title: task.title,
        message: "子任务已取消。",
      });
    }
  }
  throwIfAborted(signal, receipts);

  const completedTaskResults = Object.freeze(taskResults.map((result) => result));
  emitReceipt({
    phase: "aggregate",
    state: "started",
    role: "primary",
    profileId: primaryProfileId,
    message: "主模型正在汇总子任务结果。",
  });

  let final;
  try {
    final = await invokeCompletion({
      phase: "aggregate",
      role: "primary",
      profile: primaryProfile,
      context: { plan, taskResults: completedTaskResults },
    });
    emitReceipt({
      phase: "aggregate",
      state: "succeeded",
      role: "primary",
      profileId: primaryProfileId,
      message: "汇总已完成。",
      model: final.model,
      usage: final.usage,
    });
  } catch (error) {
    const aborted = signal?.aborted;
    const safe = safeError(error, aborted ? "cancelled" : "aggregate-failed");
    emitReceipt({
      phase: "aggregate",
      state: aborted ? "cancelled" : "failed",
      role: "primary",
      profileId: primaryProfileId,
      message: aborted ? "汇总已取消。" : safe.message,
    });
    if (aborted) {
      throwIfAborted(signal, receipts);
    }
    throw new StudioAgentOrchestratorError(
      safe.code,
      safe.message,
      { receipts },
    );
  }

  const hasPartialFailure = completedTaskResults.some((result) => result.state !== "succeeded");
  return Object.freeze({
    runId,
    status: hasPartialFailure ? "partial" : "completed",
    routing: normalizedRouting,
    plan,
    tasks: completedTaskResults,
    final: Object.freeze({
      text: final.text,
      model: final.model,
      usage: freezeUsage(final.usage),
    }),
    receipts: Object.freeze([...receipts]),
  });
}
