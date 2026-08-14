/**
 * VisionDeepSeekAdapter — 包装官方 DeepSeek 适配器的视觉扩展（v2.0）
 *
 * 通过官方扩展点（ctx.llm.registerAdapter + 继承 DeepSeekAdapter）替代两个
 * monkey-patch（resolveModelInfo / streamWithRegistration）：
 *   - resolveModel：为 deepseek 模型声明图像输入能力（替代 resolveModelInfo patch）
 *   - stream：请求分发前异步转换图片块（替代 streamWithRegistration patch）
 *
 * 协议实现（SSE 分帧、序列化、错误分类、retry 策略）全部继承官方实现——
 * 本类只叠加视觉语义。DSH 升级时破坏点是类签名（TS 契约），不会静默失效。
 *
 * 依赖：@deepseek-ai/dsh-llm-deepseek（dsh-base 标准组件）；加载失败时
 * DeepSeekAdapter 为 undefined，本类退化为不可注册（调用方降级告警）。
 */
import { loadDshPkg } from './dsh-pkg.js'

const dshDeepSeek = loadDshPkg('@deepseek-ai/dsh-llm-deepseek') || {}
export const DeepSeekAdapter = dshDeepSeek.DeepSeekAdapter

const Base = DeepSeekAdapter || Object

export class VisionDeepSeekAdapter extends Base {
  /**
   * @param config - 原 DeepSeekAdapter 的配置（{ options, resolveApiKey, resolveUserId }）
   * @param hooks - { convertImages: (options, maxChars) => Promise<options> }
   */
  constructor(config, hooks) {
    super(config)
    this.hooks = hooks || {}
  }

  /** 声明图像输入能力（替代 resolveModelInfo monkey-patch）。 */
  async resolveModel(provider, model, signal) {
    const info = await super.resolveModel(provider, model, signal)
    if (info && Array.isArray(info.inputModalities) && info.inputModalities.indexOf('image') === -1) {
      return Object.assign({}, info, { inputModalities: info.inputModalities.concat(['image']) })
    }
    return info
  }

  /** 请求分发前异步转换图片块（替代 streamWithRegistration monkey-patch）。 */
  async * stream(options) {
    let converted = options
    if (this.hooks.convertImages) {
      // 注入预算按模型上下文窗口分档（从配置的连接事实取，替代 prepared.context）
      let contextWindow
      try {
        const connection = this.config.options()
        const modelEntry = Array.isArray(connection.models)
          ? connection.models.find((m) => m.id === options.model)
          : undefined
        contextWindow = modelEntry ? modelEntry.contextWindow : connection.defaultContextWindow
      } catch { /* 未知上下文按最小档 */ }
      converted = await this.hooks.convertImages(options, contextWindow)
    }
    yield* super.stream(converted)
  }
}
