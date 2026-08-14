#!/usr/bin/env node
/**
 * vision-see.js — Vision Bridge 的独立 CLI 通道
 *
 * 用法:
 *   node vision-see.js <图片路径> [问题] [--backend mimo|glm|groq|gemini|auto] [--region x,y,w,h]
 *
 * 复用 @local/vision-bridge 导出的纯逻辑（后端表 / prompt / 缓存键 / 预处理），
 * 本文件只保留 CLI 壳、凭证读取与 curl 传输，避免双份维护。
 *
 * 凭证: 从 C:\Users\xXin\.dsh\.credentials.yaml 读取（MIMO/GLM/GROQ/GEMINI/VISION_PROXY）
 * 缓存: 图片同目录生成 <图片名>.vb-see.cache.json（同图同问同区域直接命中）
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('node:child_process')

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
// 插件模块：env 指定 → 安装副本 → 仓库自身（源码直接运行）
const PLUGIN_PATH = [
  process.env.VB_PLUGIN_PATH,
  path.join(DSH_HOME, 'profiles', 'web', 'node_modules', '@local', 'vision-bridge', 'lib', 'index.js'),
  path.join(__dirname, 'lib', 'index.js'),
].filter(Boolean).find((c) => fs.existsSync(c))
const plugin = require(PLUGIN_PATH)
const {
  BACKENDS,
  BACKEND_ORDER,
  attachmentObjectPath,
  backendTriesFor,
  buildBackendRequest,
  buildPrompt,
  cacheKeyFor,
  cropRegionImage,
  extractResponseText,
  isRateLimitError,
  mimeForPath,
  mimeFromBytes,
  parseDataUrlText,
  preprocessImage,
} = plugin

const CURL_PATH = process.platform === 'win32' ? 'C:\\Windows\\System32\\curl.exe' : 'curl'
const SSL_NO_REVOKE = process.platform === 'win32' ? ['--ssl-no-revoke'] : []
const REQUEST_TIMEOUT_MS = 150000

// ---------- 凭证（支持 DSH_HOME） ----------
function loadCreds() {
  const out = {}
  const file = path.join(DSH_HOME, '.credentials.yaml')
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/)
    if (!m) continue
    let v = m[2].replace(/\s*#.*$/, '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (v) out[m[1]] = v
  }
  return out
}

// ---------- curl 传输（stdin 传请求体；密钥走私有 config 文件，不进进程参数） ----------
function runCurl(args, stdinData) {
  return new Promise((resolve, reject) => {
    let proc
    try {
      proc = spawn(CURL_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      reject(e)
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('curl 超时'))
    }, REQUEST_TIMEOUT_MS + 10000)
    proc.stdout.on('data', (d) => { stdout += d })
    proc.stderr.on('data', (d) => { stderr += d })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code })
    })
    proc.stdin.write(stdinData)
    proc.stdin.end()
  })
}

async function callBackend(t, b64, mime, promptText, proxy) {
  const { url, headers, bodyJson, stripThink } = buildBackendRequest(t.name, b64, mime, promptText, t.key)
  // config 文件写入 DSH home 私有目录（含密钥，mode 0o600），不用系统临时目录
  const cfgDir = path.join(DSH_HOME, 'vision-bridge')
  try { fs.mkdirSync(cfgDir, { recursive: true }) } catch { /* fall through */ }
  const cfgPath = path.join(cfgDir, '.vb-curl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.cfg')
  let exitCode, stdout, stderr
  try {
    const lines = Object.entries(headers).map(([k, v]) => 'header = "' + k + ': ' + String(v).replace(/"/g, '\\"') + '"')
    fs.writeFileSync(cfgPath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 })
    const args = ['-sS', ...SSL_NO_REVOKE, '--max-time', '150', '-X', 'POST', '-K', cfgPath]
    if (proxy) args.push('-x', proxy)
    args.push('--data-binary', '@-', url)
    const r = await runCurl(args, bodyJson)
    exitCode = r.exitCode
    stdout = r.stdout
    stderr = r.stderr
  } finally {
    try { fs.unlinkSync(cfgPath) } catch { /* ignore */ }
  }
  if (exitCode !== 0) {
    throw new Error(t.name + ' 网络调用失败 (exit ' + exitCode + '): ' + (stderr || stdout).slice(0, 400))
  }
  const j = JSON.parse(stdout)
  if (j.error) throw new Error(t.name + ' API 错误: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 400))
  const text = extractResponseText(j, stripThink)
  if (!text) throw new Error(t.name + ' 返回了空结果')
  return text
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2)
  let imgPath
  let attachmentId
  let question
  let backend = 'auto'
  let region
  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backend') backend = args[++i] || 'auto'
    else if (args[i] === '--region') region = args[++i]
    else if (args[i] === '--attachment') attachmentId = args[++i]
    else positional.push(args[i])
  }
  imgPath = positional[0]
  if (positional.length > 1) question = positional.slice(1).join(' ')
  if (!imgPath && !attachmentId) {
    console.error('用法: node vision-see.js <图片路径|--attachment sha256:...> [问题] [--backend mimo|glm|groq|gemini|auto] [--region x,y,w,h]')
    process.exit(2)
  }

  // 来源解析：--attachment 读 DSH 附件存储（贴图）；否则读文件
  let raw
  let isAttachment = false
  if (attachmentId) {
    const objPath = attachmentObjectPath(DSH_HOME, attachmentId)
    if (!objPath || !fs.existsSync(objPath)) {
      throw new Error('附件不存在或路径无效: ' + attachmentId + '（期望 ' + (objPath || 'sha256:<hex>') + '）')
    }
    raw = fs.readFileSync(objPath)
    isAttachment = true
  } else {
    if (!fs.existsSync(imgPath)) throw new Error('图片不存在: ' + imgPath)
    raw = fs.readFileSync(imgPath)
  }

  const creds = loadCreds()
  const proxy = creds.VISION_PROXY
  const tries = backendTriesFor(backend, creds, proxy)
  if (tries.length === 0) {
    const names = backend && backend !== 'auto' ? [backend] : BACKEND_ORDER
    const wanted = names.map((n) => BACKENDS[n].keyNames.join(' / ')).join(' 或 ')
    throw new Error('未找到 ' + wanted + ' 凭证（检查 ' + path.join(os.homedir(), '.dsh', '.credentials.yaml') + '）')
  }

  let b64
  let mime
  const head = raw.subarray(0, 64).toString('utf8')
  const dataUrl = head.startsWith('data:image/') ? parseDataUrlText(raw.toString('utf8')) : null
  // 原始图片字节（region 裁剪的输入；data URL 文本先解码）
  const srcBytes = dataUrl ? Buffer.from(dataUrl.b64, 'base64') : raw
  if (dataUrl) {
    b64 = dataUrl.b64
    mime = dataUrl.mime
  } else if (isAttachment) {
    // 附件文件无扩展名：魔数探测 MIME
    mime = mimeFromBytes(raw)
    if (mime === undefined) throw new Error('无法识别附件图片格式: ' + attachmentId)
    const pp = await preprocessImage(raw)
    if (pp.processed) {
      b64 = pp.bytes.toString('base64')
      mime = 'image/jpeg'
    } else {
      b64 = raw.toString('base64')
    }
  } else {
    mime = mimeForPath(imgPath)
    if (mime === undefined) throw new Error('不支持的图片格式: ' + imgPath)
    const pp = await preprocessImage(raw)
    if (pp.processed) {
      b64 = pp.bytes.toString('base64')
      mime = 'image/jpeg'
    } else {
      b64 = raw.toString('base64')
    }
  }

  // ---- 结果缓存（同图同问同区域同后端同版本直接命中，不重复调用 API） ----
  const { imageHash, askHash } = cacheKeyFor(raw, question, region, backend)
  const cacheFile = (isAttachment
    ? path.join(DSH_HOME, 'vision-bridge', '.att-' + String(attachmentId).replace(/[^a-z0-9]/gi, '_'))
    : imgPath) + '.vb-see.cache.json'
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (cached && cached.imageHash === imageHash && cached.askHash === askHash && typeof cached.text === 'string' && cached.text) {
        console.log('[backend: cache]')
        console.log(cached.text)
        return
      }
    }
  } catch { /* cache miss */ }

  // ---- region 真实裁剪（基于原始图片字节；失败即报错，不静默整图） ----
  if (region) {
    const cropped = await cropRegionImage(srcBytes, region)
    if (!cropped) {
      throw new Error('region 参数无效或裁剪失败（格式应为 "x,y,w,h" 且各值在 0-1、x+w/y+h 不超过 1）: ' + region)
    }
    b64 = cropped.toString('base64')
    mime = 'image/jpeg'
  }

  const promptText = buildPrompt(question, region)

  const errors = []
  let text
  let chosen
  for (const t of tries) {
    let attempts = 0
    while (attempts < 3) {
      attempts++
      try {
        text = await callBackend(t, b64, mime, promptText, proxy)
        chosen = t.name
        break
      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        if (isRateLimitError(msg) && attempts < 3) {
          const waitMs = 2000 * attempts
          console.error(`[${t.name}] 限流，${waitMs}ms 后重试 (${attempts}/3)`)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          continue
        }
        errors.push(t.name + (attempts > 1 ? '(' + attempts + '次)' : '') + ': ' + msg)
        break
      }
    }
    if (chosen) break
  }
  if (!chosen) {
    throw new Error('所有视觉后端均失败:\n' + errors.join('\n'))
  }

  // ---- 写缓存 ----
  try {
    fs.writeFileSync(cacheFile, JSON.stringify({ imageHash, askHash, backend: chosen, text }))
  } catch { /* best effort */ }

  console.log('[backend: ' + chosen + ']')
  console.log(text)
}

main().catch((e) => {
  console.error('VISION_ERROR: ' + (e && e.message ? e.message : String(e)))
  process.exit(1)
})
