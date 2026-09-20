import { describe, it, expect } from 'vitest'
import {
  computeExperiment,
  applicabilityViolations,
  boundsViolations,
  DEFAULT_PARAMS,
  EXPERIMENT_IDS,
} from './optics'
import type { OpticsParams } from './optics'

const base: OpticsParams = { ...DEFAULT_PARAMS }

describe('computeExperiment 物理计算', () => {
  it('双缝条纹间距 Δy = λL/d', () => {
    const r = computeExperiment('double', base) // 550nm, d=200μm, L=1000mm
    expect(r.fringe).toBeCloseTo(2.75, 2)
    expect(r.intensity).toHaveLength(800)
  })

  it('单缝中央亮纹宽 2λL/a', () => {
    const r = computeExperiment('single', base) // a=50μm
    expect(r.centralWidth).toBeCloseTo(22.0, 2)
    expect(r.intensity).toHaveLength(800)
  })

  it('三类实验光强均在 [0,1] 且有限', () => {
    for (const exp of EXPERIMENT_IDS) {
      const r = computeExperiment(exp, base)
      for (const v of r.intensity) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('双缝图样中心光强为 1（主极大）', () => {
    const r = computeExperiment('double', base)
    const mid = r.intensity[r.intensity.length / 2]
    expect(mid).toBeCloseTo(1, 6)
  })
})

describe('boundsViolations 边界检查', () => {
  it('默认参数全部在边界内', () => {
    expect(boundsViolations(base)).toEqual([])
  })

  it('边界端点视为合法', () => {
    expect(boundsViolations({ wavelength: 380, slitWidth: 10, slitSeparation: 50, screenDistance: 100 })).toEqual([])
    expect(boundsViolations({ wavelength: 780, slitWidth: 200, slitSeparation: 500, screenDistance: 2000 })).toEqual([])
  })

  it('逐项检出越界参数', () => {
    expect(boundsViolations({ ...base, wavelength: 300 })).toHaveLength(1)
    expect(boundsViolations({ ...base, slitWidth: 500 })).toHaveLength(1)
    expect(boundsViolations({ ...base, slitSeparation: 10 })).toHaveLength(1)
    expect(boundsViolations({ ...base, screenDistance: 5000 })).toHaveLength(1)
    expect(boundsViolations({ wavelength: 0, slitWidth: 0, slitSeparation: 0, screenDistance: 0 })).toHaveLength(4)
  })

  it('非有限值视为越界', () => {
    expect(boundsViolations({ ...base, wavelength: NaN })).toHaveLength(1)
  })
})

describe('applicabilityViolations 适用条件', () => {
  it('默认参数三类实验均适用', () => {
    for (const exp of EXPERIMENT_IDS) {
      expect(applicabilityViolations(exp, base)).toEqual([])
    }
  })

  it('双缝：缝间距不大于缝宽时不适用', () => {
    const v = applicabilityViolations('double', { ...base, slitSeparation: 50, slitWidth: 50 })
    expect(v.some(s => s.includes('双缝重叠'))).toBe(true)
    // 单缝与牛顿环不受 d≤a 影响
    expect(applicabilityViolations('single', { ...base, slitSeparation: 50, slitWidth: 50 })).toEqual([])
  })

  it('双缝：远场条件 L ≥ d²/λ', () => {
    const v = applicabilityViolations('double', { ...base, slitSeparation: 500, wavelength: 380, screenDistance: 100 })
    expect(v.some(s => s.includes('远场条件'))).toBe(true)
  })

  it('单缝：远场条件 L ≥ a²/λ', () => {
    const v = applicabilityViolations('single', { ...base, slitWidth: 200, wavelength: 380, screenDistance: 100 })
    expect(v.some(s => s.includes('远场条件'))).toBe(true)
  })
})
