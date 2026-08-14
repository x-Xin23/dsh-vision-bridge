# Vision Bridge

给 DeepSeek Harness（Windows）上的纯文本模型（如 deepseek-v4-flash）提供完整视觉能力。

> **English**: [README.en.md](README.en.md)　|　简体中文（当前）

**核心思路**：图片不进入模型输入（DeepSeek 适配器在代码层面拒绝图片块），而是——
图片在会话里正常显示（UI 观感与原生视觉模型一致），模型上下文中收到的是
**自动预注的描述文本 + 图片附件引用**，需要细节时用 `see_image` 工具按附件 ID 精查。

**作用域**：仅重写 `deepseek-official`（纯文本）路由的图片请求；切换到任何其他
provider（含原生视觉模型）时原样放行。

## 仓库结构

```
vision-bridge/
├── lib/
│   ├── index.js        # 插件主文件（后端表 + 纯函数导出 + apply）
│   ├── adapter.js      # VisionDeepSeekAdapter（包装官方适配器，官方扩展点）
│   └── dsh-pkg.js      # DSH 包加载器（包名/DSH home 双路径解析）
├── test/               # schema(7) + logic(17) + adapter(3) 单元测试
├── docs/               # cli / troubleshooting / security（中英双语）
├── vision-see.cjs       # 独立 CLI（分析文件或贴图附件）
├── install.js          # 一键安装脚本（复制 + patch + 校验）
├── package.json        # v1.2.0，MIT
└── README.md / README.en.md（中文 / English）
```

## 快速开始（3 步）

**1. 安装**（在插件目录执行，Node ≥18）：

```powershell
node install.js            # 安装到默认 profile（web）
node install.js headless   # 或指定 profile
```

**2. 配置 API key**（编辑 `%USERPROFILE%\.dsh\.credentials.yaml`）：

```yaml
# 内置后端（最少只需 MIMO_API_KEY 一个即可使用，其余为兜底冗余）
MIMO_API_KEY: <小米 MiMo-V2.5，主后端，直连，¥1/MTok>
GLM_API_KEY: <智谱 GLM-4.6V-Flash，免费直连>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b，免费，需代理>
GEMINI_API_KEY: <Gemini gemini-flash-latest，需代理>
VISION_PROXY: http://127.0.0.1:7890   # 仅 Groq/Gemini 需要（国内网络）

# 可选：自定义视觉后端（v1.2）——填了就走自定义优先、内置兜底
VB_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions  # 任意 OpenAI 兼容端点
VB_MODEL: qwen3-vl-plus
VB_API_KEY: sk-xxx
# VB_PROTOCOL: openai      # openai（默认）| gemini
# VB_NEEDS_PROXY: true     # true 时走 VISION_PROXY
```

**3. 重启 DSH**。启动日志出现 `[vision-bridge] 原生图片通道挂接完成` 即生效。

> 最少只需 `MIMO_API_KEY` 一个 key 即可使用（其余为兜底冗余）。
> 自定义后端（`VB_*`）配置完整后，视觉请求**优先走你的端点**，内置四家仅作兜底。

## 能力

