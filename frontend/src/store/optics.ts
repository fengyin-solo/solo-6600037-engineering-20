import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  computeExperiment,
  DEFAULT_PARAMS,
  type ExperimentId,
  type OpticsParams,
} from '../physics/optics'
import {
  runBatch,
  buildBaseline,
  parseBatchInput,
  validateSubmission,
  type BatchReport,
  type Baseline,
} from '../physics/regression'

const BASELINE_KEY = 'optics-batch-baseline-v1'

const SAMPLE_INPUT = `# 每行一组：波长nm, 缝宽μm, 缝间距μm, 屏幕距离mm
550, 50, 200, 1000
480, 30, 150, 800
650, 80, 300, 1200
550, 60, 50, 1000
700, 150, 400, 300`

function loadBaseline(): Baseline | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(BASELINE_KEY)
    return raw ? (JSON.parse(raw) as Baseline) : null
  } catch {
    return null
  }
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref<ExperimentId>('double')
  const params = ref<OpticsParams>({ ...DEFAULT_PARAMS })
  const intensityData = ref<number[]>([])
  const result = ref<{ fringe?: number; centralWidth?: number }>({})

  function setExperiment(id: ExperimentId) { currentExperiment.value = id; compute() }

  function compute() {
    const r = computeExperiment(currentExperiment.value, params.value)
    intensityData.value = r.intensity
    result.value = { fringe: r.fringe, centralWidth: r.centralWidth }
  }

  // ---- 批量回归检查 ----
  const batchInput = ref(SAMPLE_INPUT)
  const batchReport = ref<BatchReport | null>(null)
  const batchErrors = ref<string[]>([])
  const baseline = ref<Baseline | null>(loadBaseline())
  const baselineMessage = ref('')
  // 单项计算 ↔ 批量计算一致性自检结果（每次批量运行时校验）
  const consistencyOk = ref<boolean | null>(null)

  function collectCases(): { cases: OpticsParams[]; errors: string[] } {
    const { cases, errors } = parseBatchInput(batchInput.value)
    return { cases, errors: [...errors, ...validateSubmission(cases)] }
  }

  // 用当前单项参数与实验类型复算一遍共享模块，与界面即时结果逐项比对
  function selfConsistency(): boolean {
    const r = computeExperiment(currentExperiment.value, params.value)
    if (r.intensity.length !== intensityData.value.length) return false
    for (let i = 0; i < r.intensity.length; i++) {
      if (r.intensity[i] !== intensityData.value[i]) return false
    }
    if (currentExperiment.value === 'double') return r.fringe === result.value.fringe
    if (currentExperiment.value === 'single') return r.centralWidth === result.value.centralWidth
    return true
  }

  function runBatchCheck() {
    const { cases, errors } = collectCases()
    baselineMessage.value = ''
    if (errors.length) {
      batchErrors.value = errors
      batchReport.value = null
      return // 提交无效：不出报告，基线保持不动
    }
    batchErrors.value = []
    batchReport.value = runBatch(cases, baseline.value)
    consistencyOk.value = selfConsistency()
  }

  function saveAsBaseline() {
    const { cases, errors } = collectCases()
    baselineMessage.value = ''
    if (errors.length) {
      batchErrors.value = errors
      return // 无参数/重复组合：保留既有基线
    }
    const bl = buildBaseline(cases)
    if (!bl) {
      batchErrors.value = ['存在超出边界的参数组合，已保留既有基线']
      return
    }
    batchErrors.value = []
    baseline.value = bl
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify(bl))
      baselineMessage.value = `基线已保存（${bl.cases.length} 组）`
    } catch {
      baselineMessage.value = `基线已保存（${bl.cases.length} 组），但写入本地存储失败，仅本次会话有效`
    }
  }

  function clearBaseline() {
    baseline.value = null
    baselineMessage.value = '基线已清除'
    try { localStorage.removeItem(BASELINE_KEY) } catch { /* 无本地存储时忽略 */ }
  }

  return {
    currentExperiment, params, intensityData, result, setExperiment, compute,
    batchInput, batchReport, batchErrors, baseline, baselineMessage, consistencyOk,
    runBatchCheck, saveAsBaseline, clearBaseline,
  }
})
