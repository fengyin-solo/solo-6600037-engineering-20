<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">光学干涉衍射仿真实验台</h1>
      <p class="text-sm text-slate-500 mt-1">双缝干涉 · 单缝衍射 · 牛顿环 · 波长调节 · 光强热力图</p>
    </header>
    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-1/4 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">实验类型</h3>
          <div class="space-y-1">
            <button v-for="exp in experiments" :key="exp.id" @click="store.setExperiment(exp.id)"
              :class="['w-full text-left p-2 rounded border text-sm transition-all', store.currentExperiment === exp.id ? 'border-cyan-500 bg-cyan-900/30 text-cyan-400' : 'border-slate-700 text-slate-300 hover:border-slate-500']">
              {{ exp.name }}
            </button>
          </div>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
          <h3 class="text-sm font-bold text-slate-400">参数调节</h3>
          <div>
            <label class="text-xs text-slate-500">波长 λ = {{ store.params.wavelength }} nm</label>
            <input type="range" min="380" max="780" step="5" v-model.number="store.params.wavelength" @input="store.compute" class="w-full accent-cyan-500" />
            <div class="flex justify-between text-xs mt-0.5">
              <span style="color:#8b5cf6">380</span><span style="color:#06b6d4">500</span><span style="color:#22c55e">550</span><span style="color:#eab308">600</span><span style="color:#dc2626">780</span>
            </div>
          </div>
          <div v-if="store.currentExperiment !== 'newton'">
            <label class="text-xs text-slate-500">缝宽/间距 d = {{ store.params.slitWidth }} μm</label>
            <input type="range" min="10" max="200" step="5" v-model.number="store.params.slitWidth" @input="store.compute" class="w-full accent-purple-500" />
          </div>
          <div v-if="store.currentExperiment === 'double'">
            <label class="text-xs text-slate-500">缝间距 D = {{ store.params.slitSeparation }} μm</label>
            <input type="range" min="50" max="500" step="10" v-model.number="store.params.slitSeparation" @input="store.compute" class="w-full accent-green-500" />
          </div>
          <div>
            <label class="text-xs text-slate-500">屏幕距离 L = {{ store.params.screenDistance }} mm</label>
            <input type="range" min="100" max="2000" step="50" v-model.number="store.params.screenDistance" @input="store.compute" class="w-full accent-orange-500" />
          </div>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700 text-sm">
          <h3 class="text-sm font-bold text-slate-400 mb-3">理论公式</h3>
          <div class="space-y-2 text-xs text-slate-400">
            <div v-if="store.currentExperiment === 'double'" class="bg-slate-900 rounded p-2">
              <div class="text-cyan-400 font-bold">双缝干涉</div>
              <div>亮纹: y = kλL/d (k=0,±1,±2...)</div>
              <div>条纹间距: Δy = λL/d</div>
              <div class="text-yellow-400 mt-1">Δy = {{ store.result.fringe?.toFixed(2) }} mm</div>
            </div>
            <div v-if="store.currentExperiment === 'single'" class="bg-slate-900 rounded p-2">
              <div class="text-cyan-400 font-bold">单缝衍射</div>
              <div>暗纹: a·sinθ = kλ</div>
              <div>中央亮纹宽: 2λL/a</div>
              <div class="text-yellow-400 mt-1">中央宽 = {{ store.result.centralWidth?.toFixed(2) }} mm</div>
            </div>
            <div v-if="store.currentExperiment === 'newton'" class="bg-slate-900 rounded p-2">
              <div class="text-cyan-400 font-bold">牛顿环</div>
              <div>暗环半径: r = √(nλR)</div>
              <div>R: 曲率半径</div>
            </div>
          </div>
        </div>
      </div>
      <div class="lg:w-3/4 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">干涉/衍射图样</h3>
          <canvas ref="patternRef" class="w-full rounded" style="height: 200px; background: black;"></canvas>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">光强分布曲线</h3>
          <canvas ref="intensityRef" class="w-full rounded" style="height: 200px; background: #0f172a;"></canvas>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">2D 热力图</h3>
          <canvas ref="heatmapRef" class="w-full rounded" style="height: 200px; background: black;"></canvas>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-sm font-bold text-slate-400">批量回归检查</h3>
            <div class="flex items-center gap-3 text-xs">
              <span v-if="store.consistencyOk === true" class="text-green-400">单项↔批量一致 ✓</span>
              <span v-else-if="store.consistencyOk === false" class="text-red-400">单项↔批量不一致 ✗</span>
              <span v-if="store.baseline" class="text-slate-500">
                基线：{{ store.baseline.cases.length }} 组 · {{ new Date(store.baseline.savedAt).toLocaleString() }}
              </span>
              <span v-else class="text-yellow-500">基线：未建立</span>
            </div>
          </div>
          <textarea v-model="store.batchInput" rows="5" spellcheck="false"
            class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 font-mono focus:border-cyan-500 focus:outline-none"
            placeholder="每行一组：波长nm, 缝宽μm, 缝间距μm, 屏幕距离mm"></textarea>
          <div class="flex flex-wrap gap-2 mt-2">
            <button @click="store.runBatchCheck()"
              class="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors">
              {{ store.batchReport ? '重试批量检查' : '运行批量检查' }}
            </button>
            <button @click="store.saveAsBaseline()"
              class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition-colors">
              保存为基线
            </button>
            <button v-if="store.baseline" @click="store.clearBaseline()"
              class="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 text-xs transition-colors">
              清除基线
            </button>
          </div>
          <div v-if="store.baselineMessage" class="mt-2 text-xs text-green-400">{{ store.baselineMessage }}</div>
          <div v-if="store.batchErrors.length" class="mt-2 bg-red-900/30 border border-red-800 rounded p-2 space-y-1">
            <div v-for="(e, i) in store.batchErrors" :key="i" class="text-xs text-red-400">✗ {{ e }}（既有基线未被覆盖）</div>
          </div>
          <div v-if="store.batchReport" class="mt-3">
            <div class="flex flex-wrap gap-3 text-xs mb-2">
              <span class="text-slate-400">共 {{ store.batchReport.total }} 组</span>
              <span class="text-green-400">通过 {{ store.batchReport.passed }}</span>
              <span :class="store.batchReport.failed ? 'text-red-400' : 'text-slate-500'">失败 {{ store.batchReport.failed }}</span>
              <span v-if="store.batchReport.comparedToBaseline" :class="store.batchReport.regressionCount ? 'text-red-400' : 'text-slate-500'">
                回归差异 {{ store.batchReport.regressionCount }} 组
              </span>
              <span v-if="store.batchReport.comparedToBaseline && store.batchReport.newCases" class="text-yellow-500">
                新增组合 {{ store.batchReport.newCases }} 组（基线外）
              </span>
              <span v-else-if="!store.batchReport.comparedToBaseline" class="text-slate-500">未与基线对比</span>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-slate-500 border-b border-slate-700">
                    <th class="text-left py-1 pr-2">#</th>
                    <th class="text-left py-1 pr-2">参数组合</th>
                    <th class="text-center py-1 px-2">双缝</th>
                    <th class="text-center py-1 px-2">单缝</th>
                    <th class="text-center py-1 px-2">牛顿环</th>
                    <th class="text-left py-1 pl-2">结论 / 失败原因</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in store.batchReport.cases" :key="c.key"
                    :class="['border-b border-slate-700/50 align-top', c.status === 'fail' ? 'bg-red-900/20' : '']">
                    <td class="py-1.5 pr-2 text-slate-500">{{ c.index + 1 }}</td>
                    <td class="py-1.5 pr-2 font-mono text-slate-300 whitespace-nowrap">
                      λ={{ c.params.wavelength }} a={{ c.params.slitWidth }} d={{ c.params.slitSeparation }} L={{ c.params.screenDistance }}
                    </td>
                    <td v-for="exp in experimentIds" :key="exp" class="py-1.5 px-2 text-center">
                      <span v-if="c.boundsErrors.length" class="text-slate-600">—</span>
                      <span v-else-if="checkOf(c, exp)?.ok" class="text-green-400">✓</span>
                      <span v-else class="text-red-400">✗</span>
                    </td>
                    <td class="py-1.5 pl-2">
                      <span v-if="c.status === 'pass'" class="text-green-400">通过</span>
                      <ul v-else class="space-y-0.5">
                        <li v-for="(r, i) in c.failureReasons" :key="i" class="text-red-400">{{ r }}</li>
                      </ul>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useOpticsStore } from './store/optics'
