/**
 * 场景 5：大拇指评分 + 老师寄语
 *
 * 浅色底 + 白色卡片，蓝色描边鼓励气泡
 * 对齐 DESIGN.md Encouragement Bubble 风格
 */
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion'
import {
  BG_PAGE, BG_CARD, CARD_SHADOW, CARD_RADIUS,
  BRAND_BLUE, KP_MASTERED, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  FONT_FAMILY,
} from '../theme'

interface Props {
  thumbsUp: number
  highlights: string
  teacherComment: string
  studentName: string
}

export const CommentScene: React.FC<Props> = ({ thumbsUp, highlights, teacherComment, studentName }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: BG_PAGE,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 240px',
        gap: 32,
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
        }}
      >
        <div style={{ width: 6, height: 36, background: BRAND_BLUE, borderRadius: 3 }} />
        <span style={{ fontSize: 48, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: 4 }}>
          老师寄语
        </span>
      </div>

      {/* 大拇指评分 — 白色卡片 */}
      <div
        style={{
          background: BG_CARD,
          borderRadius: CARD_RADIUS + 4,
          boxShadow: CARD_SHADOW,
          padding: '24px 48px',
          display: 'flex',
          gap: 20,
          alignItems: 'center',
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const delay = 15 + i * 8
          const scale = spring({ frame: Math.max(0, frame - delay), fps, from: 0, to: 1, durationInFrames: 15 })
          const isActive = i < thumbsUp
          return (
            <div
              key={i}
              style={{
                fontSize: 60,
                transform: `scale(${scale})`,
                filter: isActive ? 'none' : 'grayscale(1) opacity(0.3)',
              }}
            >
              👍
            </div>
          )
        })}
      </div>

      {/* 亮点 — 鼓励语气泡（蓝色描边） */}
      {highlights && (
        <div
          style={{
            opacity: interpolate(frame, [50, 65], [0, 1], { extrapolateRight: 'clamp' }),
            background: BG_CARD,
            border: `1px solid rgba(74,144,226,0.3)`,
            borderRadius: CARD_RADIUS,
            padding: '24px 36px',
            maxWidth: 1100,
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 26 }}>🌟</span>
            <span style={{ fontSize: 22, color: BRAND_BLUE, fontWeight: 700, letterSpacing: 3 }}>本期亮点</span>
          </div>
          <div style={{ fontSize: 24, color: TEXT_PRIMARY, lineHeight: 1.7 }}>
            {highlights}
          </div>
        </div>
      )}

      {/* 老师评语 — 鼓励语气泡（绿色描边） */}
      <div
        style={{
          opacity: interpolate(frame, [70, 85], [0, 1], { extrapolateRight: 'clamp' }),
          background: BG_CARD,
          border: `1px solid rgba(82,196,26,0.3)`,
          borderRadius: CARD_RADIUS,
          padding: '24px 36px',
          maxWidth: 1100,
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 26 }}>💬</span>
          <span style={{ fontSize: 22, color: KP_MASTERED, fontWeight: 700, letterSpacing: 3 }}>老师想说</span>
        </div>
        <div style={{ fontSize: 24, color: TEXT_PRIMARY, lineHeight: 1.7 }}>
          {teacherComment}
        </div>
      </div>
    </AbsoluteFill>
  )
}
