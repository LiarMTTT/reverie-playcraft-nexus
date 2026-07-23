import assert from "node:assert/strict";
import {
  STUDIO_AGENT_ORCHESTRATOR_LIMITS,
  StudioAgentOrchestratorError,
  normalizeStudioAgentRoutingSettings,
  parseStudioAgentTaskPlan,
  prepareStudioAgentTaskPlan,
  runApprovedStudioAgentPlan,
} from "../portal/assets/studio-agent-orchestrator.js";

const profiles = [
  { id: "primary-api", model: "primary-model", credentialClass: "api-key" },
  { id: "worker-api", model: "worker-model", credentialClass: "api-key" },
  { id: "review-api", model: "review-model", credentialClass: "api-key" },
  { id: "coding-plan", model: "coding-model", credentialClass: "sessionCodingPlanKey" },
  { id: "coding-plan-key", model: "coding-model", credentialClass: "coding-plan-key" },
  {
    id: "coding-plan-kind",
    model: "coding-model",
    credentialClass: "",
    credentialKind: "sessionCodingPlanKey",
  },
  { id: "coding-plan-preset", model: "coding-model", codingPlanPreset: "glm" },
];

function routing(overrides = {}) {
  return {
    enabledApiIds: ["primary-api", "worker-api", "review-api"],
    roleBindings: {
      primary: "primary-api",
      worker: "worker-api",
      reviewer: "review-api",
    },
    ...overrides,
  };
}

function messages() {
  return [{ role: "user", content: "test" }];
}

function validPlan(tasks = [
  { id: "research", title: "Research", role: "worker", instruction: "Collect facts." },
  { id: "review", title: "Review", role: "reviewer", instruction: "Review facts." },
]) {
  return JSON.stringify({ tasks });
}

async function runWithExplicitApproval(options = {}) {
  const prepared = await prepareStudioAgentTaskPlan(options);
  return runApprovedStudioAgentPlan({
    ...options,
    plan: prepared.plan,
    routing: prepared.routing,
    runId: prepared.runId,
    initialReceipts: prepared.receipts,
  });
}

{
  const normalized = normalizeStudioAgentRoutingSettings({
    enabledApiIds: ["primary-api", "worker-api", "worker-api", "missing"],
    roleBindings: {
      primary: "primary-api",
      worker: "worker-api",
      reviewer: "review-api",
    },
  }, { profiles });

  assert.deepEqual(normalized.enabledApiIds, ["primary-api", "worker-api"]);
  assert.deepEqual(normalized.roleBindings, {
    primary: "primary-api",
    worker: "worker-api",
    reviewer: "",
  });
  assert.deepEqual(
    normalized.issues.map((issue) => issue.code),
    ["unknown-enabled-profile", "binding-not-enabled"],
  );
}

{
  const normalized = normalizeStudioAgentRoutingSettings({
    enabledApiIds: ["coding-plan"],
    roleBindings: {
      primary: "coding-plan",
      worker: "coding-plan",
      reviewer: "coding-plan",
    },
  }, { profiles });

  assert.equal(normalized.roleBindings.primary, "coding-plan");
  assert.equal(normalized.roleBindings.worker, "");
  assert.equal(normalized.roleBindings.reviewer, "");
  assert.deepEqual(
    normalized.issues.map((issue) => issue.code),
    ["coding-plan-fanout-forbidden", "coding-plan-fanout-forbidden"],
  );
}

for (const profileId of ["coding-plan-key", "coding-plan-kind", "coding-plan-preset"]) {
  const normalized = normalizeStudioAgentRoutingSettings({
    enabledApiIds: [profileId],
    roleBindings: {
      primary: "",
      worker: profileId,
      reviewer: "",
    },
  }, { profiles });
  assert.equal(normalized.roleBindings.worker, "");
  assert.equal(normalized.issues[0].code, "coding-plan-fanout-forbidden");
}

{
  const plan = parseStudioAgentTaskPlan(validPlan());
  assert.equal(plan.depth, 1);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[0].title, "Research");
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.tasks));
}

for (const invalid of [
  `\`\`\`json\n${validPlan()}\n\`\`\``,
  JSON.stringify({ tasks: [], depth: 1 }),
  validPlan(Array.from({ length: 5 }, (_, index) => ({
    id: `task-${index}`,
    role: "worker",
    instruction: "work",
  }))),
  validPlan([{ id: "primary", role: "primary", instruction: "work" }]),
  validPlan([{ id: "nested", role: "worker", instruction: "work", subtasks: [] }]),
  validPlan([
    { id: "same", role: "worker", instruction: "work" },
    { id: "same", role: "reviewer", instruction: "review" },
  ]),
  validPlan([{ id: "bad id", role: "worker", instruction: "work" }]),
  validPlan([{ id: "empty", role: "worker", instruction: "" }]),
]) {
  assert.throws(
    () => parseStudioAgentTaskPlan(invalid),
    (error) => error instanceof StudioAgentOrchestratorError && error.code === "invalid-plan",
  );
}

