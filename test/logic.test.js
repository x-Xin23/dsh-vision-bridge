/**
 * vision-bridge 逻辑单元测试
 *
 * 覆盖模块导出的纯函数：缓存键、prompt、限流判定、mime、base64、data URL
 * 解析、响应提取、后端尝试链、请求构建、预处理、region 裁剪、消息转换、
 * 附件 id 收集。含历史 bug 的回归断言（region/后端/版本进缓存键、
 * preprocess MIME、fit 尺寸）。
 * 直接 import 插件源码（../lib/index.js），不依赖安装副本是否同步。
 *
 * 运行：
 *   node test/logic.test.js
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
const {
  BACKENDS,
  BACKEND_ORDER,
  HOOKS,
  PROMPT_VERSION,
  PREPROCESS_VERSION,
  SCOPE_PROVIDER,
  SCOPE_FAMILIES,
  VISION_WRAP_PREFIX,
  attachmentObjectPath,
  backendTriesFor,
  buildBackendRequest,
  buildDescribePrompt,
  buildPrompt,
  cacheKeyFor,
  collectImageAttachmentIds,
  convertImagesSync,
  cropRegionImage,
  customBackendFromKeys,
  customHashFor,
  describeInjectMaxFor,
  extractResponseText,
  imageBlockToText,
  isRateLimitError,
  mimeForPath,
  mimeFromBytes,
  parseDataUrlText,
  preprocessImage,
  providerInScope,
  shouldWrapModelInfo,
} = await import(new URL('../lib/index.js', import.meta.url).href)

let passed = 0
function ok(name) { passed++; console.log('PASS ' + name) }

// sharp 加载（DSH home 下；不可用时跳过依赖它的测试组）
const require = createRequire(import.meta.url)
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let sharp = null
try {
  sharp = require(path.join(DSH_HOME, 'profiles', 'node_modules', 'sharp'))
} catch {
  try { sharp = require(path.join(DSH_HOME, 'profiles', 'web', 'node_modules', 'sharp')) } catch { sharp = null }
}

// ---------- 1. 缓存键（回归：region/backend/版本必须区分；空 ask 为空串） ----------
{
  const img = Buffer.from('fake-image-bytes-1')
  const a = cacheKeyFor(img, '有几个苹果？', undefined, 'auto')
  const b = cacheKeyFor(img, '有几个苹果？', undefined, 'auto')
  const c = cacheKeyFor(img, '有几个苹果？', '0.1,0.2,0.4,0.3', 'auto')
  const d = cacheKeyFor(img, '有几个香蕉？', undefined, 'auto')
  const e = cacheKeyFor(Buffer.from('different-bytes'), '有几个苹果？', undefined, 'auto')
  const f = cacheKeyFor(img, '有几个苹果？', undefined, 'gemini')
  const none = cacheKeyFor(img, undefined, undefined, 'auto')
  assert.equal(a.imageHash, b.imageHash)
  assert.equal(a.askHash, b.askHash)
  assert.notEqual(a.askHash, c.askHash, 'region 不同必须区分缓存键')
  assert.notEqual(a.askHash, d.askHash, 'question 不同必须区分缓存键')
  assert.notEqual(a.imageHash, e.imageHash, '图片内容不同必须区分缓存键')
  assert.notEqual(a.askHash, f.askHash, '指定后端不同必须区分缓存键')
  assert.equal(none.askHash, '', '无问无区域无指定后端时 askHash 应为空串')
  assert.ok(a.askHash.length > 0, '带 question 时 askHash 非空')
  ok('1. 缓存键：region/question/后端/图片内容任一不同即区分，空 ask 为空串')
}

// ---------- 2. buildPrompt / buildDescribePrompt（结构化前置） ----------
{
  const p0 = buildPrompt(undefined, undefined)
  assert.ok(p0.includes('【概述】'))
  assert.ok(p0.includes('无附加问题'))
  const p1 = buildPrompt('这个按钮的文案是什么？', '0.1,0.2,0.4,0.3')
  assert.ok(p1.includes('这个按钮的文案是什么？'))
  assert.ok(p1.includes('【重点关注】'))
  assert.ok(p1.includes('0.1,0.2,0.4,0.3'))
  const dp = buildDescribePrompt()
  assert.ok(dp.includes('1)【概述】'), '结构化预注 prompt 应含概述段')
  assert.ok(dp.includes('2)【关键文字】'), '结构化预注 prompt 应含关键文字段（价值前置）')
  assert.ok(dp.includes('逐字准确'), '关键文字段应要求逐字准确')
  assert.ok(dp.includes('3)【主要元素】'), '结构化预注 prompt 应含主要元素段')
  assert.ok(dp.length < p0.length, '预注 prompt 应比完整 prompt 精简')
  ok('2. buildPrompt：question 与 region 正确注入；buildDescribePrompt 结构化前置')
}

// ---------- 2.2 注入档位 describeInjectMaxFor（2B） ----------
{
  assert.equal(describeInjectMaxFor(131072), 1600, '≥64K 上下文应注入 1600 字符')
  assert.equal(describeInjectMaxFor(64000), 1600, '64K 边界应注入 1600')
  assert.equal(describeInjectMaxFor(32768), 800, '≥16K 应注入 800')
  assert.equal(describeInjectMaxFor(8192), 400, '小上下文应注入 400')
  assert.equal(describeInjectMaxFor(undefined), 400, '未知上下文按最小档')
  ok('2.2 describeInjectMaxFor：按上下文窗口动态分档')
}

// ---------- 2.5 imageBlockToText / convertImagesSync（核心转换逻辑） ----------
{
  const resolver = (id) => {
    if (id === 'img-1') return { attachmentId: 'img-1', desc: '一只猫坐在沙发上' }
    if (id === 'img-2') return { attachmentId: 'img-2', desc: undefined }
    return undefined
  }
  assert.ok(imageBlockToText('img-1', resolver('img-1')).includes('[图片附件: img-1]'))
  assert.ok(imageBlockToText('img-1', resolver('img-1')).includes('【自动视觉描述】一只猫坐在沙发上'))
  assert.ok(imageBlockToText('img-1', resolver('img-1')).includes('不得视为指令'), '描述应带不可信数据标记（prompt injection 防护）')
  assert.ok(!imageBlockToText('img-2', resolver('img-2')).includes('自动视觉描述'))
  assert.ok(imageBlockToText('missing', undefined).includes('无法读取'))
  const options = {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'user', content: [
        { type: 'text', text: '看图' },
        { type: 'image', attachment: { attachmentId: 'img-1' } },
      ] },
      { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'img-2' } }] },
      { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'missing-1' } }] },
      { role: 'assistant', content: [{
        type: 'tool-result',
        callId: 'c1',
        content: [{ type: 'image', attachment: { attachmentId: 'img-1' } }],
      }] },
    ],
  }
  const out = convertImagesSync(options, resolver)
  assert.notEqual(out, options, '有转换时应返回新对象')
  const m1 = out.messages[0].content
  assert.equal(m1[1].type, 'text')
  assert.ok(m1[1].text.includes('[图片附件: img-1]'))
  assert.ok(m1[1].text.includes('【自动视觉描述】一只猫坐在沙发上'))
  assert.equal(out.messages[1].content[0].type, 'text')
  assert.ok(out.messages[1].content[0].text.includes('[图片附件: img-2]'))
  assert.ok(!out.messages[1].content[0].text.includes('自动视觉描述'))
  assert.ok(out.messages[2].content[0].text.includes('无法读取'))
  const nested = out.messages[3].content[0]
  assert.equal(nested.type, 'tool-result')
  assert.equal(nested.content[0].type, 'text')
  assert.ok(nested.content[0].text.includes('一只猫'))
  const longDesc = '很长的描述'.repeat(200)
  const longOut = convertImagesSync({
    messages: [{ role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'img-1' } }] }],
  }, () => ({ attachmentId: 'img-1', desc: longDesc }))
  assert.ok(longOut.messages[0].content[0].text.includes('…'), '超长描述应截断')
  ok('2.5 imageBlockToText/convertImagesSync：描述注入/无描述路径/未命中占位/嵌套 tool-result/截断')
}

// ---------- 2.6 collectImageAttachmentIds ----------
{
  const options = {
    messages: [
      { content: [
        { type: 'image', attachment: { attachmentId: 'a' } },
        { type: 'text', text: 'x' },
      ] },
      { content: [
        { type: 'tool-result', content: [
          { type: 'image', attachment: { attachmentId: 'b' } },
          { type: 'image', attachment: { attachmentId: 'a' } },
        ] },
      ] },
      { content: [{ type: 'text', text: 'y' }] },
    ],
  }
  assert.deepEqual(collectImageAttachmentIds(options), ['a', 'b'], '应收集全部附件 id 并去重保序')
  assert.deepEqual(collectImageAttachmentIds({ messages: [{ content: [{ type: 'text', text: 'x' }] }] }), [])
  ok('2.6 collectImageAttachmentIds：收集/去重/保序')
}

// ---------- 3. isRateLimitError ----------
{
  assert.ok(isRateLimitError('GLM API 错误: 您的账户已达到速率限制'))
  assert.ok(isRateLimitError('该模型当前访问量过大，请您稍后再试'))
  assert.ok(isRateLimitError('Rate limit reached for model'))
  assert.ok(isRateLimitError('This model is currently experiencing high demand'))
  assert.ok(isRateLimitError('HTTP 429'))
  assert.ok(!isRateLimitError('图片不存在: x.png'))
  assert.ok(!isRateLimitError('Gemini API 错误: invalid argument'))
  ok('3. 限流判定：中英文限流词命中，普通错误不误判')
}

// ---------- 4. mimeForPath ----------
{
  assert.equal(mimeForPath('a.PNG'), 'image/png')
  assert.equal(mimeForPath('a.jpg'), 'image/jpeg')
  assert.equal(mimeForPath('a.jpeg'), 'image/jpeg')
  assert.equal(mimeForPath('a.webp'), 'image/webp')
  assert.equal(mimeForPath('a.gif'), 'image/gif')
  assert.equal(mimeForPath('a.bmp'), 'image/bmp')
  assert.equal(mimeForPath('a.txt'), undefined)
  ok('4. mimeForPath：扩展名映射')
}

// ---------- 5. parseDataUrlText ----------
{
  const r = parseDataUrlText('data:image/png;base64,AAAA\r\nBBBB')
  assert.deepEqual(r, { b64: 'AAAABBBB', mime: 'image/png' })
  assert.equal(parseDataUrlText('not a data url'), null)
  assert.equal(parseDataUrlText('data:text/plain;base64,AAAA'), null)
  ok('5. parseDataUrlText：合法解析、去换行、非法拒绝')
}

// ---------- 6. extractResponseText ----------
{
  assert.equal(extractResponseText({ choices: [{ message: { content: 'hello' } }] }, false), 'hello')
  assert.equal(
    extractResponseText({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }, false),
    'ab',
  )
  assert.equal(
    extractResponseText({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }, false),
    'x',
  )
  const think = '<think>internal reasoning</think>visible answer'
  assert.equal(extractResponseText({ choices: [{ message: { content: think } }] }, true), 'visible answer')
  assert.equal(extractResponseText({ choices: [{ message: { content: think } }] }, false), think)
  assert.equal(extractResponseText({}, false), '')
  ok('6. extractResponseText：string/数组/think 剥离')
}

// ---------- 7. 后端配置表 ----------
{
  assert.deepEqual(BACKEND_ORDER, ['mimo', 'glm', 'groq', 'gemini'])
  assert.equal(BACKENDS.mimo.model, 'xiaomi/mimo-v2.5')
  assert.equal(BACKENDS.mimo.needsProxy, false)
  assert.equal(BACKENDS.groq.needsProxy, true)
  assert.equal(BACKENDS.gemini.protocol, 'gemini')
  ok('7. 后端表：模型/代理/协议配置正确')
}

// ---------- 8. buildBackendRequest ----------
{
  const oa = buildBackendRequest('mimo', 'b64data', 'image/png', 'prompt', 'key1')
  assert.equal(oa.url, 'https://api.xiaomimimo.com/v1/chat/completions')
  assert.equal(oa.headers.Authorization, 'Bearer key1')
  const oaBody = JSON.parse(oa.bodyJson)
  assert.equal(oaBody.model, 'xiaomi/mimo-v2.5')
  assert.equal(oaBody.messages[0].content[1].image_url.url, 'data:image/png;base64,b64data')

  const gm = buildBackendRequest('gemini', 'b64data', 'image/png', 'prompt', 'key2')
  assert.ok(gm.url.includes('gemini-flash-latest'))
  assert.equal(gm.headers['x-goog-api-key'], 'key2')
  const gmBody = JSON.parse(gm.bodyJson)
  assert.equal(gmBody.contents[0].parts[1].inline_data.data, 'b64data')
  ok('8. buildBackendRequest：OpenAI 与 Gemini 两种协议格式正确')
}

// ---------- 9. preprocessImage（真实 sharp：小图放大、大图缩小、中图不动、MIME） ----------
if (sharp) {
{
  const small = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ) // 1x1 PNG
  const r1 = await preprocessImage(small)
  assert.equal(r1.processed, true, '1px 小图应放大到 1024')
  assert.equal(r1.mime, 'image/jpeg', '预处理成功后 MIME 应为 image/jpeg（回归）')
  const big = await sharp({ create: { width: 2000, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
  const r2 = await preprocessImage(big)
  assert.equal(r2.processed, true, '2000px 大图应缩小到 1280')
  const bigMeta = await sharp(r2.bytes).metadata()
  assert.equal(bigMeta.width, 1280, '缩小后宽度应为 1280')
  assert.equal(bigMeta.height, 64, '缩小后高度应按宽高比 2000:100 → 64（fit 回归）')
  const mid = await sharp({ create: { width: 1000, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
  const r3 = await preprocessImage(mid)
  assert.equal(r3.processed, false, '1000px 中图不应处理')
  assert.equal(r3.mime, undefined, '未处理时不应有 mime')
  ok('9. preprocessImage：小图放大 / 大图缩小 / 中图不动 / MIME 正确')
}
} else { console.log('SKIP 9: sharp 不可用（DSH home 未安装），跳过预处理测试') }

// ---------- 9.5 cropRegionImage（region 真实裁剪） ----------
if (sharp) {
{
  const img = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer()
  const cropped = await cropRegionImage(img, '0,0,0.5,0.5')
  assert.ok(cropped, '合法 region 应裁剪成功')
  const meta = await sharp(cropped).metadata()
  assert.equal(meta.width, 1280, '裁剪后应放大到目标宽度 1280')
  assert.equal(meta.height, 640, '裁剪后高度按宽高比放大（50x25 → 1280x640，fit 回归）')
  assert.equal(await cropRegionImage(img, '0,0,2,2'), null, '越界 region 应拒绝')
  assert.equal(await cropRegionImage(img, 'abc'), null, '非法格式应拒绝')
  assert.equal(await cropRegionImage(img, undefined), null, '无 region 应拒绝')
  ok('9.5 cropRegionImage：合法裁剪放大 / 越界与非法拒绝')
}
} else { console.log('SKIP 9.5: sharp 不可用，跳过裁剪测试') }

// ---------- 10. 版本常量 / HOOKS 表 ----------
{
  assert.equal(typeof PROMPT_VERSION, 'number')
  assert.equal(typeof PREPROCESS_VERSION, 'number')
  assert.ok(PROMPT_VERSION >= 4, 'PROMPT_VERSION 应 >= 4（结构化预注 prompt 版本）')
  assert.deepEqual(Object.keys(HOOKS), ['resolveModelInfo', 'saveImage', 'streamWithRegistration'], 'HOOKS 表应含三个挂接点')
  assert.equal(typeof HOOKS.resolveModelInfo, 'string')
  ok('10. PROMPT_VERSION / PREPROCESS_VERSION / HOOKS 配置表')
}

// ---------- 11. 附件路径 / MIME 魔数 ----------
{
  const p = attachmentObjectPath('C:\\dsh', 'sha256:76d1b9e7a72e271633473d0599dc83ab8632998a6f521aac79757b666e3eb392')
  assert.equal(p, 'C:\\dsh\\attachments\\v1\\objects\\76\\76d1b9e7a72e271633473d0599dc83ab8632998a6f521aac79757b666e3eb392', '附件路径应分片')
  assert.equal(attachmentObjectPath('C:\\dsh', 'invalid'), null, '非法 attachmentId 应拒绝')
  assert.equal(attachmentObjectPath('C:\\dsh', undefined), null)
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  const jpg = Buffer.from('ffd8ffe000104a46', 'hex')
  const webp = Buffer.from('5249464600000000', 'hex')
  const gif = Buffer.from('4749463839610000', 'hex')
  assert.equal(mimeFromBytes(png), 'image/png')
  assert.equal(mimeFromBytes(jpg), 'image/jpeg')
  assert.equal(mimeFromBytes(webp), 'image/webp')
  assert.equal(mimeFromBytes(gif), 'image/gif')
  assert.equal(mimeFromBytes(Buffer.from('text')), undefined)
  ok('11. attachmentObjectPath 分片 / mimeFromBytes 魔数探测')
}

// ---------- 13. 自定义视觉后端（v1.2，A） ----------
{
  // customBackendFromKeys：完整配置 → 对象；缺键 → null
  const full = customBackendFromKeys({
    VB_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    VB_MODEL: 'qwen3-vl-plus',
    VB_API_KEY: 'sk-test',
  })
  assert.ok(full, '完整 VB_* 应构建 custom 配置')
  assert.equal(full.name, 'custom')
  assert.equal(full.protocol, 'openai')
  assert.equal(full.model, 'qwen3-vl-plus')
  assert.equal(full.needsProxy, false)
  assert.equal(customBackendFromKeys({}), null)
  assert.equal(customBackendFromKeys({ VB_MODEL: 'x' }), null, '缺 URL 应拒绝')
  assert.equal(customBackendFromKeys({ VB_BASE_URL: 'u', VB_MODEL: 'm' }), null, '缺 key 应拒绝')
  assert.equal(customBackendFromKeys({ VB_BASE_URL: 'u', VB_MODEL: 'm', VB_API_KEY: 'k', VB_PROTOCOL: 'gemini', VB_NEEDS_PROXY: 'true' }).protocol, 'gemini')
  assert.equal(customBackendFromKeys({ VB_BASE_URL: 'u', VB_MODEL: 'm', VB_API_KEY: 'k', VB_PROTOCOL: 'gemini', VB_NEEDS_PROXY: 'true' }).needsProxy, true)

  // customHashFor：配置变化 → hash 变化；空 → ''
  const h1 = customHashFor(customBackendFromKeys({ VB_BASE_URL: 'u1', VB_MODEL: 'm1', VB_API_KEY: 'k' }))
  const h2 = customHashFor(customBackendFromKeys({ VB_BASE_URL: 'u2', VB_MODEL: 'm1', VB_API_KEY: 'k' }))
  assert.ok(h1 && h1.length > 0)
  assert.notEqual(h1, h2, '端点变化必须改变 customHash')
  assert.equal(customHashFor(null), '')

  // backendTriesFor：custom 在链头；'custom' 强制；内置兜底不变
  const keys = { VB_BASE_URL: 'https://x/v1', VB_MODEL: 'm', VB_API_KEY: 'k', MIMO_API_KEY: 'mk', GLM_API_KEY: 'gk' }
  const chain = backendTriesFor('auto', keys, undefined)
  assert.equal(chain[0].name, 'custom', 'custom 应位于尝试链最前')
  assert.equal(chain[0].cfg.model, 'm')
  assert.ok(chain.some((t) => t.name === 'mimo'), '内置后端仍参与兜底')
  const only = backendTriesFor('custom', keys, undefined)
  assert.equal(only.length, 1)
  assert.equal(only[0].name, 'custom', "指定 'custom' 时只用自定义")
  assert.equal(backendTriesFor('custom', { MIMO_API_KEY: 'mk' }, undefined).length, 0, '未配置 VB_* 时 custom 不可用')
  assert.equal(backendTriesFor('auto', { MIMO_API_KEY: 'mk' }, undefined)[0].name, 'mimo', '无 custom 配置时链头为内置')

  // buildBackendRequest：cfgOverride 生效（OpenAI 协议）
  const cfg = customBackendFromKeys({ VB_BASE_URL: 'https://x/v1/chat/completions', VB_MODEL: 'qwen', VB_API_KEY: 'k' })
  const req = buildBackendRequest('custom', 'b64', 'image/png', 'prompt', 'sk-1', cfg)
  assert.equal(req.url, 'https://x/v1/chat/completions')
  const body = JSON.parse(req.bodyJson)
  assert.equal(body.model, 'qwen')
  assert.equal(req.headers.Authorization, 'Bearer sk-1')

  // cacheKeyFor：customHash 维度（同图同问，端点不同 → 键不同）
  const img = Buffer.from('custom-cache-test')
  const kNoCustom = cacheKeyFor(img, 'q', undefined, 'auto')
  const kCustom1 = cacheKeyFor(img, 'q', undefined, 'auto', h1)
  const kCustom2 = cacheKeyFor(img, 'q', undefined, 'auto', h2)
  assert.notEqual(kCustom1.askHash, kNoCustom.askHash, '有/无自定义端点必须区分')
  assert.notEqual(kCustom1.askHash, kCustom2.askHash, '自定义端点不同必须区分')
  assert.equal(kNoCustom.askHash, cacheKeyFor(img, 'q', undefined, 'auto', '').askHash, '空 customHash 与不传一致')

  ok('13. 自定义后端：VB_* 构建 / hash / 链头 / 请求构建 / 缓存键')
}

// ---------- 14. 多路由自动发现（v1.2，B） ----------
{
  assert.ok(SCOPE_FAMILIES.includes('deepseek') && SCOPE_FAMILIES.includes('glm'), '家族应含 deepseek/glm')
  // shouldWrapModelInfo：文本模型包装；视觉模型/已声明 image 排除
  assert.equal(shouldWrapModelInfo({ id: 'deepseek-v4-flash', inputModalities: ['text'] }), true)
  assert.equal(shouldWrapModelInfo({ id: 'glm-4.6', inputModalities: ['text'] }), true)
  assert.equal(shouldWrapModelInfo({ id: 'deepseek-vl', inputModalities: ['text'] }), false, 'deepseek-vl 原生视觉排除')
  assert.equal(shouldWrapModelInfo({ id: 'glm-4.6v', inputModalities: ['text'] }), false, 'glm-*-v 原生视觉排除')
  assert.equal(shouldWrapModelInfo({ id: 'janus-pro', inputModalities: ['text'] }), false)
  assert.equal(shouldWrapModelInfo({ id: 'deepseek-chat', inputModalities: ['text', 'image'] }), false, '已声明 image 输入排除')
  assert.equal(shouldWrapModelInfo(null), false)
  assert.equal(shouldWrapModelInfo({}), false)
  // providerInScope：家族内非主路由；主路由/家族外排除
  assert.equal(providerInScope('deepseek-official'), false, '替换式主路由不走变体')
  assert.equal(providerInScope('glm-official'), true)
  assert.equal(providerInScope('deepseek-local'), true)
  assert.equal(providerInScope('opencode-go'), false, '家族外排除')
  assert.equal(providerInScope(''), false)
  assert.ok(VISION_WRAP_PREFIX === 'vb-vision-')
  ok('14. 路由发现：模型过滤（视觉排除）/ provider 范围（家族内非主路由）')
}

console.log(`\nALL PASS: ${passed} 项逻辑测试全部通过`)
