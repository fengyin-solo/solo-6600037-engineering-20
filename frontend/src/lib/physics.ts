// 光学实验物理计算（纯函数，单项计算与批量回归共用同一入口，保证结果一致）

export interface OpticsParams {
  wavelength: number // nm
  slitWidth: number // μm
  slitSeparation: number // μm
  screenDistance: number // mm
}

export const DEFAULT_PARAMS: OpticsParams = {
  wavelength: 550,
  slitWidth: 50,
  slitSeparation: 200,
  screenDistance: 1000,
}

export const PARAM_BOUNDS = {
  wavelength: { min: 380, max: 780, unit: 'nm', label: '波长 λ' },
  slitWidth: { min: 10, max: 200, unit: 'μm', label: '缝宽 a' },
  slitSeparation: { min: 50, max: 500, unit: 'μm', label: '缝间距 d' },
  screenDistance: { min: 100, max: 2000, unit: 'mm', label: '屏幕距离 L' },
} as const

export type ParamKey = keyof OpticsParams
export type ExperimentId = 'double' | 'single' | 'newton'

export const EXPERIMENTS: { id: ExperimentId; name: string; uses: ParamKey[] }[] = [
  { id: 'double', name: '双缝干涉', uses: ['wavelength', 'slitWidth', 'slitSeparation', 'screenDistance'] },
  { id: 'single', name: '单缝衍射', uses: ['wavelength', 'slitWidth', 'screenDistance'] },
  { id: 'newton', name: '牛顿环', uses: ['wavelength'] },
]

export interface ScalarResult {
  fringe?: number // 双缝条纹间距 mm
  centralWidth?: number // 单缝中央亮纹宽 mm
  firstRingRadius?: number // 牛顿环第一暗环半径 mm
}

export interface ExperimentResult extends ScalarResult {
  intensityData: number[]
}

/** 参数边界校验，返回错误列表（空数组表示合法） */
export function validateParams(p: OpticsParams): string[] {
  const errors: string[] = []
  for (const key of Object.keys(PARAM_BOUNDS) as ParamKey[]) {
    const v = p[key]
    const b = PARAM_BOUNDS[key]
    if (!Number.isFinite(v)) {
      errors.push(`${b.label} 不是有效数字: ${v}`)
    } else if (v < b.min || v > b.max) {
      errors.push(`${b.label} 超出边界 [${b.min}, ${b.max}]${b.unit}: ${v}${b.unit}`)
    }
  }
  return errors
}

/** 实验适用条件核对（不阻断计算，仅给出物理适用性警告） */
export function applicabilityWarnings(exp: ExperimentId, p: OpticsParams): string[] {
  const warns: string[] = []
  if (exp === 'double' && p.slitSeparation < p.slitWidth) {
    warns.push(`缝间距 d=${p.slitSeparation}μm 小于缝宽 a=${p.slitWidth}μm，双缝模型不适用`)
  }
  if ((exp === 'double' || exp === 'single') && p.slitWidth * 1e-6 < p.wavelength * 1e-9) {
    warns.push('缝宽小于波长，夫琅禾费衍射条件不满足')
  }
  return warns
}

/** 三类实验的统一计算入口（数学与原 store.compute 完全一致） */
export function computeExperiment(exp: ExperimentId, params: OpticsParams): ExperimentResult {
  const lambda = params.wavelength * 1e-9
  const aM = params.slitWidth * 1e-6
  const dM = params.slitSeparation * 1e-6
  const LM = params.screenDistance * 1e-3
  const N = 800
  const data: number[] = []
  const xMax = 20e-3
  const scalar: ScalarResult = {}

  if (exp === 'double') {
    scalar.fringe = Math.round((lambda * LM) / dM * 1e3 * 100) / 100
    for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * xMax * 2
      const delta = (Math.PI * dM * x) / (lambda * LM)
      const beta = (Math.PI * aM * x) / (lambda * LM) || 1e-10
      const single = Math.sin(beta) / beta
      const intensity = Math.cos(delta) ** 2 * single ** 2
      data.push(Math.max(0, intensity))
    }
  } else if (exp === 'single') {
    scalar.centralWidth = Math.round((2 * lambda * LM) / aM * 1e3 * 100) / 100
    for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * xMax * 2
      const beta = (Math.PI * aM * x) / (lambda * LM) || 1e-10
      const intensity = (Math.sin(beta) / beta) ** 2
      data.push(Math.max(0, intensity))
    }
  } else {
    // newton
    const R = 1.0
    scalar.firstRingRadius = Math.round(Math.sqrt(lambda * R) * 1e3 * 1e4) / 1e4
    for (let i = 0; i < N; i++) {
      const r = (i / N) * 5e-3
      const path = (r * r) / (2 * R)
      const phi = (2 * Math.PI * path) / lambda + Math.PI
      const intensity = 0.5 * (1 - Math.cos(phi))
      data.push(Math.max(0, intensity))
    }
  }

  return { ...scalar, intensityData: data }
}
