// 批量回归检查：一次提交多组参数，逐组核对三类实验结果与既有基线，定位失败组合。
// 守卫规则：无参数 / 重复组合 / 超出边界 / 格式错误 → 拒绝运行，且绝不覆盖既有基线。

import {
  EXPERIMENTS,
  OpticsParams,
  ExperimentId,
  ScalarResult,
  applicabilityWarnings,
  computeExperiment,
  validateParams,
} from './physics'

export interface IntensitySummary {
  length: number
  max: number
  sum: number
  checksum: number
}

export interface BaselineEntry {
  result: ScalarResult
  summary: IntensitySummary
}

/** groupKey -> experimentId -> entry */
export type Baseline = Record<string, Partial<Record<ExperimentId, BaselineEntry>>>

export interface BaselineMeta {
  createdAt: string
  groupCount: number
}

export interface BaselineFile {
  meta: BaselineMeta
  entries: Baseline
}

export type BatchRejection =
  | { reason: 'empty'; message: string }
  | { reason: 'parse'; message: string; lines: number[] }
  | { reason: 'duplicate'; message: string; groups: number[][] }
  | { reason: 'out-of-bounds'; message: string; violations: { index: number; errors: string[] }[] }

export interface ExperimentReport {
  result: ScalarResult
  warnings: string[]
  status: 'pass' | 'fail'
  diffs: string[]
}

export interface GroupReport {
  index: number
  params: OpticsParams
  experiments: Record<ExperimentId, ExperimentReport>
  status: 'pass' | 'fail'
}

export interface BatchRunOk {
  ok: true
  groups: GroupReport[]
  failedIndices: number[]
  comparedAgainstBaseline: boolean
}

export interface BatchRunRejected {
  ok: false
  rejection: BatchRejection
}

export type BatchRunOutcome = BatchRunOk | BatchRunRejected

export function groupKey(p: OpticsParams): string {
  return `${p.wavelength}|${p.slitWidth}|${p.slitSeparation}|${p.screenDistance}`
}

/** 找出重复组合，返回重复组的下标分组（如 [[0,2],[1,3,4]]） */
export function findDuplicateGroups(groups: OpticsParams[]): number[][] {
  const seen = new Map<string, number[]>()
  groups.forEach((g, i) => {
    const k = groupKey(g)
    const arr = seen.get(k)
    if (arr) arr.push(i)
    else seen.set(k, [i])
  })
  return [...seen.values()].filter((arr) => arr.length > 1)
}

/** 光强序列摘要：用于基线比对，避免在基线中存储完整 800 点序列 */
export function summarizeIntensity(data: number[]): IntensitySummary {
  let max = 0
  let sum = 0
  let checksum = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (v > max) max = v
    sum += v
    checksum += (i + 1) * v
  }
  return { length: data.length, max, sum, checksum }
}

const EPS = 1e-9

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b))
}

function diffScalar(exp: ExperimentId, got: ScalarResult, want: ScalarResult): string[] {
  const diffs: string[] = []
  const fields: { key: keyof ScalarResult; label: string }[] = [
    { key: 'fringe', label: '条纹间距' },
    { key: 'centralWidth', label: '中央亮纹宽' },
    { key: 'firstRingRadius', label: '第一暗环半径' },
  ]
  for (const { key, label } of fields) {
    const g = got[key]
    const w = want[key]
    if (g === undefined && w === undefined) continue
    if (g === undefined || w === undefined || !closeEnough(g, w)) {
      diffs.push(`${exp}/${label}: 期望 ${w}，实际 ${g}`)
    }
  }
  return diffs
}

function diffSummary(got: IntensitySummary, want: IntensitySummary): string[] {
  const diffs: string[] = []
  if (got.length !== want.length) diffs.push(`光强序列长度: 期望 ${want.length}，实际 ${got.length}`)
  if (!closeEnough(got.max, want.max)) diffs.push(`光强峰值: 期望 ${want.max}，实际 ${got.max}`)
  if (!closeEnough(got.sum, want.sum)) diffs.push(`光强总和: 期望 ${want.sum}，实际 ${got.sum}`)
  if (!closeEnough(got.checksum, want.checksum)) diffs.push('光强分布校验和不匹配')
  return diffs
}

