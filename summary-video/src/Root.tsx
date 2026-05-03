/**
 * Remotion Root — 注册所有 Composition
 */
import { Composition } from 'remotion'
import { SummaryVideo } from './SummaryVideo'
import type { SummaryVideoProps } from './types'

const FPS = 30
const DEFAULT_DURATION = 35 * FPS

const defaultProps: SummaryVideoProps = {
  studentName: '示例同学',
  semester: '二上',
  term: '2026年3月',
  totalDays: 21,
  submittedDays: 18,
  totalQuestions: 420,
  totalCorrect: 389,
  avgAccuracy: 92.6,
  perfectDays: 8,
  thumbsUp: 4,
  dailyData: [],
  knowledgePoints: [],
  highlights: '学习态度认真，每天按时完成练习。',
  teacherComment: '继续保持，你很棒！',
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SummaryVideo"
        component={SummaryVideo as any}
        durationInFrames={DEFAULT_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={defaultProps}
      />
    </>
  )
}
