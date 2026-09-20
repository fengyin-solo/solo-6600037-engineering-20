// 批量回归检查引擎
// 一次提交多组参数，逐组核对三类实验的计算结果与适用条件，并与既有基线对比定位回归。
// 基线保护规则：无参数、重复组合或超出边界时，一律不覆盖既有基线。

import {
  computeExperiment,
  applicabilityViolations,
  boundsViolations,
  EXPERIMENT_IDS,
  EXPERIMENT_NAMES,
  type ExperimentId,
  type ExperimentResult,
  type OpticsParams,
} from './optics'

export interface ExperimentCheck {
  experiment: ExperimentId
  applicable: boolean
  violations: string[]      // 适用条件违规
  sanityErrors: string[]    // 计算结果异常
  baselineDiffs: string[]   // 与既有基线的回归差异
  result: ExperimentResult
  ok: boolean
}

export interface CaseReport {
  index: number
  key: string
  params: OpticsParams
  boundsErrors: string[]    // 越界错误（越界时不再计算）
  checks: ExperimentCheck[]
  status: 'pass' | 'fail'
  failureReasons: string[]  // 汇总，用于定位失败组合
}

export interface BatchReport {
  id: number
  ranAt: number
  cases: CaseReport[]
  total: number
  passed: number
  failed: number
  comparedToBaseline: boolean
  regressionCount: number // 与基线不一致的组合数
  newCases: number        // 基线中不存在的新组合数
}

export interface BaselineCase {
  key: string
  params: OpticsParams
  results: Record<ExperimentId, ExperimentResult>
}

export interface Baseline {
  savedAt: number
  cases: BaselineCase[]
}

export const MAX_BATCH_CASES = 50
const INTENSITY_TOL = 1e-9

/** 参数组合的规范化标识，用于重复检测与基线匹配 */
export function caseKey(p: OpticsParams): string {
  return `${p.wavelength}|${p.slitWidth}|${p.slitSeparation}|${p.screenDistance}`
}

export function formatCase(p: OpticsParams): string {
  return `λ=${p.wavelength}nm, a=${p.slitWidth}μm, d=${p.slitSeparation}μm, L=${p.screenDistance}mm`
}

export function findDuplicates(cases: OpticsParams[]): OpticsParams[] {
  const count = new Map<string, number>()
  const dups = new Map<string, OpticsParams>()
  for (const c of cases) {
    const k = caseKey(c)
    const n = (count.get(k) ?? 0) + 1
    count.set(k, n)
    if (n > 1) dups.set(k, c)
  }
  return [...dups.values()]
}

/** 提交级校验：空提交、超量、重复组合。返回错误列表，空数组表示可提交 */
export function validateSubmission(cases: OpticsParams[]): string[] {
  const errors: string[] = []
  if (cases.length === 0) {
    errors.push('未提交任何参数组合')
    return errors
  }
  if (cases.length > MAX_BATCH_CASES) {
    errors.push(`一次最多提交 ${MAX_BATCH_CASES} 组参数，当前 ${cases.length} 组`)
  }
  const dups = findDuplicates(cases)
  if (dups.length) {
    errors.push(`存在重复参数组合：${dups.map(formatCase).join('；')}`)
  }
  return errors
}

/** 解析批量输入：每行一组「波长, 缝宽, 缝间距, 屏幕距离」，支持 # 注释与空行 */
export function parseBatchInput(text: string): { cases: OpticsParams[]; errors: string[] } {
  const cases: OpticsParams[] = []
  const errors: string[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.split('#')[0].trim()
    if (!line) return
    const parts = line.split(/[\s,，、]+/).filter(Boolean)
    if (parts.length !== 4) {
      errors.push(`第 ${i + 1} 行：需要 4 个数值（波长,缝宽,缝间距,屏幕距离），实际 ${parts.length} 个`)
      return
    }
    const nums = parts.map(Number)
    if (nums.some(n => !Number.isFinite(n))) {
      errors.push(`第 ${i + 1} 行：包含非数值内容「${line}」`)
      return
    }
    cases.push({
      wavelength: nums[0],
      slitWidth: nums[1],
      slitSeparation: nums[2],
      screenDistance: nums[3],
    })
  })
  return { cases, errors }
}

