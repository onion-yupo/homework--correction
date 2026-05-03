/**
 * 手写答案信息（腾讯云 API 返回）
 * @see https://cloud.tencent.com/document/product/866/128274
 */
export interface AnswerInfo {
  /** 手写答案内容 */
  HandwriteInfo: string
  /** 手写答案坐标 [x1,y1, x2,y2, x3,y3, x4,y4] */
  HandwriteInfoPositions: number[]
  /** 是否正确 */
  IsCorrect: boolean
  /** 答案分析 */
  AnswerAnalysis: string
  /** 知识点 */
  KnowledgePoints: string[]
  /** 正确答案 */
  RightAnswer: string
}

/**
 * 批改信息（递归嵌套结构）
 * 大题 → 子题 → 答案
 */
export interface MarkInfo {
  /** 题目标题 */
  MarkItemTitle: string
  /** 子题列表（递归） */
  MarkInfos: MarkInfo[]
  /** 答案信息列表 */
  AnswerInfos: AnswerInfo[]
}

/** 提交批改任务的响应 */
export interface SubmitJobResponse {
  jobId: string
  questionCount: number
}

/** 查询批改任务的响应 */
export interface QueryJobResponse {
  jobStatus: 'WAIT' | 'RUN' | 'DONE' | 'FAIL'
  errorCode: string
  errorMessage: string
  angle: number
  markInfos: MarkInfo[]
}

/** 扁平化后的单道题批改结果（用于图片标注渲染） */
export interface FlatQuestion {
  id: string
  title: string
  handwriteInfo: string
  positions: number[]
  isCorrect: boolean
  reviewedCorrect: boolean
  analysis: string
  knowledgePoints: string[]
  rightAnswer: string
}

/** 单个答案（前端可编辑） */
export interface ReviewAnswer {
  id: string
  handwriteInfo: string
  positions: number[]
  isCorrect: boolean
  reviewedCorrect: boolean
  rightAnswer: string
  knowledgePoints: string[]
  analysis: string
}

/** 子题 */
export interface ReviewSubQuestion {
  title: string
  answers: ReviewAnswer[]
}

/** 大题（顶层） */
export interface ReviewQuestion {
  index: number
  title: string
  subQuestions: ReviewSubQuestion[]
  /** 大题直属的答案（没有子题时） */
  directAnswers: ReviewAnswer[]
}

/** 老师手动添加的标注（框选 + 对错） */
export interface ManualAnnotation {
  id: string
  /** 在自然尺寸图片上的矩形坐标 [x1,y1, x2,y2, x3,y3, x4,y4] */
  positions: number[]
  isCorrect: boolean
}
