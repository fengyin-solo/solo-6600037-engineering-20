import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOpticsStore } from '../../store/optics'
import { DEFAULT_PARAMS, EXPERIMENTS, OpticsParams, computeExperiment } from '../physics'
import { findDuplicateGroups, parseBatchInput, runBatch } from '../batch'

const g1: OpticsParams = { wavelength: 550, slitWidth: 50, slitSeparation: 200, screenDistance: 1000 }
const g2: OpticsParams = { wavelength: 600, slitWidth: 100, slitSeparation: 300, screenDistance: 1500 }

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('原有行为保持不变', () => {
  it('默认参数预设不变', () => {
    const store = useOpticsStore()
    expect(store.params).toEqual(DEFAULT_PARAMS)
    expect(store.params).toEqual({ wavelength: 550, slitWidth: 50, slitSeparation: 200, screenDistance: 1000 })
    expect(store.currentExperiment).toBe('double')
  })

  it('单项计算结果与物理公式一致（即时反馈数据源不变）', () => {
    const store = useOpticsStore()
    store.compute()
    // 双缝: Δy = λL/d = 550e-9 * 1 / 200e-6 = 2.75 mm
    expect(store.result.fringe).toBe(2.75)
    expect(store.intensityData.length).toBe(800)
    store.setExperiment('single')
    // 单缝: 2λL/a = 2 * 550e-9 * 1 / 50e-6 = 22 mm
    expect(store.result.centralWidth).toBe(22)
  })
})

describe('批量结果与单项计算一致（启动 / 重试 / 切换实验）', () => {
  it('切换实验后，批量报告中的标量与光强序列和单项 compute 完全相等', () => {
    const store = useOpticsStore()
    const out = store.runBatchRegression([g1, g2])
    expect(out.ok).toBe(true)

    for (const exp of EXPERIMENTS) {
      store.setExperiment(exp.id)
      const direct = computeExperiment(exp.id, g1)
      const report = store.batchReport!.groups[0].experiments[exp.id]
      // 批量 vs 单项 store
      expect(report.result).toEqual(store.result)
      // 批量 vs 纯函数
      expect(report.result).toEqual({
        fringe: direct.fringe,
        centralWidth: direct.centralWidth,
        firstRingRadius: direct.firstRingRadius,
      })
      expect(store.intensityData).toEqual(direct.intensityData)
    }
  })

  it('重试两次结果完全一致', () => {
    const store = useOpticsStore()
    store.runBatchRegression([g1, g2]) // 首次运行建立基线
    store.runBatchRegression([g1, g2])
    const first = JSON.stringify(store.batchReport)
    store.runBatchRegression([g1, g2])
    expect(JSON.stringify(store.batchReport)).toBe(first)
  })
})

describe('基线保护：无参数 / 重复组合 / 超出边界时不覆盖既有基线', () => {
  it('三种非法提交均被拒绝且基线原样保留', () => {
    const store = useOpticsStore()
    store.runBatchRegression([g1, g2]) // 首次成功运行，自动建立基线
    const baselineBefore = JSON.stringify(store.baseline)
    const metaBefore = JSON.stringify(store.baselineMeta)

    const empty = store.runBatchRegression([])
    expect(empty.ok).toBe(false)
    expect(store.batchRejection?.reason).toBe('empty')

    const dup = store.runBatchRegression([g1, g2, { ...g1 }])
    expect(dup.ok).toBe(false)
    expect(store.batchRejection?.reason).toBe('duplicate')

    const oob = store.runBatchRegression([g1, { ...g2, wavelength: 1000 }])
    expect(oob.ok).toBe(false)
    expect(store.batchRejection?.reason).toBe('out-of-bounds')

    expect(JSON.stringify(store.baseline)).toBe(baselineBefore)
    expect(JSON.stringify(store.baselineMeta)).toBe(metaBefore)
  })

  it('空提交时即使本来就没有基线，也不会意外建立基线', () => {
    const store = useOpticsStore()
    const out = store.runBatchRegression([])
    expect(out.ok).toBe(false)
    expect(Object.keys(store.baseline).length).toBe(0)
    expect(store.baselineMeta).toBeNull()
  })
})

describe('失败组合定位', () => {
  it('偏离基线的组合被逐组定位，其余组合通过', () => {
    const store = useOpticsStore()
    store.runBatchRegression([g1, g2]) // 建立基线

    const drifted = { ...g2, wavelength: g2.wavelength + 50 }
    const out = store.runBatchRegression([g1, drifted])
    expect(out.ok).toBe(true)
    expect(store.batchReport!.failedIndices).toEqual([1])
    expect(store.batchReport!.groups[0].status).toBe('pass')
    expect(store.batchReport!.groups[1].status).toBe('fail')
    // 三类实验都因波长变化而失配，且给出差异描述
    for (const exp of EXPERIMENTS) {
      const r = store.batchReport!.groups[1].experiments[exp.id]
      expect(r.status).toBe('fail')
      expect(r.diffs.length).toBeGreaterThan(0)
    }
  })

  it('显式覆盖基线后，原失败组合转为通过', () => {
    const store = useOpticsStore()
    store.runBatchRegression([g1])
    const changed = { ...g1, slitSeparation: 250 }
    store.runBatchRegression([changed])
    expect(store.batchReport!.failedIndices).toEqual([0])
    store.runBatchRegression([changed], { updateBaseline: true })
    expect(store.batchReport!.failedIndices).toEqual([])
  })
})

describe('批量输入解析与适用条件', () => {
  it('解析多行输入，跳过空行与注释，标记格式错误行', () => {
    const { groups, badLines } = parseBatchInput('550,50,200,1000\n# 注释\n\n600 100 300 1500\nabc,1,2,3\n1,2,3')
    expect(groups).toEqual([g1, g2])
    expect(badLines).toEqual([5, 6])
  })

  it('重复组合检测返回重复下标分组', () => {
    expect(findDuplicateGroups([g1, g2, { ...g1 }, g2])).toEqual([[0, 2], [1, 3]])
    expect(findDuplicateGroups([g1, g2])).toEqual([])
  })

  it('超出物理适用条件时给出警告（缝间距小于缝宽）', () => {
    const weird: OpticsParams = { wavelength: 550, slitWidth: 200, slitSeparation: 100, screenDistance: 1000 }
    const out = runBatch([weird], null)
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.groups[0].experiments.double.warnings.length).toBeGreaterThan(0)
      expect(out.groups[0].experiments.newton.warnings.length).toBe(0)
    }
  })
})
