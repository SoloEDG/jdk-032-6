<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crosshair, MousePointer2 } from '@lucide/vue'
import type {
  BodyPose, DominoDocument, ForceZone, ForceZoneKind, Piece, PieceKind, SimulationRun, Vec2,
} from '@/shared/document'
import type { ZoneDraft } from '@/features/forces'
import { directionVector, isZoneActiveAt } from '@/features/forces/lib/forceField'

const props = defineProps<{
  document: DominoDocument
  activeTool: PieceKind | null
  selectedId: string | null
  run: SimulationRun | null
  focusPieceId: string | null
  time?: number
  forceTool?: ForceZoneKind | null
  zoneDraft?: ZoneDraft | null
  selectedZoneId?: string | null
}>()
const emit = defineEmits<{
  place: [PieceKind, number, number]
  select: [string | null]
  move: [string, number, number]
  zoneDrawStart: [Vec2]
  zoneDrawMove: [Vec2]
  zoneDrawCommit: []
  zoneSelect: [string | null]
  zoneUpdate: [string, Partial<ForceZone>]
}>()

const svg = ref<SVGSVGElement | null>(null)
const view = { width: 1040, height: 510, margin: 35 }
let dragging: string | null = null
let zoneDragging: string | null = null
let zoneDragOffset: Vec2 | null = null

const unitX = computed(() => (view.width - view.margin * 2) / props.document.scene.width)
const unitY = computed(() => (view.height - view.margin * 2) / props.document.scene.height)
const unit = computed(() => Math.min(unitX.value, unitY.value))

function worldPoint(event: PointerEvent) {
  if (!svg.value) return { x: 0, y: 0 }
  const bounds = svg.value.getBoundingClientRect()
  const svgX = (event.clientX - bounds.left) / bounds.width * view.width
  const svgY = (event.clientY - bounds.top) / bounds.height * view.height
  return {
    x: Math.max(0, Math.min(props.document.scene.width,
      (svgX - view.margin) / (view.width - view.margin * 2) * props.document.scene.width)),
    y: Math.max(0, Math.min(props.document.scene.height,
      (svgY - view.margin) / (view.height - view.margin * 2) * props.document.scene.height)),
  }
}

function downPiece(event: PointerEvent, piece: Piece) {
  // While drawing a force field, let the pointer event bubble to the SVG so
  // a zone can start even on top of a domino.
  if (props.forceTool) return
  event.stopPropagation()
  dragging = piece.id
  zoneDragging = null
  emit('select', piece.id)
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}

function downZone(event: PointerEvent, zone: ForceZone) {
  if (props.forceTool) return
  event.stopPropagation()
  emit('zoneSelect', zone.id)
  const point = worldPoint(event)
  zoneDragging = zone.id
  zoneDragOffset = { x: point.x - zone.x, y: point.y - zone.y }
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}

function svgPointerDown(event: PointerEvent) {
  const point = worldPoint(event)
  if (props.forceTool) {
    emit('zoneDrawStart', point)
    try { svg.value?.setPointerCapture(event.pointerId) } catch { /* pointer capture is progressive enhancement */ }
    return
  }
  if (dragging || zoneDragging) return
  if (props.activeTool) emit('place', props.activeTool, point.x, point.y)
  else emit('select', null)
}

