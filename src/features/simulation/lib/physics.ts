import type {
  BodyPose,
  DominoDocument,
  Piece,
  ReplayFrame,
  SimulationContact,
  SimulationEvent,
  Vec2,
} from '@/shared/document'
import { EPS, directionVector, magnitude, sampleForceField } from '../../forces/lib/forceField'

interface ScheduledAction {
  time: number
  kind: 'manual' | 'link' | 'contact'
  targetId: string
  causeId: string | null
  detail: string
  impulse?: number
  sourceId?: string
}

interface Body {
  piece: Piece
  x: number
  y: number
  width: number
  height: number
  threshold: number
  friction: number
  direction: Vec2
  tilt: number
  previousTilt: number
  omega: number
  state: BodyPose['status']
  committed: boolean
  commitEventId: string | null
  causeId: string | null
  detail: string
  pendingKick: number
  pendulumAngle: number
  pendulumOmega: number
  pendulumAxis: Vec2
  shake: Vec2
}

export interface PhysicsResult {
  events: SimulationEvent[]
  contacts: SimulationContact[]
  frames: ReplayFrame[]
  duration: number
  interruptedPieceId: string | null
  interruptionReason: string | null
  reachedTrigger: boolean
  status: 'complete' | 'interrupted' | 'empty' | 'stable'
}

const FIXED_STEP = 1 / 240
const FRAME_STRIDE = 4

