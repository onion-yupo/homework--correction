/**
 * 字幕覆盖层
 *
 * 逐句显示旁白字幕，底部居中，白色半透明卡片风格
 * 对齐 DESIGN.md 整体视觉
 */
import { useCurrentFrame, interpolate } from 'remotion'
import { BRAND_BLUE, FONT_FAMILY } from '../theme'

export interface SubtitleSegment {
  text: string
  startFrame: number
  endFrame: number
}

interface Props {
  segments: SubtitleSegment[]
}

export const SubtitleOverlay: React.FC<Props> = ({ segments }) => {
  const frame = useCurrentFrame()

  const current = segments.find(
    (s) => frame >= s.startFrame && frame < s.endFrame,
  )
  if (!current) return null

  const fadeIn = interpolate(
    frame,
    [current.startFrame, current.startFrame + 6],
    [0, 1],
    { extrapolateRight: 'clamp' },
  )
  const fadeOut = interpolate(
    frame,
    [current.endFrame - 6, current.endFrame],
    [1, 0],
    { extrapolateRight: 'clamp' },
  )
  const opacity = Math.min(fadeIn, fadeOut)

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 48,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          opacity,
          background: 'rgba(255, 255, 255, 0.92)',
          borderRadius: 12,
          padding: '12px 36px',
          maxWidth: 1200,
          textAlign: 'center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
          border: `1px solid rgba(74,144,226,0.15)`,
        }}
      >
        <div
          style={{
            fontSize: 36,
            color: '#333333',
            lineHeight: 1.6,
            letterSpacing: 2,
            fontWeight: 400,
          }}
        >
          {current.text}
        </div>
      </div>
    </div>
  )
}
