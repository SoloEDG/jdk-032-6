<script setup lang="ts">
import { FlaskConical, Plus, Trash2, Vibrate, Wind } from '@lucide/vue'
import type { ForceZone, ForceZoneKind } from '@/shared/document'
import type { SelfCheckReport } from '@/features/simulation/lib/selfCheck'

const props = defineProps<{
  zones: ForceZone[]
  selectedId: string | null
  drawTool: ForceZoneKind | null
  report?: SelfCheckReport | null
}>()
const emit = defineEmits<{
  chooseDraw: [ForceZoneKind | null]
  select: [string | null]
  add: [ForceZoneKind]
  remove: [string]
  update: [string, Partial<ForceZone>]
  verify: []
}>()

function numberValue(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}
function directionLabel(value: number) {
  const angle = ((value % 360) + 360) % 360
  if (angle < 22.5 || angle >= 337.5) return '东 →'
  if (angle < 67.5) return '东南 ↘'
  if (angle < 112.5) return '南 ↓'
  if (angle < 157.5) return '西南 ↙'
  if (angle < 202.5) return '西 ←'
  if (angle < 247.5) return '西北 ↖'
  if (angle < 292.5) return '北 ↑'
  return '东北 ↗'
}
const selected = () => props.zones.find(zone => zone.id === props.selectedId) ?? null
</script>

<template>
  <section class="force-panel" aria-labelledby="force-title">
    <div class="section-kicker"><span>WIND / PULSE</span><h2 id="force-title">风区与震动</h2></div>
    <p class="force-hint">在桌面拖出区域；重叠区按向量合成，等强逆风会抵消。</p>
    <div class="force-draw-grid">
      <button class="force-tool wind" :class="{ chosen: drawTool === 'wind' }" :aria-pressed="drawTool === 'wind'"
        @click="emit('chooseDraw', 'wind')">
        <Wind :size="16" /><span>画风区</span>
      </button>
      <button class="force-tool vibe" :class="{ chosen: drawTool === 'vibration' }" :aria-pressed="drawTool === 'vibration'"
        @click="emit('chooseDraw', 'vibration')">
        <Vibrate :size="16" /><span>画震动带</span>
      </button>
    </div>
    <div class="force-quick">
      <button @click="emit('add', 'wind')"><Plus :size="13" /> 添加风区</button>
      <button @click="emit('add', 'vibration')"><Plus :size="13" /> 窄震动</button>
    </div>

    <div v-if="zones.length" class="zone-list" aria-label="已添加的力场">
      <button v-for="zone in zones" :key="zone.id" class="zone-row"
        :class="[zone.kind, { selected: zone.id === selectedId, disabled: zone.enabled === false }]"
        :aria-pressed="zone.id === selectedId" @click="emit('select', zone.id)">
        <component :is="zone.kind === 'wind' ? Wind : Vibrate" :size="14" />
        <span class="zone-row-copy">
          <strong>{{ zone.label }}</strong>
          <small>{{ zone.start.toFixed(2) }}–{{ (zone.start + zone.duration).toFixed(2) }}s · {{ directionLabel(zone.direction) }}</small>
        </span>
        <span class="zone-strength mono">{{ zone.strength.toFixed(1) }}</span>
      </button>
    </div>

    <div v-if="selected()" class="zone-editor">
      <label class="field-label">名称
        <input :value="selected()!.label" maxlength="20" @change="emit('update', selected()!.id, { label: ($event.target as HTMLInputElement).value })" />
      </label>
      <div class="field-pair">
        <label class="field-label">生效时刻 (s)<input type="number" min="0" max="20" step="0.05" :value="selected()!.start"
          @change="emit('update', selected()!.id, { start: Math.max(0, numberValue($event)) })" /></label>
        <label class="field-label">持续时间 (s)<input type="number" min="0.02" max="8" step="0.02" :value="selected()!.duration"
          @change="emit('update', selected()!.id, { duration: Math.max(0.02, numberValue($event)) })" /></label>
      </div>
      <label class="field-label">强度 <span>{{ selected()!.strength.toFixed(2) }} m/s²</span>
        <input type="range" min="0" max="6" step="0.05" :value="selected()!.strength"
          @change="emit('update', selected()!.id, { strength: numberValue($event) })" />
      </label>
      <label class="field-label">方向 <span class="mono">{{ selected()!.direction }}° · {{ directionLabel(selected()!.direction) }}</span>
        <input type="range" min="0" max="359" step="5" :value="selected()!.direction"
          @change="emit('update', selected()!.id, { direction: numberValue($event) })" />
      </label>
      <div class="field-pair">
        <label class="field-label">宽 m<input type="number" min="0.3" max="21" step="0.1" :value="selected()!.width"
          @change="emit('update', selected()!.id, { width: Math.max(0.3, numberValue($event)) })" /></label>
        <label class="field-label">高 m<input type="number" min="0.24" max="9" step="0.05" :value="selected()!.height"
          @change="emit('update', selected()!.id, { height: Math.max(0.24, numberValue($event)) })" /></label>
      </div>
      <label v-if="selected()!.kind === 'vibration'" class="field-label">频率 <span>{{ selected()!.frequency ?? 4 }} Hz</span>
        <input type="range" min="1" max="24" step="1" :value="selected()!.frequency ?? 4"
          @change="emit('update', selected()!.id, { frequency: numberValue($event) })" />
      </label>
      <div class="zone-actions">
        <label class="zone-enable"><input type="checkbox" :checked="selected()!.enabled !== false"
          @change="emit('update', selected()!.id, { enabled: ($event.target as HTMLInputElement).checked })" /> 启用</label>
        <button class="zone-delete" @click="emit('remove', selected()!.id)"><Trash2 :size="14" /> 删除区域</button>
      </div>
    </div>

    <button class="verify-button" @click="emit('verify')"><FlaskConical :size="15" /> 运行验收并载入验证剧场</button>
    <div v-if="report" class="self-check" :class="report.passed ? 'passed' : 'failed'" role="status">
      <strong>{{ report.passed ? '验收通过 · 逆风抵消 / 窄震补阈 / 接触冻结' : '验收未通过' }}</strong>
      <ul>
        <li v-for="check in report.checks" :key="check.id" :class="{ ok: check.ok, bad: !check.ok }">
          <span>{{ check.ok ? '✓' : '!' }}</span>
          <div><strong>{{ check.label }}</strong><small>{{ check.detail }}</small></div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.force-panel { padding: 15px 0; }