export function propagatePhysics(doc: DominoDocument): PhysicsResult {
  const events: SimulationEvent[] = []
  const contacts: SimulationContact[] = []
  const actions: ScheduledAction[] = []
  let eventSequence = 0
  let contactSequence = 0
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null
  let reachedTrigger = false
  const forceZones = doc.forceZones ?? []

  const makeEvent = (init: Omit<SimulationEvent, 'id'>): SimulationEvent => {
    const event = { id: `event-${++eventSequence}`, ...init }
    events.push(event)
    return event
  }

  const bodies = new Map<string, Body>()
  for (const piece of doc.pieces) {
    bodies.set(piece.id, {
      piece,
      x: piece.x,
      y: piece.y,
      width: Math.max(0.12, piece.width),
      // Ramps are described by their run length in this stylized side/top bridge.
      height: piece.kind === 'ramp' ? Math.max(piece.height, piece.width * 1.25) : Math.max(0.25, piece.height),
      threshold: piece.fallThreshold,
      friction: piece.friction,
      direction: directionVector(piece.angle),
      tilt: 0,
      previousTilt: 0,
      omega: 0,
      state: 'standing',
      committed: false,
      commitEventId: null,
      causeId: null,
      detail: '',
      pendingKick: 0,
      pendulumAngle: 0,
      pendulumOmega: 0,
      pendulumAxis: directionVector(piece.angle),
      shake: { x: 0, y: 0 },
    })
  }

  // Force-zone interval markers are part of the immutable replay.
  for (const zone of forceZones) {
    if (zone.enabled === false) continue
    const kindLabel = zone.kind === 'wind' ? '风区' : '震动带'
    makeEvent({
      pieceId: '',
      zoneId: zone.id,
      time: zone.start,
      causeId: null,
      kind: 'force',
      detail: `${kindLabel}生效 · ${zone.label || zone.id}`,
    })
    makeEvent({
      pieceId: '',
      zoneId: zone.id,
      time: zone.start + zone.duration,
      causeId: null,
      kind: 'force',
      detail: `${kindLabel}结束 · ${zone.label || zone.id}`,
    })
  }

  if (doc.startPieceId && bodies.has(doc.startPieceId)) {
    actions.push({
      time: 0,
      kind: 'manual',
      targetId: doc.startPieceId,
      causeId: null,
      detail: '手动触发',
    })
  }

  function criticalAcceleration(body: Body): number {
    // Torque balance at the leading lower edge:
    // m*a*H/2 = m*g*(W/2)*threshold.
    return doc.scene.gravity * body.width / body.height * body.threshold
  }

  function commitBody(body: Body, time: number, causeId: string | null, detail: string): SimulationEvent {
    if (body.commitEventId) return events.find(event => event.id === body.commitEventId)!
    body.committed = true
    body.causeId = causeId ?? body.causeId
    body.detail = detail || body.detail
    if (body.omega < 0.8) body.omega = Math.max(body.omega, 1.35)

    const isMechanism = body.piece.kind === 'trigger' || body.piece.kind === 'splitter'
    const eventDetail = body.piece.kind === 'trigger'
      ? `触发器响应 · ${body.detail || '接触到达'}`
      : body.piece.kind === 'splitter'
        ? `分岔展开 · ${body.detail || '受力展开'}`
        : body.piece.kind === 'ramp'
          ? `坡道传递 · ${body.detail || '坡面接触'}`
          : `受力倒下 · ${body.detail || '风场施力'}`

    const event = makeEvent({
      pieceId: body.piece.id,
      time,
      causeId: body.causeId,
      kind: isMechanism ? 'mechanism' : 'fall',
      detail: eventDetail,
    })
    body.commitEventId = event.id
    if (body.piece.kind === 'trigger') reachedTrigger = true

    for (const link of doc.connections.filter(item => item.from === body.piece.id && item.enabled)) {
      actions.push({
        time: time + link.delay,
        kind: 'link',
        targetId: link.to,
        causeId: event.id,
        detail: '机关连线',
      })
    }

    scheduleGraphContact(body, time, event.id)
    maybeMarkInterruption(body, time, event.id)
    return event
  }

  function findGraphTarget(source: Body): Piece | null {
    const candidates = doc.pieces
      .map(piece => bodies.get(piece.id)!)
      .filter(target => target
        && target.piece.id !== source.piece.id
        && target.piece.kind !== 'pendulum'
        && !target.committed)
    if (source.piece.kind === 'ramp') {
      return candidates
        .filter(target => target.x > source.x && Math.abs(target.y - source.y) < 2.1)
        .sort((a, b) => a.x - b.x || a.piece.id.localeCompare(b.piece.id))[0]?.piece ?? null
    }

    const grip = (doc.scene.friction + source.piece.friction) / 2
    const reachScale = (0.94 + grip * 0.35) * (1.25 - source.piece.fallThreshold * 0.25)
    const maxDistance = source.height * 1.18 * reachScale
    let best: { piece: Piece; score: number } | null = null
    for (const target of candidates) {
      const delta = { x: target.x - source.x, y: target.y - source.y }
      const distance = magnitude(delta)
      if (distance <= EPS || distance > maxDistance) continue
      const forward = delta.x * source.direction.x + delta.y * source.direction.y
      if (forward <= 0.05) continue
      const lateral = Math.sqrt(Math.max(0, distance * distance - forward * forward))
      const lateralLimit = 0.42 + target.width * 0.9
      if (lateral > lateralLimit) continue
      const alignment = Math.acos(Math.max(-1, Math.min(1, forward / distance))) * 180 / Math.PI
      if (alignment > 52) continue
      const score = distance
      if (!best || score < best.score || (score === best.score && target.piece.id.localeCompare(best.piece.id) < 0)) {
        best = { piece: target.piece, score }
      }
    }
    return best?.piece ?? null
  }

  function scheduleGraphContact(source: Body, commitTime: number, eventId: string) {
    const targetPiece = findGraphTarget(source)
    if (!targetPiece) return
    const target = bodies.get(targetPiece.id)
    if (!target || target.committed) return
    const separation = Math.hypot(source.x - target.x, source.y - target.y)
    const grip = (doc.scene.friction + source.piece.friction) / 2
    const speed = Math.max(1.8, source.height * doc.scene.gravity / 2) * (0.75 + grip * 0.5)
    const travel = Math.max(0.24, separation / speed)
    actions.push({
      time: commitTime + travel,
      kind: 'contact',
      sourceId: source.piece.id,
      targetId: target.piece.id,
      causeId: eventId,
      detail: source.piece.kind === 'splitter' ? '分岔臂接触' : source.piece.kind === 'ramp' ? '坡面末端接触' : '相邻接触',
      impulse: 1.35 + source.omega * 0.42,
    })
  }

  function maybeMarkInterruption(body: Body, time: number, eventId: string) {
    if (interruptedPieceId || body.piece.kind === 'trigger') return
    const hasConnection = doc.connections.some(link => link.from === body.piece.id && link.enabled)
    const hasNearbyTarget = findGraphTarget(body)
    if (!hasNearbyTarget && !hasConnection) {
      interruptedPieceId = body.piece.id
      interruptionReason = '倒下方向内没有可触达的元件，链路在此停止。'
      makeEvent({
        pieceId: body.piece.id,
        time: time + 0.05,
        causeId: eventId,
        kind: 'interrupted',
        detail: interruptionReason,
      })
    }
  }

  function processAction(action: ScheduledAction, time: number) {
    const body = bodies.get(action.targetId)
    if (!body) return
    if (action.kind === 'manual') {
      if (body.piece.kind === 'trigger' || body.piece.kind === 'splitter') {
        commitBody(body, action.time, null, action.detail)
      } else {
        body.direction = directionVector(body.piece.angle)
        body.omega = Math.max(body.omega, 2.65)
        body.pendingKick = 2.65
        body.causeId = null
        body.detail = action.detail
        body.state = 'tipping'
      }
      return
    }

    if (action.kind === 'link') {
      if (body.committed) return
      if (body.piece.kind === 'trigger' || body.piece.kind === 'splitter') {
        commitBody(body, action.time, action.causeId, action.detail)
      } else {
        body.causeId = action.causeId
        body.detail = action.detail
        body.omega = Math.max(body.omega, 3.15)
        body.pendingKick = 3.15
        body.state = 'tipping'
      }
      return
    }

    if (action.kind === 'contact') {
      if (body.committed || !action.sourceId) return
      const source = bodies.get(action.sourceId)
      const delta = source
        ? { x: body.x - source.x, y: body.y - source.y }
        : directionVector(body.piece.angle)
      const distance = magnitude(delta) || 1
      const contactDirection = { x: delta.x / distance, y: delta.y / distance }
      const contactEvent = makeEvent({
        pieceId: body.piece.id,
        time: action.time,
        causeId: action.causeId,
        contactId: `contact-${contactSequence + 1}`,
        kind: 'contact',
        detail: `${action.detail} · ${action.sourceId}→${body.piece.id}`,
      })
      const contact: SimulationContact = {
        id: `contact-${++contactSequence}`,
        time: action.time,
        sourceId: action.sourceId,
        targetId: body.piece.id,
        eventId: contactEvent.id,
        impulse: action.impulse ?? 2.2,
        point: source ? { x: (source.x + body.x) / 2, y: (source.y + body.y) / 2 } : { x: body.x, y: body.y },
      }
      contactEvent.contactId = contact.id
      contacts.push(contact)

      body.direction = contactDirection
      body.causeId = contactEvent.id
      body.detail = action.detail
      body.omega = Math.max(body.omega, action.impulse ?? 2.2)
      body.pendingKick = action.impulse ?? 2.2
      body.state = 'tipping'
      if (body.piece.kind === 'trigger' || body.piece.kind === 'splitter') {
        commitBody(body, action.time, contactEvent.id, action.detail)
      }
    }
  }

  function integrateDomino(body: Body, time: number, dt: number) {
    if (body.piece.kind === 'pendulum') return
    body.previousTilt = body.tilt
    const sample = sampleForceField(forceZones, body.x, body.y, time)
    body.shake = { x: 0, y: 0 }

    if (body.state === 'fallen') {
      body.omega = 0
      body.tilt = Math.PI / 2
      return
    }

    const forceMagnitude = magnitude(sample.net)
    const critical = criticalAcceleration(body)

    if (body.state === 'standing' && body.omega === 0 && body.tilt === 0) {
      if (forceMagnitude + 1e-7 < critical && body.pendingKick === 0) {
        if (sample.contributions.some(item => item.kind === 'vibration')) {
          const ratio = Math.max(-1, Math.min(1, sample.net.x / Math.max(critical, 0.001)))
          body.shake = { x: ratio * 0.025, y: sample.net.y / Math.max(critical, 0.001) * 0.025 }
        }
        return
      }
      if (body.pendingKick > 0) {
        body.omega = Math.max(body.omega, body.pendingKick)
        body.pendingKick = 0
      } else if (forceMagnitude >= critical) {
        body.direction = { x: sample.net.x / forceMagnitude, y: sample.net.y / forceMagnitude }
      }
      body.state = 'tipping'
    }

    if (body.pendingKick > 0) {
      body.omega += body.pendingKick
      body.pendingKick = 0
      body.state = 'tipping'
    }

    const axisForce = sample.net.x * body.direction.x + sample.net.y * body.direction.y
    const h = body.height
    const w = body.width
    const theta = body.tilt
    // fallThreshold scales the available restoring half-width: lower values
    // describe a card that is already close to its tipping separatrix.
    const gravityTorque = doc.scene.gravity
      * (h / 2 * Math.sin(theta) - body.threshold * w / 2 * Math.cos(theta))
    const forceTorque = axisForce * (h / 2 * Math.cos(theta) + w / 2 * Math.sin(theta))
    const damping = 0.06 + body.friction * 0.16
    const angularAcceleration = 3 / (h * h) * (gravityTorque + forceTorque) - damping * body.omega

    body.omega += angularAcceleration * dt
    body.tilt += body.omega * dt

    if (body.tilt <= 0 && body.omega < 0) {
      const hadCommitted = body.committed
      body.tilt = 0
      body.omega = 0
      // A genuinely sub-critical excursion returns home without an event.
      // Once committed, retain the event id so later force edits or motion
      // cannot produce a second rewritten record.
      body.state = hadCommitted ? 'tipping' : 'standing'
      if (!hadCommitted) body.commitEventId = null
      return
    }

    const noReturnAngle = Math.atan2(body.threshold * w, h)
    if (!body.committed && body.tilt >= noReturnAngle && body.omega > 0) {
      commitBody(body, time, body.causeId, body.detail || '越过失稳角')
    }

    if (body.tilt >= Math.PI / 2) {
      body.tilt = Math.PI / 2
      body.omega = 0
      body.state = 'fallen'
      if (!body.committed) commitBody(body, time, body.causeId, body.detail || '受力倒下')
    } else if (body.tilt > 0) {
      body.state = 'tipping'
    }
  }

  function integratePendulum(body: Body, time: number, dt: number) {
    if (body.piece.kind !== 'pendulum') return
    const length = Math.max(0.45, body.piece.height)
    const sample = sampleForceField(forceZones, body.x, body.y, time)
    const axisForce = sample.net.x * body.pendulumAxis.x + sample.net.y * body.pendulumAxis.y
    const phi = body.pendulumAngle
    const damping = 0.05 + doc.scene.friction * 0.08
    const acceleration = -(doc.scene.gravity / length) * Math.sin(phi)
      + (axisForce / length) * Math.cos(phi)
      - damping * body.pendulumOmega
    body.pendulumOmega += acceleration * dt
    body.pendulumAngle += body.pendulumOmega * dt
  }

  function poseFor(body: Body, time: number): BodyPose {
    const length = Math.max(0.45, body.piece.height)
    return {
      id: body.piece.id,
      x: body.x,
      y: body.y,
      tilt: body.tilt,
      direction: Math.atan2(body.direction.y, body.direction.x),
      angularVelocity: body.omega,
      status: body.state,
      pendulumAngle: body.piece.kind === 'pendulum' ? body.pendulumAngle : undefined,
      bobX: body.piece.kind === 'pendulum' ? length * Math.sin(body.pendulumAngle) : undefined,
      bobY: body.piece.kind === 'pendulum' ? length * Math.cos(body.pendulumAngle) : undefined,
      shakeX: body.shake.x,
      shakeY: body.shake.y,
    }
  }

  const frames: ReplayFrame[] = [{ time: 0, bodies: [...bodies.values()].map(body => poseFor(body, 0)) }]
  const lastZoneEnd = Math.max(0, ...forceZones.map(zone => zone.start + zone.duration))
  const physicsLimit = Math.min(16, Math.max(8, lastZoneEnd + 3))
  let step = 0
  let time = 0

  while (time < physicsLimit) {
    step += 1
    time = Math.min(physicsLimit, step * FIXED_STEP)

    actions.sort((a, b) => a.time - b.time || a.targetId.localeCompare(b.targetId))
    while (actions.length && actions[0].time <= time + 1e-8) {
      const action = actions.shift()!
      processAction(action, Math.min(time, Math.max(0, action.time)))
    }

    for (const body of bodies.values()) {
      integrateDomino(body, time, FIXED_STEP)
      integratePendulum(body, time, FIXED_STEP)
    }

    if (step % FRAME_STRIDE === 0) {
      frames.push({ time, bodies: [...bodies.values()].map(body => poseFor(body, time)) })
    }
  }

  if (frames.at(-1)?.time !== physicsLimit) {
    frames.push({ time: physicsLimit, bodies: [...bodies.values()].map(body => poseFor(body, physicsLimit)) })
  }

  for (const event of events) {
    if (Number.isFinite(event.time)) event.time = Math.max(0, Number(event.time.toFixed(4)))
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))

  const lastPhysicalEventTime = events
    .filter(event => event.kind !== 'force')
    .reduce((max, event) => Math.max(max, event.time), 0)
  const lastContactTime = contacts.reduce((max, contact) => Math.max(max, contact.time), 0)
  const duration = Math.min(
    physicsLimit,
    Math.max(0.8, lastPhysicalEventTime + 0.9, lastContactTime + 0.5, lastZoneEnd + 0.45),
  )

  const committedCount = [...bodies.values()].filter(body => body.committed).length
  const status: PhysicsResult['status'] = doc.pieces.length === 0
    ? 'empty'
    : interruptedPieceId
      ? 'interrupted'
      : reachedTrigger
        ? 'complete'
        : committedCount > 0 || contacts.length > 0
          ? 'complete'
          : 'stable'

  return {
    events,
    contacts,
    frames: frames.filter(frame => frame.time <= duration + 1 / 60),
    duration,
    interruptedPieceId,
    interruptionReason,
    reachedTrigger,
    status,
  }
}

/** Backwards-compatible entry point used by the simulation model. */
export function propagate(doc: DominoDocument) {
  return propagatePhysics(doc)
}
