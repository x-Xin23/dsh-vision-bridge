/**
 * DSH 包加载器：优先包名解析（安装副本环境），回退 DSH home 各 profile 的
 * node_modules 绝对路径（源码目录/测试环境）。包缺失返回 null，调用方降级。
 */
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const requirePkg = createRequire(import.meta.url)

export function loadDshPkg(name) {
  try { return requirePkg(name) } catch { /* not resolvable here */ }
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const candidates = [
    path.join(dshHome, 'profiles', 'node_modules', name),
    path.join(dshHome, 'profiles', 'web', 'node_modules', name),
    path.join(dshHome, 'profiles', 'headless', 'node_modules', name),
  ]
  for (const c of candidates) {
    try { return requirePkg(c) } catch { /* next */ }
  }
  return null
}
