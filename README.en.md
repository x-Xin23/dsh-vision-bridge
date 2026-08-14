# Vision Bridge

Full vision capability for text-only models (e.g. `deepseek-v4-flash`) on DeepSeek Harness (Windows).

**Core idea**: images never enter the model input (the DeepSeek adapter rejects image blocks at the code level). Instead — images render normally in the conversation (UI feels like a native vision model), and the model context receives **automatically pre-injected text descriptions + image attachment references**. For details, use the `see_image` tool with the attachment ID.

**Scope**: only rewrites image requests on the `deepseek-official` (text-only) route. Any other provider (including native vision models) passes through untouched.

**Design principle — zero UI intrusion**: this plugin **registers no browser panels, Settings sections, or tool cards** — the DSH web UI stays completely untouched. The entire configuration surface is a single file (`.credentials.yaml`), and installation only writes two lines into `cordis.patch.yml` (mount + disable the original adapter). That buys: no UI-breakage risk on DSH upgrades, minimal compatibility surface with DSH versions, and the lowest mental load for users — paste and go, no settings page to explore. The honest cost: there is no visual configuration page yet; changing configuration (e.g. the custom backend `VB_*`) means editing the yaml file.

> 中文文档：[README.md](README.md)

## Repository Layout

```
vision-bridge/
├── lib/
│   ├── index.js        # Plugin main file (backend table + pure-function exports + apply)
│   ├── adapter.js      # VisionDeepSeekAdapter (wraps the official adapter via the official extension point)
│   └── dsh-pkg.js      # DSH package loader (package-name / DSH-home dual path resolution)
├── test/               # Unit tests: schema(7) + logic(17) + adapter(3)
├── docs/               # cli / troubleshooting / security (bilingual)
├── vision-see.cjs      # Standalone CLI (analyzes files or chat attachments)
├── install.js          # One-command install (copy + patch + verify)
├── package.json        # v1.2.0, MIT
└── README.md / README.en.md
```

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

