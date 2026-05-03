/**
 * 场景 2：数据总览
 *
 * 四个白色 KPI 卡片依次弹入，数字滚动动画
 * 对齐 DESIGN.md KPI Stat Grid 风格
 */
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion'
import {
  BG_PAGE, BG_CARD, CARD_SHADOW, CARD_RADIUS,
  BRAND_BLUE, COLOR_SUCCESS, CHART_GOLD, COLOR_DANGER,
  TEXT_PRIMARY, TEXT_MUTED, FONT_FAMILY,
} from '../theme'

interface Props {
  submittedDays: number
  totalDays: number
  totalQuestions: number
  totalCorrect: number
  avgAccuracy: number
  perfectDays: number
}

const ACCENT_COLORS = [BRAND_BLUE, COLOR_SUCCESS, CHART_GOLD, COLOR_DANGER]
const BG_TINTS = [
  'rgba(74,144,226,0.06)',
  'rgba(82,196,26,0.06)',
  'rgba(245,197,66,0.06)',
  'rgba(255,77,79,0.06)',
]

export const StatsScene: React.FC<Props> = ({
  submittedDays,
  totalDays,
  totalQuestions,
  totalCorrect,
  avgAccuracy,
  perfectDays,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const stats = [
    { label: '完成天数', value: submittedDays, suffix: `/${totalDays}天`, icon: '📅' },
    { label: '答题总量', value: totalQuestions, suffix: '题', icon: '✏️' },
    { label: '平均正确率', value: avgAccuracy, suffix: '%', decimal: true, icon: '🎯' },
    { label: '满分天数', value: perfectDays, suffix: '天', icon: '🌟' },
  ]

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: BG_PAGE,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 120px',
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* 章节标题 */}
      <div
        style={{
          opacity: titleOpacity,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 64,
        }}
      >
        <div
          style={{
            width: 6,
            height: 36,
            background: BRAND_BLUE,
            borderRadius: 3,
          }}
        />
        <span
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            letterSpacing: 4,
          }}
        >
          学期数据总览
        </span>
      </div>

      {/* 四个 KPI 白色卡片 */}
      <div style={{ display: 'flex', gap: 32, width: '100%', justifyContent: 'center' }}>
        {stats.map((stat, i) => {
          const delay = 15 + i * 12
          const cardScale = spring({ frame: Math.max(0, frame - delay), fps, from: 0.8, to: 1, durationInFrames: 20 })
          const cardOpacity = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateRight: 'clamp' })

          const numProgress = interpolate(frame, [delay + 5, delay + 40], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
          const displayValue = stat.decimal
            ? (stat.value * numProgress).toFixed(1)
            : Math.round(stat.value * numProgress)

          return (
            <div
              key={stat.label}
              style={{
                opacity: cardOpacity,
                transform: `scale(${cardScale})`,
                flex: 1,
                background: BG_CARD,
                borderRadius: CARD_RADIUS + 4,
                padding: '48px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
                boxShadow: CARD_SHADOW,
                borderTop: `4px solid ${ACCENT_COLORS[i]}`,
              }}
            >
              {/* 图标底色圆 */}
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: '50%',
                  background: BG_TINTS[i],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 44,
                }}
              >
                {stat.icon}
              </div>
              <div style={{ fontSize: 24, color: TEXT_MUTED, letterSpacing: 3 }}>
                {stat.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 68, fontWeight: 800, color: ACCENT_COLORS[i] }}>
                  {displayValue}
                </span>
                <span style={{ fontSize: 28, color: TEXT_MUTED, fontWeight: 400 }}>
                  {stat.suffix}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
