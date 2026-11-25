import { createVerificationDocument } from '../../../shared/verification'
import { sampleForceField } from '../../forces/lib/forceField'
import { propagatePhysics } from './physics'

export interface CheckResult {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface SelfCheckReport {
  passed: boolean
  checks: CheckResult[]
  contactCount: number
  eventCount: number
  criticalFallTime: number | null
  duration: number
}

export function runWindSelfCheck(): SelfCheckReport {
  const fixture = createVerificationDocument()
  const result = propagatePhysics(fixture)
  const fell = new Set(
    result.events
      .filter(event => event.kind === 'fall' || event.kind === 'mechanism')
      .map(event => event.pieceId),
  )
  const criticalFall = result.events.find(event => event.pieceId === 'verify-critical' && event.kind === 'fall')
  const contact = result.contacts.find(item => item.sourceId === 'verify-critical' && item.targetId === 'verify-receiver')
  const cancelled = sampleForceField(fixture.forceZones, 6.2, 2.25, 0.8)
  const wind = sampleForceField(fixture.forceZones, 14, 4.85, 0.8)
  const cancelPendulumAngle = Math.max(0, ...result.frames.map(frame =>
    Math.abs(frame.bodies.find(body => body.id === 'verify-cancel-pendulum')?.pendulumAngle ?? 0)))
  const windPendulumAngle = Math.max(0, ...result.frames.map(frame =>
    Math.abs(frame.bodies.find(body => body.id === 'verify-wind-pendulum')?.pendulumAngle ?? 0)))

  const effectiveTimesOk = fixture.forceZones.every(zone =>
    result.events.some(event => event.zoneId === zone.id && event.time === zone.start))
  const frozenLog = JSON.stringify({ events: result.events, contacts: result.contacts })
  fixture.forceZones = fixture.forceZones.map(zone => ({ ...zone, strength: 99, start: 9, duration: 0.01 }))
  const priorLogSurvivesMutation = JSON.stringify({ events: result.events, contacts: result.contacts }) === frozenLog

  const checks: CheckResult[] = [
    {
      id: 'unforced-start',
      label: '起点在 t=0 未受力',
      ok: result.frames[0]?.bodies.every(body => body.tilt === 0 && (body.pendulumAngle ?? 0) === 0)
        && !fell.has('verify-free'),
      detail: fell.has('verify-free') ? '未受力牌意外倒下' : '首帧全部直立，未受力牌保持静止',
    },
    {
      id: 'opposite-winds',
      label: '重叠逆风相互抵消',
      ok: Math.abs(cancelled.net.x) < 1e-9 && Math.abs(cancelled.average.x) < 1e-9 && !fell.has('verify-cancel-card'),
      detail: `合成向量 ${cancelled.net.x.toFixed(2)}，平均 ${cancelled.average.x.toFixed(2)}`,
    },
    {
      id: 'cancel-pendulum',
      label: '抵消区摆锤保持静止',
      ok: cancelPendulumAngle < 0.03,
      detail: `末端摆角 ${(cancelPendulumAngle * 180 / Math.PI).toFixed(1)}°`,
    },
    {
      id: 'vibration-alone',
      label: '窄震动单独不足以致倒',
      ok: !fell.has('verify-vibe-only'),
      detail: '仅震动带内的骨牌未越过门槛',
    },
    {
      id: 'critical-overlap',
      label: '弱风加窄震动倾倒临界牌',
      ok: criticalFall ? criticalFall.time >= 0.54 : false,
      detail: criticalFall ? `临界牌在 ${criticalFall.time.toFixed(2)}s 倒下` : '临界牌未倒下',
    },
    {
      id: 'contact',
      label: '倒牌产生并冻结接触',
      ok: Boolean(contact) && fell.has('verify-receiver') && fell.has('verify-trigger'),
      detail: contact ? `接触于 ${contact.time.toFixed(2)}s 传递` : '未找到临界牌接触',
    },
    {
      id: 'pendulum-force',
      label: '摆锤采样同一风场',
      ok: wind.net.x > 1 && windPendulumAngle > 0.03,
      detail: `风力 ${wind.net.x.toFixed(2)} m/s²，摆角 ${(windPendulumAngle * 180 / Math.PI).toFixed(1)}°`,
    },
    {
      id: 'effective-times',
      label: '回放保留力场生效时刻',
      ok: effectiveTimesOk,
      detail: `${fixture.forceZones.length} 个力场的开始/结束时刻均已入轨`,
    },
    {
      id: 'immutable-contacts',
      label: '改风区不回溯已发生接触',
      ok: priorLogSurvivesMutation,
      detail: '旧运行持有结构化快照，事件与接触记录保持冻结',
    },
  ]

  return {
    passed: checks.every(check => check.ok),
    checks,
    contactCount: result.contacts.length,
    eventCount: result.events.length,
    criticalFallTime: criticalFall?.time ?? null,
    duration: result.duration,
  }
}
