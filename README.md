# Vision Bridge

给 DeepSeek Harness（Windows）上的纯文本模型（如 deepseek-v4-flash）提供完整视觉能力。

> **English**: [README.en.md](README.en.md)　|　简体中文（当前）

**核心思路**：图片不进入模型输入（DeepSeek 适配器在代码层面拒绝图片块），而是——
图片在会话里正常显示（UI 观感与原生视觉模型一致），模型上下文中收到的是
**自动预注的描述文本 + 图片附件引用**，需要细节时用 `see_image` 工具按附件 ID 精查。

**作用域**：仅重写 `deepseek-official`（纯文本）路由的图片请求；切换到任何其他
provider（含原生视觉模型）时原样放行。

**设计原则——零 UI 侵入**：本插件**不注册任何浏览器面板、Settings 段或工具卡片**，
DSH 的 Web 界面零改动。视觉能力的全部配置面只有一个文件（`.credentials.yaml`），
安装只写入 `cordis.patch.yml` 两行（挂载 + 禁用原适配器）。这样换来：
升级 DSH 无界面破裂风险、与 DSH 版本的兼容面最小、用户心智负担最低——粘贴即用，
没有"设置页"要逛。代价（如实）：暂无可视化配置页面，改配置（如自定义后端 `VB_*`）
需编辑 yaml 文件。

**实现方式——包装官方适配器**：基于 DeepSeek 官方 `DeepSeekAdapter` 继承实现，
通过**官方扩展点** `ctx.llm.registerAdapter` 注册，**不 monkey-patch 任何内部方法**。
三处配合完成"无感预注入"：

1. `resolveModel` 为纯文本模型声明图片输入能力（通过 DSH 准入检查，贴图可进会话）
2. `saveImage` 钩子在图片保存时**后台翻译成描述**（多后端 failover + 缓存 + 限流重试）
3. `stream` 在请求转发前把图片块替换为已生成的描述文本（等待 in-flight 描述，有界 8s），再委托官方实现

协议实现（SSE 分帧、序列化、重试策略）全部继承官方——DSH 升级的破坏点是类签名
（TS 契约），启动自检告警，**不会静默失效**。

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

# 可选：自定义视觉后端——填了就走自定义优先、内置兜底
VB_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions  # 任意 OpenAI 兼容端点
VB_MODEL: qwen3-vl-plus
VB_API_KEY: sk-xxx
# VB_PROTOCOL: openai      # openai（默认）| gemini
# VB_NEEDS_PROXY: true     # true 时走 VISION_PROXY
```

**3. 重启 DSH**。启动日志出现 `[vision-bridge] 原生图片通道挂接完成` 即生效。

### 获取 API key（对应上面各字段）

| 后端 | 获取地址 | 说明 |
|---|---|---|
| MiMo（主） | [mimo.mi.com](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call) | 小米 MiMo 开放平台，注册/登录后创建 API key，有免费额度 |
| GLM | [open.bigmodel.cn](https://open.bigmodel.cn/) | 智谱 AI 开放平台，注册即送免费额度（GLM-4.6V-Flash 免费） |
| Groq | [console.groq.com](https://console.groq.com/) | 免费注册，需代理访问 |
| Gemini | [aistudio.google.com](https://aistudio.google.com/) | Google AI Studio，免费 key（3 分钟），需代理访问 |
| VISION_PROXY | 自备 | 国内网络访问 Groq/Gemini 用的代理地址（如 Clash 的 `http://127.0.0.1:7890`） |
| 自定义端点 | 你自己的服务控制台 | 如阿里云百炼、OpenRouter、自建 vLLM/Ollama 的 API key |

> 最少只需 `MIMO_API_KEY` 一个 key 即可使用（其余为兜底冗余）。
> 自定义后端（`VB_*`）配置完整后，视觉请求**优先走你的端点**，内置四家仅作兜底。

## 能力

