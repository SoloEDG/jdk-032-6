import assert from 'node:assert/strict'
import { createVerificationDocument } from '../src/shared/verification.ts'
import { propagatePhysics } from '../src/features/simulation/lib/physics.ts'
import { sampleForceField } from '../src/features/forces/lib/forceField.ts'
import { runWindSelfCheck } from '../src/features/simulation/lib/selfCheck.ts'

const document = createVerificationDocument()
const result = propagatePhysics(document)
const fell = new Set(result.events.filter(event => event.kind === 'fall' || event.kind === 'mechanism').map(event => event.pieceId))
const pose = (id: string, time?: number) => {
  if (time === undefined) return result.frames.at(-1)?.bodies.find(body => body.id === id)
  const frame = [...result.frames].reverse().find(item => item.time <= time + 1e-6) ?? result.frames[0]
  return frame.bodies.find(body => body.id === id)
}

// 1. The starting fixture is completely unloaded at t = 0.
assert.equal(result.frames[0].time, 0)
for (const body of result.frames[0].bodies) {
  assert.equal(body.tilt, 0, `${body.id} should start upright`)
  assert.equal(body.pendulumAngle ?? 0, 0, `${body.id} pendulum should start at rest`)
}
assert.equal(result.events.some(event => event.time === 0 && event.kind !== 'force'), false)
assert.equal(fell.has('verify-free'), false, 'untouched starting card must remain standing')
assert.equal(pose('verify-free')?.status, 'standing')

// 2. Equal opposite overlapping winds have both zero vector sum and mean.
const cancelled = sampleForceField(document.forceZones, 6.2, 2.25, 0.8)
assert.ok(Math.abs(cancelled.net.x) < 1e-9)
assert.ok(Math.abs(cancelled.net.y) < 1e-9)
assert.ok(Math.abs(cancelled.average.x) < 1e-9)
assert.equal(fell.has('verify-cancel-card'), false, 'opposite overlapping winds must cancel')
assert.equal(Math.abs(pose('verify-cancel-pendulum')?.pendulumAngle ?? 1) < 0.02, true)

// 3. The narrow vibration band alone is insufficient.
assert.equal(fell.has('verify-vibe-only'), false, 'vibration-only card must survive')
assert.equal(pose('verify-vibe-only')?.status, 'standing')

// 4. Wind + the narrow pulse tip the critical card and create a real contact.
const criticalFall = result.events.find(event => event.pieceId === 'verify-critical' && event.kind === 'fall')
assert.ok(criticalFall, 'critical card should fall after wind plus vibration')
assert.ok(criticalFall.time >= 0.55, 'fall must not predate the effective pulse')
const contact = result.contacts.find(item => item.sourceId === 'verify-critical' && item.targetId === 'verify-receiver')
assert.ok(contact, 'critical card should contact its receiver')
assert.ok(contact.time >= criticalFall.time)
assert.ok(fell.has('verify-receiver'), 'contact impulse should tip receiver')
assert.ok(fell.has('verify-trigger'), 'receiver should reach trigger')
assert.equal(result.status, 'complete')

// 5. The same sampled force field moves the pendulum outside the cancellation zone.
const windSample = sampleForceField(document.forceZones, 14, 4.85, 0.8)
assert.ok(windSample.net.x > 1)
assert.ok(Math.abs(pose('verify-wind-pendulum')?.pendulumAngle ?? 0) > 0.03, 'pendulum should respond to wind')

// 6. Replay data records exact effective intervals and enough frames.
for (const zone of document.forceZones) {
  assert.ok(result.events.some(event => event.zoneId === zone.id && event.time === zone.start))
  assert.ok(result.events.some(event => event.zoneId === zone.id && event.time === Number((zone.start + zone.duration).toFixed(4))))
}
assert.ok(result.frames.length > 20)
assert.ok(result.duration >= criticalFall.time)

// 7. Later edits to zones cannot rewrite the already produced run/contact log.
const frozenContacts = JSON.stringify(result.contacts)
const frozenEvents = JSON.stringify(result.events)
const frozenCriticalTime = criticalFall.time
document.forceZones = document.forceZones.map(zone => ({ ...zone, strength: 99, start: 8, duration: 0.01 }))
document.forceZones.push({
  id: 'later-rewrite-attempt', kind: 'wind', label: '改写', x: 2, y: 2,
  width: 2, height: 2, direction: 180, strength: 99, start: 0, duration: 9, enabled: true,
})
assert.equal(JSON.stringify(result.contacts), frozenContacts)
assert.equal(JSON.stringify(result.events), frozenEvents)
assert.equal(criticalFall.time, frozenCriticalTime)

const report = runWindSelfCheck()
assert.equal(report.passed, true, report.checks.filter(check => !check.ok).map(check => `${check.id}: ${check.detail}`).join('; '))

console.log('Wind verification passed:', {
  status: result.status,
  events: result.events.length,
  contacts: result.contacts.map(item => `${item.sourceId}->${item.targetId}@${item.time.toFixed(3)}`),
  criticalFall: criticalFall.time.toFixed(3),
  duration: result.duration.toFixed(2),
  frames: result.frames.length,
  pendulumAngle: pose('verify-wind-pendulum')?.pendulumAngle?.toFixed(3),
})
