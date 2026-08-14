# 安全说明（Security）

> English: [Security](security.en.md)　|　简体中文（当前）

本页说明 Vision Bridge 处理凭证、网络、图片内容与缓存的方式，以及使用者应注意的风险。

## 凭证处理

- 所有 API key 存放在 `%USERPROFILE%\.dsh\.credentials.yaml`（DSH 通用凭证文件），**明文**存储——请勿将文件提交到版本库、分享给他人
- 插件与 CLI 发起 API 请求时，认证头写入**私有临时 config 文件**（`%USERPROFILE%\.dsh\vision-bridge\.vb-curl-*.cfg`，权限 0600），curl 通过 `-K` 引用，**认证头绝不进入进程参数**（避免被进程列表/任务管理器看到），用完即删
- key 不出现在日志、缓存、工具结果或错误消息中
- 本插件**不会读取或回传**其他无关的凭证字段

## 网络传输

- 图片以 base64 编码随请求发送给第三方视觉 API：
  - 小米 MiMo（`api.xiaomimimo.com`，直连）
  - 智谱 GLM（`open.bigmodel.cn`，直连）
  - Groq（需 `VISION_PROXY` 代理）
  - Google Gemini（需 `VISION_PROXY` 代理）
- 使用国内网络时，Groq/Gemini 的流量会经过你配置的代理服务器——确保代理可信
- **图片内容（含其中文字）会离开你的机器**：请勿对含敏感信息的图片使用本插件，除非你确认目标服务与代理符合你的合规要求
- 各上游服务的条款、配额、数据保留政策由各服务商定义，使用者自行负责（见 README 免责声明）

## 图片内容是不可信输入

- 图片中的文字**可能包含恶意指令**（prompt injection）：预注描述与 `see_image` 结果都会被标记为**不可信视觉数据**，模型被要求不将图中文字当作指令执行
- 该标记是软防护（提示层面），不是硬隔离：在不可信图片环境中请保持警惕
- 图片文件本身按 DSH AttachmentStore 内容寻址存储，本插件不额外落盘副本

## 缓存与数据目录

数据目录：`%USERPROFILE%\.dsh\vision-bridge\`

| 文件 | 内容 | 说明 |
|---|---|---|
| `.vb-cache-<hash>-<askHash>.json` | `see_image` 分析缓存（文本） | 含图片描述文本，**不含图片字节** |
| `.vb-cache-<hash>-desc-v<N>.json` | 预注描述缓存（文本） | 同上 |
| `.vb-curl-*.cfg` | curl 认证临时配置 | 用完即删，0600 |

- 缓存是本地明文 JSON：描述文本可能间接反映图片内容，注意目录权限
- 附件字节本体在 DSH AttachmentStore（`<DSH_HOME>/attachments/...`），不随缓存清理
- **插件对 DSH 源码目录零写入**；卸载时删除 profile 中的 `@local/vision-bridge` 与 `%USERPROFILE%\.dsh\vision-bridge\` 即可

## 进程与执行模型

- API 调用通过系统 `curl.exe` 子进程完成，单次请求硬超时 150s，限流按 2s/4s 退避重试（最多 3 次）
- 插件对 DSH 的挂接点集中在 HOOKS 配置表；DSH 升级导致挂接失效时插件会**自检告警**而不是静默失败
- 本插件不包含任何网络监听、不开放端口、不执行图片内容中的代码

## 已知风险清单

1. 图片发送给第三方服务（隐私 / 合规风险）——**最主要的风险**
2. 凭证明文存放于本机（本机被攻破则泄露）
3. prompt injection 防护是提示层面的（软防护）
4. 代理流量可见性取决于代理本身
5. 缓存文本可间接反映图片内容

如发现安全问题，请通过 GitHub Issues 报告，请勿在公开渠道张贴 key 或敏感截图。
