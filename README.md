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
├── test/               # schema(7) + logic(15) + adapter(3) 单元测试
├── vision-see.cjs       # 独立 CLI（分析文件或贴图附件）
├── install.js          # 一键安装脚本（复制 + patch + 校验）
├── package.json        # v1.0.0，MIT
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
MIMO_API_KEY: <小米 MiMo-V2.5，主后端，直连，¥1/MTok>
GLM_API_KEY: <智谱 GLM-4.6V-Flash，免费直连>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b，免费，需代理>
GEMINI_API_KEY: <Gemini gemini-flash-latest，需代理>
VISION_PROXY: http://127.0.0.1:7890   # 仅 Groq/Gemini 需要（国内网络）
```

**3. 重启 DSH**。启动日志出现 `[vision-bridge] 原生图片通道挂接完成` 即生效。

> 最少只需 `MIMO_API_KEY` 一个 key 即可使用（其余为兜底冗余）。

## 能力

| 能力 | 说明 |
|---|---|
| 原生贴图 | 粘贴/拖拽图片进聊天框，缩略图正常显示，不再报"模型不支持图片" |
| 预注式视觉 | 图片上传后**后台立即生成描述**（限流自动重试）；模型请求**等待 in-flight 描述完成**（有界 8s）——模型天然"看见"，无竞态 |
| `see_image` 工具 | 按需精查：OCR / 布局 / 定向问题 / 区域聚焦（真实裁剪）；支持 `attachment_id` 或 `file_path` |
| region 真实裁剪 | 归一化坐标 → sharp 裁剪放大到 1280px；失败即报错，不静默整图 |
| 四后端轮询 | MiMo（主）→ GLM → Groq → Gemini，失败自动降级 |
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

## 独立 CLI（备用通道）

```bash
# 分析本地文件
node vision-see.cjs <图片路径> [问题] [--backend mimo|glm|groq|gemini|auto] [--region x,y,w,h]
# 直接分析会话贴图附件（主会话直达，无需子代理/插件工具）
node vision-see.cjs --attachment sha256:xxx... [问题] [--backend ...] [--region ...]
```
薄壳实现，纯逻辑复用插件模块导出，单一来源。支持 `DSH_HOME` 与 `VB_PLUGIN_PATH` 环境变量；
`--attachment` 从 DSH 附件存储读取贴图（`<DSH_HOME>/attachments/v1/objects/<前2位>/<完整hash>`，魔数探测 MIME）。

## 测试

```bash
node test/schema.test.js   # schema 校验（dsh 真实校验器，7 项）
node test/logic.test.js    # 逻辑单元测试（15 项，含回归断言）
node test/adapter.test.js  # 包装 Adapter 测试（3 项）
```
测试直接 import 插件源码；sharp 不可用时自动跳过依赖它的测试组。

## 已知限制

- 包装 Adapter 继承官方 `DeepSeekAdapter`——DSH 升级时类签名变化可能破坏（TS 契约级，显式暴露，不会静默失效）；启动自检会告警
- 预注描述注入预算按上下文动态分档（≥64K→1600 / ≥16K→800 / 更小→400）；更细需求用 `see_image`
- 预注与 `see_image` 缓存独立（内容要求不同）；**see_image 整图分析会回填预注缓存**——预注失败的图精查一次后自愈
- Groq/Gemini 国内直连不通，需配置 `VISION_PROXY`

## 缓存与清理

- 缓存文件：`.vb-cache-*`（每图两个几 KB 文件）
- **自动清理**：启动时保留最近 500 个缓存文件（`CACHE_KEEP_MAX`），更旧的自动删除

## License

MIT
