/**
 * 场景 6：结尾
 *
 * 洋葱蓝渐变 + 品牌 Logo + 温暖收尾文案
 * 对齐 DESIGN.md Banner 风格收束
 */
import { AbsoluteFill, Img, useCurrentFrame, interpolate, staticFile } from 'remotion'
import { TEXT_WHITE, FONT_FAMILY } from '../theme'

const logoDark = staticFile('logo-dark.png')

interface Props {
  studentName: string
}

export const OutroScene: React.FC<Props> = ({ studentName }) => {
  const frame = useCurrentFrame()

  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' })
  const fadeOut = interpolate(frame, [50, 70], [1, 0], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #5BA0F0 0%, #4A90E2 40%, #7AB8FF 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: Math.min(opacity, fadeOut),
        fontFamily: FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      {/* 几何纹理 */}
      <svg
        width={1920}
        height={1080}
        style={{ position: 'absolute', top: 0, left: 0, opacity: 0.1 }}
      >
        <polygon points="0,0 300,0 150,260" fill="#fff" />
        <polygon points="1920,1080 1620,1080 1770,820" fill="#fff" />
        <polygon points="960,0 810,300 1110,300" fill="#fff" />
      </svg>

      <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: TEXT_WHITE,
          letterSpacing: 8,
          marginBottom: 12,
        }}
      >
        {studentName}，继续加油！
      </div>

      {/* 品牌 footer */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <Img src={logoDark} style={{ height: 44, opacity: 0.9 }} />
        <div
          style={{
            fontSize: 20,
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: 4,
          }}
        >
          洋葱学园 · 计算营 AI Copilot
        </div>
      </div>
    </AbsoluteFill>
  )
}
