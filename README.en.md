# Vision Bridge

Full vision capability for text-only models (e.g. `deepseek-v4-flash`) on DeepSeek Harness (Windows).

**Core idea**: images never enter the model input (the DeepSeek adapter rejects image blocks at the code level). Instead — images render normally in the conversation (UI feels like a native vision model), and the model context receives **automatically pre-injected text descriptions + image attachment references**. For details, use the `see_image` tool with the attachment ID.

**Scope**: only rewrites image requests on the `deepseek-official` (text-only) route. Any other provider (including native vision models) passes through untouched.

**Design principle — zero UI intrusion**: this plugin **registers no browser panels, Settings sections, or tool cards** — the DSH web UI stays completely untouched. The entire configuration surface is a single file (`.credentials.yaml`), and installation only writes two lines into `cordis.patch.yml` (mount + disable the original adapter). That buys: no UI-breakage risk on DSH upgrades, minimal compatibility surface with DSH versions, and the lowest mental load for users — paste and go, no settings page to explore. The honest cost: there is no visual configuration page yet; changing configuration (e.g. the custom backend `VB_*`) means editing the yaml file.

**Implementation — a wrapper around the official adapter**: built by extending DeepSeek's official `DeepSeekAdapter` and registered through the **official extension point** `ctx.llm.registerAdapter` — **no monkey-patching of internal methods**. Three pieces work together for "invisible pre-injection":

1. `resolveModel` declares image input on text-only models (passes DSH admission checks, so pasted images enter the session)
2. The `saveImage` hook translates every image into a description in the background (multi-backend failover + caching + rate-limit retry)
3. `stream` swaps image blocks for the generated description before forwarding the request (waits for in-flight descriptions, bounded 8s), then delegates to the official implementation

The wire protocol (SSE framing, serialization, retry policy) is fully inherited from the official class — a DSH upgrade breaks at the class signature (a TS contract), the startup self-check warns, **never silently**.

> 中文文档：[README.md](README.md)

## Quick Start (3 steps)

**1. Install** (run inside the plugin directory, Node ≥18):

```powershell
node install.js            # installs into the default profile (web)
node install.js headless   # or specify another profile
```

**2. Configure API keys** (edit `%USERPROFILE%\.dsh\.credentials.yaml`):

```yaml
# Built-in backends (only MIMO_API_KEY is required; the rest are fallback redundancy)
MIMO_API_KEY: <Xiaomi MiMo-V2.5, primary backend, direct, ¥1/MTok>
GLM_API_KEY: <Zhipu GLM-4.6V-Flash, free, direct>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b, free, requires proxy>
GEMINI_API_KEY: <Gemini gemini-flash-latest, requires proxy>
VISION_PROXY: http://127.0.0.1:7890   # only needed for Groq/Gemini (mainland-China networks)

# Optional: custom vision backend — when set, custom goes first, built-ins back it up
VB_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions  # any OpenAI-compatible endpoint
VB_MODEL: qwen3-vl-plus
VB_API_KEY: sk-xxx
# VB_PROTOCOL: openai      # openai (default) | gemini
# VB_NEEDS_PROXY: true     # true → route through VISION_PROXY
```

**3. Restart DSH**. You are up once the startup log shows `[vision-bridge] native image channel ready`.

### Where to get API keys (for the fields above)