.force-hint { margin: 6px 0 10px; color: var(--quiet); font-size: 10px; line-height: 1.5; }
.force-draw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.force-tool { min-height: 42px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--rule-soft); border-radius: 5px; background: var(--field); color: var(--muted); font-size: 10px; }
.force-tool.wind svg { color: #8fd3e8; }
.force-tool.vibe svg { color: var(--gold); }
.force-tool.chosen { border-color: var(--gold); background: #35413a; color: var(--cream); box-shadow: inset 0 0 0 1px #e6bd6833; }
.force-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
.force-quick button { height: 29px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--rule-soft); border-radius: 4px; background: transparent; color: var(--muted); font-size: 10px; }
.force-quick button:hover { border-color: var(--rule); color: var(--ink); }
.zone-list { display: grid; gap: 3px; margin-top: 10px; max-height: 142px; overflow: auto; }
.zone-row { width: 100%; display: grid; grid-template-columns: 18px minmax(0,1fr) auto; align-items: center; gap: 7px; padding: 7px 7px; border: 1px solid transparent; border-radius: 4px; background: transparent; text-align: left; color: var(--muted); }
.zone-row:hover { background: var(--panel); }
.zone-row.selected { border-color: #6b7654; background: #303d36; }
.zone-row.wind svg { color: #8fd3e8; }
.zone-row.vibration svg { color: var(--gold); }
.zone-row-copy { min-width: 0; display: grid; gap: 2px; }
.zone-row-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 11px; font-weight: 600; }
.zone-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--quiet); font-size: 9px; }
.zone-strength { color: var(--gold); font-size: 9px; }
.zone-row.disabled { opacity: .45; }
.zone-editor { display: grid; gap: 9px; margin-top: 11px; padding: 10px; border: 1px solid var(--rule-soft); border-radius: 5px; background: #1c2b27; }
.zone-editor .field-label { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px 8px; }
.zone-editor .field-label > input { grid-column: 1 / -1; }
.zone-editor .field-label > span { grid-column: 2; color: var(--gold); font: 9px var(--mono); text-align: right; }
.zone-editor .field-label input:not([type=range]) { height: 30px; padding: 0 7px; border: 1px solid #3a4b42; border-radius: 3px; background: var(--field); color: var(--ink); font-size: 11px; }
.zone-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.zone-enable { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; }
.zone-delete { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #6d5145; border-radius: 4px; background: transparent; color: var(--terracotta); font-size: 10px; padding: 6px 8px; }
.zone-delete:hover { background: #3a2d27; }
.verify-button { width: 100%; margin-top: 10px; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px dashed #7c815d; border-radius: 5px; background: #2a352d; color: var(--cream); font-size: 10px; line-height: 1.2; padding: 6px; }
.verify-button:hover { border-style: solid; border-color: var(--gold); }
.self-check { margin-top: 8px; padding: 9px; border-radius: 5px; border: 1px solid #46554b; background: #1b2a25; }
.self-check.passed { border-color: #526f5c; }
.self-check.failed { border-color: #7b5144; }
.self-check > strong { display: block; color: var(--mint); font-size: 10px; line-height: 1.4; }
.self-check.failed > strong { color: var(--terracotta); }
.self-check ul { display: grid; gap: 6px; margin-top: 8px; max-height: 190px; overflow: auto; }
.self-check li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 5px; align-items: start; }
.self-check li > span { width: 15px; height: 15px; display: grid; place-items: center; border-radius: 50%; background: #35503f; color: var(--mint); font: 9px var(--mono); }
.self-check li.bad > span { background: #5b3a31; color: var(--terracotta); }
.self-check li strong { display: block; color: var(--ink); font-size: 10px; font-weight: 600; }
.self-check li small { display: block; margin-top: 2px; color: var(--quiet); font-size: 9px; line-height: 1.35; }
</style>