import { EXPERIMENT_IDS, type ExperimentId } from './physics/optics'
import type { CaseReport } from './physics/regression'

const store = useOpticsStore()
const patternRef = ref<HTMLCanvasElement | null>(null)
const intensityRef = ref<HTMLCanvasElement | null>(null)
const heatmapRef = ref<HTMLCanvasElement | null>(null)

const experimentIds = EXPERIMENT_IDS

const experiments: Array<{ id: ExperimentId; name: string }> = [
  { id: 'double', name: '双缝干涉 (Young实验)' },
  { id: 'single', name: '单缝衍射 (Fraunhofer)' },
  { id: 'newton', name: '牛顿环干涉' },
]

function checkOf(c: CaseReport, exp: ExperimentId) {
  return c.checks.find(ch => ch.experiment === exp)
}

function wavelengthToRGB(nm: number): [number, number, number] {
  let r = 0, g = 0, b = 0
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1.0 }
  else if (nm >= 440 && nm < 490) { g = (nm - 440) / 50; b = 1.0 }
  else if (nm >= 490 && nm < 510) { g = 1.0; b = -(nm - 510) / 20 }
  else if (nm >= 510 && nm < 580) { r = (nm - 510) / 70; g = 1.0 }
  else if (nm >= 580 && nm < 645) { r = 1.0; g = -(nm - 645) / 65 }
  else if (nm >= 645 && nm <= 780) { r = 1.0 }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function drawPattern() {
  const canvas = patternRef.value
  if (!canvas || !store.intensityData.length) return
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, W, H)
  const [r, g, b] = wavelengthToRGB(store.params.wavelength)
  const data = store.intensityData
  for (let x = 0; x < W; x++) {
    const idx = Math.round(x / W * (data.length - 1))
    const intensity = data[idx] || 0
    const alpha = Math.min(1, intensity)
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
    ctx.fillRect(x, 0, 1, H)
  }
}

