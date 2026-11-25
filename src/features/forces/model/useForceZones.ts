import { computed, ref, type Ref } from 'vue'
import type { DominoDocument, ForceZone, ForceZoneKind, Vec2 } from '@/shared/document'
import { stableId } from '@/shared/time'

export interface ZoneDraft {
  kind: ForceZoneKind
  start: Vec2
  current: Vec2
}

const defaults: Record<ForceZoneKind, Pick<ForceZone, 'width' | 'height' | 'strength' | 'duration' | 'direction'>> = {
  wind: { width: 3.6, height: 2.2, strength: 2.45, duration: 1.8, direction: 0 },
  vibration: { width: 2.8, height: 0.55, strength: 1.8, duration: 0.14, direction: 0 },
}

export function useForceZones(document: Ref<DominoDocument>, changed: () => void) {
  const selectedZoneId = ref<string | null>(null)
  const drawTool = ref<ForceZoneKind | null>(null)
  const draft = ref<ZoneDraft | null>(null)

  const zones = computed(() => document.value.forceZones ?? [])
  const selectedZone = computed(() => zones.value.find(zone => zone.id === selectedZoneId.value) ?? null)

  function chooseDrawTool(kind: ForceZoneKind | null) {
    drawTool.value = drawTool.value === kind ? null : kind
    draft.value = null
  }

  function selectZone(id: string | null) {
    selectedZoneId.value = id
    if (id) drawTool.value = null
  }

  function makeZone(kind: ForceZoneKind, center: Vec2, patch: Partial<ForceZone> = {}): ForceZone {
    const preset = defaults[kind]
    const count = zones.value.filter(zone => zone.kind === kind).length + 1
    return {
      id: stableId(kind === 'wind' ? 'wind' : 'vibe'),
      kind,
      label: kind === 'wind' ? `风区 ${count}` : `震动 ${count}`,
      x: Math.round(center.x * 10) / 10,
      y: Math.round(center.y * 10) / 10,
      ...preset,
      start: kind === 'wind' ? 0.2 : 0.45,
      enabled: true,
      frequency: kind === 'vibration' ? 4 : undefined,
      phase: kind === 'vibration' ? 0 : undefined,
      ...patch,
    }
  }

  function addZone(kind: ForceZoneKind, center?: Vec2, patch: Partial<ForceZone> = {}) {
    const point = center ?? { x: document.value.scene.width / 2, y: document.value.scene.height / 2 }
    const zone = makeZone(kind, point, patch)
    document.value = { ...document.value, forceZones: [...zones.value, zone] }
    selectedZoneId.value = zone.id
    changed()
    return zone.id
  }

  function beginDraft(point: Vec2, kind = drawTool.value) {
    if (!kind) return
    draft.value = { kind, start: point, current: point }
  }

  function updateDraft(point: Vec2) {
    if (draft.value) draft.value = { ...draft.value, current: point }
  }

  function draftRect(draftValue: ZoneDraft): { center: Vec2; width: number; height: number; direction: number } {
    const dx = draftValue.current.x - draftValue.start.x
    const dy = draftValue.current.y - draftValue.start.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    const preset = defaults[draftValue.kind]
    const tapped = absX < 0.16 && absY < 0.16
    const width = tapped ? preset.width : Math.max(0.32, absX)
    const height = tapped ? preset.height : Math.max(draftValue.kind === 'vibration' ? 0.24 : 0.55, absY)
    const center = {
      x: (draftValue.start.x + draftValue.current.x) / 2,
      y: (draftValue.start.y + draftValue.current.y) / 2,
    }
    const direction = absX > 0.35 && absY < 0.35 ? (dx >= 0 ? 0 : 180) : preset.direction
    return { center, width, height, direction }
  }

  function commitDraft(): string | null {
    if (!draft.value) return null
    const { kind } = draft.value
    const rect = draftRect(draft.value)
    draft.value = null
    const id = addZone(kind, rect.center, { width: rect.width, height: rect.height, direction: rect.direction })
    drawTool.value = null
    return id
  }

  function cancelDraft() {
    draft.value = null
    drawTool.value = null
  }

  function updateZone(id: string, patch: Partial<ForceZone>) {
    document.value = {
      ...document.value,
      forceZones: zones.value.map(zone => zone.id === id ? { ...zone, ...patch } : zone),
    }
    changed()
  }

  function removeZone(id: string) {
    document.value = { ...document.value, forceZones: zones.value.filter(zone => zone.id !== id) }
    if (selectedZoneId.value === id) selectedZoneId.value = null
    changed()
  }

  return {
    zones, selectedZoneId, selectedZone, drawTool, draft,
    chooseDrawTool, selectZone, addZone, beginDraft, updateDraft,
    commitDraft, cancelDraft, draftRect, updateZone, removeZone,
  }
}
