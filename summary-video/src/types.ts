/**
 * 总结视频的输入数据类型
 */
export interface DailyDataItem {
  day: number
  totalQuestions: number
  correctCount: number
  errorCount: number
  accuracy: number
  isPerfect: boolean
}

export interface KnowledgePoint {
  name: string
  accuracy: number
  totalQuestions: number
  correctCount: number
}

export interface SummaryVideoProps {
  studentName: string
  semester: string
  term: string
  totalDays: number
  submittedDays: number
  totalQuestions: number
  totalCorrect: number
  avgAccuracy: number
  perfectDays: number
  thumbsUp: number
  dailyData: DailyDataItem[]
  knowledgePoints: KnowledgePoint[]
  highlights: string
  teacherComment: string
}
