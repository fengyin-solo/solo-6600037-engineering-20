import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOpticsStore } from './optics'
import { DEFAULT_PARAMS } from '../physics/optics'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('单项计算（既有行为保持不变）', () => {
  it('参数预设与默认实验类型不变', () => {
    const s = useOpticsStore()
    expect(s.currentExperiment).toBe('double')
    expect(s.params).toEqual(DEFAULT_PARAMS)
  })

  it('compute 即时更新光强与理论值', () => {
    const s = useOpticsStore()
    s.compute()
    expect(s.intensityData).toHaveLength(800)
    expect(s.result.fringe).toBeCloseTo(2.75, 2)
    s.params.wavelength = 650
    s.compute()
    expect(s.result.fringe).toBeCloseTo(3.25, 2)
  })

  it('切换实验后立即重算', () => {
    const s = useOpticsStore()
    s.compute()
    s.setExperiment('single')
    expect(s.intensityData).toHaveLength(800)
    expect(s.result.centralWidth).toBeCloseTo(22.0, 2)
    s.setExperiment('newton')
    expect(s.intensityData).toHaveLength(800)
  })
})

describe('批量回归检查', () => {
  it('运行批量检查后单项↔批量一致，覆盖三类实验', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    expect(s.batchErrors).toEqual([])
    expect(s.batchReport).not.toBeNull()
    expect(s.batchReport!.total).toBeGreaterThan(0)
    expect(s.consistencyOk).toBe(true)
    // 预填样本中第 4 组 d<a，双缝不适用 → 能被定位
    const failed = s.batchReport!.cases.filter(c => c.status === 'fail')
    expect(failed).toHaveLength(1)
    expect(failed[0].failureReasons.some(r => r.includes('双缝'))).toBe(true)
  })

  it('切换实验后批量与单项仍对得上', () => {
    const s = useOpticsStore()
    s.compute()
    for (const exp of ['single', 'newton', 'double'] as const) {
      s.setExperiment(exp)
      s.runBatchCheck()
      expect(s.consistencyOk).toBe(true)
    }
  })

  it('重试批量检查结果稳定', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    const first = JSON.stringify(s.batchReport!.cases.map(c => [c.key, c.status, c.failureReasons]))
    s.runBatchCheck()
    const second = JSON.stringify(s.batchReport!.cases.map(c => [c.key, c.status, c.failureReasons]))
    expect(second).toBe(first)
  })

  it('无参数提交：报错且既有基线不被覆盖', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    s.saveAsBaseline()
    const baselineRef = s.baseline
    expect(baselineRef).not.toBeNull()

    s.batchInput = '  \n# 空提交\n'
    s.runBatchCheck()
    expect(s.batchErrors.some(e => e.includes('未提交'))).toBe(true)
    expect(s.batchReport).toBeNull()
    expect(s.baseline).toBe(baselineRef)

    s.saveAsBaseline()
    expect(s.baseline).toBe(baselineRef)
  })

  it('重复组合：报错且既有基线不被覆盖', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    s.saveAsBaseline()
    const baselineRef = s.baseline

    s.batchInput = '550, 50, 200, 1000\n550, 50, 200, 1000'
    s.runBatchCheck()
    expect(s.batchErrors.some(e => e.includes('重复'))).toBe(true)
    expect(s.baseline).toBe(baselineRef)

    s.saveAsBaseline()
    expect(s.baseline).toBe(baselineRef)
  })

  it('超出边界：组合标记失败且既有基线不被覆盖', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    s.saveAsBaseline()
    const baselineRef = s.baseline

    s.batchInput = '550, 50, 200, 1000\n900, 50, 200, 1000'
    s.runBatchCheck()
    expect(s.batchErrors).toEqual([])
    expect(s.batchReport!.failed).toBe(1)
    expect(s.batchReport!.cases[1].boundsErrors.length).toBeGreaterThan(0)

    s.saveAsBaseline()
    expect(s.batchErrors.some(e => e.includes('边界'))).toBe(true)
    expect(s.baseline).toBe(baselineRef)
  })

  it('保存基线后，相同提交回归为零；修改参数提交则定位差异', () => {
    const s = useOpticsStore()
    s.compute()
    s.runBatchCheck()
    s.saveAsBaseline()
    expect(s.baseline).not.toBeNull()

    s.runBatchCheck()
    expect(s.batchReport!.comparedToBaseline).toBe(true)
    expect(s.batchReport!.regressionCount).toBe(0)

    // 手工篡改基线模拟代码回归
    s.baseline!.cases[0].results.double.fringe = 0.01
    s.runBatchCheck()
    expect(s.batchReport!.regressionCount).toBe(1)
    expect(s.batchReport!.cases[0].failureReasons.some(r => r.includes('回归差异'))).toBe(true)
  })
})
