# Security

> 简体中文：[安全说明](security.md)　|　English (current)

This page explains how Vision Bridge handles credentials, network traffic, image content and caching, plus the risks you should be aware of.

## Credential handling

- All API keys live in `%USERPROFILE%\.dsh\.credentials.yaml` (DSH's shared credentials file), stored **in plaintext** — never commit it to version control or share it
- When the plugin or CLI makes API requests, auth headers are written to a **private temporary config file** (`%USERPROFILE%\.dsh\vision-bridge\.vb-curl-*.cfg`, mode 0600), which curl consumes via `-K` — **auth headers never appear in process arguments** (invisible to process listings/task managers), and the file is deleted after use
- Keys never appear in logs, caches, tool results, or error messages
- The plugin does **not** read or forward other unrelated credential fields

## Network traffic

- Images are sent base64-encoded to third-party vision APIs:
  - Xiaomi MiMo (`api.xiaomimimo.com`, direct)
  - Zhipu GLM (`open.bigmodel.cn`, direct)
  - Groq (requires `VISION_PROXY`)
  - Google Gemini (requires `VISION_PROXY`)
- On mainland-China networks, Groq/Gemini traffic goes through the proxy you configure — make sure the proxy is trustworthy
- **Image content (including text inside images) leaves your machine**: do not use this plugin with sensitive images unless the target services and proxy meet your compliance requirements
- Each upstream service's terms, quotas, and data-retention policy are defined by its provider; you are responsible for them (see the README disclaimer)

## Image content is untrusted input

- Text inside images **may contain malicious instructions** (prompt injection): pre-injected descriptions and `see_image` results are explicitly marked as **untrusted visual data**, and the model is instructed not to treat in-image text as instructions
- This marking is soft protection (prompt-level), not a hard isolation: stay alert in untrusted-image environments
- Image files themselves are stored content-addressed by the DSH AttachmentStore; the plugin writes no extra copies

## Cache and data directory

Data directory: `%USERPROFILE%\.dsh\vision-bridge\`

| File | Content | Notes |
|---|---|---|
| `.vb-cache-<hash>-<askHash>.json` | `see_image` analysis cache (text) | Contains description text, **not image bytes** |
| `.vb-cache-<hash>-desc-v<N>.json` | Pre-injection description cache (text) | Same |
| `.vb-curl-*.cfg` | curl auth temp config | Deleted after use, mode 0600 |

- Caches are local plaintext JSON: description text may indirectly reflect image content — mind directory permissions
- Attachment bytes live in the DSH AttachmentStore (`<DSH_HOME>/attachments/...`), unaffected by cache cleanup
- **The plugin writes nothing into the DSH source directory**; to uninstall, remove `@local/vision-bridge` from the profile and delete `%USERPROFILE%\.dsh\vision-bridge\`

## Process & execution model

- API calls run as `curl.exe` subprocesses with a 150s hard timeout per request; rate limits back off 2s/4s and retry up to 3 times
- The plugin's hooks into DSH are centralized in the HOOKS table; if a DSH upgrade breaks a hook, the plugin **warns loudly via self-check** instead of failing silently
- The plugin opens no network listeners, exposes no ports, and never executes code contained in image content

## Known risk list

1. Images are sent to third-party services (privacy / compliance) — **the main risk**
2. Credentials are stored in plaintext on the machine (leak if the machine is compromised)
3. Prompt-injection protection is prompt-level (soft)
4. Proxy traffic visibility depends on the proxy itself
5. Cache text can indirectly reflect image content

To report a security issue, use GitHub Issues — never post keys or sensitive screenshots in public channels.