function drawIntensity() {
  const canvas = intensityRef.value
  if (!canvas || !store.intensityData.length) return
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, W, H)
  const [r, g, b] = wavelengthToRGB(store.params.wavelength)
  const data = store.intensityData
  ctx.beginPath()
  ctx.strokeStyle = `rgb(${r},${g},${b})`
  ctx.lineWidth = 2
  data.forEach((v, i) => {
    const x = i / (data.length - 1) * W
    const y = H - v * (H - 10) - 5
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()
  // Fill
  ctx.fillStyle = `rgba(${r},${g},${b},0.15)`
  ctx.lineTo(W, H); ctx.lineTo(0, H)
  ctx.closePath(); ctx.fill()
  // Axes
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#94a3b8'; ctx.font = '10px monospace'; ctx.textAlign = 'center'
  ctx.fillText('0', W / 2, H - 2); ctx.fillText('光强 I', 30, 12); ctx.fillText('位置 x', W - 20, H - 2)
}

function drawHeatmap() {
  const canvas = heatmapRef.value
  if (!canvas || !store.intensityData.length) return
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  const [r, g, b] = wavelengthToRGB(store.params.wavelength)
  const data = store.intensityData
  const imgData = ctx.createImageData(W, H)
  for (let x = 0; x < W; x++) {
    const idx = Math.round(x / W * (data.length - 1))
    const intensity = Math.min(1, data[idx] || 0)
    for (let y = 0; y < H; y++) {
      const dist = Math.abs(y - H / 2) / (H / 2)
      const alpha = intensity * (1 - dist * 0.8) * 255
      const pos = (y * W + x) * 4
      imgData.data[pos] = r; imgData.data[pos + 1] = g; imgData.data[pos + 2] = b; imgData.data[pos + 3] = alpha
    }
  }
  ctx.putImageData(imgData, 0, 0)
}

function renderAll() { drawPattern(); drawIntensity(); drawHeatmap() }

onMounted(() => { store.compute(); setTimeout(renderAll, 100) })
watch(() => store.intensityData, () => renderAll(), { deep: true })
</script>
