import type { ForceZone, Vec2 } from '../../../shared/document'

export interface ForceContribution extends Vec2 {
  zoneId: string
  kind: ForceZone['kind']
  magnitude: number
  wave: number
}

export interface ForceSample {
  /** Vector sum of all active contributions; equal opposite winds cancel. */
  net: Vec2
  /** Arithmetic mean kept for field-blending/debug assertions. */
  average: Vec2
  contributions: ForceContribution[]
}

export const EPS = 1e-9

export function directionVector(directionDegrees: number): Vec2 {
  const radians = directionDegrees * Math.PI / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

export function isZoneActiveAt(zone: ForceZone, time: number): boolean {
  return zone.enabled !== false
    && time + EPS >= zone.start
    && time <= zone.start + zone.duration + EPS
}

export function zoneContainsPoint(zone: ForceZone, x: number, y: number): boolean {
  return Math.abs(x - zone.x) <= zone.width / 2 + EPS
    && Math.abs(y - zone.y) <= zone.height / 2 + EPS
}

/**
 * Deterministic vibration waveform. The quarter-cycle phase makes a narrow
 * pulse begin at its constructive peak, which is important for the critical
 * domino fixture. The smooth envelope avoids an artificial force step.
 */
export function vibrationWave(zone: ForceZone, time: number): number {
  const elapsed = time - zone.start
  if (elapsed < -EPS || elapsed > zone.duration + EPS || zone.duration <= 0) return 0
  const frequency = zone.frequency ?? 18
  const phase = zone.phase ?? 0
  const progress = Math.min(1, Math.max(0, elapsed / zone.duration))
  // Smooth onset/offset plus a rapid tremor. The baseline term represents the
  // net jolt transferred by a very short band and keeps the pulse constructive.
  const envelope = Math.sin(Math.PI * progress)
  const tremor = 0.72 + 0.28 * Math.sin(2 * Math.PI * frequency * elapsed + phase)
  return envelope * tremor
}

export function sampleForceField(
  zones: readonly ForceZone[],
  x: number,
  y: number,
  time: number,
): ForceSample {
  const contributions: ForceContribution[] = []
  for (const zone of zones) {
    if (!isZoneActiveAt(zone, time) || !zoneContainsPoint(zone, x, y)) continue
    const direction = directionVector(zone.direction)
    const wave = zone.kind === 'vibration' ? vibrationWave(zone, time) : 1
    const magnitude = zone.strength * wave
    contributions.push({
      zoneId: zone.id,
      kind: zone.kind,
      magnitude,
      wave,
      x: direction.x * magnitude,
      y: direction.y * magnitude,
    })
  }
  const net = contributions.reduce<Vec2>((sum, item) => ({ x: sum.x + item.x, y: sum.y + item.y }), { x: 0, y: 0 })
  const count = contributions.length || 1
  return {
    net,
    average: { x: net.x / count, y: net.y / count },
    contributions,
  }
}

export function magnitude(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y)
}
