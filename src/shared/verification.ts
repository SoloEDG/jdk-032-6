import type { DominoDocument, ForceZone, Piece } from './document'

function verificationCard(id: string, x: number, label: string, fallThreshold = 0.8): Piece {
  return {
    id,
    kind: 'domino',
    x,
    y: 2.25,
    angle: 0,
    facing: 'east',
    label,
    height: 1.6,
    width: 0.42,
    fallThreshold,
    friction: 0.55,
  }
}

function verificationPendulum(id: string, x: number, label: string): Piece {
  return {
    ...verificationCard(id, x, label, 0.8),
    kind: 'pendulum',
    y: 4.85,
    height: 1.25,
    width: 0.24,
  }
}

function zone(init: ForceZone): ForceZone {
  return init
}

/**
 * Deterministic acceptance fixture:
 * - one untouched card at t = 0,
 * - two equal opposite overlapping wind zones,
 * - one vibration-only card that remains standing,
 * - one near-threshold card tipped by wind + a narrow vibration pulse,
 * - a contact receiver/trigger and two pendulums sampling the same field.
 */
export function createVerificationDocument(): DominoDocument {
  const pieces: Piece[] = [
    verificationCard('verify-free', 2.1, '未受力'),
    verificationCard('verify-cancel-card', 6.2, '逆风抵消', 0.72),
    verificationCard('verify-vibe-only', 10.1, '仅震动', 0.58),
    verificationCard('verify-critical', 14.0, '临界牌', 0.58),
    verificationCard('verify-receiver', 15.45, '接触牌', 0.82),
    { ...verificationCard('verify-trigger', 16.85, '终点', 0.8), kind: 'trigger', width: 0.62, height: 0.9 },
    verificationPendulum('verify-cancel-pendulum', 6.2, '零摆'),
    verificationPendulum('verify-wind-pendulum', 14.0, '同力摆'),
  ]

  const forceZones: ForceZone[] = [
    zone({
      id: 'verify-wind-east', kind: 'wind', label: '东向逆风', x: 6.2, y: 3.75,
      width: 3.5, height: 5.1, direction: 0, strength: 3.4, start: 0.2, duration: 2.4,
      enabled: true,
    }),
    zone({
      id: 'verify-wind-west', kind: 'wind', label: '西向逆风', x: 6.2, y: 3.75,
      width: 3.5, height: 5.1, direction: 180, strength: 3.4, start: 0.2, duration: 2.4,
      enabled: true,
    }),
    zone({
      id: 'verify-vibe-alone', kind: 'vibration', label: '窄震动带', x: 10.1, y: 2.25,
      width: 2.7, height: 0.46, direction: 0, strength: 1.45, start: 0.55, duration: 0.12,
      enabled: true, frequency: 4, phase: 0,
    }),
    zone({
      id: 'verify-wind-critical', kind: 'wind', label: '临界弱风', x: 14.0, y: 3.55,
      width: 2.35, height: 4.3, direction: 0, strength: 1.47, start: 0.25, duration: 1.35,
      enabled: true,
    }),
    zone({
      id: 'verify-vibe-critical', kind: 'vibration', label: '叠加窄震', x: 14.0, y: 2.25,
      width: 2.5, height: 0.46, direction: 0, strength: 1.45, start: 0.55, duration: 0.12,
      enabled: true, frequency: 4, phase: 0,
    }),
  ]

  return {
    id: 'wind-verification-theatre',
    title: '风场验证剧场',
    revision: 1,
    updatedAt: 0,
    pieces,
    connections: [],
    forceZones,
    scene: { gravity: 9.8, friction: 0.62, width: 19, height: 8.2, showGrid: true },
    startPieceId: '',
  }
}