function pointerMove(event: PointerEvent) {
  const point = worldPoint(event)
  if (dragging) {
    emit('move', dragging, point.x, point.y)
    return
  }
  if (zoneDragging && zoneDragOffset) {
    const zone = editorZones.value.find(item => item.id === zoneDragging)
    if (!zone) return
    const x = Math.max(zone.width / 2, Math.min(props.document.scene.width - zone.width / 2, point.x - zoneDragOffset.x))
    const y = Math.max(zone.height / 2, Math.min(props.document.scene.height - zone.height / 2, point.y - zoneDragOffset.y))
    emit('zoneUpdate', zone.id, { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
    return
  }
  if (props.forceTool && props.zoneDraft) emit('zoneDrawMove', point)
}

function pointerUp() {
  dragging = null
  zoneDragging = null
  zoneDragOffset = null
  if (props.zoneDraft) emit('zoneDrawCommit')
}

function pxX(x: number) { return view.margin + x / props.document.scene.width * (view.width - view.margin * 2) }
function pxY(y: number) { return view.margin + y / props.document.scene.height * (view.height - view.margin * 2) }

function poseFor(pieceId: string): BodyPose | null {
  if (!props.run?.frames?.length) return null
  const time = props.time ?? 0
  let frame = props.run.frames[0]
  for (const candidate of props.run.frames) {
    if (candidate.time <= time + 1e-6) frame = candidate
    else break
  }
  return frame.bodies.find(body => body.id === pieceId) ?? null
}

function isFallen(piece: Piece) {
  const pose = poseFor(piece.id)
  return pose?.status === 'fallen' || (pose?.tilt ?? 0) > 1.12
}

function pieceColor(piece: Piece) {
  if (piece.id === props.run?.interruptedPieceId) return '#e88b69'
  if (isFallen(piece)) return '#89c5a5'
  if (piece.kind === 'ramp') return '#8ca6a0'
  if (piece.kind === 'splitter') return '#e6bd68'
  if (piece.kind === 'trigger') return '#df8d70'
  if (piece.kind === 'pendulum') return '#9fc7df'
  return '#ead8b5'
}

function eventTime(pieceId: string) {
  const time = props.time ?? 0
  const event = props.run?.events.find(item => item.pieceId === pieceId && item.time <= time + 1e-6)
  return event ? event.time.toFixed(2) : ''
}

function pivotY(piece: Piece) {
  if (piece.kind === 'ramp') return 10
  if (piece.kind === 'splitter') return 13
  if (piece.kind === 'trigger') return 11
  if (piece.kind === 'pendulum') return 0
  return 19
}

/** Affine projection of a body tipping toward its world-space force direction. */
function bodyTransform(piece: Piece) {
  const pose = poseFor(piece.id)
  const theta = pose?.tilt ?? 0
  const direction = pose
    ? { x: Math.cos(pose.direction), y: Math.sin(pose.direction) }
    : directionVector(piece.angle)
  const kx = Math.sin(theta) * direction.x
  const ky = Math.sin(theta) * direction.y
  const cosine = Math.cos(theta)
  const pivot = pivotY(piece)
  const shakeX = (pose?.shakeX ?? 0) * unitX.value
  const shakeY = (pose?.shakeY ?? 0) * unitY.value
  const a = 1
  const b = 0
  const c = -kx
  const d = cosine - ky
  const e = pivot * kx + shakeX
  const f = pivot * (1 - cosine + ky) + shakeY
  return `matrix(${a} ${b} ${c.toFixed(4)} ${d.toFixed(4)} ${e.toFixed(2)} ${f.toFixed(2)})`
}

function pendulumGeometry(piece: Piece) {
  const pose = poseFor(piece.id)
  const length = piece.height * unit.value
  const angle = pose?.pendulumAngle ?? 0
  const x = (pose?.bobX ?? piece.height * Math.sin(angle)) * unit.value
  const y = (pose?.bobY ?? piece.height * Math.cos(angle)) * unit.value
  return { x, y, length, radius: Math.max(8, piece.width * unit.value) }
}

function zoneArrow(zone: ForceZone) {
  const direction = directionVector(zone.direction)
  const length = Math.max(34, Math.min(62, Math.min(zone.width, zone.height + 1.2) * unit.value * 0.42))
  const x1 = -direction.x * length * 0.52
  const y1 = -direction.y * length * 0.52
  const x2 = direction.x * length * 0.52
  const y2 = direction.y * length * 0.52
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 9
  const h1x = x2 - head * Math.cos(angle - 0.48)
  const h1y = y2 - head * Math.sin(angle - 0.48)
  const h2x = x2 - head * Math.cos(angle + 0.48)
  const h2y = y2 - head * Math.sin(angle + 0.48)
  return { x1, y1, x2, y2, head: `M ${x2} ${y2} L ${h1x} ${h1y} M ${x2} ${y2} L ${h2x} ${h2y}` }
}

function zoneActive(zone: ForceZone) {
  return isZoneActiveAt(zone, props.time ?? 0)
}

const draftBox = computed(() => {
  const draft = props.zoneDraft
  if (!draft) return null
  return {
    x: Math.min(draft.start.x, draft.current.x),
    y: Math.min(draft.start.y, draft.current.y),
    width: Math.abs(draft.current.x - draft.start.x),
    height: Math.abs(draft.current.y - draft.start.y),
    kind: draft.kind,
  }
})

const replayZones = computed(() => props.run?.snapshot?.forceZones ?? [])
const editorZones = computed<ForceZone[]>(() => props.document.forceZones ?? [])
const cursorClass = computed(() => props.forceTool ? 'force-drawing' : props.activeTool ? 'piece-placing' : '')
</script>

<template>
  <section class="stage-panel" aria-label="骨牌构筑场景">
    <div class="stage-toolbar">
      <div class="stage-mode">
        <MousePointer2 :size="15" />
        <span v-if="forceTool === 'wind'">拖动绘制风区，松开生成；方向可在左侧调整</span>
        <span v-else-if="forceTool === 'vibration'">拖动绘制窄震动带，单击可放置默认短脉冲</span>
        <span v-else-if="activeTool">点击空位添加元件</span>
        <span v-else>编辑场景 · 拖动元件或力场区域</span>
      </div>
      <div class="stage-readout"><span class="readout-dot"></span>{{ document.pieces.length }} 件元件 <span class="readout-sep">·</span> {{ editorZones.length }} 个力场 <span class="readout-sep">·</span> {{ document.scene.width }} × {{ document.scene.height }} 桌面</div>
    </div>
    <svg ref="svg" class="stage-svg" :class="cursorClass" :viewBox="`0 0 ${view.width} ${view.height}`" role="img"
      aria-label="可编辑的多米诺与风场场景。使用鼠标拖动或方向键微调选中元件。" @pointerup="pointerUp" @pointercancel="pointerUp"
      @pointermove="pointerMove" @pointerdown="svgPointerDown">
      <defs>
        <pattern id="draft-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3c5048" stroke-width=".65" opacity=".6" />
          <circle cx="0" cy="0" r="1" fill="#b9c3a5" opacity=".3" />
        </pattern>
        <pattern id="draft-fine" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="#758376" opacity=".35" />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#101a17" flood-opacity=".38" />
        </filter>
      </defs>
      <rect x="0" y="0" :width="view.width" :height="view.height" rx="12" class="board-bg" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" class="board-surface" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" fill="url(#draft-fine)" pointer-events="none" />
      <path v-if="document.scene.showGrid" :d="`M ${view.margin} ${view.height/2} H ${view.width-view.margin} M ${view.width/2} ${view.margin} V ${view.height-view.margin}`" class="center-guide" pointer-events="none" />

      <g v-for="zone in editorZones" :key="`edit-${zone.id}`" class="force-zone"
        :class="[zone.kind, { selected: selectedZoneId === zone.id, active: zoneActive(zone), disabled: zone.enabled === false }]"
        :transform="`translate(${pxX(zone.x)} ${pxY(zone.y)})`"
        @pointerdown="downZone($event, zone)">
        <rect class="force-zone-hit" :x="-zone.width * unitX / 2" :y="-zone.height * unitY / 2"
          :width="zone.width * unitX" :height="zone.height * unitY" rx="12" />
        <rect class="force-zone-fill" :x="-zone.width * unitX / 2" :y="-zone.height * unitY / 2"
          :width="zone.width * unitX" :height="zone.height * unitY" rx="12" pointer-events="none" />
        <g class="force-arrow" pointer-events="none">
          <line :x1="zoneArrow(zone).x1" :y1="zoneArrow(zone).y1" :x2="zoneArrow(zone).x2" :y2="zoneArrow(zone).y2" />
          <path :d="zoneArrow(zone).head" />
        </g>
        <text class="zone-canvas-label" text-anchor="middle" :y="-zone.height * unitY / 2 + 15" pointer-events="none">{{ zone.label }}</text>
        <text class="zone-canvas-time mono" text-anchor="middle" :y="zone.height * unitY / 2 - 9" pointer-events="none">{{ zone.start.toFixed(2) }}–{{ (zone.start + zone.duration).toFixed(2) }}s</text>
      </g>

      <g v-for="zone in replayZones" :key="`replay-${zone.id}`" class="replay-force-zone"
        :class="[zone.kind, { active: isZoneActiveAt(zone, time ?? 0) }]"
        :transform="`translate(${pxX(zone.x)} ${pxY(zone.y)})`" pointer-events="none">
        <rect :x="-zone.width * unitX / 2" :y="-zone.height * unitY / 2" :width="zone.width * unitX"
          :height="zone.height * unitY" rx="12" />
        <text v-if="isZoneActiveAt(zone, time ?? 0)" class="replay-zone-tag" text-anchor="middle"
          :y="-zone.height * unitY / 2 - 7">回放生效中</text>
      </g>

      <rect v-if="draftBox" class="zone-draft" :class="draftBox.kind" :x="pxX(draftBox.x)" :y="pxY(draftBox.y)"
        :width="Math.max(8, draftBox.width * unitX)" :height="Math.max(8, draftBox.height * unitY)" rx="10" pointer-events="none" />

      <g v-for="connection in document.connections.filter(link => link.enabled)" :key="connection.id" class="mechanism-link" pointer-events="none">
        <path :d="`M ${pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)} Q ${(pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)+pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0))/2} ${(pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)+pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0))/2-36} ${pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0)}`" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)" r="3" />
      </g>

      <g v-for="piece in document.pieces" :key="piece.id" class="scene-piece"
        :class="{ selected: selectedId === piece.id, focused: focusPieceId === piece.id, fallen: isFallen(piece) }"
        :transform="`translate(${pxX(piece.x)} ${pxY(piece.y)})`"
        :tabindex="0" role="button" :aria-label="`${piece.label}，${piece.x.toFixed(1)}，${piece.y.toFixed(1)}`" :aria-pressed="selectedId === piece.id"
        @pointerdown="downPiece($event, piece)" @keydown.enter.stop="emit('select', piece.id)" @keydown.space.stop.prevent="emit('select', piece.id)">
        <ellipse v-if="piece.kind !== 'pendulum'" cx="0" cy="7" rx="15" ry="8" class="piece-ground-shadow" />
        <ellipse v-else cx="0" :cy="pendulumGeometry(piece).y + 7" rx="18" ry="6" class="piece-ground-shadow" />

        <g v-if="piece.kind === 'pendulum'" :transform="`rotate(${piece.angle})`" class="pendulum-rig">
          <path d="M -15 -3 L 15 -3 L 10 4 L -10 4 Z" fill="#52675f" stroke="#b9c9c0" stroke-width="1" />
          <line x1="0" y1="0" :x2="pendulumGeometry(piece).x" :y2="pendulumGeometry(piece).y" class="pendulum-string" />
          <circle :cx="pendulumGeometry(piece).x" :cy="pendulumGeometry(piece).y" :r="pendulumGeometry(piece).radius"
            :fill="pieceColor(piece)" class="pendulum-bob" filter="url(#piece-shadow)" />
          <circle :cx="pendulumGeometry(piece).x - 4" :cy="pendulumGeometry(piece).y - 4" r="3" fill="#ffffff55" pointer-events="none" />
        </g>

        <g v-else :transform="bodyTransform(piece)" class="tipping-body">
          <rect v-if="piece.kind === 'domino'" x="-9" y="-20" width="18" height="39" rx="4" :fill="pieceColor(piece)" class="domino-body" filter="url(#piece-shadow)" />
          <path v-else-if="piece.kind === 'ramp'" d="M-24 10 L22 10 L22 -10 Z" :fill="pieceColor(piece)" class="ramp-body" filter="url(#piece-shadow)" />
          <path v-else-if="piece.kind === 'splitter'" d="M0-13 L13 0 L0 13 L-13 0 Z" :fill="pieceColor(piece)" class="splitter-body" filter="url(#piece-shadow)" />
          <circle v-else r="11" :fill="pieceColor(piece)" class="trigger-body" filter="url(#piece-shadow)" />
          <line v-if="piece.kind === 'domino'" x1="0" y1="-15" x2="0" y2="14" class="domino-mark" />
        </g>

        <circle v-if="piece.id === document.startPieceId" cy="-28" r="4" class="start-marker" />
        <circle v-if="piece.id === run?.interruptedPieceId" cy="-34" r="7" class="failure-marker" />
        <text y="32" text-anchor="middle" class="piece-label">{{ piece.label }}</text>
        <text v-if="eventTime(piece.id)" y="44" text-anchor="middle" class="piece-time">{{ eventTime(piece.id) }}s</text>
        <rect v-if="selectedId === piece.id || focusPieceId === piece.id" x="-18" y="-28" width="36" height="55" rx="8" class="selection-ring" />
      </g>

      <g v-if="focusPieceId" class="focus-reticle" pointer-events="none">
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="25" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="32" />
      </g>
      <g class="board-scale" pointer-events="none"><path d="M 0 0 H 80 M 0 0 V -5 M 80 0 V -5" /><text x="40" y="15" text-anchor="middle">2 M</text></g>
    </svg>
    <div class="stage-footer"><span><Crosshair :size="13" /> 桌面定位</span><span>拖动摆放 <kbd>↑ ↓ ← →</kbd> 微调 <kbd>Shift</kbd> 加速</span></div>
  </section>
</template>
