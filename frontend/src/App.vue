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
              <div class="text-yellow-400 mt-1">r₁ = {{ store.result.firstRingRadius?.toFixed(4) }} mm</div>
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
      </div>
    </div>

    <!-- 批量回归检查 -->
    <div class="px-4 pb-4">
      <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 class="text-sm font-bold text-slate-400">批量回归检查</h3>
          <div class="text-xs text-slate-500">
            <span v-if="store.baselineMeta">基线: {{ store.baselineMeta.groupCount }} 组 · {{ formatTime(store.baselineMeta.createdAt) }}</span>
            <span v-else>暂无基线（首次成功运行将自动建立）</span>
          </div>
        </div>
        <p class="text-xs text-slate-500 mb-2">每行一组参数：<span class="font-mono text-slate-400">波长nm, 缝宽μm, 缝间距μm, 屏幕距离mm</span>。逐组核对三类实验结果与适用条件；无参数、重复组合或超出边界时拒绝运行且不覆盖既有基线。</p>
        <textarea v-model="batchInput" rows="4" spellcheck="false"
          class="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs font-mono text-slate-300 focus:border-cyan-500 outline-none"
          placeholder="550, 50, 200, 1000"></textarea>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          <button @click="runRegression(false)"
            class="px-3 py-1.5 rounded text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors">运行批量回归</button>
          <button @click="runRegression(true)"
            class="px-3 py-1.5 rounded text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors">运行并设为基线</button>
          <button @click="store.clearBaseline()"
            class="px-3 py-1.5 rounded text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">清除基线</button>
        </div>

        <div v-if="parseError || store.batchRejection" class="mt-3 bg-red-900/30 border border-red-700 rounded p-3 text-xs text-red-300">
          <div class="font-bold mb-1">已拒绝运行，既有基线保持不变</div>
          <div>{{ parseError || store.batchRejection?.message }}</div>
          <ul v-if="store.batchRejection?.reason === 'out-of-bounds'" class="mt-1 space-y-0.5 list-disc list-inside text-red-400">
            <li v-for="v in store.batchRejection.violations" :key="v.index">第 {{ v.index + 1 }} 组: {{ v.errors.join('；') }}</li>
          </ul>
        </div>

        <div v-if="store.batchReport" class="mt-3">
          <div class="text-xs mb-2" :class="store.batchReport.failedIndices.length ? 'text-red-400' : 'text-green-400'">
            共 {{ store.batchReport.groups.length }} 组，
            <template v-if="store.batchReport.failedIndices.length">
              失败 {{ store.batchReport.failedIndices.length }} 组：第 {{ store.batchReport.failedIndices.map(i => i + 1).join('、') }} 组
            </template>
            <template v-else>全部通过</template>
            <span v-if="!store.batchReport.comparedAgainstBaseline" class="text-slate-500">（无基线可比对，本次结果已作为基准）</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-slate-500 border-b border-slate-700">
                  <th class="text-left py-1 pr-2">#</th>
                  <th class="text-left py-1 pr-2">参数 (λ/a/d/L)</th>
                  <th class="text-left py-1 pr-2">双缝干涉</th>
                  <th class="text-left py-1 pr-2">单缝衍射</th>
                  <th class="text-left py-1 pr-2">牛顿环</th>
                  <th class="text-left py-1">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="g in store.batchReport.groups" :key="g.index"
                  :class="['border-b border-slate-700/50', g.status === 'fail' ? 'bg-red-900/20' : '']">
                  <td class="py-1.5 pr-2 text-slate-500">{{ g.index + 1 }}</td>
                  <td class="py-1.5 pr-2 font-mono text-slate-400">
                    {{ g.params.wavelength }}/{{ g.params.slitWidth }}/{{ g.params.slitSeparation }}/{{ g.params.screenDistance }}
                  </td>
                  <td v-for="exp in experiments" :key="exp.id" class="py-1.5 pr-2">
                    <div :class="g.experiments[exp.id].status === 'fail' ? 'text-red-400' : 'text-slate-300'">
                      {{ formatScalar(exp.id, g.experiments[exp.id].result) }}
                      <span v-if="g.experiments[exp.id].status === 'fail'" :title="g.experiments[exp.id].diffs.join('\n')" class="cursor-help">✗</span>
                      <span v-else class="text-green-500">✓</span>
                    </div>
                    <div v-for="(w, wi) in g.experiments[exp.id].warnings" :key="wi" class="text-yellow-500 text-[10px]">⚠ {{ w }}</div>
                    <div v-if="g.experiments[exp.id].status === 'fail'" class="text-red-500 text-[10px]">
                      {{ g.experiments[exp.id].diffs[0] }}
                    </div>
                  </td>
                  <td class="py-1.5" :class="g.status === 'fail' ? 'text-red-400 font-bold' : 'text-green-500'">
                    {{ g.status === 'fail' ? '失败' : '通过' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useOpticsStore } from './store/optics'
import { ExperimentId, ScalarResult } from './lib/physics'
import { parseBatchInput } from './lib/batch'

const store = useOpticsStore()
const patternRef = ref<HTMLCanvasElement | null>(null)
const intensityRef = ref<HTMLCanvasElement | null>(null)
const heatmapRef = ref<HTMLCanvasElement | null>(null)

const experiments: { id: ExperimentId; name: string }[] = [
  { id: 'double', name: '双缝干涉 (Young实验)' },
  { id: 'single', name: '单缝衍射 (Fraunhofer)' },
  { id: 'newton', name: '牛顿环干涉' },
]

// ---- 批量回归检查 ----
const batchInput = ref('550, 50, 200, 1000\n600, 100, 300, 1500')
const parseError = ref('')

function runRegression(updateBaseline: boolean) {
  const { groups, badLines } = parseBatchInput(batchInput.value)
  if (badLines.length > 0) {
    parseError.value = `第 ${badLines.join('、')} 行格式错误（应为 4 个数字：波长,缝宽,缝间距,屏幕距离）`
    return
  }
  parseError.value = ''
  store.runBatchRegression(groups, { updateBaseline })
}

function formatScalar(exp: ExperimentId, r: ScalarResult): string {
  if (exp === 'double') return `Δy=${r.fringe?.toFixed(2)}mm`
  if (exp === 'single') return `中央宽=${r.centralWidth?.toFixed(2)}mm`
  return `r₁=${r.firstRingRadius?.toFixed(4)}mm`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
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