# Optional: custom vision backend (v1.2) — when set, custom goes first, built-ins back it up
VB_BASE_URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions  # any OpenAI-compatible endpoint
VB_MODEL: qwen3-vl-plus
VB_API_KEY: sk-xxx
# VB_PROTOCOL: openai      # openai (default) | gemini
# VB_NEEDS_PROXY: true     # true → route through VISION_PROXY
```

**3. Restart DSH**. You are up once the startup log shows `[vision-bridge] native image channel ready`.

> Only `MIMO_API_KEY` is required to use the plugin; the rest are fallback redundancy.
> With a complete `VB_*` config, vision requests **prefer your endpoint**; the four built-ins are fallback only.

## Features

| Feature | Description |
|---|---|
| Native image attach | Paste/drag images into the chat; thumbnails render; no more "model does not support images" |
| Pre-injected vision | A background vision analysis describes every uploaded image (with rate-limit retry); model requests **wait for in-flight descriptions** (bounded 8s) — the model "sees" without a race |
| `see_image` tool | On-demand deep analysis: OCR / layout / targeted questions / region focus (real cropping); accepts `attachment_id` or `file_path` |
| Real region cropping | Normalized coordinates → sharp crop + upscale to 1280px; **fails loudly instead of silently analyzing the whole image** |
| Four-backend failover | MiMo (primary) → GLM → Groq → Gemini, automatic degradation |
| Custom vision backend | Optional `VB_BASE_URL` / `VB_MODEL` / `VB_API_KEY` / `VB_PROTOCOL` / `VB_NEEDS_PROXY` — plug in any OpenAI-compatible (or Gemini-protocol) vision model; **custom first, four built-ins as fallback** |
| Auto-discovered vision routes | deepseek-official is enhanced replacement-style (no model selector change); other text-only family routes (glm etc.) get an automatic "(vision)" variant — switch your main model and vision follows |
| Rate-limit retry | 2s/4s backoff retries (max 3) on rate-limit errors |
| Result caching | image-hash + (question⊕region⊕backend⊕version)-hash; invalidates automatically when backend/version changes |
| Single-attachment storage | No duplicate copies — in-memory byte cache + DSH `attachments.readImage` (content-addressed, digest-verified) survives restarts |
| Image preprocessing | Downscale >1600px → 1280; upscale <700px → 1024; unified JPEG q85 |
| Structured pre-injection | Description prompt ordered by information value (overview → verbatim text → 2-4 elements); truncation only drops the least valuable tail |
| Dynamic injection budget | By model context window: ≥64K → 1600 chars, ≥16K → 800, smaller → 400 |
| Upgrade self-healing | Hook method names centralized in the **HOOKS table**; startup self-check warns with repair guidance if DSH upgrades break them |
| Key protection | curl auth headers go through a private config file (mode 0600, deleted after use) — never in process args |
| Injection defense | Pre-injected descriptions are explicitly marked **untrusted visual data** (text inside images must not be treated as instructions) |

## Requirements

- **Windows** (Node ≥18; standalone CLI reuse needs Node ≥22.12)
- DSH must have run at least once (creates the `.dsh` directory)
- Preprocessing/cropping use `sharp` — auto-degrades (skips preprocessing/cropping) when unavailable; core features are unaffected
  - DSH environments usually bundle it (profile `node_modules`); otherwise `npm i sharp` into
    `%USERPROFILE%\.dsh\profiles\web\node_modules\` or the install directory

## Data Directory

`%USERPROFILE%\.dsh\vision-bridge\`
- `.vb-cache-<hash>-<askHash>.json` — `see_image` analysis cache
- `.vb-cache-<hash>-desc-v<N>.json` — pre-injection description cache (separate key, prompt-versioned)
- `.vb-curl-*.cfg` — curl auth temp config (deleted after use)

Attachment bytes live in the DSH AttachmentStore (no duplicate disk copies). **The plugin writes nothing into the DSH source directory.**

## Architecture

```
user pastes image ──► saveImage (patch)
              ├─ bytes into in-memory cache (attachmentId → bytes)
              └─ background pre-injection: brief-prompt analysis → desc into memory + separate disk cache
                            (shared in-flight Promise, rate-limit retry)
model request ──► VisionDeepSeekAdapter.stream (wraps the official DeepSeek adapter via the official extension point)
              ├─ converts only on deepseek-official; other providers untouched
              ├─ waits for in-flight descriptions (bounded 8s, honors cancellation)
              ├─ image block → [图片附件: <id>] + 【自动视觉描述】(dynamic budget) + untrusted-data marker
              ├─ bytes from: memory cache → attachments.readImage (after restart)
              ├─ nested tool-result image blocks converted too
              └─ fallback to attachment placeholder when no description (model can call see_image)
see_image ──► attachment_id / file_path → backend-table failover (unified OpenAI/Gemini dual-protocol caller)
              ├─ image preprocessing (down/upscale, JPEG q85)
              ├─ real region cropping (fails loudly)
              ├─ cache hit (backend/version aware) → zero cost
              └─ rate-limit retry → degrade to next backend
