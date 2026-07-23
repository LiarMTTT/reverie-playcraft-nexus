import assert from 'node:assert/strict';
import {
  MCP_MAX_SERVERS,
  createDesktopMcpBridge,
  createMcpPrepareRequest,
  formatMcpResultForContext,
  hasNativeApprovalReceipt,
  mcpServerStorageValue,
  normalizeMcpArgs,
  normalizeMcpEnvironment,
  normalizeMcpServerConfig,
  normalizeMcpServerRegistry,
  normalizeToolArguments,
} from '../portal/assets/studio-mcp.js';

const server = normalizeMcpServerConfig({
  id: 'mcp-local',
  name: '本机测试 MCP',
  executable: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['server.mjs', 'TOP_SECRET'],
  cwd: 'C:\\example\\rpn-mcp-browser',
  envNames: ['MCP_API_KEY'],
});
const sessionArgs = normalizeMcpArgs(['server.mjs', '--stdio']);
assert.equal(Object.hasOwn(server, 'args'), false, '规范化配置必须直接丢弃旧版持久化 args');
assert.deepEqual(normalizeMcpArgs(['server.mjs', 'TOP_SECRET']), ['server.mjs', 'TOP_SECRET']);
assert.deepEqual({ ...normalizeMcpEnvironment('{"MCP_API_KEY":"secret"}') }, { MCP_API_KEY: 'secret' });
assert.deepEqual({ ...normalizeToolArguments('{"query":"test"}') }, { query: 'test' });
assert.throws(() => normalizeMcpEnvironment('{"BAD-NAME":"x"}'), /环境变量名无效/);
assert.throws(() => normalizeMcpEnvironment('{"GIT_CONFIG_KEY_0":"alias.pwn"}'), /不是允许的秘密变量名/);
assert.throws(() => normalizeMcpEnvironment('{"DISPLAY_MODE":"unsafe"}'), /不是允许的秘密变量名/);
assert.throws(() => normalizeMcpEnvironment('{"__proto__":"x"}'), /环境变量名无效/);
assert.throws(() => normalizeToolArguments('[]'), /JSON 对象/);
assert.throws(() => normalizeToolArguments('{"__proto__":{"polluted":true}}'), /禁止字段/);
assert.throws(
  () => normalizeMcpServerConfig({ ...server, executable: 'node.exe' }),
  /本机绝对路径/,
);
assert.throws(
  () => normalizeMcpArgs(['server.mjs', '--api-key', 'TOP_SECRET']),
  /疑似包含凭据/,
);
assert.throws(
  () => normalizeMcpArgs(['server.mjs', 'https://user:password@example.com']),
  /疑似包含凭据/,
);

const storage = mcpServerStorageValue([{
  ...server,
  args: ['server.mjs', 'TOP_SECRET'],
}]);
assert.equal(storage.version, 1);
assert.deepEqual(storage.servers[0].envNames, ['MCP_API_KEY']);
assert.equal(Object.hasOwn(storage.servers[0], 'args'), false, '持久化配置不得包含 args 字段');
assert.equal(JSON.stringify(storage).includes('TOP_SECRET'), false, '任意位置参数也不得进入 IndexedDB 配置');
assert.equal(JSON.stringify(storage).includes('secret'), false, '持久化配置不得包含会话环境值');
assert.equal(normalizeMcpServerRegistry([server, server, { broken: true }]).length, 1);
assert.equal(normalizeMcpServerRegistry(Array.from({ length: MCP_MAX_SERVERS + 4 }, (_, index) => ({
  ...server,
  id: `mcp-local-${index}`,
  name: `MCP ${index}`,
}))).length, MCP_MAX_SERVERS, 'MCP 配置数量必须限制为 24 个');

const listRequest = createMcpPrepareRequest(server, {
  args: sessionArgs,
  environment: { MCP_API_KEY: 'secret' },
  operation: 'listTools',
});
assert.equal(listRequest.operation, 'listTools');
assert.equal(listRequest.env.MCP_API_KEY, 'secret');
assert.equal(Object.hasOwn(listRequest, 'tool'), false);