| 能力 | 说明 |
|---|---|
| 原生贴图 | 粘贴/拖拽图片进聊天框，缩略图正常显示，不再报"模型不支持图片" |
| 预注式视觉 | 图片上传后**后台立即生成描述**（限流自动重试）；模型请求**等待 in-flight 描述完成**（有界 8s）——模型天然"看见"，无竞态 |
| `see_image` 工具 | 按需精查：OCR / 布局 / 定向问题 / 区域聚焦（真实裁剪）；支持 `attachment_id` 或 `file_path` |
| region 真实裁剪 | 归一化坐标 → sharp 裁剪放大到 1280px；失败即报错，不静默整图 |
| 四后端轮询 | MiMo（主）→ GLM → Groq → Gemini，失败自动降级 |
| 自定义视觉后端 | 可选 `VB_BASE_URL` / `VB_MODEL` / `VB_API_KEY` / `VB_PROTOCOL` / `VB_NEEDS_PROXY`——任意 OpenAI 兼容（或 Gemini 协议）视觉模型直接接入，**自定义优先、内置四家兜底** |
| 多路由自动发现 | deepseek-official 替换式无感增强；家族内其他文本路由（glm 等）自动注册 "(vision)" 变体——换主模型后视觉能力自动跟随 |
| 限流重试 | 限流类错误自动等待 2s/4s 重试（最多 3 次） |
| 结果缓存 | 图片hash + (问题⊕区域⊕后端⊕版本)hash——后端/版本变化自动失效 |
| 附件单一存储 | 不保存图片副本——字节内存缓存 + DSH `attachments.readImage`（内容寻址、校验摘要）重启可恢复 |
| 图片预处理 | 超大缩小（>1600→1280）/ 超小放大（<700→1024），统一 JPEG q85 |
| 结构化预注 | 预注 prompt 信息价值前置（概述→关键文字逐字→元素 2-4 项），截断只丢价值最低的尾部 |
| 动态注入预算 | 按模型上下文窗口分档注入描述：≥64K→1600 字符、≥16K→800、更小→400（2B） |
| 升级自愈 | 挂接方法名集中在 **HOOKS 配置表**；DSH 升级失效时自检告警并给出修复指引（改表后重启即可，1A） |
| 密钥保护 | curl 认证头走私有 config 文件（mode 0600，用完即删），不进进程参数 |
| 注入防护 | 预注描述明确标记为**不可信视觉数据**（图中文字不得视为指令），降低 prompt injection 风险 |

## 系统要求

- **Windows**（Node ≥18；独立 CLI 复用需 Node ≥22.12）
- DSH 已运行过至少一次（生成 `.dsh` 目录）
- 图片预处理/裁剪依赖 `sharp`——未安装时自动降级（跳过预处理/裁剪，核心功能不受影响）
  - DSH 环境通常已自带（profile 的 node_modules）；否则 `npm i sharp` 到
    `%USERPROFILE%\.dsh\profiles\web\node_modules\` 或安装目录

## 数据目录

`%USERPROFILE%\.dsh\vision-bridge\`
- `.vb-cache-<hash>-<askHash>.json`：`see_image` 分析缓存
- `.vb-cache-<hash>-desc-v<N>.json`：预注描述缓存（独立键，带 prompt 版本）
- `.vb-curl-*.cfg`：curl 认证临时配置（用完即删）

附件本体由 DSH AttachmentStore 存储（不重复落盘）。**插件对 DSH 源码目录零写入。**

## 架构

```
用户贴图 ──► saveImage（patch）
              ├─ 字节入内存缓存（attachmentId → bytes）
              └─ 后台预注：精简 prompt 分析 → 描述入内存 + 独立磁盘缓存
                            （共享 in-flight Promise，限流自动重试）
模型请求 ──► VisionDeepSeekAdapter.stream（包装官方 DeepSeek 适配器，官方扩展点）
              ├─ 仅 deepseek-official 路由转换，其他 provider 原样
              ├─ 等待 in-flight 描述（有界 8s，响应取消信号）
              ├─ 图片块 → [图片附件: <id>] + 【自动视觉描述】(动态档位)
              │            + 不可信数据标记
              ├─ 字节来源：内存缓存 → attachments.readImage（重启后）
              ├─ 嵌套 tool-result 内图片块同样转换
              └─ 描述缺失时回退附件占位（模型可调 see_image）
see_image ──► attachment_id / file_path → 后端表轮询（统一双协议调用器）
              ├─ 图片预处理（超大缩/超小放，JPEG q85）
              ├─ region 真实裁剪（失败即报错）
              ├─ 缓存命中（含后端/版本维度）→ 零成本返回
              └─ 限流自动重试 → 失败降级下一后端