/** 提交前校验：返回拒绝原因；null 表示可以运行。拒绝时调用方不得触碰基线。 */
export function preflight(groups: OpticsParams[]): BatchRejection | null {
  if (!groups || groups.length === 0) {
    return { reason: 'empty', message: '未提交任何参数组合，批量回归未运行，既有基线保持不变' }
  }
  const dups = findDuplicateGroups(groups)
  if (dups.length > 0) {
    return {
      reason: 'duplicate',
      message: `存在 ${dups.length} 处重复参数组合（第 ${dups.map((g) => g.map((i) => i + 1).join('/')).join('、')} 组），已拒绝运行，既有基线保持不变`,
      groups: dups,
    }
  }
  const violations = groups
    .map((g, i) => ({ index: i, errors: validateParams(g) }))
    .filter((v) => v.errors.length > 0)
  if (violations.length > 0) {
    return {
      reason: 'out-of-bounds',
      message: `第 ${violations.map((v) => v.index + 1).join('、')} 组参数超出边界，已拒绝运行，既有基线保持不变`,
      violations,
    }
  }
  return null
}

/** 用一批组合构建基线条目 */
export function buildBaselineEntries(groups: OpticsParams[]): Baseline {
  const entries: Baseline = {}
  for (const g of groups) {
    const perExp: Partial<Record<ExperimentId, BaselineEntry>> = {}
    for (const exp of EXPERIMENTS) {
      const { intensityData, ...scalar } = computeExperiment(exp.id, g)
      perExp[exp.id] = { result: scalar, summary: summarizeIntensity(intensityData) }
    }
    entries[groupKey(g)] = perExp
  }
  return entries
}

/**
 * 运行批量回归。
 * - 任一守卫触发：返回 ok:false，调用方必须保持基线不变。
 * - 正常运行：逐组 × 逐实验计算（与单项 compute 同源），与 baseline 对比；
 *   baseline 为空时仅计算不判失败（comparedAgainstBaseline=false）。
 */
export function runBatch(groups: OpticsParams[], baseline: Baseline | null): BatchRunOutcome {
  const rejection = preflight(groups)
  if (rejection) return { ok: false, rejection }

  const hasBaseline = !!baseline && Object.keys(baseline).length > 0
  const reports: GroupReport[] = groups.map((params, index) => {
    const key = groupKey(params)
    const experiments = {} as Record<ExperimentId, ExperimentReport>
    for (const exp of EXPERIMENTS) {
      const { intensityData, ...scalar } = computeExperiment(exp.id, params)
      const warnings = applicabilityWarnings(exp.id, params)
      const diffs: string[] = []
      const base = hasBaseline ? baseline![key]?.[exp.id] : undefined
      if (hasBaseline) {
        if (!base) {
          diffs.push('基线中不存在该组合，无法比对')
        } else {
          diffs.push(...diffScalar(exp.id, scalar, base.result))
          diffs.push(...diffSummary(summarizeIntensity(intensityData), base.summary))
        }
      }
      experiments[exp.id] = { result: scalar, warnings, status: diffs.length ? 'fail' : 'pass', diffs }
    }
    const status = EXPERIMENTS.some((e) => experiments[e.id].status === 'fail') ? 'fail' : 'pass'
    return { index, params, experiments, status }
  })

  return {
    ok: true,
    groups: reports,
    failedIndices: reports.filter((r) => r.status === 'fail').map((r) => r.index),
    comparedAgainstBaseline: hasBaseline,
  }
}

/** 解析批量输入：每行一组 `波长,缝宽,缝间距,屏幕距离`，支持逗号/空白分隔，# 开头为注释 */
export function parseBatchInput(text: string): { groups: OpticsParams[]; badLines: number[] } {
  const groups: OpticsParams[] = []
  const badLines: number[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const parts = line.split(/[,\s]+/).map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      badLines.push(i + 1)
      return
    }
    const [wavelength, slitWidth, slitSeparation, screenDistance] = parts
    groups.push({ wavelength, slitWidth, slitSeparation, screenDistance })
  })
  return { groups, badLines }
}