| 能力 | 说明 |
|---|---|
| 原生贴图 | 粘贴/拖拽图片进聊天框，缩略图正常显示，不再报"模型不支持图片" |
| 预注式视觉 | 图片上传后**后台立即生成描述**；模型请求等待描述完成（有界 8s）——模型首轮就"看见"，无竞态 |
| `see_image` 工具 | 按需精查：OCR / 布局 / 定向问题 / 区域聚焦（真实裁剪）；支持 `attachment_id` 或 `file_path`，可指定后端 |
| 四后端 failover | MiMo → GLM → Groq → Gemini 自动降级；限流自动等待重试（最多 3 次） |
| 自定义视觉后端 | `VB_*` 配置任意 OpenAI 兼容（或 Gemini 协议）视觉模型——**自定义优先、内置四家兜底** |
| 多路由自动发现 | 换主模型后视觉自动跟随：其他文本路由自动出现 "(vision)" 变体（原生视觉模型自动跳过） |
| 结果缓存 | 图片 + 问题/区域/后端/自定义端点/版本全维度缓存；自动清理（保留最近 500 个），重复看图零成本 |
| 密钥保护 | API key 走私有临时 config 文件（mode 0600，用完即删），不进进程参数、不进日志 |
| 注入防护 | 预注描述标记为**不可信视觉数据**（图中文字不得视为指令），降低 prompt injection 风险 |
| 升级自愈 | DSH 升级导致挂接失效时启动自检告警并给出修复指引，不静默失败 |
| 独立 CLI | `vision-see.cjs` 命令行直接看图（本地文件或会话附件），不依赖插件运行 |

## 系统要求

- **Windows**（Node ≥18；独立 CLI 复用需 Node ≥22.12）
- DSH 已运行过至少一次（生成 `.dsh` 目录）
- 图片预处理/裁剪依赖 `sharp`——未安装时自动降级（核心看图功能不受影响）；
  DSH 环境通常已自带，否则 `npm i sharp` 到 profile 的 node_modules

## 独立 CLI（备用通道）

```bash
node vision-see.cjs <图片路径|--attachment sha256:...> [问题] [--backend auto|custom|mimo|glm|groq|gemini] [--region x,y,w,h]
```

完整用法见 **[独立 CLI 手册](docs/cli.md)**。

## 文档

| 文档 | 说明 |
|---|---|
| [独立 CLI 手册](docs/cli.md) | 参数、示例、凭证、退出码、缓存 |
| [故障排查](docs/troubleshooting.md) | 常见症状与解决 |
| [安全说明](docs/security.md) | 凭证处理、网络传输、不可信图片内容、风险清单 |

## 已知限制

- 预注描述注入预算按上下文动态分档（≥64K→1600 / ≥16K→800 / 更小→400）；更细需求用 `see_image`
- 自定义后端（VB_*）支持 OpenAI 兼容或 Gemini 协议；其他协议（Anthropic 等）暂不支持
- 路由自动发现基于 provider 注册拓扑——延迟挂载的路由在下次拓扑变化时才出现 "(vision)" 变体
- Groq/Gemini 国内直连不通，需配置 `VISION_PROXY`

## 免责声明

- 本项目按 **MIT 许可证"按现状"（AS-IS）提供**，作者不对任何特定用途（包括商业用途）作任何担保或背书；因使用本项目产生的任何直接或间接损失，作者不承担责任
- 本项目的视觉能力依赖**第三方上游服务**：小米 MiMo、智谱 GLM、Groq、Google Gemini（及用户自配的代理/自定义端点）。这些服务的使用受**各自服务条款、配额与数据政策的约束**，由使用者自行负责
- **图片内容（含图中文字）会发送至上述第三方服务**：请勿对含敏感信息的图片使用本项目，除非你确认目标服务与网络路径符合你的合规要求
- 图中文字可能包含恶意指令（prompt injection）：本项目虽注入不可信数据标记作为防护，但该防护为提示层面，非硬隔离
- 本项目由个人开发者维护，不提供任何形式的服务等级承诺（SLA）

## License

MIT
