# 独立 CLI 手册（vision-see.cjs）

> English: [CLI Manual](cli.en.md)　|　简体中文（当前）

`vision-see.cjs` 是 Vision Bridge 的**独立命令行通道**：不依赖 DSH 插件运行，
直接读取图片（本地文件或会话贴图附件）并调用视觉后端返回描述。它复用插件模块
（`lib/index.js`）导出的纯逻辑——后端表、prompt、缓存键、图片预处理、region 裁剪
——单一代码来源，不重复维护。

适用场景：

- DSH 之外想直接看一张图（脚本、管道、临时分析）
- 调试 / 对比后端输出（指定 `--backend`）
- 子代理或外部程序需要视觉能力，而不想经过模型工具层

## 系统要求

- **Windows**（Node ≥ 22.12 建议；`sharp` 可用时启用预处理/裁剪，缺失时自动降级）
- 已配置至少一个视觉后端凭证（见下文"凭证"）
- `C:\Windows\System32\curl.exe`（系统自带）用于 API 传输

## 用法

```
node vision-see.cjs <图片路径 | --attachment sha256:...> [问题] [选项]
```

### 参数

| 参数 | 说明 |
|---|---|
| `<图片路径>` | 本地图片文件（png / jpg / jpeg / webp / gif / bmp；也支持 `data:image/...` 文本） |
| `--attachment sha256:...` | 改为读取 DSH 会话贴图附件（从附件存储按内容寻址读取，魔数探测格式） |
| `[问题]` | 可选的自然语言问题，附加到分析 prompt（如 `"图表纵轴是什么？"`） |
| `--backend <name>` | 指定后端：`mimo` \| `glm` \| `groq` \| `gemini` \| `auto`（默认 `auto`，按序 failover） |
| `--region x,y,w,h` | 真实裁剪区域（归一化坐标 0-1），例如 `0.1,0.2,0.4,0.3`；失败即报错 |

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_HOME` | DSH 数据目录（默认 `%USERPROFILE%\.dsh`），用于读取凭证与附件存储 |
| `VB_PLUGIN_PATH` | 插件 `lib/index.js` 的显式路径（默认依次尝试：DSH profile 安装副本 → 仓库自身） |

## 示例

```bash
# 1. 分析本地文件
node vision-see.cjs screenshot.png

# 2. 带问题
node vision-see.cjs screenshot.png "图表纵轴单位是什么？"

# 3. 只用一个后端
node vision-see.cjs photo.jpg "描述这张照片" --backend mimo

# 4. 聚焦区域（真实裁剪后分析）
node vision-see.cjs screenshot.png --region 0.1,0.2,0.4,0.3

# 5. 直接分析会话贴图附件（无需把图导出成文件）
node vision-see.cjs --attachment sha256:3f2a... "界面上的错误提示是什么？"
```

## 凭证

从 `%USERPROFILE%\.dsh\.credentials.yaml`（或 `$DSH_HOME` 下）读取：

```yaml
MIMO_API_KEY: <小米 MiMo-V2.5，主后端，直连>
GLM_API_KEY: <智谱 GLM-4.6V-Flash，免费直连>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b，免费，需代理>
GEMINI_API_KEY: <Gemini gemini-flash-latest，需代理>
VISION_PROXY: http://127.0.0.1:7890   # 仅 Groq/Gemini 需要
```

最少只需 `MIMO_API_KEY` 一个即可运行；其余为 failover 兜底。
缺凭证时报错：`未找到 <keyNames> 凭证（检查 .../.credentials.yaml）`。

## 输出格式

成功时两行：

```
[backend: mimo]     ← 实际使用的后端；命中缓存时为 [backend: cache]
<分析结果文本>
```

失败时以 `VISION_ERROR: <原因>` 输出到 stderr。

## 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功（含缓存命中） |
| 1 | 运行错误（凭证缺失 / 后端全部失败 / 图片无效等） |
| 2 | 用法错误（缺图片参数） |

## 缓存

- 缓存文件：附件 → `%USERPROFILE%\.dsh\vision-bridge\.att-<id>.vb-see.cache.json`；
  本地文件 → `<图片路径>.vb-see.cache.json`
- 命中条件：图片内容 hash + 问题/区域/后端/版本 hash 全部一致
- 命中后**不再调用任何 API**（输出 `[backend: cache]`）
- 清缓存：删除对应 `.vb-see.cache.json` 即可

## 错误与重试

- **网络**：curl 超时 150s；失败即报错，不自动换后端时按 `auto` 顺序轮询
- **限流**：429 类错误自动等待 2s / 4s 重试，最多 3 次，仍失败则降级下一后端
- **所有后端失败**：汇总每次尝试的错误后以 `VISION_ERROR: 所有视觉后端均失败: ...` 退出

## 与 `see_image` 工具的关系

- `see_image` 是 DSH 模型可直接调用的工具（按附件 ID 或文件路径精查）
- CLI 是同一套逻辑的独立入口，适合人在终端直接用
- 两者共享后端表、prompt、缓存键、预处理逻辑，但**缓存文件独立**
  （CLI 用 `.vb-see.cache.json`，插件用 `.vb-cache-*`），互不干扰
