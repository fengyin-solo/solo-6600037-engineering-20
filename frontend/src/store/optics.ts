import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  DEFAULT_PARAMS,
  ExperimentId,
  OpticsParams,
  ScalarResult,
  computeExperiment,
} from '../lib/physics'
import {
  Baseline,
  BaselineFile,
  BaselineMeta,
  BatchRejection,
  BatchRunOk,
  buildBaselineEntries,
  runBatch,
} from '../lib/batch'

const BASELINE_STORAGE_KEY = 'optics-batch-baseline-v1'

function loadBaseline(): BaselineFile | null {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BaselineFile
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) return null
    return parsed
  } catch {
    return null
  }
}

function saveBaseline(file: BaselineFile | null) {
  try {
    if (file) localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(file))
    else localStorage.removeItem(BASELINE_STORAGE_KEY)
  } catch {
    // 非浏览器环境（如测试）下静默跳过持久化
  }
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref<ExperimentId>('double')
  const params = ref<OpticsParams>({ ...DEFAULT_PARAMS })
  const intensityData = ref<number[]>([])
  const result = ref<ScalarResult>({})

  function setExperiment(id: ExperimentId) {
    currentExperiment.value = id
    compute()
  }

  function compute() {
    const { intensityData: data, ...scalar } = computeExperiment(currentExperiment.value, params.value)
    result.value = scalar
    intensityData.value = data
  }

  // ---- 批量回归检查 ----
  const persisted = loadBaseline()
  const baseline = ref<Baseline>(persisted?.entries ?? {})
  const baselineMeta = ref<BaselineMeta | null>(persisted?.meta ?? null)
  const batchReport = ref<BatchRunOk | null>(null)
  const batchRejection = ref<BatchRejection | null>(null)

  /**
   * 运行批量回归。
   * - 无参数 / 重复组合 / 超出边界：拒绝运行，既有基线原样保留。
   * - 正常运行：与既有基线比对；尚无任何基线时自动以本次结果建立基线；
   *   updateBaseline=true 时显式用本次结果覆盖基线。
   */
  function runBatchRegression(groups: OpticsParams[], opts?: { updateBaseline?: boolean }) {
    const outcome = runBatch(groups, baseline.value)
    if (!outcome.ok) {
      batchRejection.value = outcome.rejection
      return outcome
    }
    batchRejection.value = null
    const hasBaseline = Object.keys(baseline.value).length > 0
    if (opts?.updateBaseline || !hasBaseline) {
      baseline.value = buildBaselineEntries(groups)
      baselineMeta.value = { createdAt: new Date().toISOString(), groupCount: groups.length }
      saveBaseline({ meta: baselineMeta.value, entries: baseline.value })
      if (hasBaseline) {
        // 显式覆盖既有基线：以新基线重新出报告，保证报告与基线一致
        const rerun = runBatch(groups, baseline.value)
        if (rerun.ok) {
          batchReport.value = rerun
          return rerun
        }
      }
    }
    batchReport.value = outcome
    return outcome
  }

  function clearBaseline() {
    baseline.value = {}
    baselineMeta.value = null
    saveBaseline(null)
  }

  return {
    currentExperiment,
    params,
    intensityData,
    result,
    setExperiment,
    compute,
    baseline,
    baselineMeta,
    batchReport,
    batchRejection,
    runBatchRegression,
    clearBaseline,
  }
})
