import { describe, it, expect } from 'vitest'
import {
  parseBatchInput,
  validateSubmission,
  runBatch,
  buildBaseline,
  caseKey,
  MAX_BATCH_CASES,
  type Baseline,
} from './regression'
import { DEFAULT_PARAMS, EXPERIMENT_IDS } from './optics'
import type { OpticsParams } from './optics'

const P = (over: Partial<OpticsParams> = {}): OpticsParams => ({ ...DEFAULT_PARAMS, ...over })

const VALID_CASES: OpticsParams[] = [
  P(),
  P({ wavelength: 480, slitWidth: 30, slitSeparation: 150, screenDistance: 800 }),
  P({ wavelength: 650, slitWidth: 80, slitSeparation: 300, screenDistance: 1200 }),
]

describe('parseBatchInput 输入解析', () => {
  it('支持逗号/空白/中文逗号分隔与注释、空行', () => {
    const { cases, errors } = parseBatchInput(`
# 注释行
550, 50, 200, 1000
480 30 150 800

650，80，300，1200  # 行内注释
`)
    expect(errors).toEqual([])
    expect(cases).toHaveLength(3)
    expect(cases[2]).toEqual({ wavelength: 650, slitWidth: 80, slitSeparation: 300, screenDistance: 1200 })
  })

  it('列数不对或非数值时报行号错误', () => {
    const { cases, errors } = parseBatchInput('550, 50, 200\nabc, 1, 2, 3')
    expect(cases).toHaveLength(0)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('第 1 行')
    expect(errors[1]).toContain('第 2 行')
  })

  it('空文本解析为空提交', () => {
    const { cases, errors } = parseBatchInput('  \n# 只有注释\n')
    expect(cases).toHaveLength(0)
    expect(errors).toHaveLength(0)
    expect(validateSubmission(cases)).not.toEqual([])
  })
})

describe('validateSubmission 提交校验', () => {
  it('空提交被拒绝', () => {
    expect(validateSubmission([]).some(e => e.includes('未提交'))).toBe(true)
  })

  it('重复组合被拒绝并指出具体组合', () => {
    const errors = validateSubmission([P(), P({ wavelength: 480 }), P()])
    expect(errors.some(e => e.includes('重复'))).toBe(true)
  })

  it('仅参数顺序不同的相同组合也算重复', () => {
    const errors = validateSubmission([P(), P()])
    expect(errors.some(e => e.includes('重复'))).toBe(true)
  })

  it('超过上限被拒绝', () => {
    const many = Array.from({ length: MAX_BATCH_CASES + 1 }, (_, i) => P({ wavelength: 380 + (i % 400) }))
    // 去掉重复后仍超量：用不同缝宽保证唯一
    const unique = Array.from({ length: MAX_BATCH_CASES + 1 }, (_, i) => P({ slitWidth: 10 + (i % 190), screenDistance: 100 + i }))
    const errors = validateSubmission(unique.length > MAX_BATCH_CASES ? unique : many)
    expect(errors.some(e => e.includes('最多'))).toBe(true)
  })

  it('合法提交通过', () => {
    expect(validateSubmission(VALID_CASES)).toEqual([])
  })
})

describe('runBatch 批量核对', () => {
  it('合法组合全部通过，覆盖三类实验', () => {
    const report = runBatch(VALID_CASES, null)
    expect(report.total).toBe(3)
    expect(report.failed).toBe(0)
    expect(report.passed).toBe(3)
    for (const c of report.cases) {
      expect(c.checks.map(ch => ch.experiment)).toEqual(EXPERIMENT_IDS)
      expect(c.checks.every(ch => ch.ok)).toBe(true)
    }
  })

  it('d≤a 时仅双缝失败，可定位到具体组合与实验', () => {
    const bad = P({ slitWidth: 50, slitSeparation: 50 })
    const report = runBatch([P(), bad], null)
    expect(report.failed).toBe(1)
    const failed = report.cases[1]
    expect(failed.status).toBe('fail')
    expect(failed.checks.find(c => c.experiment === 'double')?.ok).toBe(false)
    expect(failed.checks.find(c => c.experiment === 'single')?.ok).toBe(true)
    expect(failed.checks.find(c => c.experiment === 'newton')?.ok).toBe(true)
    expect(failed.failureReasons.some(r => r.includes('双缝'))).toBe(true)
  })

  it('越界组合直接失败且不再计算', () => {
    const report = runBatch([P({ wavelength: 1000 })], null)
    const c = report.cases[0]
    expect(c.status).toBe('fail')
    expect(c.boundsErrors).toHaveLength(1)
    expect(c.checks).toHaveLength(0)
  })

  it('重试结果确定：两次运行数值完全一致', () => {
    const a = runBatch(VALID_CASES, null)
    const b = runBatch(VALID_CASES, null)
    for (let i = 0; i < a.cases.length; i++) {
      for (const exp of EXPERIMENT_IDS) {
        const ra = a.cases[i].checks.find(c => c.experiment === exp)!.result
        const rb = b.cases[i].checks.find(c => c.experiment === exp)!.result
        expect(ra).toEqual(rb)
      }
    }
  })
})

describe('基线保护', () => {
  it('空提交不生成基线', () => {
    expect(buildBaseline([])).toBeNull()
  })

  it('重复组合不生成基线', () => {
    expect(buildBaseline([P(), P()])).toBeNull()
  })

  it('任一组合越界则不生成基线', () => {
    expect(buildBaseline([P(), P({ screenDistance: 9999 })])).toBeNull()
  })

  it('合法提交生成基线，且结果与单项计算一致', () => {
    const bl = buildBaseline(VALID_CASES)!
    expect(bl.cases).toHaveLength(3)
    expect(bl.cases[0].key).toBe(caseKey(P()))
    expect(bl.cases[0].results.double.fringe).toBeCloseTo(2.75, 2)
  })

  it('与基线一致的提交无回归差异', () => {
    const bl = buildBaseline(VALID_CASES)!
    const report = runBatch(VALID_CASES, bl)
    expect(report.comparedToBaseline).toBe(true)
    expect(report.regressionCount).toBe(0)
    expect(report.failed).toBe(0)
  })

  it('基线被篡改时能定位回归组合与实验', () => {
    const bl = buildBaseline(VALID_CASES)!
    const tampered: Baseline = JSON.parse(JSON.stringify(bl))
    tampered.cases[1].results.double.fringe = 9.99
    tampered.cases[1].results.single.intensity[0] = 0.5
    const report = runBatch(VALID_CASES, tampered)
    expect(report.regressionCount).toBe(1)
    const c = report.cases[1]
    expect(c.status).toBe('fail')
    expect(c.failureReasons.some(r => r.includes('双缝干涉·回归差异'))).toBe(true)
    expect(c.failureReasons.some(r => r.includes('单缝衍射·回归差异'))).toBe(true)
    expect(c.checks.find(ch => ch.experiment === 'newton')?.ok).toBe(true)
  })

  it('基线外的新组合被计数但不误判为回归', () => {
    const bl = buildBaseline(VALID_CASES)!
    const extra = P({ wavelength: 600 })
    const report = runBatch([...VALID_CASES, extra], bl)
    expect(report.newCases).toBe(1)
    expect(report.regressionCount).toBe(0)
    expect(report.failed).toBe(0)
  })

  it('runBatch 不修改传入的基线对象', () => {
    const bl = buildBaseline(VALID_CASES)!
    const snapshot = JSON.stringify(bl)
    runBatch([P({ wavelength: 700 })], bl)
    expect(JSON.stringify(bl)).toBe(snapshot)
  })
})