function sanityErrors(exp: ExperimentId, r: ExperimentResult): string[] {
  const errs: string[] = []
  for (const v of r.intensity) {
    if (!Number.isFinite(v) || v < -1e-12 || v > 1 + 1e-9) {
      errs.push('光强数据异常（非有限值或超出 [0,1]）')
      break
    }
  }
  if (exp === 'double' && !(Number.isFinite(r.fringe) && (r.fringe as number) > 0)) {
    errs.push('条纹间距计算结果异常')
  }
  if (exp === 'single' && !(Number.isFinite(r.centralWidth) && (r.centralWidth as number) > 0)) {
    errs.push('中央亮纹宽计算结果异常')
  }
  return errs
}

function diffResults(exp: ExperimentId, actual: ExperimentResult, expected: ExperimentResult): string[] {
  const diffs: string[] = []
  if (exp === 'double' && actual.fringe !== expected.fringe) {
    diffs.push(`条纹间距 ${actual.fringe}mm ≠ 基线 ${expected.fringe}mm`)
  }
  if (exp === 'single' && actual.centralWidth !== expected.centralWidth) {
    diffs.push(`中央亮纹宽 ${actual.centralWidth}mm ≠ 基线 ${expected.centralWidth}mm`)
  }
  if (actual.intensity.length !== expected.intensity.length) {
    diffs.push(`光强采样点数 ${actual.intensity.length} ≠ 基线 ${expected.intensity.length}`)
  } else {
    let maxDiff = 0
    for (let i = 0; i < actual.intensity.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(actual.intensity[i] - expected.intensity[i]))
    }
    if (maxDiff > INTENSITY_TOL) {
      diffs.push(`光强分布最大偏差 ${maxDiff.toExponential(2)} 超过容差 ${INTENSITY_TOL}`)
    }
  }
  return diffs
}

let reportSeq = 0

/**
 * 执行批量回归：逐组 × 三实验计算，核对适用条件与结果合理性；
 * 若提供基线则逐组对比定位回归差异。本函数永不修改基线。
 */
export function runBatch(cases: OpticsParams[], baseline: Baseline | null): BatchReport {
  const baselineMap = new Map<string, BaselineCase>(baseline?.cases.map(c => [c.key, c]) ?? [])

  const reports: CaseReport[] = cases.map((params, index) => {
    const key = caseKey(params)
    const boundsErrors = boundsViolations(params)
    const checks: ExperimentCheck[] = []

    if (boundsErrors.length === 0) {
      for (const exp of EXPERIMENT_IDS) {
        const result = computeExperiment(exp, params)
        const violations = applicabilityViolations(exp, params)
        const sanity = sanityErrors(exp, result)
        const base = baselineMap.get(key)
        const baselineDiffs = base ? diffResults(exp, result, base.results[exp]) : []
        checks.push({
          experiment: exp,
          applicable: violations.length === 0,
          violations,
          sanityErrors: sanity,
          baselineDiffs,
          result,
          ok: violations.length === 0 && sanity.length === 0 && baselineDiffs.length === 0,
        })
      }
    }

    const failureReasons: string[] = [...boundsErrors]
    for (const c of checks) {
      const name = EXPERIMENT_NAMES[c.experiment]
      failureReasons.push(...c.violations.map(v => `${name}·适用条件：${v}`))
      failureReasons.push(...c.sanityErrors.map(v => `${name}·结果异常：${v}`))
      failureReasons.push(...c.baselineDiffs.map(v => `${name}·回归差异：${v}`))
    }

    return {
      index,
      key,
      params,
      boundsErrors,
      checks,
      status: failureReasons.length ? 'fail' as const : 'pass' as const,
      failureReasons,
    }
  })

  return {
    id: ++reportSeq,
    ranAt: Date.now(),
    cases: reports,
    total: reports.length,
    passed: reports.filter(r => r.status === 'pass').length,
    failed: reports.filter(r => r.status === 'fail').length,
    comparedToBaseline: baseline !== null,
    regressionCount: reports.filter(r => r.checks.some(c => c.baselineDiffs.length > 0)).length,
    newCases: baseline ? reports.filter(r => !baselineMap.has(r.key)).length : 0,
  }
}

/**
 * 由当前提交生成基线。
 * 无参数、重复组合或任一组合超出边界时返回 null —— 调用方必须保留既有基线。
 */
export function buildBaseline(cases: OpticsParams[]): Baseline | null {
  if (validateSubmission(cases).length > 0) return null
  if (cases.some(c => boundsViolations(c).length > 0)) return null
  return {
    savedAt: Date.now(),
    cases: cases.map(params => {
      const results = {} as Record<ExperimentId, ExperimentResult>
      for (const exp of EXPERIMENT_IDS) results[exp] = computeExperiment(exp, params)
      return { key: caseKey(params), params: { ...params }, results }
    }),
  }
}
