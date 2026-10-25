/** 工作包 B1：TTS 音频分析总线（模块级单例）。
 *
 * tts.ts 每条播报音频元素接入同一 AudioContext → AnalyserNode，对外提供实时 RMS/频谱。
 * - AudioContext 只创建一次；元素播完/出错即断开其 MediaElementSource（防节点泄漏）。
 * - 接入后声音改走 Web Audio 图（analyser → destination），可听性不变；
 *   若自动播放策略拦截，audio.play() 本身就会失败（与基线行为一致，不劣化播报链路）。
 * - 麦克风侧维持现有模拟（STT 流取不到音频，SPEC 允许）。
 */

interface Bus {
  ctx: AudioContext
  analyser: AnalyserNode
  freq: Uint8Array<ArrayBuffer>
  time: Uint8Array<ArrayBuffer>
}

let bus: Bus | null = null

export function audioBusAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.AudioContext === 'function'
}

/** 把一个播报音频元素接入分析总线（幂等：每元素仅接一次，播完自动断开）。 */
export function attachTtsAudio(el: HTMLAudioElement): void {
  if (!audioBusAvailable()) return
  if (!bus) {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.5
    analyser.connect(ctx.destination)
    bus = {
      ctx,
      analyser,
      freq: new Uint8Array(analyser.frequencyBinCount),
      time: new Uint8Array(analyser.fftSize),
    }
  }
  if (bus.ctx.state === 'suspended') void bus.ctx.resume()
  try {
    const src = bus.ctx.createMediaElementSource(el)
    src.connect(bus.analyser)
    const bye = () => {
      try {
        src.disconnect()
      } catch {
        /* 忽略 */
      }
    }
    el.addEventListener('ended', bye, { once: true })
    el.addEventListener('error', bye, { once: true })
    // 停止/切句走 pause()（不触发 ended）——同样断开源节点，防 MediaElementSource 泄漏
    el.addEventListener('pause', bye, { once: true })
  } catch {
    /* 元素重复接入/浏览器限制：忽略，元素直放路径不受影响 */
  }
}

export interface TtsLevels {
  /** 0-1（byte 时域 RMS，未经归一放大，静音≈0） */
  rms: number
  /** 频谱（0-255，length=frequencyBinCount）；总线未就绪为 null */
  freq: Uint8Array | null
  /** 是否有可感知声音（阈值防抖） */
  playing: boolean
}

/** 读取当前 TTS 电平与频谱（消费方在自己的 rAF 中轮询）。 */
export function readTtsLevels(): TtsLevels {
  if (!bus || bus.ctx.state !== 'running') return { rms: 0, freq: null, playing: false }
  const { analyser, time, freq } = bus
  analyser.getByteTimeDomainData(time)
  let sum = 0
  for (let i = 0; i < time.length; i++) {
    const v = (time[i] - 128) / 128
    sum += v * v
  }
  const rms = Math.sqrt(sum / time.length)
  analyser.getByteFrequencyData(freq)
  return { rms, freq, playing: rms > 0.004 }
}
