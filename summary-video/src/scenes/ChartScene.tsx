/**
 * 场景 3：每日正确率折线图
 *
 * 浅色底 + 白色图表区域，金黄折线 + 蓝色参考线
 * 对齐 DESIGN.md Line Chart 双色风格
 */
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'
import type { DailyDataItem } from '../types'
import {
  BG_PAGE, BG_CARD, CARD_SHADOW, CARD_RADIUS,
  BRAND_BLUE, CHART_GOLD, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED,
  FONT_FAMILY,
} from '../theme'

interface Props {
  dailyData: DailyDataItem[]
}

const CHART_LEFT = 200
const CHART_RIGHT = 1720
const CHART_TOP = 260
const CHART_BOTTOM = 820
const CHART_W = CHART_RIGHT - CHART_LEFT
const CHART_H = CHART_BOTTOM - CHART_TOP

export const ChartScene: React.FC<Props> = ({ dailyData }) => {
  const frame = useCurrentFrame()

  if (!dailyData.length) {
    return (
      <AbsoluteFill
        style={{
          background: BG_PAGE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_FAMILY,
        }}
      >
        <div style={{ color: TEXT_MUTED, fontSize: 32 }}>暂无每日数据</div>
      </AbsoluteFill>
    )
  }

  const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' })
  const drawProgress = interpolate(frame, [20, 180], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const count = dailyData.length
  const maxAcc = 100
  const minAcc = Math.max(0, Math.min(...dailyData.map((d) => d.accuracy)) - 10)

  const avgLine = dailyData.reduce((sum, d) => sum + d.accuracy, 0) / count
  const avgY = CHART_BOTTOM - ((avgLine - minAcc) / (maxAcc - minAcc)) * CHART_H

  const points = dailyData.map((d, i) => {
    const x = CHART_LEFT + (i / (count - 1 || 1)) * CHART_W
    const y = CHART_BOTTOM - ((d.accuracy - minAcc) / (maxAcc - minAcc)) * CHART_H
    return { x, y, ...d }
  })

  const visibleCount = Math.ceil(drawProgress * points.length)
  const visiblePoints = points.slice(0, visibleCount)

  const pathD = visiblePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = visiblePoints.length > 1
    ? `${pathD} L ${visiblePoints[visiblePoints.length - 1].x} ${CHART_BOTTOM} L ${visiblePoints[0].x} ${CHART_BOTTOM} Z`
    : ''

  return (
    <AbsoluteFill style={{ background: BG_PAGE, fontFamily: FONT_FAMILY }}>
      {/* 章节标题 */}
      <div
        style={{
          position: 'absolute',
          top: 48,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 12,
          opacity: titleOpacity,
        }}
      >
        <div style={{ width: 6, height: 36, background: BRAND_BLUE, borderRadius: 3 }} />
        <span style={{ fontSize: 48, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: 4 }}>
          每日正确率趋势
        </span>
      </div>

      {/* 白色图表卡片 */}
      <div
        style={{
          position: 'absolute',
          top: 130,
          left: 80,
          right: 80,
          bottom: 50,
          background: BG_CARD,
          borderRadius: CARD_RADIUS + 4,
          boxShadow: CARD_SHADOW,
        }}
      />

      <svg width={1920} height={1080} style={{ position: 'absolute', top: 0, left: 0 }}>
        {/* 网格线 */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const val = minAcc + ((maxAcc - minAcc) * pct) / 100
          const y = CHART_BOTTOM - (pct / 100) * CHART_H
          return (
            <g key={pct}>
              <line x1={CHART_LEFT} y1={y} x2={CHART_RIGHT} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <text x={CHART_LEFT - 16} y={y + 6} fill={TEXT_MUTED} fontSize={20} textAnchor="end" fontFamily="AlibabaPuHuiTi, sans-serif">
                {Math.round(val)}%
              </text>
            </g>
          )
        })}

        {/* X 轴标签 */}
        {points.map((p) => (
          <text key={p.day} x={p.x} y={CHART_BOTTOM + 36} fill={TEXT_SECONDARY} fontSize={18} textAnchor="middle" fontFamily="AlibabaPuHuiTi, sans-serif">
            第{p.day}天
          </text>
        ))}

        {/* 平均线（蓝色虚线）— DESIGN.md "平均" 蓝 */}
        <line
          x1={CHART_LEFT}
          y1={avgY}
          x2={CHART_LEFT + CHART_W * drawProgress}
          y2={avgY}
          stroke={BRAND_BLUE}
          strokeWidth={2}
          strokeDasharray="8 4"
          opacity={0.6}
        />
        {drawProgress > 0.5 && (
          <text x={CHART_RIGHT + 12} y={avgY + 6} fill={BRAND_BLUE} fontSize={18} fontFamily="AlibabaPuHuiTi, sans-serif">
            平均 {avgLine.toFixed(1)}%
          </text>
        )}

        {/* 渐变填充区域 — 金黄色 */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_GOLD} stopOpacity={0.25} />
            <stop offset="100%" stopColor={CHART_GOLD} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {areaD && <path d={areaD} fill="url(#areaGrad)" />}

        {/* 折线 — 金黄色 "我的" */}
        <path d={pathD} fill="none" stroke={CHART_GOLD} strokeWidth={3} strokeLinejoin="round" />

        {/* 数据点 */}
        {visiblePoints.map((p, i) => (
          <g key={p.day}>
            {/* 白色底圈 */}
            <circle cx={p.x} cy={p.y} r={p.isPerfect ? 10 : 6} fill="#fff" />
            <circle cx={p.x} cy={p.y} r={p.isPerfect ? 8 : 5} fill={p.isPerfect ? CHART_GOLD : CHART_GOLD} />
            {p.isPerfect && (
              <text x={p.x} y={p.y - 20} fill={CHART_GOLD} fontSize={24} textAnchor="middle">
                ⭐
              </text>
            )}
            {i === visiblePoints.length - 1 && (
              <text x={p.x} y={p.y - 24} fill={TEXT_PRIMARY} fontSize={22} fontWeight="bold" textAnchor="middle" fontFamily="AlibabaPuHuiTi, sans-serif">
                {p.accuracy.toFixed(1)}%
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* 图例 */}
      <div
        style={{
          position: 'absolute',
          bottom: 70,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 48,
          opacity: interpolate(frame, [60, 80], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 24, height: 3, background: CHART_GOLD, borderRadius: 2 }} />
          <span style={{ color: TEXT_SECONDARY, fontSize: 22 }}>我的正确率</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 3, background: BRAND_BLUE, borderRadius: 2, borderTop: '2px dashed ' + BRAND_BLUE }} />
          <span style={{ color: TEXT_SECONDARY, fontSize: 22 }}>平均正确率</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>⭐</span>
          <span style={{ color: TEXT_SECONDARY, fontSize: 22 }}>满分日</span>
        </div>
      </div>
    </AbsoluteFill>
  )
}
