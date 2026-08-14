/**
 * vision-bridge schema 校验测试
 *
 * 用 dsh 安装版的真实校验器（assertSupportedJsonSchema / validateJsonSchemaValue）
 * 验证 see_image 工具定义符合当前工具注册器的标准 JSON Schema 子集。
 * 直接 import 插件源码（../lib/index.js），不依赖安装副本是否同步。
 *
 * 运行：
 *   node test/schema.test.js
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let dshTools = null
for (const c of [
  '@deepseek-ai/dsh-tools',
  path.join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools'),
  path.join(DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools'),
]) {
  try { dshTools = require(c); break } catch { /* next */ }
}
if (!dshTools) {
  console.error('SKIP: 未找到 @deepseek-ai/dsh-tools（DSH home 未安装），跳过 schema 校验测试')
  process.exit(0)
}
const { assertSupportedJsonSchema, validateJsonSchemaValue } = dshTools
const {
  SEE_IMAGE_PARAMETERS,
  SEE_IMAGE_OUTPUT,
} = await import(new URL('../lib/index.js', import.meta.url).href)

// 1. 输出 schema 通过 dsh 校验器 —— 不应抛 UNSUPPORTED_SCHEMA
assertSupportedJsonSchema(SEE_IMAGE_OUTPUT.schema)
console.log('PASS 1: 输出 schema 通过 assertSupportedJsonSchema')

// 2. 参数 schema 通过校验
assertSupportedJsonSchema(SEE_IMAGE_PARAMETERS)
console.log('PASS 2: 参数 schema 通过 assertSupportedJsonSchema')

// 3. attachment_id 与 file_path 均在参数中声明
assert.ok(SEE_IMAGE_PARAMETERS.properties.file_path, '应声明 file_path')
assert.ok(SEE_IMAGE_PARAMETERS.properties.attachment_id, '应声明 attachment_id')
console.log('PASS 3: file_path 与 attachment_id 均声明')

// 4. 无必填属性（file_path/attachment_id 二选一，运行时校验）
{
  const errors = validateJsonSchemaValue(SEE_IMAGE_PARAMETERS, {})
  assert.deepEqual(errors, [], '无必填属性时不应报错（二选一由执行时校验）')
  console.log('PASS 4: 无必填属性通过 schema 校验（二选一语义在运行时）')
}

// 5. 缺少输出字段（text）时被校验层发现
{
  const errors = validateJsonSchemaValue(SEE_IMAGE_OUTPUT.schema, { backend: 'glm' })
  assert.ok(
    errors.some((e) => e.includes('text')),
    `缺 text 应被拒绝, got: ${JSON.stringify(errors)}`,
  )
  console.log('PASS 5: 缺输出字段 text 被拒绝')
}

// 6. 正常返回 backend + text 时通过
{
  const errors = validateJsonSchemaValue(SEE_IMAGE_OUTPUT.schema, { backend: 'glm', text: '结构化视觉描述' })
  assert.deepEqual(errors, [])
  console.log('PASS 6: 完整输出值通过校验')
}

// 7. render() 正常生成文本内容
{
  const blocks = SEE_IMAGE_OUTPUT.render({}, { backend: 'glm', text: '描述内容' })
  assert.equal(blocks[0].type, 'text')
  assert.ok(blocks[0].text.includes('glm'), 'render 输出应含后端名')
  assert.ok(blocks[0].text.includes('描述内容'), 'render 输出应含描述文本')
  console.log('PASS 7: render() 生成文本内容')
}

console.log('\nALL PASS: vision-bridge schema 校验测试全部通过')
