# Vision Bridge

Full vision capability for text-only models (e.g. `deepseek-v4-flash`) on DeepSeek Harness (Windows).

**Core idea**: images never enter the model input (the DeepSeek adapter rejects image blocks at the code level). Instead — images render normally in the conversation (UI feels like a native vision model), and the model context receives **automatically pre-injected text descriptions + image attachment references**. For details, use the `see_image` tool with the attachment ID.

**Scope**: only rewrites image requests on the `deepseek-official` (text-only) route. Any other provider (including native vision models) passes through untouched.

> 中文文档：[README.md](README.md)

## Repository Layout

```
vision-bridge/
├── lib/
│   ├── index.js        # Plugin main file (backend table + pure-function exports + apply)
│   ├── adapter.js      # VisionDeepSeekAdapter (wraps the official adapter via the official extension point)
│   └── dsh-pkg.js      # DSH package loader (package-name / DSH-home dual path resolution)
├── test/               # Unit tests: schema(7) + logic(15) + adapter(3)
├── vision-see.cjs      # Standalone CLI (analyzes files or chat attachments)
├── install.js          # One-command install (copy + patch + verify)
├── package.json        # v1.0.0, MIT
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
MIMO_API_KEY: <Xiaomi MiMo-V2.5, primary backend, direct, ¥1/MTok>
GLM_API_KEY: <Zhipu GLM-4.6V-Flash, free, direct>
GROQ_API_KEY: <Groq qwen/qwen3.6-27b, free, requires proxy>
GEMINI_API_KEY: <Gemini gemini-flash-latest, requires proxy>
VISION_PROXY: http://127.0.0.1:7890   # only needed for Groq/Gemini (mainland-China networks)
```

**3. Restart DSH**. You are up once the startup log shows `[vision-bridge] native image channel ready`.

> Only `MIMO_API_KEY` is required to use the plugin; the rest are fallback redundancy.

## Features

| Feature | Description |
|---|---|
| Native image attach | Paste/drag images into the chat; thumbnails render; no more "model does not support images" |
| Pre-injected vision | A background vision analysis describes every uploaded image (with rate-limit retry); model requests **wait for in-flight descriptions** (bounded 8s) — the model "sees" without a race |
| `see_image` tool | On-demand deep analysis: OCR / layout / targeted questions / region focus (real cropping); accepts `attachment_id` or `file_path` |
| Real region cropping | Normalized coordinates → sharp crop + upscale to 1280px; **fails loudly instead of silently analyzing the whole image** |
| Four-backend failover | MiMo (primary) → GLM → Groq → Gemini, automatic degradation |
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

## Standalone CLI (backup channel)

```bash
# analyze a local file
node vision-see.cjs <image-path> [question] [--backend mimo|glm|groq|gemini|auto] [--region x,y,w,h]
# analyze a chat attachment directly (no subagent/plugin tool needed)
node vision-see.cjs --attachment sha256:xxx... [question] [--backend ...] [--region ...]
```
Thin shell; all pure logic reuses the plugin module exports (single source of truth). Honors `DSH_HOME` and `VB_PLUGIN_PATH`;
`--attachment` reads from the DSH attachment store (`<DSH_HOME>/attachments/v1/objects/<first-2>/<full-hash>`, magic-byte MIME detection).

## Tests

```bash
node test/schema.test.js   # schema validation (real dsh validator), 7 cases
node test/logic.test.js    # logic unit tests, 15 cases (with regression assertions)
node test/adapter.test.js  # wrapper-adapter tests, 3 cases
```
Tests import the plugin source directly; groups that need `sharp` are skipped automatically when it is unavailable.

## Known Limitations

- The wrapper adapter extends the official `DeepSeekAdapter` — a DSH upgrade may break the class signature (TS-contract level, explicit, never silent); the startup self-check warns
- Pre-injection budget is context-window tiered (≥64K → 1600 / ≥16K → 800 / smaller → 400); use `see_image` for deeper needs
- Pre-injection and `see_image` caches are separate (different content requirements); **a full `see_image` analysis backfills the pre-injection cache** — a failed pre-injection self-heals after one deep look
- Groq/Gemini are not directly reachable from mainland-China networks; configure `VISION_PROXY`

## Cache & Cleanup

- Cache files: `.vb-cache-*` (a few KB per image, two files per image)
- **Auto cleanup**: on startup, keeps the most recent 500 cache files (`CACHE_KEEP_MAX`); older ones are deleted

## License

MIT
