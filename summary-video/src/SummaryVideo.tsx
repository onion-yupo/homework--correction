/**
 * 学期总结视频 — 主组件
 *
 * 视觉风格对齐 DESIGN.md 洋葱学园设计系统
 * 场景时长由旁白语音驱动，通过 props.sceneDurations 传入。
 */
import { AbsoluteFill, Sequence, staticFile } from 'remotion'
import type { SummaryVideoProps } from './types'
import { CoverScene } from './scenes/CoverScene'
import { StatsScene } from './scenes/StatsScene'
import { ChartScene } from './scenes/ChartScene'
import { KnowledgeScene } from './scenes/KnowledgeScene'
import { CommentScene } from './scenes/CommentScene'
import { OutroScene } from './scenes/OutroScene'
import { BrandScene } from './scenes/BrandScene'
import { SubtitleOverlay } from './scenes/SubtitleOverlay'
import type { SubtitleSegment } from './scenes/SubtitleOverlay'
import { BG_PAGE, FONT_FAMILY } from './theme'

const FPS = 30
const DEFAULT_DURATIONS = [4 * FPS, 6 * FPS, 8 * FPS, 8 * FPS, 6 * FPS]

interface ExtendedProps extends SummaryVideoProps {
  sceneDurations?: number[]
  subtitles?: SubtitleSegment[]
}

const fontRegular = staticFile('fonts/AlibabaPuHuiTi-2-55-Regular.ttf')
const fontBold = staticFile('fonts/AlibabaPuHuiTi-2-85-Bold.ttf')
const fontExtraBold = staticFile('fonts/AlibabaPuHuiTi-2-95-ExtraBold.ttf')

export const SummaryVideo: React.FC<ExtendedProps> = (props) => {
  const d = props.sceneDurations?.length === 5 ? props.sceneDurations : DEFAULT_DURATIONS

  const starts = [0, d[0], d[0] + d[1], d[0] + d[1] + d[2], d[0] + d[1] + d[2] + d[3]]
  const outroStart = starts[4] + d[4]
  const outroDuration = 3 * FPS
  const brandStart = outroStart + outroDuration
  const brandDuration = 3 * FPS

  return (
    <AbsoluteFill style={{ background: BG_PAGE, fontFamily: FONT_FAMILY }}>
      {/* @font-face 全局注入 */}
      <style>{`
        @font-face {
          font-family: 'AlibabaPuHuiTi';
          src: url('${fontRegular}') format('truetype');
          font-weight: 400;
          font-style: normal;
        }
        @font-face {
          font-family: 'AlibabaPuHuiTi';
          src: url('${fontBold}') format('truetype');
          font-weight: 700;
          font-style: normal;
        }
        @font-face {
          font-family: 'AlibabaPuHuiTi';
          src: url('${fontExtraBold}') format('truetype');
          font-weight: 800;
          font-style: normal;
        }
      `}</style>

      <Sequence from={starts[0]} durationInFrames={d[0]}>
        <CoverScene studentName={props.studentName} semester={props.semester} term={props.term} />
      </Sequence>

      <Sequence from={starts[1]} durationInFrames={d[1]}>
        <StatsScene
          submittedDays={props.submittedDays}
          totalDays={props.totalDays}
          totalQuestions={props.totalQuestions}
          totalCorrect={props.totalCorrect}
          avgAccuracy={props.avgAccuracy}
          perfectDays={props.perfectDays}
        />
      </Sequence>

      <Sequence from={starts[2]} durationInFrames={d[2]}>
        <ChartScene dailyData={props.dailyData} />
      </Sequence>

      <Sequence from={starts[3]} durationInFrames={d[3]}>
        <KnowledgeScene knowledgePoints={props.knowledgePoints} />
      </Sequence>

      <Sequence from={starts[4]} durationInFrames={d[4]}>
        <CommentScene
          thumbsUp={props.thumbsUp}
          highlights={props.highlights}
          teacherComment={props.teacherComment}
          studentName={props.studentName}
        />
      </Sequence>

      <Sequence from={outroStart} durationInFrames={outroDuration}>
        <OutroScene studentName={props.studentName} />
      </Sequence>

      <Sequence from={brandStart} durationInFrames={brandDuration}>
        <BrandScene />
      </Sequence>

      {props.subtitles && props.subtitles.length > 0 && (
        <SubtitleOverlay segments={props.subtitles} />
      )}
    </AbsoluteFill>
  )
}
