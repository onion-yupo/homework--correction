/**
 * 场景 7：品牌 Logo 动效（片尾标识）
 *
 * 纯白底 → Logo 缩放渐入 → 品牌名浮现 → 整体淡出
 * 约 2.5-3 秒，作为视频最后一幕
 */
import { AbsoluteFill, Img, useCurrentFrame, interpolate, spring, useVideoConfig, staticFile } from 'remotion'
import { BRAND_BLUE, TEXT_MUTED, FONT_FAMILY } from '../theme'

const logoDark = staticFile('logo-dark.png')

export const BrandScene: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const logoScale = spring({ frame, fps, from: 0.6, to: 1, durationInFrames: 25, config: { damping: 12 } })
  const logoOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })

  const textOpacity = interpolate(frame, [18, 35], [0, 1], { extrapolateRight: 'clamp' })
  const textY = spring({ frame: Math.max(0, frame - 15), fps, from: 16, to: 0, durationInFrames: 20 })

  const lineWidth = interpolate(frame, [25, 50], [0, 200], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* Logo */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}
      >
        <Img src={logoDark} style={{ height: 80 }} />
      </div>

      {/* 装饰线 */}
      <div
        style={{
          width: lineWidth,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${BRAND_BLUE}40, transparent)`,
          marginTop: 20,
          marginBottom: 16,
        }}
      />

      {/* 品牌文案 */}
      <div
        style={{
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
          fontSize: 20,
          color: TEXT_MUTED,
          letterSpacing: 6,
          fontWeight: 400,
        }}
      >
        计算营 AI Copilot
      </div>
    </AbsoluteFill>
  )
}
