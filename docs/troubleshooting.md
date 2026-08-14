# 故障排查（Troubleshooting）

> English: [Troubleshooting](troubleshooting.en.md)　|　简体中文（当前）

按症状查找。排查顺序建议：**安装 → 启动日志 → 贴图 → 后端 → 缓存 → 升级**。

## 安装 / 启动

| 症状 | 原因与解决 |
|---|---|
| 启动日志没有 `[vision-bridge] 原生图片通道挂接完成` | 插件未生效：确认 `cordis.patch.yml` 含 `- insert: vision-bridge` 且 `@local/vision-bridge` 目录存在；确认 `llm-deepseek` 行被置为 `disabled: true`（避免路由冲突）；重启 DSH |
| 报 `Cannot find module '@local/vision-bridge'` | `install.js` 未成功复制到 profile：重跑 `node install.js`（可带 profile 名）；检查 `%USERPROFILE%\.dsh\profiles\web\node_modules\@local\vision-bridge\` 是否存在 |
| 安装到错误的 profile | `node install.js headless` 指定 profile；默认是 `web`。确认你启动 DSH 时用的 profile 与安装目标一致 |
| DSH 升级后出现自检告警 | 挂接点被 DSH 新版本改动：告警会给出具体 HOOKS 表项与修复指引，按提示修改 `lib/index.js` 的 HOOKS 配置（或更新插件）后重启 |

## 贴图 / 模型响应

| 症状 | 原因与解决 |
|---|---|
| 贴图仍报"模型不支持图片" | 模型选择器选中的不是 `deepseek-official` 路由（插件只重写该路由）；或插件未生效（见上）；或贴图发生在插件加载前（重启 DSH 后再试） |
| 图片显示了，但模型说"看不到图片" | 预注描述在 8s 等待窗口内未完成（网络慢 / 后端限流）。图片本身已正确挂接，让模型调用 `see_image` 工具即可；下次同图会命中缓存 |
| 模型收到的描述是占位符 `[图片附件: ...]` | 同上：预注失败后的兜底路径。`see_image` 精查一次会回填预注缓存（自愈） |
| `see_image` 报"附件不存在" | 附件 ID 写错或附件已被清理；在会话中直接引用贴图消息的附件 ID；`--attachment sha256:<hex>` 需完整 hash |
| `region` 参数无效 | 格式必须为 `x,y,w,h` 且各值在 0-1、`x+w` / `y+h` 不超过 1；失败会显式报错而非静默整图 |

## 后端 / 网络

| 症状 | 原因与解决 |
|---|---|
| 所有后端均失败（日志含 `所有视觉后端均失败`） | 逐一核对 `.credentials.yaml` 的 key 是否正确、是否有空格/引号残留；看错误明细里各后端的失败原因 |
| 仅 Groq / Gemini 失败 | 国内网络直连不通：配置 `VISION_PROXY`（如 `http://127.0.0.1:7890`），并确认代理本身可用 |
| 报 `未找到 ... 凭证` | `.credentials.yaml` 缺少对应 key 或格式错误（`KEY: value` 一行一个，值可加引号，`#` 后为注释） |
| 频繁出现限流重试（`限流，2000ms 后重试`） | 短时间大量看图触发了后端配额：稍等再试；`see_image` 对同图同问会命中缓存，避免重复调用 |
| curl 超时（`curl 超时`） | 网络不稳或代理慢：检查代理连通性后重试；150s 为单次请求上限 |
| 某后端报 401 / 403 | key 无效或过期：换 key；确认 key 与后端对应（MiMo key 不能填到 GLM 字段） |
| 自定义后端（VB_*）总是失败 | 确认 `VB_BASE_URL` 是完整的 chat/completions 端点（OpenAI 兼容）或 Gemini 端点；`VB_MODEL` 是该服务实际可用的视觉模型名；`VB_PROTOCOL` 与端点协议一致；需代理时设 `VB_NEEDS_PROXY: true`。日志中 custom 失败后会自动回退内置四家 |
| 改了 VB_* 但结果没变 | 缓存键含自定义端点 hash——改了端点/模型应自动失效；若 CLI 缓存未失效，删除对应 `.vb-see.cache.json` |

## 缓存 / 数据

| 症状 | 原因与解决 |
|---|---|
| 缓存不命中 | 缓存键含图片 hash + 问题/区域/后端/版本：换了问题、区域、后端或升级版本都会天然失效（设计如此） |
| 缓存占用磁盘 | 每个缓存文件仅几 KB；启动时自动清理，保留最近 500 个（`CACHE_KEEP_MAX`）。手动清：删除 `%USERPROFILE%\.dsh\vision-bridge\.vb-cache-*` |
| CLI 缓存路径疑惑 | CLI 缓存独立：附件 → `%USERPROFILE%\.dsh\vision-bridge\.att-*.vb-see.cache.json`；文件 → `<图片路径>.vb-see.cache.json` |

## 图片处理

| 症状 | 原因与解决 |
|---|---|
| 预处理/裁剪不生效 | `sharp` 未安装：插件自动降级（跳过预处理/裁剪，核心看图功能不受影响）。需要时安装：`npm i sharp` 到 profile 的 `node_modules` 或安装目录 |
| 超大图失败 | 超过后端限制的大图会被压缩到 1280px；若仍失败，检查图片是否损坏或格式是否支持（png / jpg / webp / gif / bmp） |
| 识别结果与图片不符 | 视觉模型的能力上限；改用 `see_image` 精查（更详细的 prompt 与 region 聚焦），或换后端对比（`--backend glm` 等） |

## 测试 / 开发

| 症状 | 原因与解决 |
|---|---|
| 测试报模块找不到 | 测试直接 import 插件源码：DSH 包（`@deepseek-ai/*`）解析失败时回退到 DSH home 查找，确认 `%USERPROFILE%\.dsh\profiles\web\node_modules\` 下存在 DSH 包 |
| sharp 相关测试跳过 | 环境无 `sharp`，测试组自动跳过（正常行为） |
