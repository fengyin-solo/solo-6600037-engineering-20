// 光学实验共享计算模块（纯函数）
// 单项计算与批量回归共用同一套实现，保证两侧结果始终一致。

export type ExperimentId = 'double' | 'single' | 'newton'

export interface OpticsParams {
  wavelength: number      // nm
  slitWidth: number       // μm
  slitSeparation: number  // μm
  screenDistance: number  // mm
}

export interface ExperimentResult {
  intensity: number[]
  fringe?: number        // mm — 双缝条纹间距
  centralWidth?: number  // mm — 单缝中央亮纹宽度
}

export const EXPERIMENT_IDS: ExperimentId[] = ['double', 'single', 'newton']

export const EXPERIMENT_NAMES: Record<ExperimentId, string> = {
  double: '双缝干涉',
  single: '单缝衍射',
  newton: '牛顿环',
}

// 原有参数预设（默认值保持不变）
export const DEFAULT_PARAMS: OpticsParams = {
  wavelength: 550,
  slitWidth: 50,
  slitSeparation: 200,
  screenDistance: 1000,
}

// 参数边界，与调节滑块范围一致
export const PARAM_BOUNDS = {
  wavelength: { min: 380, max: 780, label: '波长 λ', unit: 'nm' },
  slitWidth: { min: 10, max: 200, label: '缝宽 a', unit: 'μm' },
  slitSeparation: { min: 50, max: 500, label: '缝间距 d', unit: 'μm' },
  screenDistance: { min: 100, max: 2000, label: '屏幕距离 L', unit: 'mm' },
} as const

export type ParamKey = keyof typeof PARAM_BOUNDS

/** 越界检查：返回全部越界说明，空数组表示全部在边界内 */
export function boundsViolations(p: OpticsParams): string[] {
  const out: string[] = []
  for (const key of Object.keys(PARAM_BOUNDS) as ParamKey[]) {
    const b = PARAM_BOUNDS[key]
    const v = p[key]
    if (!Number.isFinite(v) || v < b.min || v > b.max) {
      out.push(`${b.label} = ${v}${b.unit} 超出边界 [${b.min}, ${b.max}]${b.unit}`)
    }
  }
  return out
}

/** 单组参数 × 单个实验的物理计算（与原有单项计算逻辑逐字一致） */
export function computeExperiment(exp: ExperimentId, params: OpticsParams): ExperimentResult {
  const lambda = params.wavelength * 1e-9
  const aM = params.slitWidth * 1e-6
  const dM = params.slitSeparation * 1e-6
  const LM = params.screenDistance * 1e-3
  const N = 800
  const xMax = 20e-3
  const intensity: number[] = []
  const out: ExperimentResult = { intensity }

  if (exp === 'double') {
    out.fringe = Math.round(lambda * LM / dM * 1e3 * 100) / 100
    for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * xMax * 2
      const delta = Math.PI * dM * x / (lambda * LM)
      const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
      const single = Math.sin(beta) / beta
      intensity.push(Math.max(0, Math.cos(delta) ** 2 * single ** 2))
    }
  } else if (exp === 'single') {
    out.centralWidth = Math.round(2 * lambda * LM / aM * 1e3 * 100) / 100
    for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * xMax * 2
      const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
      intensity.push(Math.max(0, (Math.sin(beta) / beta) ** 2))
    }
  } else { // newton
    const R = 1.0
    for (let i = 0; i < N; i++) {
      const r = (i / N) * 5e-3
      const path = r * r / (2 * R)
      const phi = 2 * Math.PI * path / lambda + Math.PI
      intensity.push(Math.max(0, 0.5 * (1 - Math.cos(phi))))
    }
  }
  return out
}

/** 适用条件核对：返回该实验在此参数下的全部违规说明，空数组表示适用 */
export function applicabilityViolations(exp: ExperimentId, params: OpticsParams): string[] {
  const lambda = params.wavelength * 1e-9
  const aM = params.slitWidth * 1e-6
  const dM = params.slitSeparation * 1e-6
  const LM = params.screenDistance * 1e-3
  const out: string[] = []

  if (exp === 'double') {
    if (dM <= aM) {
      out.push(`缝间距 d=${params.slitSeparation}μm 须大于缝宽 a=${params.slitWidth}μm，否则双缝重叠`)
    }
    const farField = dM * dM / lambda // 夫琅禾费远场条件 L ≥ d²/λ
    if (LM < farField) {
      out.push(`远场条件不满足：L=${params.screenDistance}mm < d²/λ≈${(farField * 1e3).toFixed(0)}mm`)
    }
  } else if (exp === 'single') {
    const farField = aM * aM / lambda // 夫琅禾费远场条件 L ≥ a²/λ
    if (LM < farField) {
      out.push(`远场条件不满足：L=${params.screenDistance}mm < a²/λ≈${(farField * 1e3).toFixed(0)}mm`)
    }
  } else { // newton
    if (params.wavelength < PARAM_BOUNDS.wavelength.min || params.wavelength > PARAM_BOUNDS.wavelength.max) {
      out.push('牛顿环实验需使用可见光波长')
    }
  }
  return out
}
