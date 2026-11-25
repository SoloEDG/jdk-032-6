export type PieceKind = 'domino' | 'ramp' | 'splitter' | 'trigger' | 'pendulum'
export type Axis = 'north' | 'east' | 'south' | 'west'
export type ForceZoneKind = 'wind' | 'vibration'

export interface Vec2 { x: number; y: number }

export interface Piece {
  id: string
  kind: PieceKind
  x: number
  y: number
  angle: number
  facing: Axis
  label: string
  height: number
  width: number
  fallThreshold: number
  friction: number
}

export interface MechanismConnection {
  id: string
  from: string
  to: string
  delay: number
  enabled: boolean
}

export interface ForceZone {
  id: string
  kind: ForceZoneKind
  label: string
  /** Center of the zone in world metres. */
  x: number
  y: number
  /** Axis-aligned rectangular footprint in metres. */
  width: number
  height: number
  /** Force direction in degrees; 0 = +x/east, 90 = +y/south. */
  direction: number
  /** Peak horizontal acceleration in m/s². */
  strength: number
  /** Simulation time when the zone becomes active, in seconds. */
  start: number
  /** Active duration in seconds. Vibration bands are intentionally short. */
  duration: number
  enabled: boolean
  /** Oscillation frequency for vibration zones, in Hz. */
  frequency?: number
  /** Oscillation phase in radians. */
  phase?: number
}

export interface SceneSettings {
  gravity: number
  friction: number
  width: number
  height: number
  showGrid: boolean
}

export interface DominoDocument {
  id: string
  title: string
  revision: number
  updatedAt: number
  pieces: Piece[]
  connections: MechanismConnection[]
  forceZones: ForceZone[]
  scene: SceneSettings
  startPieceId: string
}

export interface SimulationEvent {
  id: string
  pieceId: string
  time: number
  causeId: string | null
  kind: 'trigger' | 'fall' | 'mechanism' | 'interrupted' | 'contact' | 'force'
  detail: string
  zoneId?: string
  contactId?: string
}

export interface SimulationContact {
  id: string
  time: number
  sourceId: string
  targetId: string
  eventId: string
  /** Horizontal impulse transferred through the contact, in N·s per kg. */
  impulse: number
  point: Vec2
}

export interface BodyPose {
  id: string
  x: number
  y: number
  /** Tipping angle from vertical, in radians. */
  tilt: number
  /** World-space direction of tipping, in radians. */
  direction: number
  angularVelocity: number
  status: 'standing' | 'tipping' | 'fallen'
  /** Pendulum angle from its vertical rest axis, in radians. */
  pendulumAngle?: number
  bobX?: number
  bobY?: number
  shakeX?: number
  shakeY?: number
}

export interface ReplayFrame {
  time: number
  bodies: BodyPose[]
}

export interface SimulationRun {
  id: string
  documentId: string
  revision: number
  startedAt: number
  startPieceId: string
  status: 'complete' | 'interrupted' | 'empty' | 'stable'
  events: SimulationEvent[]
  contacts: SimulationContact[]
  frames: ReplayFrame[]
  /** Frozen scene used for this replay. Later edits must never mutate it. */
  snapshot: DominoDocument
  interruptedPieceId: string | null
  interruptionReason: string | null
  duration: number
}