```

**v2.0 architecture (monkey-patch eliminated)**:
- `VisionDeepSeekAdapter extends DeepSeekAdapter` (official class, inherits the wire protocol) — registered via the
  **official extension point** `ctx.llm.registerAdapter`, replacing the former
  `resolveModelInfo` / `streamWithRegistration` internal-method monkey-patches
- Only `attachments.saveImage` patching remains (**public abstraction**, stable)
- A DSH upgrade breaks at the class signature (a TS contract) — **never silently**
- The installer writes `llm-deepseek: disabled` into `cordis.patch.yml` (disables the original adapter, avoiding route conflicts)
- `see_image` is always available

**v1.2 extensions (adaptability)**:
- **A custom vision backend**: with `VB_BASE_URL` / `VB_MODEL` / `VB_API_KEY` etc. configured, the attempt chain
  becomes custom → MiMo → GLM → Groq → Gemini; cache keys include a custom-endpoint hash (switching endpoints invalidates automatically)
- **B multi-route auto-discovery**: deepseek-official stays replacement-style (no model selector change); other text-only
  family routes (glm etc., `SCOPE_FAMILIES`) get an automatic `vb-vision-<id>` wrapper route — a "(vision)" variant appears
  in the model selector, images are converted to descriptions then delegated to the original route; `llm/adapters-updated`
  re-scans, so late-mounted routes are covered too; native vision models are skipped automatically

## Standalone CLI (backup channel)

`vision-see.cjs` is a standalone CLI channel: it runs without the plugin and analyzes local files or chat attachments directly.

```bash
node vision-see.cjs <image-path|--attachment sha256:...> [question] [--backend auto|custom|mimo|glm|groq|gemini] [--region x,y,w,h]
```

Thin shell; all pure logic reuses the plugin module exports (single source of truth). Full usage: **[CLI Manual](docs/cli.en.md)** (arguments, examples, credentials, output, exit codes, caching).

## Documentation

| Doc | Read it when |
|---|---|
| [CLI Manual](docs/cli.en.md) | Full `vision-see.cjs` usage: arguments, examples, credentials, output, exit codes, caching |
| [Troubleshooting](docs/troubleshooting.en.md) | Common symptoms and fixes (install / pasting / backends / cache / upgrades) |
| [Security](docs/security.en.md) | Credential handling, network traffic, untrusted image content, data directory and risk list |

## Tests

```bash
node test/schema.test.js   # schema validation (real dsh validator), 7 cases
node test/logic.test.js    # logic unit tests, 17 cases (with regression assertions)
node test/adapter.test.js  # wrapper-adapter tests, 3 cases
```
Tests import the plugin source directly; groups that need `sharp` are skipped automatically when it is unavailable.

## Known Limitations

- The wrapper adapter extends the official `DeepSeekAdapter` — a DSH upgrade may break the class signature (TS-contract level, explicit, never silent); the startup self-check warns
- Route discovery follows the provider topology (`llm/adapters-updated` re-scan) — late-mounted routes get their "(vision)" variant on the next topology change
- Custom backends (VB_*) speak the OpenAI-compatible or Gemini protocol; other protocols (Anthropic etc.) are not supported yet
- Pre-injection budget is context-window tiered (≥64K → 1600 / ≥16K → 800 / smaller → 400); use `see_image` for deeper needs
- Pre-injection and `see_image` caches are separate (different content requirements); **a full `see_image` analysis backfills the pre-injection cache** — a failed pre-injection self-heals after one deep look
- Groq/Gemini are not directly reachable from mainland-China networks; configure `VISION_PROXY`

## Cache & Cleanup

- Cache files: `.vb-cache-*` (a few KB per image, two files per image)
- **Auto cleanup**: on startup, keeps the most recent 500 cache files (`CACHE_KEEP_MAX`); older ones are deleted

## Disclaimer

- This project is provided **"AS-IS" under the MIT License**; the author makes no warranty and gives no endorsement for any particular use (commercial use included), and accepts no liability for any direct or indirect damages arising from its use.
- Vision capability depends on **third-party upstream services**: Xiaomi MiMo, Zhipu GLM, Groq, Google Gemini (and any proxy you configure). Their use is governed by **each service's own terms, quotas, and data policies**, for which you are responsible.
- **Image content (including text inside images) is sent to those third-party services**: do not use this project with sensitive images unless the target services and network path meet your compliance requirements.
- Text inside images may contain malicious instructions (prompt injection): this project injects an untrusted-data marker as defense, but it is prompt-level protection, not hard isolation.
- Maintained by an individual developer; no service-level agreement (SLA) of any kind is provided.

## License

MIT