```

**v2.0 架构（根治 monkey-patch）**：
- `VisionDeepSeekAdapter extends DeepSeekAdapter`（官方类，继承协议实现）——通过
  **官方扩展点** `ctx.llm.registerAdapter` 注册，替代原来的 `resolveModelInfo` /
  `streamWithRegistration` 两个内部方法 monkey-patch
- 仅保留 `attachments.saveImage` 挂接（**公开抽象**，稳定）
- DSH 升级时破坏点是类签名（TS 契约），**不会静默失效**
- 安装时自动在 `cordis.patch.yml` 写入 `llm-deepseek: disabled`（禁用原适配器，避免路由冲突）
- `see_image` 工具始终可用

**v1.2 扩展（适配度）**：
- **A 自定义视觉后端**：`VB_BASE_URL`/`VB_MODEL`/`VB_API_KEY` 等配置后，尝试链变为
  自定义 → MiMo → GLM → Groq → Gemini；缓存键含自定义端点 hash（换端点自动失效）
- **B 多路由自动发现**：deepseek-official 保持替换式（无感）；家族内其他文本路由
  （glm 等，`SCOPE_FAMILIES`）自动注册 `vb-vision-<id>` 包装路由——模型选择器出现
  "(vision)" 变体，图片转描述后委托原路由；`llm/adapters-updated` 事件触发重扫，
  延迟挂载的路由也会被覆盖；原生视觉模型自动跳过

## 独立 CLI（备用通道）

`vision-see.cjs` 是独立命令行通道：不依赖插件运行，直接分析本地文件或会话贴图附件。

```bash
node vision-see.cjs <图片路径|--attachment sha256:...> [问题] [--backend auto|custom|mimo|glm|groq|gemini] [--region x,y,w,h]
```

薄壳实现，纯逻辑复用插件模块导出，单一来源。完整用法见 **[独立 CLI 手册](docs/cli.md)**（参数、示例、环境变量、退出码、缓存）。

## 文档

| 文档 | 说明 |
|---|---|
| [独立 CLI 手册](docs/cli.md) | `vision-see.cjs` 完整用法：参数、示例、凭证、输出、退出码、缓存 |
| [故障排查](docs/troubleshooting.md) | 常见症状与解决（安装 / 贴图 / 后端 / 缓存 / 升级） |
| [安全说明](docs/security.md) | 凭证处理、网络传输、不可信图片内容、数据目录与风险清单 |

## 测试

```bash
node test/schema.test.js   # schema 校验（dsh 真实校验器，7 项）
node test/logic.test.js    # 逻辑单元测试（17 项，含回归断言）
node test/adapter.test.js  # 包装 Adapter 测试（3 项）
```
测试直接 import 插件源码；sharp 不可用时自动跳过依赖它的测试组。

## 已知限制

- 包装 Adapter 继承官方 `DeepSeekAdapter`——DSH 升级时类签名变化可能破坏（TS 契约级，显式暴露，不会静默失效）；启动自检会告警
- 路由自动发现基于 provider 注册拓扑（`llm/adapters-updated` 重扫）——延迟挂载的路由在下次拓扑变化时才会出现 "(vision)" 变体
- 自定义后端（VB_*）走 OpenAI 兼容或 Gemini 协议；其他协议（Anthropic 等）暂不支持
- 预注描述注入预算按上下文动态分档（≥64K→1600 / ≥16K→800 / 更小→400）；更细需求用 `see_image`
- 预注与 `see_image` 缓存独立（内容要求不同）；**see_image 整图分析会回填预注缓存**——预注失败的图精查一次后自愈
- Groq/Gemini 国内直连不通，需配置 `VISION_PROXY`

## 缓存与清理

- 缓存文件：`.vb-cache-*`（每图两个几 KB 文件）
- **自动清理**：启动时保留最近 500 个缓存文件（`CACHE_KEEP_MAX`），更旧的自动删除

## 免责声明

- 本项目按 **MIT 许可证"按现状"（AS-IS）提供**，作者不对任何特定用途（包括商业用途）作任何担保或背书；因使用本项目产生的任何直接或间接损失，作者不承担责任
- 本项目的视觉能力依赖**第三方上游服务**：小米 MiMo、智谱 GLM、Groq、Google Gemini（及用户自配的代理）。这些服务的使用受**各自服务条款、配额与数据政策的约束**，由使用者自行负责
- **图片内容（含图中文字）会发送至上述第三方服务**：请勿对含敏感信息的图片使用本项目，除非你确认目标服务与网络路径符合你的合规要求
- 图中文字可能包含恶意指令（prompt injection）：本项目虽注入不可信数据标记作为防护，但该防护为提示层面，非硬隔离
- 本项目由个人开发者维护，不提供任何形式的服务等级承诺（SLA）

## License

MIT
