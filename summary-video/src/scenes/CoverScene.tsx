/**
 * 场景 1：封面
 *
 * 洋葱蓝渐变背景 + 半透明几何纹理 + 品牌logo + 学生信息
 * 对齐 DESIGN.md Blue Gradient Banner 风格
 */
import { AbsoluteFill, Img, useCurrentFrame, interpolate, spring, useVideoConfig, staticFile } from 'remotion'
import { FONT_FAMILY, TEXT_WHITE } from '../theme'

const logoWhite = staticFile('logo-white.png')

interface Props {
  studentName: string
  semester: string
  term: string
}

export const CoverScene: React.FC<Props> = ({ studentName, semester, term }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const logoOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })
  const logoY = spring({ frame, fps, from: -30, to: 0, durationInFrames: 20 })

  const titleOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateRight: 'clamp' })
  const titleY = spring({ frame: Math.max(0, frame - 10), fps, from: 30, to: 0, durationInFrames: 25 })

  const nameScale = spring({ frame: Math.max(0, frame - 20), fps, from: 0.7, to: 1, durationInFrames: 25 })
  const nameOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' })

  const metaOpacity = interpolate(frame, [45, 65], [0, 1], { extrapolateRight: 'clamp' })

  const decoWidth = interpolate(frame, [55, 90], [0, 400], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #5BA0F0 0%, #4A90E2 40%, #7AB8FF 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* 半透明几何纹理 — DESIGN.md Banner 风格 */}
      <svg
        width={1920}
        height={1080}
        style={{ position: 'absolute', top: 0, left: 0, opacity: 0.12 }}
      >
        <polygon points="0,0 400,0 200,350" fill="#fff" />
        <polygon points="1920,0 1520,0 1720,350" fill="#fff" />
        <polygon points="960,1080 760,730 1160,730" fill="#fff" />
        <polygon points="300,1080 100,780 500,780" fill="#fff" />
        <polygon points="1620,1080 1420,780 1820,780" fill="#fff" />
        <polygon points="1200,200 1050,500 1350,500" fill="#fff" />
        <polygon points="500,400 350,650 650,650" fill="#fff" />
      </svg>

      {/* Logo */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `translateY(${logoY}px)`,
          marginBottom: 32,
        }}
      >
        <Img src={logoWhite} style={{ height: 72 }} />
      </div>

      {/* 副标题 */}
      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          fontSize: 36,
          color: 'rgba(255,255,255,0.85)',
          letterSpacing: 10,
          fontWeight: 400,
          marginBottom: 28,
        }}
      >
        计算练习 · 学期总结
      </div>

      {/* 学生名字 */}
      <div
        style={{
          opacity: nameOpacity,
          transform: `scale(${nameScale})`,
          fontSize: 96,
          fontWeight: 800,
          color: TEXT_WHITE,
          letterSpacing: 10,
        }}
      >
        {studentName}
      </div>

      {/* 学期 + 期信息 */}
      <div
        style={{
          opacity: metaOpacity,
          marginTop: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          fontSize: 30,
          color: 'rgba(255,255,255,0.8)',
          letterSpacing: 5,
          fontWeight: 400,
        }}
      >
        <span>{semester}</span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
        <span>{term}</span>
      </div>

      {/* 底部装饰线 */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          width: decoWidth,
          height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
        }}
      />
    </AbsoluteFill>
  )
}