| Backend | Where to get it | Notes |
|---|---|---|
| MiMo (primary) | [mimo.mi.com](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call) | Xiaomi MiMo open platform — sign up/log in, create an API key, free quota available |
| GLM | [open.bigmodel.cn](https://open.bigmodel.cn/) | Zhipu AI open platform — free quota on signup (GLM-4.6V-Flash is free) |
| Groq | [console.groq.com](https://console.groq.com/) | Free signup, proxy required |
| Gemini | [aistudio.google.com](https://aistudio.google.com/) | Google AI Studio — free key in ~3 minutes, proxy required |
| VISION_PROXY | your own | Proxy address for reaching Groq/Gemini from mainland-China networks (e.g. Clash's `http://127.0.0.1:7890`) |
| Custom endpoint | your own service console | e.g. Alibaba DashScope, OpenRouter, self-hosted vLLM/Ollama API key |

> Only `MIMO_API_KEY` is required to use the plugin; the rest are fallback redundancy.
> With a complete `VB_*` config, vision requests **prefer your endpoint**; the four built-ins are fallback only.

## Features

| Feature | Description |
|---|---|
| Native image attach | Paste/drag images into the chat; thumbnails render; no more "model does not support images" |
| Pre-injected vision | Every uploaded image is described in the background; model requests wait for the description (bounded 8s) — the model "sees" in its very first response, no race |
| `see_image` tool | On-demand deep analysis: OCR / layout / targeted questions / region focus (real cropping); accepts `attachment_id` or `file_path`, backend selectable |
| Four-backend failover | MiMo → GLM → Groq → Gemini with automatic degradation; rate-limit backoff retries (max 3) |
| Custom vision backend | `VB_*` plugs in any OpenAI-compatible (or Gemini-protocol) vision model — **custom first, four built-ins as fallback** |
| Auto-discovered vision routes | Vision follows your main model: other text-only routes get a "(vision)" variant automatically (native vision models are skipped) |
| Result caching | Full-dimension cache (image + question/region/backend/custom endpoint/version); auto-cleanup (keeps newest 500); repeated reads cost nothing |
| Key protection | API keys go through a private temp config file (mode 0600, deleted after use) — never in process args or logs |
| Injection defense | Pre-injected descriptions are marked **untrusted visual data** (text inside images must not be treated as instructions) |
| Upgrade self-healing | If a DSH upgrade breaks a hook, the startup self-check warns loudly with repair guidance — never silent |
| Standalone CLI | `vision-see.cjs` reads images from the command line (local file or chat attachment) without the plugin |

## Requirements

- **Windows** (Node ≥18; standalone CLI reuse needs Node ≥22.12)
- DSH must have run at least once (creates the `.dsh` directory)
- Preprocessing/cropping use `sharp` — auto-degrades (core vision unaffected) when unavailable;
  DSH environments usually bundle it; otherwise `npm i sharp` into the profile `node_modules`

## Standalone CLI (backup channel)

```bash
node vision-see.cjs <image-path|--attachment sha256:...> [question] [--backend auto|custom|mimo|glm|groq|gemini] [--region x,y,w,h]
```

Full usage: **[CLI Manual](docs/cli.en.md)**.

## Documentation

| Doc | Read it when |
|---|---|
| [CLI Manual](docs/cli.en.md) | Arguments, examples, credentials, exit codes, caching |
| [Troubleshooting](docs/troubleshooting.en.md) | Common symptoms and fixes |
| [Security](docs/security.en.md) | Credential handling, network traffic, untrusted image content, risk list |

## Known Limitations

- Pre-injection budget is context-window tiered (≥64K → 1600 / ≥16K → 800 / smaller → 400); use `see_image` for deeper needs
- Custom backends (VB_*) support the OpenAI-compatible or Gemini protocol; other protocols (Anthropic etc.) are not supported yet
- Route discovery follows the provider topology — late-mounted routes get their "(vision)" variant on the next topology change
- Groq/Gemini are not directly reachable from mainland-China networks; configure `VISION_PROXY`

## Disclaimer

- This project is provided **"AS-IS" under the MIT License**; the author makes no warranty and gives no endorsement for any particular use (commercial use included), and accepts no liability for any direct or indirect damages arising from its use.
- Vision capability depends on **third-party upstream services**: Xiaomi MiMo, Zhipu GLM, Groq, Google Gemini (and any proxy or custom endpoint you configure). Their use is governed by **each service's own terms, quotas, and data policies**, for which you are responsible.
- **Image content (including text inside images) is sent to those third-party services**: do not use this project with sensitive images unless the target services and network path meet your compliance requirements.
- Text inside images may contain malicious instructions (prompt injection): this project injects an untrusted-data marker as defense, but it is prompt-level protection, not hard isolation.
- Maintained by an individual developer; no service-level agreement (SLA) of any kind is provided.

## License

MIT
