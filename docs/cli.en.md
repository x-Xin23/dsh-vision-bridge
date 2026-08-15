# CLI Manual (vision-see.cjs)

> 简体中文：[CLI 手册](cli.md)　|　English (current)

`vision-see.cjs` is the **standalone CLI** of Vision Bridge: it does not require the DSH plugin to run — it reads an image (a local file or a chat attachment) and returns a description from the vision backends. It reuses the pure logic exported by the plugin module (`lib/index.js`) — backend table, prompt, cache keys, image preprocessing, region cropping — so there is a single source of truth, no duplicated maintenance.

Use cases:

- Look at an image directly outside DSH (scripts, pipelines, ad-hoc analysis)
- Debug / compare backends (pin one with `--backend`)
- Give vision to sub-agents or external programs without going through the model tool layer

## Requirements

- **Windows** (Node ≥ 22.12 recommended; preprocessing/cropping use `sharp` when available and degrade automatically otherwise)
- At least one vision backend credential configured (see "Credentials" below)
- `C:\Windows\System32\curl.exe` (bundled with Windows) for API transport

## Usage

```
node vision-see.cjs <image-path | --attachment sha256:...> [question] [options]
```

### Arguments

| Argument | Description |
|---|---|
| `<image-path>` | Local image file (png / jpg / jpeg / webp / gif / bmp; `data:image/...` text also accepted) |
| `--attachment sha256:...` | Read a DSH chat attachment instead (content-addressed from the attachment store, magic-byte MIME detection) |
| `[question]` | Optional natural-language question appended to the analysis prompt (e.g. `"What is the y-axis unit?"`) |
| `--backend <name>` | Pin backend: `auto` \| `custom` \| `mimo` \| `glm` \| `groq` \| `gemini` (default `auto`: custom (VB_*) first → sequential failover; `custom` uses only the custom endpoint) |
| `--region x,y,w,h` | Real crop region (normalized 0-1), e.g. `0.1,0.2,0.4,0.3`; fails loudly on invalid input |

### Environment variables

| Variable | Description |
|---|---|
| `DSH_HOME` | DSH data directory (default `%USERPROFILE%\.dsh`); used for credentials and the attachment store |
| `VB_PLUGIN_PATH` | Explicit path to the plugin `lib/index.js` (default search order: DSH profile install → this repo) |

## Examples

```bash
# 1. Analyze a local file
node vision-see.cjs screenshot.png

# 2. With a question
node vision-see.cjs screenshot.png "What is the y-axis unit?"

# 3. Pin a single backend
node vision-see.cjs photo.jpg "describe this photo" --backend mimo

# 4. Focus a region (real crop before analysis)
node vision-see.cjs screenshot.png --region 0.1,0.2,0.4,0.3

# 5. Analyze a chat attachment directly (no file export needed)
node vision-see.cjs --attachment sha256:3f2a... "What error is shown?"
```

## Credentials

Read from `%USERPROFILE%\.dsh\.credentials.yaml` (or under `$DSH_HOME`):

```yaml
MIMO_API_KEY: <Xiaomi MiMo-V2.5, primary backend, direct>
GLM_API_KEY: <Zhipu GLM-4.6V-Flash, free, direct>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b, free, requires proxy>
GEMINI_API_KEY: <Gemini gemini-flash-latest, requires proxy>
VISION_PROXY: http://127.0.0.1:7890   # only needed for Groq/Gemini

# Optional: custom vision backend (used first when complete; --backend custom forces it)
VB_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
VB_MODEL: qwen3-vl-plus
VB_API_KEY: sk-xxx
# VB_PROTOCOL: openai    # openai (default) | gemini
# VB_NEEDS_PROXY: true
```

Only `MIMO_API_KEY` is required; the rest are failover redundancy.
Missing credentials produce: `未找到 <keyNames> 凭证（检查 .../.credentials.yaml）`.

**Where to get keys**: MiMo → [mimo.mi.com](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call) ｜
GLM → [open.bigmodel.cn](https://open.bigmodel.cn/) ｜
Groq → [console.groq.com](https://console.groq.com/) (proxy required) ｜
Gemini → [aistudio.google.com](https://aistudio.google.com/) (proxy required) ｜
Custom endpoint → your own service console.

## Output format

On success, two lines:

```
[backend: mimo]     ← backend actually used; [backend: cache] on cache hit
<analysis text>
```

On failure, `VISION_ERROR: <reason>` is written to stderr.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (including cache hit) |
| 1 | Runtime error (missing credentials / all backends failed / invalid image, etc.) |
| 2 | Usage error (no image argument) |

## Caching

- Cache files: attachments → `%USERPROFILE%\.dsh\vision-bridge\.att-<id>.vb-see.cache.json`;
  local files → `<image-path>.vb-see.cache.json`
- Hit condition: image content hash + question/region/backend/version hash all match
- On hit, **no API is called** (output `[backend: cache]`)
- To clear: delete the matching `.vb-see.cache.json`

## Errors and retries

- **Network**: curl timeout 150s; on failure the `auto` chain moves to the next backend
- **Rate limit**: 429-class errors wait 2s / 4s and retry, up to 3 times; then fall through to the next backend
- **All backends failed**: exits with `VISION_ERROR: 所有视觉后端均失败: <per-backend errors>`

## Relationship with the `see_image` tool

- `see_image` is the tool DSH models can call directly (deep analysis by attachment ID or file path)
- The CLI is an independent entry point to the same logic, for use from a terminal
- Both share the backend table, prompt, cache keys and preprocessing, but **cache files are separate**
  (CLI: `.vb-see.cache.json`; plugin: `.vb-cache-*`) — they do not interfere
