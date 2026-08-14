# Troubleshooting

> 简体中文：[故障排查](troubleshooting.md)　|　English (current)

Look up your symptom below. Suggested order: **install → startup log → pasting → backends → cache → upgrades**.

## Install / Startup

| Symptom | Cause & fix |
|---|---|
| No `[vision-bridge] native image channel ready` in the startup log | Plugin not active: confirm `cordis.patch.yml` has `- insert: vision-bridge` and the `@local/vision-bridge` directory exists; confirm the `llm-deepseek` row is `disabled: true` (avoids route conflicts); restart DSH |
| `Cannot find module '@local/vision-bridge'` | `install.js` did not copy into the profile: re-run `node install.js` (optionally with a profile name); check `%USERPROFILE%\.dsh\profiles\web\node_modules\@local\vision-bridge\` exists |
| Installed into the wrong profile | `node install.js headless` targets a specific profile; the default is `web`. Make sure the install target matches the profile DSH actually starts with |
| Self-check warning after a DSH upgrade | A hook point changed in the new DSH version: the warning names the exact HOOKS entry and repair steps — follow them (edit the HOOKS table in `lib/index.js` or update the plugin), then restart |

## Pasting / Model responses

| Symptom | Cause & fix |
|---|---|
| Pasting still reports "model does not support images" | The selected model is not on the `deepseek-official` route (the plugin only rewrites that route); or the plugin is not active (see above); or the image was pasted before the plugin loaded (restart DSH and retry) |
| The image shows, but the model says it cannot see it | The pre-injection description did not finish within the 8s wait window (slow network / rate limit). The image itself is wired correctly — ask the model to call `see_image`; the same image hits the cache next time |
| The model receives a `[图片附件: ...]` placeholder | Same as above — the fallback path when pre-injection failed. One `see_image` deep read backfills the pre-injection cache (self-healing) |
| `see_image` reports "attachment not found" | Wrong attachment ID, or the attachment was cleaned up; reference the attachment ID from the pasted message in the session; `--attachment sha256:<hex>` needs the full hash |
| `region` argument invalid | Format must be `x,y,w,h`, each value 0-1, `x+w` / `y+h` ≤ 1; it fails loudly instead of silently analyzing the whole image |

## Backends / Network

| Symptom | Cause & fix |
|---|---|
| All backends failed (log contains `所有视觉后端均失败`) | Check each key in `.credentials.yaml` — correctness, stray spaces/quotes; read the per-backend error details in the message |
| Only Groq / Gemini fail | Mainland-China networks cannot reach them directly: configure `VISION_PROXY` (e.g. `http://127.0.0.1:7890`) and make sure the proxy itself works |
| `未找到 ... 凭证` reported | The key is missing or malformed in `.credentials.yaml` (`KEY: value` per line, quoted values allowed, `#` starts a comment) |
| Frequent rate-limit retries (`限流，2000ms 后重试`) | A burst of image reads hit backend quota: wait and retry; `see_image` hits the cache for the same image+question, avoiding repeat calls |
| curl timeout (`curl 超时`) | Unstable network or slow proxy: check proxy connectivity and retry; 150s is the per-request cap |
| A backend reports 401 / 403 | Invalid or expired key: replace it; confirm the key matches its backend (a MiMo key cannot go into the GLM field) |

## Cache / Data

| Symptom | Cause & fix |
|---|---|
| Cache misses | The cache key includes image hash + question/region/backend/version: changing any of them invalidates the entry by design |
| Cache uses disk space | Each cache file is a few KB; startup auto-cleanup keeps the newest 500 files (`CACHE_KEEP_MAX`). Manual: delete `%USERPROFILE%\.dsh\vision-bridge\.vb-cache-*` |
| Confused about CLI cache paths | CLI caches are separate: attachments → `%USERPROFILE%\.dsh\vision-bridge\.att-*.vb-see.cache.json`; files → `<image-path>.vb-see.cache.json` |

## Image processing

| Symptom | Cause & fix |
|---|---|
| Preprocessing / cropping inactive | `sharp` not installed: the plugin degrades automatically (skips preprocessing/cropping; core vision still works). To enable: `npm i sharp` into the profile `node_modules` or the install directory |
| Very large image fails | Large images are downscaled to 1280px; if it still fails, check whether the image is corrupt or the format is unsupported (png / jpg / webp / gif / bmp) |
| Recognition does not match the image | That is the vision model's capability ceiling: use `see_image` for a deeper read (more detailed prompt, region focus), or compare backends (`--backend glm` etc.) |

## Tests / Development

| Symptom | Cause & fix |
|---|---|
| Tests cannot find a module | Tests import the plugin source directly: when `@deepseek-ai/*` package resolution fails it falls back to the DSH home — confirm DSH packages exist under `%USERPROFILE%\.dsh\profiles\web\node_modules\` |
| sharp-dependent test groups skipped | No `sharp` in the environment: those groups skip automatically (expected behavior) |