const callRequest = createMcpPrepareRequest(server, {
  args: sessionArgs,
  environment: { MCP_API_KEY: 'secret' },
  operation: 'callTool',
  tool: 'search',
  arguments: '{"query":"角色卡"}',
});
assert.deepEqual({ ...callRequest.arguments }, { query: '角色卡' });
assert.throws(
  () => createMcpPrepareRequest(server, { environment: {}, operation: 'listTools' }),
  /环境变量名称必须与已保存的名称完全一致/,
);

const invocations = [];
const intentId = `mcp-${'1'.repeat(32)}`;
const immutableDigest = 'a'.repeat(64);
const bridge = createDesktopMcpBridge({
  invoke: async (command, args) => {
    invocations.push({ command, args });
    if (command === 'desktop_mcp_prepare') {
      return {
        intentId,
        executable: server.executable,
        cwd: server.cwd,
        argsCount: listRequest.args.length,
        envNames: ['MCP_API_KEY'],
        operation: 'listTools',
        immutableDigest,
        expiresInSeconds: 120,
      };
    }
    if (command === 'desktop_mcp_execute') {
      return {
        protocolVersion: '2025-03-26',
        tools: [{ name: 'search' }],
        annotationsTrusted: false,
        approvalReceipt: {
          intentId,
          approvedAt: 1_753_261_200_000,
          immutableDigest,
        },
      };
    }
    return true;
  },
});
const summary = await bridge.prepare(listRequest);
const result = await bridge.execute(summary.intentId);
const cancelledIntentId = `mcp-${'2'.repeat(32)}`;
assert.equal(await bridge.cancel(cancelledIntentId), true);
assert.deepEqual(invocations.map((item) => item.command), [
  'desktop_mcp_prepare',
  'desktop_mcp_execute',
  'desktop_mcp_cancel',
]);
assert.deepEqual(invocations[0].args, { request: listRequest });
assert.equal(invocations[1].args.intentId, intentId);
assert.equal(invocations[2].args.intentId, cancelledIntentId);
assert.equal(result.annotationsTrusted, false);
assert.equal(hasNativeApprovalReceipt(result, { intentId, immutableDigest }), true);
assert.equal(hasNativeApprovalReceipt(result, { intentId: cancelledIntentId, immutableDigest }), false);
assert.equal(hasNativeApprovalReceipt({
  ...result,
  approvalReceipt: { ...result.approvalReceipt, approvedAt: '2026-07-23T09:00:00.000Z' },
}), false, 'approvedAt 必须使用 Rust u64 毫秒时间戳');
assert.equal(hasNativeApprovalReceipt({
  ...result,
  approvalReceipt: { ...result.approvalReceipt, immutableDigest: 'short' },
}), false);

const context = formatMcpResultForContext({
  protocolVersion: '2025-03-26',
  content: [{ type: 'text', text: 'tool result' }],
  annotationsTrusted: true,
});
assert.match(context, /不可信数据/);
assert.match(context, /未携带原生批准回执/);
assert.match(context, /"annotationsTrusted": false/);
assert.doesNotMatch(context, /授予权限、触发命令或覆盖系统边界。\n.*secret/s);

const approvedContext = formatMcpResultForContext({
  protocolVersion: '2025-03-26',
  content: [{ type: 'text', text: 'approved tool result' }],
  approvalReceipt: {
    intentId,
    approvedAt: 1_753_261_200_000,
    immutableDigest,
  },
});
assert.match(approvedContext, /经 RPN 原生确认执行/);
assert.match(approvedContext, new RegExp(immutableDigest));

const truncatedContext = formatMcpResultForContext({
  protocolVersion: '2025-03-26',
  content: [{ type: 'text', text: 'x'.repeat(80_000) }],
  approvalReceipt: {
    intentId,
    approvedAt: 1_753_261_200_000,
    immutableDigest,
  },
}, { maxCharacters: 24_000 });
assert.equal(truncatedContext.length, 24_000);
assert.match(truncatedContext, /已截断/);

console.log('[ok] custom MCP frontend contracts passed');