{
  const phases = [];
  const prepared = await prepareStudioAgentTaskPlan({
    routing: routing(),
    profiles,
    input: { request: "two-stage" },
    runId: "two-stage-run",
    createMessages: messages,
    createClient(profile, meta) {
      phases.push(`${meta.phase}:${profile.id}`);
      return {
        async createChatCompletion() {
          assert.equal(meta.phase, "planner");
          return { text: validPlan() };
        },
      };
    },
  });

  assert.equal(prepared.status, "awaiting-approval");
  assert.deepEqual(phases, ["planner:primary-api"]);
  assert(Object.isFrozen(prepared.plan));
  assert(Object.isFrozen(prepared.plan.tasks));
  assert(Object.isFrozen(prepared.plan.tasks[0]));

  const executed = await runApprovedStudioAgentPlan({
    plan: prepared.plan,
    routing: prepared.routing,
    profiles,
    input: { request: "two-stage" },
    runId: prepared.runId,
    initialReceipts: prepared.receipts,
    concurrency: 2,
    createMessages: messages,
    createClient(profile, meta) {
      phases.push(`${meta.phase}:${profile.id}`);
      return {
        async createChatCompletion() {
          assert.notEqual(meta.phase, "planner");
          return { text: meta.phase === "aggregate" ? "approved final" : "approved task" };
        },
      };
    },
  });

  assert.equal(executed.status, "completed");
  assert.equal(executed.final.text, "approved final");
  assert.deepEqual(phases, [
    "planner:primary-api",
    "task:worker-api",
    "task:review-api",
    "aggregate:primary-api",
  ]);
  assert(Object.isFrozen(executed.plan));
  assert.deepEqual(
    executed.receipts.map((receipt) => receipt.sequence),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
}

{
  const controller = new AbortController();
  const calls = [];
  const seenContexts = [];
  let activeTasks = 0;
  let maxActiveTasks = 0;
  let plannerDone = false;
  let aggregateDone = false;
  const fourTasks = [
    { id: "one", role: "worker", instruction: "one" },
    { id: "two", role: "worker", instruction: "two" },
    { id: "three", role: "reviewer", instruction: "three" },
    { id: "four", role: "reviewer", instruction: "four" },
  ];

  const result = await runWithExplicitApproval({
    routing: routing(),
    profiles,
    signal: controller.signal,
    concurrency: 99,
    runId: "happy-run",
    now: () => "2026-07-23T00:00:00.000Z",
    createMessages(context) {
      seenContexts.push(context);
      return messages();
    },
    createClient(profile, meta) {
      return {
        async createChatCompletion(request, options) {
          calls.push({ profileId: profile.id, meta, request, signal: options.signal });
          assert.equal(options.signal, controller.signal);
          assert.deepEqual(Object.keys(request).sort(), ["messages", "model"]);
          if (meta.phase === "planner") {
            plannerDone = true;
            return { text: validPlan(fourTasks), model: profile.model, usage: { inputTokens: 10 } };
          }
          if (meta.phase === "aggregate") {
            aggregateDone = true;
            return { text: "final answer", model: profile.model, usage: { outputTokens: 5 } };
          }
          activeTasks += 1;
          maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeTasks -= 1;
          return { text: `result:${meta.role}`, model: profile.model };
        },
      };
    },
  });

  assert(plannerDone);
  assert(aggregateDone);
  assert.equal(result.status, "completed");
  assert.equal(result.tasks.length, 4);
  assert.equal(result.final.text, "final answer");
  assert(maxActiveTasks <= STUDIO_AGENT_ORCHESTRATOR_LIMITS.maxConcurrency);
  assert.deepEqual(
    calls.filter((call) => call.meta.phase === "task").map((call) => call.profileId),
    ["worker-api", "worker-api", "review-api", "review-api"],
  );
  assert.deepEqual(
    calls.filter((call) => call.meta.phase !== "task").map((call) => call.profileId),
    ["primary-api", "primary-api"],
  );
  assert(seenContexts.some((context) => context.phase === "aggregate" && context.taskResults.length === 4));
  assert.deepEqual(
    result.receipts.map((receipt) => `${receipt.phase}:${receipt.state}`),
    [
      "planner:started",
      "planner:succeeded",
      "task:started",
      "task:started",
      "task:succeeded",
      "task:started",
      "task:succeeded",
      "task:started",
      "task:succeeded",
      "task:succeeded",
      "aggregate:started",
      "aggregate:succeeded",
    ],
  );
}

{
  let aggregateContext;
  const taskProfiles = [];
  const result = await runWithExplicitApproval({
    routing: routing({
      enabledApiIds: ["primary-api", "worker-api"],
      roleBindings: {
        primary: "primary-api",
        worker: "worker-api",
        reviewer: "review-api",
      },
    }),
    profiles,
    runId: "partial-run",
    createMessages(context) {
      if (context.phase === "aggregate") {
        aggregateContext = context;
      }
      return messages();
    },
    createClient(profile, meta) {
      return {
        async createChatCompletion() {
          if (meta.phase === "planner") {
            return {
              text: validPlan([
                { id: "work", role: "worker", instruction: "work" },
                { id: "review", role: "reviewer", instruction: "review" },
              ]),
            };
          }
          if (meta.phase === "aggregate") {
            return { text: "partial aggregate" };
          }
          taskProfiles.push(profile.id);
          if (meta.role === "worker") {
            throw Object.assign(new Error("worker unavailable"), { code: "upstream-error" });
          }
          return { text: "unexpected fallback" };
        },
      };
    },
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(taskProfiles, ["worker-api"]);
  assert.equal(result.tasks[0].state, "failed");
  assert.equal(result.tasks[0].error.code, "upstream-error");
  assert.equal(result.tasks[1].state, "failed");
  assert.equal(result.tasks[1].error.code, "missing-role-binding");
  assert.equal(result.final.text, "partial aggregate");
  assert.equal(aggregateContext.taskResults[0].state, "failed");
  assert.equal(aggregateContext.taskResults[1].state, "failed");
}

{
  let callCount = 0;
  const normalizedCodingPlanRouting = normalizeStudioAgentRoutingSettings({
    enabledApiIds: ["primary-api", "coding-plan"],
    roleBindings: {
      primary: "primary-api",
      worker: "coding-plan",
      reviewer: "",
    },
  }, { profiles });
  await assert.rejects(
    prepareStudioAgentTaskPlan({
      routing: normalizedCodingPlanRouting,
      profiles,
      createMessages: messages,
      createClient() {
        callCount += 1;
        throw new Error("must not create client");
      },
    }),
    (error) => (
      error instanceof StudioAgentOrchestratorError
      && error.code === "coding-plan-fanout-forbidden"
    ),
  );
  assert.equal(callCount, 0);
}

{
  const controller = new AbortController();
  let aggregateCalls = 0;
  const queuedPlan = parseStudioAgentTaskPlan(validPlan([
    { id: "a", role: "worker", instruction: "a" },
    { id: "b", role: "worker", instruction: "b" },
    { id: "c", role: "reviewer", instruction: "c" },
  ]));

  await assert.rejects(
    runApprovedStudioAgentPlan({
      plan: queuedPlan,
      routing: routing(),
      profiles,
      signal: controller.signal,
      concurrency: 1,
      runId: "queued-cancel-run",
      createMessages: messages,
      createClient(_profile, meta) {
        return {
          async createChatCompletion() {
            if (meta.phase === "aggregate") {
              aggregateCalls += 1;
              return { text: "must not aggregate" };
            }
            controller.abort();
            return { text: "late success must become cancellation" };
          },
        };
      },
    }),
    (error) => {
      if (!(error instanceof StudioAgentOrchestratorError) || error.code !== "cancelled") {
        return false;
      }
      const terminalTasks = error.receipts.filter(
        (receipt) => receipt.phase === "task" && receipt.state === "cancelled",
      );
      assert.deepEqual(terminalTasks.map((receipt) => receipt.taskId), ["a", "b", "c"]);
      assert.equal(error.receipts.some((receipt) => receipt.state === "succeeded"), false);
      return true;
    },
  );
  assert.equal(aggregateCalls, 0);
}

{
  const controller = new AbortController();
  let aggregateCalls = 0;
  let receivedSignal;
  await assert.rejects(
    runWithExplicitApproval({
      routing: routing(),
      profiles,
      signal: controller.signal,
      runId: "cancel-run",
      createMessages: messages,
      createClient(_profile, meta) {
        return {
          async createChatCompletion(_request, options) {
            receivedSignal = options.signal;
            if (meta.phase === "planner") {
              return {
                text: validPlan([{ id: "cancel-me", role: "worker", instruction: "work" }]),
              };
            }
            if (meta.phase === "aggregate") {
              aggregateCalls += 1;
              return { text: "must not aggregate" };
            }
            controller.abort();
            throw Object.assign(new Error("aborted"), { code: "aborted" });
          },
        };
      },
    }),
    (error) => (
      error instanceof StudioAgentOrchestratorError
      && error.code === "cancelled"
      && error.receipts.some((receipt) => receipt.state === "cancelled")
    ),
  );
  assert.equal(receivedSignal, controller.signal);
  assert.equal(aggregateCalls, 0);
}

console.log("studio_agent_orchestrator.test.mjs: all assertions passed");
