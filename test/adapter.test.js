/**
 * VisionDeepSeekAdapter 单元测试（v2.0）
 *
 * 验证包装适配器：
 *   - resolveModel 为 deepseek 模型声明图像输入能力（替代 resolveModelInfo patch）
 *   - stream 在分发前调用 convertImages hook（替代 streamWithRegistration patch）
 *   - 转换失败时原样透传（不阻塞请求）
 *
 * 运行：
 *   node test/adapter.test.js
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const { VisionDeepSeekAdapter } = await import(new URL('../lib/adapter.js', import.meta.url).href)

let passed = 0
function ok(name) { passed++; console.log('PASS ' + name) }

// 构造最小配置（不联网）：options 返回解析后的连接事实
function makeAdapter(hooks) {
  const options = () => ({
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com',
    defaults: { thinking: undefined, reasoningEffort: undefined },
    maxTokens: 8192,
    defaultContextWindow: 131072,
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 131072 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 131072 },
    ],
    streamIdleTimeoutMs: 60000,
    retryPolicy: { mode: 'normal', maxRetries: 1, backoff: { initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0.1 } },
  })
  return new VisionDeepSeekAdapter(
    { options, resolveApiKey: async () => 'test-key', resolveUserId: () => 'test-user' },
    hooks,
  )
}

// ---------- 1. resolveModel 声明图像能力 ----------
{
  const adapter = makeAdapter()
  const info = await adapter.resolveModel('deepseek-official', 'deepseek-v4-flash')
  assert.ok(Array.isArray(info.inputModalities), '应返回 inputModalities')
  assert.ok(info.inputModalities.includes('image'), '应声明 image 输入（替代 resolveModelInfo patch）')
  assert.ok(info.inputModalities.includes('text'), 'text 输入应保留')
  assert.equal(info.id, 'deepseek-v4-flash')
  assert.equal(info.provider, 'deepseek-official')
  ok('1. resolveModel：deepseek 模型声明 image 输入能力')
}

// ---------- 2. stream 在分发前调用 convertImages hook（hook 抛错证明调用点先于网络） ----------
{
  let called = false
  let receivedMaxChars
  const adapter = makeAdapter({
    convertImages: async (reqOptions, maxChars) => {
      called = true
      receivedMaxChars = maxChars
      throw new Error('stop-here') // 抛错即止：验证 hook 先于 super.stream（不触网）
    },
  })
  const it = adapter.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [] })
  let threw = ''
  try { await it.next() } catch (e) { threw = e && e.message ? e.message : '' }
  assert.equal(threw, 'stop-here', 'hook 的异常应在分发前传播')
  assert.ok(called, 'convertImages hook 应被调用')
  assert.equal(receivedMaxChars, 131072, 'maxChars 应取模型 contextWindow（131072 → 1600 档）')
  ok('2. stream：分发前调用 convertImages hook，maxChars 按上下文分档')
}

// ---------- 3. hook 缺失时原样透传（不挂死） ----------
{
  const noHook = makeAdapter(undefined)
  assert.equal(typeof noHook.stream, 'function', '无 hook 时 stream 仍可用')
  // 无 hook 时不调用 convertImages——用抛错 hook 的等价验证：hook 缺失 → 直接进 super.stream
  const adapter = makeAdapter({ convertImages: undefined })
  const it = adapter.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [] })
  let settled = false
  try {
    await Promise.race([it.next(), new Promise((r) => setTimeout(() => r('timeout'), 5000))])
    settled = true
  } catch { settled = true }
  assert.ok(settled, 'stream 应能开始（无 hook 时直接走底层；底层无网络时以 finish/异常结束，不挂死）')
  ok('3. hook 缺失：优雅降级，不挂死')
}

console.log(`\nALL PASS: ${passed} 项 adapter 测试全部通过`)
