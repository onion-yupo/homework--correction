/**
 * 场景 4：知识点掌握度
 *
 * Phase 1: 环形图 + 三档统计（白色卡片风格）
 * Phase 2: 双列聚焦 — 掌握最好 / 需要加强 Top5
 * 对齐 DESIGN.md Donut Chart 和知识点列表风格
 */
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion'
import type { KnowledgePoint } from '../types'
import {
  BG_PAGE, BG_CARD, CARD_SHADOW, CARD_RADIUS,
  BRAND_BLUE, KP_MASTERED, KP_GOOD, KP_WARN, KP_WEAK,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  FONT_FAMILY,
} from '../theme'

interface Props {
  knowledgePoints: KnowledgePoint[]
}

function getBarColor(accuracy: number): string {
  if (accuracy >= 95) return KP_MASTERED
  if (accuracy >= 80) return KP_GOOD
  if (accuracy >= 60) return KP_WARN
  return KP_WEAK
}

const TIERS = [
  { label: '完全掌握', color: KP_MASTERED, filter: (k: KnowledgePoint) => k.accuracy >= 95 },
  { label: '掌握良好', color: KP_GOOD, filter: (k: KnowledgePoint) => k.accuracy >= 80 && k.accuracy < 95 },
  { label: '需要加强', color: KP_WARN, filter: (k: KnowledgePoint) => k.accuracy < 80 },
]

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }
  const end = { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

export const KnowledgeScene: React.FC<Props> = ({ knowledgePoints }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const total = knowledgePoints.length
  const tierCounts = TIERS.map(t => knowledgePoints.filter(t.filter).length)

  const PHASE2_START = 120
  const phase1Opacity = interpolate(frame, [PHASE2_START - 15, PHASE2_START], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const phase2Opacity = interpolate(frame, [PHASE2_START, PHASE2_START + 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })

  /* ========= Phase 1: 环形图 ========= */
  const ringProgress = interpolate(frame, [15, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const R = 140
  const STROKE = 32
  const GAP = 0.04

  let ringArcs: { color: string; startAngle: number; endAngle: number }[] = []
  if (total > 0) {
    let currentAngle = -Math.PI / 2
    for (let i = 0; i < TIERS.length; i++) {
      const ratio = tierCounts[i] / total
      if (ratio <= 0) continue
      const sweep = ratio * Math.PI * 2 - GAP
      const visibleSweep = sweep * ringProgress
      if (visibleSweep > 0.01) {
        ringArcs.push({ color: TIERS[i].color, startAngle: currentAngle, endAngle: currentAngle + visibleSweep })
      }
      currentAngle += ratio * Math.PI * 2
    }
  }

  const centerNum = Math.round(total * ringProgress)

  /* ========= Phase 2: 双列 Top5 ========= */
  const bestKps = [...knowledgePoints]
    .filter(k => k.totalQuestions >= 3)
    .sort((a, b) => b.accuracy - a.accuracy || b.totalQuestions - a.totalQuestions)
    .slice(0, 5)

  const weakKps = [...knowledgePoints]
    .filter(k => k.accuracy < 95 && k.totalQuestions >= 2)
    .sort((a, b) => a.accuracy - b.accuracy || b.totalQuestions - a.totalQuestions)
    .slice(0, 5)

  const ringSize = (R + STROKE) * 2

  return (
    <AbsoluteFill
      style={{
        background: BG_PAGE,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* 章节标题 */}
      <div
        style={{
          opacity: titleOpacity,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 48,
          marginBottom: 16,
        }}
      >
        <div style={{ width: 6, height: 36, background: BRAND_BLUE, borderRadius: 3 }} />
        <span style={{ fontSize: 48, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: 4 }}>
          知识点掌握度
        </span>
      </div>

      {/* Phase 1: 环形图 + 三档统计卡片 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: phase1Opacity,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 80,
          paddingTop: 40,
        }}
      >
        {/* 环形图卡片 */}
        <div
          style={{
            background: BG_CARD,
            borderRadius: CARD_RADIUS + 4,
            boxShadow: CARD_SHADOW,
            padding: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ position: 'relative', width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize} style={{ position: 'absolute', top: 0, left: 0 }}>
              <circle
                cx={R + STROKE}
                cy={R + STROKE}
                r={R}
                fill="none"
                stroke="#F0F0F0"
                strokeWidth={STROKE}
              />
              {ringArcs.map((arc, i) => (
                <path
                  key={i}
                  d={arcPath(R + STROKE, R + STROKE, R, arc.startAngle, arc.endAngle)}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 56, fontWeight: 800, color: TEXT_PRIMARY }}>{centerNum}</div>
              <div style={{ fontSize: 20, color: TEXT_MUTED, letterSpacing: 3 }}>知识点</div>
            </div>
          </div>
        </div>

        {/* 三档统计卡片 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {TIERS.map((tier, i) => {
            const delay = 25 + i * 15
            const itemOpacity = interpolate(frame, [delay, delay + 12], [0, 1], { extrapolateRight: 'clamp' })
            const countAnim = Math.round(
              interpolate(frame, [delay, delay + 20], [0, tierCounts[i]], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            )
            const pct = total > 0 ? Math.round((tierCounts[i] / total) * 100) : 0
            const pctAnim = Math.round(
              interpolate(frame, [delay, delay + 20], [0, pct], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            )

            return (
              <div
                key={tier.label}
                style={{
                  opacity: itemOpacity,
                  background: BG_CARD,
                  borderRadius: CARD_RADIUS,
                  boxShadow: CARD_SHADOW,
                  padding: '20px 28px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  borderLeft: `5px solid ${tier.color}`,
                  minWidth: 460,
                }}
              >
                <div style={{ width: 100 }}>
                  <div style={{ fontSize: 20, color: TEXT_MUTED }}>{tier.label}</div>
                </div>
                <div style={{ fontSize: 40, fontWeight: 800, color: tier.color, width: 65, textAlign: 'right' }}>
                  {countAnim}
                </div>
                <div style={{ fontSize: 20, color: TEXT_MUTED, width: 55 }}>
                  {pctAnim}%
                </div>
                <div style={{ flex: 1, height: 12, background: '#F0F0F0', borderRadius: 6, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pctAnim}%`,
                      height: '100%',
                      background: tier.color,
                      borderRadius: 5,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Phase 2: 双列聚焦 */}
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 120,
          right: 120,
          bottom: 50,
          opacity: phase2Opacity,
          display: 'flex',
          gap: 48,
        }}
      >
        {/* 左列：掌握最好 */}
        <div
          style={{
            flex: 1,
            background: BG_CARD,
            borderRadius: CARD_RADIUS + 4,
            boxShadow: CARD_SHADOW,
            padding: '28px 32px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <span style={{ fontSize: 30 }}>🌟</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: KP_MASTERED, letterSpacing: 3 }}>掌握最好</span>
          </div>
          {bestKps.map((kp, i) => {
            const delay = PHASE2_START + 10 + i * 10
            const rowOp = interpolate(frame, [delay, delay + 8], [0, 1], { extrapolateRight: 'clamp' })
            const barW = interpolate(frame, [delay, delay + 20], [0, kp.accuracy], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            return (
              <div key={kp.name} style={{ opacity: rowOp, marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 22, color: TEXT_PRIMARY }}>{kp.name}</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: getBarColor(kp.accuracy) }}>{Math.round(barW)}%</span>
                </div>
                <div style={{ height: 16, background: '#F0F0F0', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${barW}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${getBarColor(kp.accuracy)}cc, ${getBarColor(kp.accuracy)})`,
                      borderRadius: 8,
                    }}
                  />
                </div>
                <div style={{ fontSize: 16, color: TEXT_MUTED, marginTop: 4 }}>
                  {kp.correctCount}/{kp.totalQuestions} 题
                </div>
              </div>
            )
          })}
        </div>

        {/* 右列：需要加强 */}
        <div
          style={{
            flex: 1,
            background: BG_CARD,
            borderRadius: CARD_RADIUS + 4,
            boxShadow: CARD_SHADOW,
            padding: '28px 32px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <span style={{ fontSize: 30 }}>💪</span>
            <span style={{ fontSize: 28, fontWeight: 700, color: KP_WARN, letterSpacing: 3 }}>需要加强</span>
          </div>
          {weakKps.map((kp, i) => {
            const delay = PHASE2_START + 10 + i * 10
            const rowOp = interpolate(frame, [delay, delay + 8], [0, 1], { extrapolateRight: 'clamp' })
            const barW = interpolate(frame, [delay, delay + 20], [0, kp.accuracy], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            return (
              <div key={kp.name} style={{ opacity: rowOp, marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 22, color: TEXT_PRIMARY }}>{kp.name}</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: getBarColor(kp.accuracy) }}>{Math.round(barW)}%</span>
                </div>
                <div style={{ height: 16, background: '#F0F0F0', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${barW}%`,
                      height: '100%',
                      background: `linear-gradient(90deg, ${getBarColor(kp.accuracy)}cc, ${getBarColor(kp.accuracy)})`,
                      borderRadius: 8,
                    }}
                  />
                </div>
                <div style={{ fontSize: 16, color: TEXT_MUTED, marginTop: 4 }}>
                  {kp.correctCount}/{kp.totalQuestions} 题
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}
