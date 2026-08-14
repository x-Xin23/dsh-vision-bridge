#!/usr/bin/env node
/**
 * Vision Bridge 安装脚本（跨平台，Node ≥18）
 *
 * 把当前目录的插件安装到指定 DSH profile：
 *   1. 复制 lib/package.json/README 到 <DSH_HOME>/profiles/<profile>/node_modules/@local/vision-bridge
 *   2. 在 profile 的 cordis.patch.yml 中追加挂载行（已存在则跳过）
 *   3. 语法校验（node --check）
 *
 * 用法:
 *   node install.js                # 安装到默认 profile（web）
 *   node install.js headless       # 安装到指定 profile
 *   DSH_HOME=... node install.js   # 自定义 DSH home
 *
 * 环境:
 *   DSH_HOME           DSH 数据目录（默认 ~/.dsh）
 *   VB_SKIP_PATCH=1    跳过 cordis.patch.yml 写入
 */
'use strict'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = process.argv[2] || 'web'
const SRC = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE = '@local/vision-bridge'
const DEST = path.join(DSH_HOME, 'profiles', PROFILE, 'node_modules', PACKAGE)
const PATCH_FILE = path.join(DSH_HOME, 'profiles', PROFILE, 'cordis.patch.yml')
const PATCH_INSERT = `- insert:\n    - id: vision-bridge\n      name: '${PACKAGE}'\n`
const PATCH_DISABLE = `- id: llm-deepseek\n  disabled: true\n`

function step(msg) { console.log(`[install] ${msg}`) }
function fail(msg) { console.error(`[install] ✗ ${msg}`); process.exit(1) }

// ---------- 1. 复制 ----------
step(`目标: ${DEST}`)
if (!fs.existsSync(path.join(SRC, 'lib', 'index.js'))) fail('未找到 lib/index.js（请在插件源码目录运行本脚本）')
fs.mkdirSync(DEST, { recursive: true })
fs.mkdirSync(path.join(DEST, 'lib'), { recursive: true }) // 新环境必须显式创建 lib/（修复）
for (const rel of ['lib/index.js', 'lib/adapter.js', 'lib/dsh-pkg.js', 'package.json', 'README.md']) {
  const from = path.join(SRC, rel)
  if (!fs.existsSync(from)) continue
  fs.copyFileSync(from, path.join(DEST, rel))
}
step('插件文件已复制（lib/* / package.json / README.md）')

// ---------- 2. patch（挂载行 + llm-deepseek 禁用，分别检查/写入） ----------
if (process.env.VB_SKIP_PATCH === '1') {
  step('跳过 cordis.patch.yml（VB_SKIP_PATCH=1）')
} else {
  let patch = ''
  if (fs.existsSync(PATCH_FILE)) {
    patch = fs.readFileSync(PATCH_FILE, 'utf8')
  }
  const hasBridge = patch.includes('vision-bridge')
  const hasDisable = patch.includes('- id: llm-deepseek') && patch.includes('disabled: true')
  const additions = []
  if (!hasBridge) additions.push(PATCH_INSERT)
  if (!hasDisable) additions.push(PATCH_DISABLE)
  if (additions.length === 0) {
    step('cordis.patch.yml 已包含挂载行与 llm-deepseek 禁用，跳过写入')
  } else {
    const block = additions.join('')
    const content = patch.trim().length > 0 && patch.trim() !== '[]'
      ? patch.replace(/\s*$/, '\n') + block
      : '# Vision Bridge 挂载与 llm-deepseek 禁用（install.js 生成）\n' + block
    fs.mkdirSync(path.dirname(PATCH_FILE), { recursive: true })
    fs.writeFileSync(PATCH_FILE, content, 'utf8')
    const what = (!hasBridge ? ' 挂载行' : '') + (!hasDisable ? ' llm-deepseek 禁用' : '')
    step('已写入 patch → ' + PATCH_FILE + '（' + what.trim() + '）')
  }
}

// ---------- 3. 语法校验 ----------
try {
  execFileSync(process.execPath, ['--check', path.join(DEST, 'lib', 'index.js')], { stdio: 'inherit' })
  execFileSync(process.execPath, ['--check', path.join(DEST, 'lib', 'adapter.js')], { stdio: 'inherit' })
  step('语法校验通过')
} catch {
  fail('插件语法校验失败')
}

step(`完成。请重启 DSH 后按 README「凭证」配置 API key。`)
console.log(`\n下一步：\n  1. 编辑 ${path.join(DSH_HOME, '.credentials.yaml')} 添加视觉 API key\n  2. 重启 DSH 生效`)
