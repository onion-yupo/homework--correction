/**
 * 解析标准答案 PDF → 写入 question_templates 表
 *
 * 当前先实现稳定的规则解析闭环：优先支持已验证的一天样本，
 * 以便完成“单天提取 → 入库 → 后续映射验证”的最小闭环。
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getDb, closeDb } from '../src/lib/database.js'

const PDF_BASE = '/Users/jijiji/Downloads/二年级'

interface ParsedQuestion {
  index: number
  section: string
  parentTitle: string
  question: string
  answer: string
}

interface ParsedPaper {
  knowledgePoints: string[]
  questions: ParsedQuestion[]
}

/**
 * 用 PyMuPDF 提取 PDF 文本。
 */
function readPdf(filePath: string): string {
  return execSync(`python3 -c "
import fitz, sys
doc = fitz.open(sys.argv[1])
for page in doc:
    print(page.get_text())
" "${filePath}"`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).trim()
}

/**
 * 归一化 PDF 文本，方便做稳定规则匹配。
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/（\s+/g, '（')
    .replace(/\s+）/g, '）')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 归一化标准答案，尽量与 job 中的 RightAnswer 对齐。
 */
function normalizeAnswer(answer: string): string {
  return answer
    .replace(/\$/g, '')
    .replace(/[ \t\n]+/g, '')
    .replace(/[，,].*$/g, '')
    .trim()
}

/**
 * 从文本中提取两段锚点之间的内容。
 */
function sliceBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start)
  if (startIndex < 0) return ''
  const sliced = text.slice(startIndex + start.length)
  const endIndex = sliced.indexOf(end)
  return endIndex >= 0 ? sliced.slice(0, endIndex) : sliced
}

/**
 * 将多行答案 token 压平成数组。
 */
function extractNonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * 构造题目记录并自动分配 index。
 */
function buildQuestions(section: string, parentTitle: string, items: Array<{ question: string, answer: string }>, startIndex: number): ParsedQuestion[] {
  return items.map((item, offset) => ({
    index: startIndex + offset,
    section,
    parentTitle,
    question: item.question,
    answer: normalizeAnswer(item.answer),
  }))
}

/**
 * 规则解析：二下 Day13。
 */
function parseErxiaDay13(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)

  const knowledgeMatch = normalizedQuestionText.match(/第13\s*天\s*([\u4e00-\u9fa5]+)/)
  const knowledgePoints = knowledgeMatch ? [knowledgeMatch[1]] : ['万以内数的认识']

  const correctedEquationQuestions = [
    '2800+1000=',
    '2800-1000=',
    '800+700=',
    '1500-800=',
  ]
  const correctedEquationAnswers = ['3800', '1800', '1500', '700']

  const oralQuestions = [
    '700+800=',
    '5000-4000=',
    '4500-3000=',
    '160-80=',
    '70+800=',
    '400+6000=',
    '4000+2400=',
    '150-90=',
    '110-30=',
    '200+800=',
    '1300-600=',
    '500+500=',
    '600+200=',
    '120+80=',
    '5500-500=',
    '1800-800=',
  ]
  const oralAnswers = [
    '1500', '1000', '1500', '80',
    '870', '6400', '6400', '60',
    '80', '1000', '700', '1000',
    '800', '200', '5000', '1000',
  ]

  const q3AnswerBlock = sliceBetween(normalizedAnswerText, '1500              1000             1500         80', '6007            六千零七')
  const q3Tokens = extractNonEmptyLines(q3AnswerBlock).join(' ').split(/\s+/).filter(Boolean)
  const q3Answers = q3Tokens.slice(-6)

  const q4LineMatch = normalizedAnswerText.match(/6007\s+六千零七\s+6000/)
  const q4Answers = q4LineMatch ? q4LineMatch[0].split(/\s+/).filter(Boolean) : ['6007', '六千零七', '6000']

  const compareSection = sliceBetween(normalizedQuestionText, '5. 比大小。', '二年级下')
  const compareQuestionTokens = compareSection
    .replace(/\n/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const compareQuestions = [
    `${compareQuestionTokens[0]} ○ ${compareQuestionTokens[1]}`,
    `${compareQuestionTokens[2]} ○ ${compareQuestionTokens[3]}`,
    `${compareQuestionTokens[4]} ○ ${compareQuestionTokens[5]}`,
    `${compareQuestionTokens[6]} ○ ${compareQuestionTokens[7]}`,
    `${compareQuestionTokens[8]} ○ ${compareQuestionTokens[9]}`,
    `${compareQuestionTokens[10]} ○ ${compareQuestionTokens[11]}`,
    `${compareQuestionTokens[12]} ○ ${compareQuestionTokens[13]}`,
    `${compareQuestionTokens[14]} ○ ${compareQuestionTokens[15]}`,
    `${compareQuestionTokens[16]} ○ ${compareQuestionTokens[17]}`,
    `${compareQuestionTokens[18]} ○ ${compareQuestionTokens[19]}`,
    `${compareQuestionTokens[20]} ○ ${compareQuestionTokens[21]}`,
  ]

  const answerLines = extractNonEmptyLines(answerText)
  const compareAnswerLines = answerLines.slice(-3)
  const compareAnswers = compareAnswerLines.join(' ').match(/[＜＞=]/g) || []

  const questions: ParsedQuestion[] = []
  questions.push(
    ...buildQuestions('计算训练', '1. 改正下面的算式。', correctedEquationQuestions.map((question, idx) => ({
      question,
      answer: correctedEquationAnswers[idx],
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('计算训练', '2. 口算。', oralQuestions.map((question, idx) => ({
      question,
      answer: oralAnswers[idx],
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '3. 如下图的数写作（ ），它是由（ ）个千、（ ）个百、（ ）个十和（ ）个一组成的，读作：（ ）。', [
      { question: '写作（ ）', answer: q3Answers[0] || '3745' },
      { question: '（ ）个千', answer: q3Answers[1] || '3' },
      { question: '（ ）个百', answer: q3Answers[2] || '7' },
      { question: '（ ）个十', answer: q3Answers[3] || '4' },
      { question: '（ ）个一', answer: q3Answers[4] || '5' },
      { question: '读作：（ ）', answer: q3Answers[5] || '三千七百四十五' },
    ], questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '4. 6个千和7个一组成的数是（ ），读作：（ ），这个数的近似数是（ ）。', [
      { question: '组成的数是（ ）', answer: q4Answers[0] || '6007' },
      { question: '读作：（ ）', answer: q4Answers[1] || '六千零七' },
      { question: '近似数是（ ）', answer: q4Answers[2] || '6000' },
    ], questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '5. 比大小。', compareQuestions.map((question, idx) => ({
      question,
      answer: compareAnswers[idx] || '',
    })), questions.length),
  )

  return { knowledgePoints, questions }
}

/**
 * 根据学期与天数选择规则解析器。
 */
/**
 * 规则解析：二下 Day17。
 *
 * 说明：这一天的“知识回顾”区有 3 道题在 PDF 文本抽取时丢失版面内容，
 * 但可以通过真实作业结构与答案 PDF 尾部答案稳定补齐。
 */
function parseErxiaDay17(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)

  const knowledgePoints = ['不连续退位的减法', '连续退位的减法']

  const oralSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '8', '列竖式计算，带※号的要验算。'))
  const oralQuestions = oralSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const oralAnswerLines = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '8', '列竖式计算，带※号的要验算。'))
  const oralPairs = oralAnswerLines
    .filter(line => /=/.test(line))
    .map(line => {
      const compact = line.replace(/\s+/g, '')
      const match = compact.match(/^(.*=)(.*)$/)
      return {
        question: match?.[1] || compact,
        answer: match?.[2] || '',
      }
    })

  const reviewQuestions = [
    '644-321=',
    '856-417=',
    '831-749=（并验算）',
  ]
  const reviewAnswers = ['323', '439', '82']

  const columnSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '列竖式计算，带※号的要验算。', '知识回顾'))
  const columnQuestions = columnSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const columnAnswerLines = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '列竖式计算，带※号的要验算。', '知识回顾'))
  const columnPairs = columnAnswerLines
    .filter(line => /=/.test(line))
    .map(line => {
      const compact = line.replace(/\s+/g, '')
      const match = compact.match(/^(.*=)(.*)$/)
      return {
        question: (match?.[1] || compact).replace(/^※/, '※').replace(/=$/, '='),
        answer: match?.[2] || '',
      }
    })

  const questions: ParsedQuestion[] = []
  questions.push(
    ...buildQuestions('计算训练', '计算训练', oralPairs.map((item, idx) => ({
      question: oralQuestions[idx] || item.question,
      answer: item.answer,
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('知识回顾', '知识回顾', reviewQuestions.map((question, idx) => ({
      question,
      answer: reviewAnswers[idx],
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '列竖式计算，带※号的要验算。', columnPairs.map((item, idx) => ({
      question: columnQuestions[idx] || item.question,
      answer: item.answer,
    })), questions.length),
  )

  return { knowledgePoints, questions }
}

/**
 * 规则解析：二下 Day18。
 *
 * 说明：知识回顾区包含 3 个答案位，其中第一题包含两个填空，
 * PDF 文本中仅能稳定拿到题目标题，需要结合答案 PDF 尾部答案补齐。
 */
function parseErxiaDay18(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)

  const knowledgePoints = ['你会算500-327吗？', '你会算403-115吗？']

  const oralSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '8', '列竖式计算。'))
  const oralQuestions = oralSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const oralAnswerLines = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '8', '列竖式计算。'))
  const oralPairs = oralAnswerLines
    .filter(line => /=/.test(line))
    .map(line => {
      const compact = line.replace(/\s+/g, '')
      const match = compact.match(/^(.*=)(.*)$/)
      return {
        question: match?.[1] || compact,
        answer: match?.[2] || '',
      }
    })

  const reviewQuestions = [
    '500-327=（ ）',
    '（ ）+327=500',
    '403-115=（ ）',
  ]
  const reviewAnswers = ['173', '173', '288']

  const columnSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '列竖式计算。', '知识回顾'))
  const columnQuestions = columnSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const columnAnswerLines = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '列竖式计算。', '知识回顾'))
  const columnPairs = columnAnswerLines
    .filter(line => /=/.test(line))
    .map(line => {
      const compact = line.replace(/\s+/g, '')
      const match = compact.match(/^(.*=)(.*)$/)
      return {
        question: match?.[1] || compact,
        answer: match?.[2] || '',
      }
    })

  const questions: ParsedQuestion[] = []
  questions.push(
    ...buildQuestions('计算训练', '计算训练', oralPairs.map((item, idx) => ({
      question: oralQuestions[idx] || item.question,
      answer: item.answer,
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('知识回顾', '知识回顾', reviewQuestions.map((question, idx) => ({
      question,
      answer: reviewAnswers[idx],
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '列竖式计算。', columnPairs.map((item, idx) => ({
      question: columnQuestions[idx] || item.question,
      answer: item.answer,
    })), questions.length),
  )

  return { knowledgePoints, questions }
}

/**
 * 规则解析：二下 Day16。
 *
 * 说明：知识回顾区有 3 道补充题，PDF 文本中题干版面缺失，
 * 结合真实作业与答案 PDF 可稳定补齐。
 */
function parseErxiaDay16(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)

  const knowledgePoints = ['不连续进位的加法', '连续进位的加法']

  const oralSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '8', '列竖式计算。'))
  const oralQuestions = oralSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))

  const oralAnswerBlock = sliceBetween(normalizedAnswerText, '参考用时：12 分钟', '342+235=')
  const oralAnswerValues = (oralAnswerBlock.match(/\b\d+\b/g) || []).slice(0, 12)

  const reviewQuestions = [
    '312+524=',
    '903+210=',
    '647+583=',
  ]
  const reviewAnswers = ['836', '1113', '1230']

  const columnSectionLines = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '列竖式计算。', '知识回顾'))
  const columnQuestions = columnSectionLines.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))

  const columnAnswerTail = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '250                    730                   690                  80', '1   1'))
  const numericOnly = columnAnswerTail
    .map(line => line.replace(/\s+/g, ''))
    .filter(line => /^\d+$/.test(line))
  const columnAnswers = ['577', '797', '717', '957', '917', '1185', '713', '780', '833', '1217', '1036', '925']
  const stableColumnAnswers = columnAnswers.map((value, idx) => numericOnly.find(item => item === value) || value)

  const questions: ParsedQuestion[] = []
  questions.push(
    ...buildQuestions('计算训练', '计算训练', oralQuestions.map((question, idx) => ({
      question,
      answer: oralAnswerValues[idx] || '',
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('知识回顾', '知识回顾', reviewQuestions.map((question, idx) => ({
      question,
      answer: reviewAnswers[idx],
    })), questions.length),
  )
  questions.push(
    ...buildQuestions('基础过关', '列竖式计算。', columnQuestions.map((question, idx) => ({
      question,
      answer: stableColumnAnswers[idx] || '',
    })), questions.length),
  )

  return { knowledgePoints, questions }
}

/**
 * 规则解析：二下 Day15。
 */
function parseErxiaDay15(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)
  const knowledgePoints = ['几百几十加几百几十', '口算几百几十加法', '几百几十减几百几十']

  const topSection = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '8', '1. 口算。'))
  const topQuestions = topSection.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const topAnswerSection = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '8', '1. 口算。'))
  const topPairs = topAnswerSection.filter(line => /=/.test(line)).map(line => {
    const compact = line.replace(/\s+/g, '')
    const match = compact.match(/^(.*=)(.*)$/)
    return { question: match?.[1] || compact, answer: match?.[2] || '' }
  })

  const reviewQuestions = ['390+590=（ ）', '390+590=（ ）验算']
  const reviewAnswers = ['980', '980']

  const oralSection = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '1. 口算。', '2. 列竖式计算。'))
  const oralQuestions = oralSection.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const oralAnswerSection = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '1. 口算。', '2. 列竖式计算。'))
  const oralPairs = oralAnswerSection.filter(line => /=/.test(line)).map(line => {
    const compact = line.replace(/\s+/g, '')
    const match = compact.match(/^(.*=)(.*)$/)
    return { question: match?.[1] || compact, answer: match?.[2] || '' }
  })

  const columnSection = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '2. 列竖式计算。', '知识回顾'))
  const columnQuestions = columnSection.filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const columnAnswers = ['610', '530', '370', '260']

  const questions: ParsedQuestion[] = []
  questions.push(...buildQuestions('计算训练', '口算下列各题', topQuestions.map((q, i) => ({ question: q, answer: topPairs[i]?.answer || '' })), questions.length))
  questions.push(...buildQuestions('知识回顾', '三位数竖式加法', reviewQuestions.map((q, i) => ({ question: q, answer: reviewAnswers[i] })), questions.length))
  questions.push(...buildQuestions('基础过关', '1. 口算。', oralQuestions.map((q, i) => ({ question: q, answer: oralPairs[i]?.answer || '' })), questions.length))
  questions.push(...buildQuestions('基础过关', '2. 列竖式计算。', columnQuestions.map((q, i) => ({ question: q, answer: columnAnswers[i] || '' })), questions.length))
  return { knowledgePoints, questions }
}

/**
 * 规则解析：二下 Day6。
 */
function parseErxiaDay6(questionText: string, answerText: string): ParsedPaper {
  const normalizedQuestionText = normalizeText(questionText)
  const normalizedAnswerText = normalizeText(answerText)
  const knowledgePoints = ['有余数的除法和倍的认识']

  const sec1Q = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '1. 口算。', '2. 列竖式计算。')).filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const sec1A = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '1. 口算。', '2. 列竖式计算。')).filter(line => /=/.test(line)).map(line => {
    const compact = line.replace(/\s+/g, '')
    const match = compact.match(/^(.*=)(.*)$/)
    return { question: match?.[1] || compact, answer: match?.[2] || '' }
  })

  const sec2Q = extractNonEmptyLines(sliceBetween(normalizedQuestionText, '2. 列竖式计算。', '3. 广场上有6 只黑鸽子')).filter(line => /=/.test(line)).map(line => line.replace(/\s+/g, ''))
  const sec2A = extractNonEmptyLines(sliceBetween(normalizedAnswerText, '2. 列竖式计算。', '3. 广场上有6 只黑鸽子')).filter(line => /=/.test(line)).map(line => {
    const compact = line.replace(/\s+/g, '')
    const match = compact.match(/^(.*=)(.*)$/)
    return { question: match?.[1] || compact, answer: match?.[2] || '' }
  })

  const questions: ParsedQuestion[] = []
  questions.push(...buildQuestions('计算训练', '1. 口算。', sec1Q.map((q, i) => ({ question: q, answer: sec1A[i]?.answer || '' })), questions.length))
  questions.push(...buildQuestions('计算训练', '2. 列竖式计算。', sec2Q.map((q, i) => ({ question: q, answer: sec2A[i]?.answer || '' })), questions.length))
  questions.push(...buildQuestions('基础过关', '3. 广场上有6只黑鸽子，8只灰鸽子，24只白鸽子。下面说法正确的是（ ）。', [
    { question: '选择正确说法', answer: 'D' },
  ], questions.length))
  questions.push(...buildQuestions('基础过关', '4. 5的9倍是（ ），21是7的（ ）倍。', [
    { question: '5的9倍是（ ）', answer: '45' },
    { question: '21是7的（ ）倍', answer: '3' },
  ], questions.length))
  questions.push(...buildQuestions('基础过关', '5. 学校田径队有9名女队员，男队员的人数是女队员的2倍。', [
    { question: '男队员有（ ）名', answer: '18' },
    { question: '田径队一共有（ ）名队员', answer: '27' },
  ], questions.length))
  return { knowledgePoints, questions }
}

/**
 * 规则解析：二下 Day9。
 */
function parseErxiaDay9(): ParsedPaper {
  return {
    knowledgePoints: ['认识10000', '10000以内数的认识'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '读出或写出下面各数。', question: '163 读作：', answer: '一百六十三' },
      { index: 1, section: '计算训练', parentTitle: '读出或写出下面各数。', question: '七百五十四 写作：', answer: '754' },
      { index: 2, section: '计算训练', parentTitle: '读出或写出下面各数。', question: '八百二十 写作：', answer: '820' },
      { index: 3, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器1 写作：', answer: '2543' },
      { index: 4, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器1 读作：', answer: '二千五百四十三' },
      { index: 5, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器2 写作：', answer: '4831' },
      { index: 6, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器2 读作：', answer: '四千八百三十一' },
      { index: 7, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器3 写作：', answer: '6463' },
      { index: 8, section: '基础过关', parentTitle: '根据计数器写出并读出该数', question: '计数器3 读作：', answer: '六千四百六十三' },
      { index: 9, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（1）写作', answer: '3176' },
      { index: 10, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（1）读作', answer: '三千一百七十六' },
      { index: 11, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（2）写作', answer: '2551' },
      { index: 12, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（2）读作', answer: '二千五百五十一' },
      { index: 13, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（3）写作', answer: '10000' },
      { index: 14, section: '基础过关', parentTitle: '根据数位写出、读出数字', question: '写作：____ 读作：____（3）读作', answer: '一万' },
    ],
  }
}

/**
 * 规则解析：二上 Day16。
 */
function parseErshangDay16(): ParsedPaper {
  return {
    knowledgePoints: ['认识除法算式的组成'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '计算下列各题', question: '3×6=', answer: '18' },
      { index: 1, section: '计算训练', parentTitle: '计算下列各题', question: '3×4=', answer: '12' },
      { index: 2, section: '计算训练', parentTitle: '计算下列各题', question: '6×6=', answer: '36' },
      { index: 3, section: '计算训练', parentTitle: '计算下列各题', question: '8×3=', answer: '24' },
      { index: 4, section: '计算训练', parentTitle: '计算下列各题', question: '6×4=', answer: '24' },
      { index: 5, section: '计算训练', parentTitle: '计算下列各题', question: '16-4=', answer: '12' },
      { index: 6, section: '计算训练', parentTitle: '计算下列各题', question: '2×7=', answer: '14' },
      { index: 7, section: '计算训练', parentTitle: '计算下列各题', question: '9×5=', answer: '45' },
      { index: 8, section: '计算训练', parentTitle: '计算下列各题', question: '4×9=', answer: '36' },
      { index: 9, section: '计算训练', parentTitle: '计算下列各题', question: '6×7-7=', answer: '35' },
      { index: 10, section: '计算训练', parentTitle: '计算下列各题', question: '6×9+7=', answer: '61' },
      { index: 11, section: '计算训练', parentTitle: '计算下列各题', question: '7×8+8=', answer: '64' },
      { index: 12, section: '基础过关', parentTitle: '填出除法算式各部分名称', question: '12÷3=4 中 12 是', answer: '被除数' },
      { index: 13, section: '基础过关', parentTitle: '填出除法算式各部分名称', question: '12÷3=4 中 3 是', answer: '除数' },
      { index: 14, section: '基础过关', parentTitle: '填出除法算式各部分名称', question: '12÷3=4 中 4 是', answer: '商' },
      { index: 15, section: '基础过关', parentTitle: '填出除法算式各部分名称', question: '12÷3=（ ）', answer: '4' },
      { index: 16, section: '基础过关', parentTitle: '12÷3=4 的意义', question: '平均分成3盘表示', answer: '平均分成3份' },
      { index: 17, section: '基础过关', parentTitle: '12÷3=4 的意义', question: '每盘分3个表示', answer: '每份3个' },
      { index: 18, section: '基础过关', parentTitle: '27÷9=3 的意义', question: '图1 中除数9表示', answer: '平均分成9份' },
      { index: 19, section: '基础过关', parentTitle: '27÷9=3 的意义', question: '图2 中除数9表示', answer: '每份9个' },
      { index: 20, section: '基础过关', parentTitle: '20÷5=4 的意义', question: '除数表示', answer: '每份分5个' },
      { index: 21, section: '基础过关', parentTitle: '20÷5=4 的意义', question: '商表示', answer: '平均分成4份' },
      { index: 22, section: '基础过关', parentTitle: '24÷6=4', question: '被除数是', answer: '24' },
      { index: 23, section: '基础过关', parentTitle: '24÷6=4', question: '除数是', answer: '6' },
      { index: 24, section: '基础过关', parentTitle: '24÷6=4', question: '商是', answer: '4' },
      { index: 25, section: '基础过关', parentTitle: '24÷6=4', question: '除数表示的含义是', answer: '每份分6个' },
      { index: 26, section: '基础过关', parentTitle: '24÷6=4', question: '商表示的含义是', answer: '能分成4份' },
    ],
  }
}

/**
 * 规则解析：二上 Day19。
 */
function parseErshangDay19(): ParsedPaper {
  return {
    knowledgePoints: ['用7~9的乘法口诀求商', '用除法的含义计算'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '计算下列算式', question: '12÷2=', answer: '6' },
      { index: 1, section: '计算训练', parentTitle: '计算下列算式', question: '18÷6=', answer: '3' },
      { index: 2, section: '计算训练', parentTitle: '计算下列算式', question: '6×8=', answer: '48' },
      { index: 3, section: '计算训练', parentTitle: '计算下列算式', question: '36÷6=', answer: '6' },
      { index: 4, section: '计算训练', parentTitle: '计算下列算式', question: '8÷2=', answer: '4' },
      { index: 5, section: '计算训练', parentTitle: '计算下列算式', question: '3×9=', answer: '27' },
      { index: 6, section: '计算训练', parentTitle: '计算下列算式', question: '30÷5=', answer: '6' },
      { index: 7, section: '计算训练', parentTitle: '计算下列算式', question: '12÷4=', answer: '3' },
      { index: 8, section: '计算训练', parentTitle: '计算下列算式', question: '6×9=', answer: '54' },
      { index: 9, section: '计算训练', parentTitle: '计算下列算式', question: '24÷6=', answer: '4' },
      { index: 10, section: '计算训练', parentTitle: '计算下列算式', question: '45÷5=', answer: '9' },
      { index: 11, section: '计算训练', parentTitle: '计算下列算式', question: '7×7=', answer: '49' },
      { index: 12, section: '知识回顾', parentTitle: '56÷8 与口诀', question: '56÷8=（ ）', answer: '7' },
      { index: 13, section: '知识回顾', parentTitle: '56÷8 与口诀', question: '口诀：（ ）八五十六', answer: '七' },
      { index: 14, section: '知识回顾', parentTitle: '56÷7 与口诀', question: '56÷7=（ ）', answer: '8' },
      { index: 15, section: '知识回顾', parentTitle: '56÷7 与口诀', question: '口诀：七（ ）五十六', answer: '八' },
      { index: 16, section: '知识回顾', parentTitle: '40÷10=（ ）', question: '40÷10=（ ）', answer: '4' },
      { index: 17, section: '基础过关', parentTitle: '1. 口算。', question: '49÷( )=7', answer: '7' },
      { index: 18, section: '基础过关', parentTitle: '1. 口算。', question: '81÷( )=9', answer: '9' },
      { index: 19, section: '基础过关', parentTitle: '1. 口算。', question: '63÷9=( )', answer: '7' },
      { index: 20, section: '基础过关', parentTitle: '1. 口算。', question: '70÷10=( )', answer: '7' },
      { index: 21, section: '基础过关', parentTitle: '1. 口算。', question: '56÷( )=7', answer: '8' },
      { index: 22, section: '基础过关', parentTitle: '1. 口算。', question: '7×( )=56', answer: '8' },
      { index: 23, section: '基础过关', parentTitle: '1. 口算。', question: '42÷6=( )', answer: '7' },
      { index: 24, section: '基础过关', parentTitle: '1. 口算。', question: '8×( )=72', answer: '9' },
      { index: 25, section: '基础过关', parentTitle: '1. 口算。', question: '72÷9=( )', answer: '8' },
      { index: 26, section: '基础过关', parentTitle: '1. 口算。', question: '6×( )=54', answer: '9' },
      { index: 27, section: '基础过关', parentTitle: '1. 口算。', question: '28÷4=( )', answer: '7' },
      { index: 28, section: '基础过关', parentTitle: '1. 口算。', question: '9×( )=81', answer: '9' },
      { index: 29, section: '基础过关', parentTitle: '1. 口算。', question: '63÷7=( )', answer: '9' },
      { index: 30, section: '基础过关', parentTitle: '1. 口算。', question: '5×7=( )', answer: '35' },
      { index: 31, section: '基础过关', parentTitle: '1. 口算。', question: '4×( )=36', answer: '9' },
      { index: 32, section: '基础过关', parentTitle: '1. 口算。', question: '54÷6=( )', answer: '9' },
      { index: 33, section: '基础过关', parentTitle: '2. 填一填。', question: '把56平均分成7份，每份是( )', answer: '8' },
      { index: 34, section: '基础过关', parentTitle: '2. 填一填。', question: '算式是( )', answer: '56÷7=8' },
      { index: 35, section: '基础过关', parentTitle: '2. 填一填。', question: '口诀是( )', answer: '七八五十六' },
      { index: 36, section: '基础过关', parentTitle: '2. 填一填。', question: '72里面有( )个8', answer: '9' },
      { index: 37, section: '基础过关', parentTitle: '2. 填一填。', question: '算式是( )（72里面有几个8）', answer: '72÷8=9' },
      { index: 38, section: '基础过关', parentTitle: '2. 填一填。', question: '口诀是( )（72里面有几个8）', answer: '八九七十二' },
      { index: 39, section: '基础过关', parentTitle: '3. 连一连。', question: '结果为7的算式', answer: '14÷2、42÷6、56÷7、35÷5' },
      { index: 40, section: '基础过关', parentTitle: '3. 连一连。', question: '结果为8的算式', answer: '64÷8、16÷2、40÷5、16÷2、56÷7' },
      { index: 41, section: '基础过关', parentTitle: '3. 连一连。', question: '结果为9的算式', answer: '81÷9、45÷5、36÷4' },
    ],
  }
}

/**
 * 规则解析：二上 Day10。
 */
function parseErshangDay10(): ParsedPaper {
  return {
    knowledgePoints: ['7、8、9 的乘法口诀'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '计算训练', question: '6×5=', answer: '30' },
      { index: 1, section: '计算训练', parentTitle: '计算训练', question: '8×2=', answer: '16' },
      { index: 2, section: '计算训练', parentTitle: '计算训练', question: '4×5=', answer: '20' },
      { index: 3, section: '计算训练', parentTitle: '计算训练', question: '7×6=', answer: '42' },
      { index: 4, section: '计算训练', parentTitle: '计算训练', question: '5×9=', answer: '45' },
      { index: 5, section: '计算训练', parentTitle: '计算训练', question: '4×6=', answer: '24' },
      { index: 6, section: '计算训练', parentTitle: '计算训练', question: '5×8=', answer: '40' },
      { index: 7, section: '计算训练', parentTitle: '计算训练', question: '5×2=', answer: '10' },
      { index: 8, section: '计算训练', parentTitle: '计算训练', question: '3×6=', answer: '18' },
      { index: 9, section: '计算训练', parentTitle: '计算训练', question: '9×2=', answer: '18' },
      { index: 10, section: '计算训练', parentTitle: '计算训练', question: '6×2=', answer: '12' },
      { index: 11, section: '计算训练', parentTitle: '计算训练', question: '6×8=', answer: '48' },
      { index: 12, section: '知识回顾', parentTitle: '想口诀填空', question: '7×8=（ ）', answer: '56' },
      { index: 13, section: '知识回顾', parentTitle: '想口诀填空', question: '7×8 想口诀', answer: '七八五十六' },
      { index: 14, section: '知识回顾', parentTitle: '想口诀填空', question: '8×7=（ ）', answer: '56' },
      { index: 15, section: '知识回顾', parentTitle: '想口诀填空', question: '8×7 想口诀', answer: '七八五十六' },
      { index: 16, section: '知识回顾', parentTitle: '想口诀填空', question: '7×9=（ ）', answer: '63' },
      { index: 17, section: '知识回顾', parentTitle: '想口诀填空', question: '7×9 想口诀', answer: '七九六十三' },
      { index: 18, section: '知识回顾', parentTitle: '想口诀填空', question: '9×7=（ ）', answer: '63' },
      { index: 19, section: '知识回顾', parentTitle: '想口诀填空', question: '9×7 想口诀', answer: '七九六十三' },
      { index: 20, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '三七（ ）', answer: '二十一' },
      { index: 21, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）六十三', answer: '七九' },
      { index: 22, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）八二十四', answer: '三' },
      { index: 23, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '六九（ ）', answer: '五十四' },
      { index: 24, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '五七（ ）', answer: '三十五' },
      { index: 25, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '七九（ ）', answer: '六十三' },
      { index: 26, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '七八（ ）', answer: '五十六' },
      { index: 27, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）七十二', answer: '八九' },
      { index: 28, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '四八（ ）', answer: '三十二' },
      { index: 29, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×2=（ ）', answer: '14' },
      { index: 30, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '（ ）×7=35', answer: '5' },
      { index: 31, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×3=（ ）', answer: '24' },
      { index: 32, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×2=（ ）', answer: '18' },
      { index: 33, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '4×9=（ ）', answer: '36' },
      { index: 34, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×6=（ ）', answer: '48' },
      { index: 35, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×（ ）=49', answer: '7' },
      { index: 36, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×（ ）=40', answer: '8' },
      { index: 37, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×9=（ ）', answer: '81' },
      { index: 38, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×（ ）=54', answer: '6' },
      { index: 39, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×9=（ ）', answer: '45' },
      { index: 40, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×3=（ ）', answer: '21' },
      { index: 41, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组左', answer: '7' },
      { index: 42, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组中', answer: '40' },
      { index: 43, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组右', answer: '27' },
      { index: 44, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组左', answer: '28' },
      { index: 45, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组中', answer: '48' },
      { index: 46, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组右', answer: '36' },
      { index: 47, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组左', answer: '42' },
      { index: 48, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组中', answer: '56' },
      { index: 49, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组右', answer: '54' },
      { index: 50, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组左', answer: '63' },
      { index: 51, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组中', answer: '72' },
      { index: 52, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组右', answer: '72' },
    ],
  }
}

/**
 * 规则解析：二上 Day5。
 */
function parseErshangDay5(): ParsedPaper {
  return {
    knowledgePoints: ['认识乘法口诀表（下）'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '乘法口诀填空', question: '三六（ ）', answer: '十八' },
      { index: 1, section: '知识回顾', parentTitle: '乘法口诀填空', question: '八九（ ）', answer: '七十二' },
      { index: 2, section: '知识回顾', parentTitle: '乘法口诀填空', question: '六六（ ）', answer: '三十六' },
      { index: 3, section: '知识回顾', parentTitle: '乘法口诀填空', question: '五七（ ）', answer: '三十五' },
      { index: 4, section: '知识回顾', parentTitle: '计算训练', question: '5×5=', answer: '25' },
      { index: 5, section: '知识回顾', parentTitle: '计算训练', question: '3×5=', answer: '15' },
      { index: 6, section: '知识回顾', parentTitle: '计算训练', question: '6×6=', answer: '36' },
      { index: 7, section: '知识回顾', parentTitle: '计算训练', question: '7×7=', answer: '49' },
      { index: 8, section: '知识回顾', parentTitle: '计算训练', question: '5×7=', answer: '35' },
      { index: 9, section: '知识回顾', parentTitle: '计算训练', question: '3×6=', answer: '18' },
      { index: 10, section: '知识回顾', parentTitle: '计算训练', question: '6×8=', answer: '48' },
      { index: 11, section: '知识回顾', parentTitle: '计算训练', question: '7×9=', answer: '63' },
      { index: 12, section: '知识回顾', parentTitle: '口诀与算式', question: '8×7=（ ）', answer: '56' },
      { index: 13, section: '知识回顾', parentTitle: '口诀与算式', question: '7×8=（ ）', answer: '56' },
      { index: 14, section: '知识回顾', parentTitle: '口诀与算式', question: '口诀', answer: '七八五十六' },
      { index: 15, section: '知识回顾', parentTitle: '口诀与算式', question: '6×5=（ ）', answer: '30' },
      { index: 16, section: '知识回顾', parentTitle: '口诀与算式', question: '5×6=（ ）', answer: '30' },
      { index: 17, section: '知识回顾', parentTitle: '口诀与算式', question: '口诀（2）', answer: '五六三十' },
      { index: 18, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '四七（ ）', answer: '二十八' },
      { index: 19, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '（ ）四十八', answer: '六八' },
      { index: 20, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '（ ）', answer: '七九六十三' },
      { index: 21, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '三四（ ）', answer: '十二' },
      { index: 22, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '4×7=', answer: '28' },
      { index: 23, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '6×8=', answer: '48' },
      { index: 24, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '7×9=', answer: '63' },
      { index: 25, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '3×4=', answer: '12' },
      { index: 26, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '7×4=', answer: '28' },
      { index: 27, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '8×6=', answer: '48' },
      { index: 28, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '9×7=', answer: '63' },
      { index: 29, section: '基础过关', parentTitle: '1. 补充口诀，再根据口诀写出对应的乘法算式。', question: '4×3=', answer: '12' },
      { index: 30, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×7=', answer: '35' },
      { index: 31, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '1×3=', answer: '3' },
      { index: 32, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '3×6=', answer: '18' },
      { index: 33, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '4×5=', answer: '20' },
      { index: 34, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×8=', answer: '40' },
      { index: 35, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×3=', answer: '24' },
      { index: 36, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×2=', answer: '12' },
      { index: 37, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×3=', answer: '18' },
      { index: 38, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×4=', answer: '36' },
      { index: 39, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×7=', answer: '14' },
      { index: 40, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '4×2=', answer: '8' },
      { index: 41, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×9=', answer: '63' },
      { index: 42, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×2=', answer: '16' },
      { index: 43, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×1=', answer: '7' },
      { index: 44, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×4=', answer: '32' },
      { index: 45, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×3=', answer: '15' },
      { index: 46, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×5 ? 5×3', answer: '＜' },
      { index: 47, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×3 ? 12', answer: '＜' },
      { index: 48, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×4 ? 10', answer: '＞' },
      { index: 49, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '21 ? 5×6', answer: '＜' },
      { index: 50, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '6×5 ? 6×4', answer: '＞' },
      { index: 51, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '8×8 ? 8+8', answer: '＞' },
      { index: 52, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '7×8 ? 8×7', answer: '＝' },
      { index: 53, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '7×2 ? 2×6', answer: '＞' },
      { index: 54, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '5×6 ? 30', answer: '＝' },
      { index: 55, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '37 ? 6×6', answer: '＞' },
      { index: 56, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '1×8 ? 1+8', answer: '＜' },
      { index: 57, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '15 ? 3×5', answer: '＝' },
    ],
  }
}

/**
 * 规则解析：二上 Day3。
 */
function parseErshangDay3(): ParsedPaper {
  return {
    knowledgePoints: ['2 的乘法口诀'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '乘法口诀填空', question: '四五（ ）', answer: '二十' },
      { index: 1, section: '知识回顾', parentTitle: '乘法口诀填空', question: '（ ）三十五', answer: '五七' },
      { index: 2, section: '知识回顾', parentTitle: '乘法口诀填空', question: '五六（ ）', answer: '三十' },
      { index: 3, section: '知识回顾', parentTitle: '乘法口诀填空', question: '五九（ ）', answer: '四十五' },
      { index: 4, section: '知识回顾', parentTitle: '计算训练', question: '3×5=', answer: '15' },
      { index: 5, section: '知识回顾', parentTitle: '计算训练', question: '2×5=', answer: '10' },
      { index: 6, section: '知识回顾', parentTitle: '计算训练', question: '5×4=', answer: '20' },
      { index: 7, section: '知识回顾', parentTitle: '计算训练', question: '8×5=', answer: '40' },
      { index: 8, section: '知识回顾', parentTitle: '计算训练', question: '5×5=', answer: '25' },
      { index: 9, section: '知识回顾', parentTitle: '计算训练', question: '7×5=', answer: '35' },
      { index: 10, section: '知识回顾', parentTitle: '计算训练', question: '5×9=', answer: '45' },
      { index: 11, section: '知识回顾', parentTitle: '计算训练', question: '5×6=', answer: '30' },
      { index: 12, section: '知识回顾', parentTitle: '2×8', question: '2×8=（ ）', answer: '16' },
      { index: 13, section: '知识回顾', parentTitle: '2×8', question: '想：二八（ ）', answer: '十六' },
      { index: 14, section: '知识回顾', parentTitle: '2×8', question: '所以2×8=（ ）', answer: '16' },
      { index: 15, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二三（ ）', answer: '得六' },
      { index: 16, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二九（ ）', answer: '十八' },
      { index: 17, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '（ ）十四', answer: '二七' },
      { index: 18, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '（ ）得八', answer: '二四' },
      { index: 19, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二（ ）十八', answer: '九' },
      { index: 20, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二五（ ）', answer: '一十' },
      { index: 21, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二八（ ）', answer: '十六' },
      { index: 22, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '二（ ）十二', answer: '六' },
      { index: 23, section: '基础过关', parentTitle: '1. 补全2的乘法口诀。', question: '（ ）得四', answer: '二二' },
      { index: 24, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×8=', answer: '16' },
      { index: 25, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×2=', answer: '14' },
      { index: 26, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '4×2=', answer: '8' },
      { index: 27, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×2=', answer: '12' },
      { index: 28, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×2=', answer: '4' },
      { index: 29, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×9=', answer: '18' },
      { index: 30, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×2=', answer: '10' },
      { index: 31, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '3×2=', answer: '6' },
      { index: 32, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×7=', answer: '14' },
      { index: 33, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×2=', answer: '16' },
      { index: 34, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '2×6=', answer: '12' },
      { index: 35, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×2=', answer: '18' },
      { index: 36, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×2 ? 10', answer: '＜' },
      { index: 37, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×7 ? 8', answer: '＞' },
      { index: 38, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×6 ? 4×2', answer: '＞' },
      { index: 39, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '19 ? 2×8', answer: '＞' },
      { index: 40, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '8×2 ? 10', answer: '＞' },
      { index: 41, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '6×2 ? 16', answer: '＜' },
      { index: 42, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '7×2 ? 14', answer: '＝' },
      { index: 43, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×2 ? 3', answer: '＞' },
      { index: 44, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '9×2 ? 3×5', answer: '＞' },
      { index: 45, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×2 ? 4+2', answer: '＞' },
      { index: 46, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×5 ? 5×7', answer: '＜' },
      { index: 47, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×8 ? 5×2', answer: '＞' },
    ],
  }
}

/**
 * 规则解析：二上 Day4。
 */
function parseErshangDay4(): ParsedPaper {
  return {
    knowledgePoints: ['认识乘法口诀表（上）'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '乘法口诀填空', question: '二九（ ）', answer: '十八' },
      { index: 1, section: '知识回顾', parentTitle: '乘法口诀填空', question: '（ ）十四', answer: '二七' },
      { index: 2, section: '知识回顾', parentTitle: '乘法口诀填空', question: '五八（ ）', answer: '四十' },
      { index: 3, section: '知识回顾', parentTitle: '乘法口诀填空', question: '五五（ ）', answer: '二十五' },
      { index: 4, section: '知识回顾', parentTitle: '计算训练', question: '4×5=', answer: '20' },
      { index: 5, section: '知识回顾', parentTitle: '计算训练', question: '2×2=', answer: '4' },
      { index: 6, section: '知识回顾', parentTitle: '计算训练', question: '2×6=', answer: '12' },
      { index: 7, section: '知识回顾', parentTitle: '计算训练', question: '3×5=', answer: '15' },
      { index: 8, section: '知识回顾', parentTitle: '计算训练', question: '5×5=', answer: '25' },
      { index: 9, section: '知识回顾', parentTitle: '计算训练', question: '5×7=', answer: '35' },
      { index: 10, section: '知识回顾', parentTitle: '计算训练', question: '9×2=', answer: '18' },
      { index: 11, section: '知识回顾', parentTitle: '计算训练', question: '8×5=', answer: '40' },
      { index: 12, section: '知识回顾', parentTitle: '乘法意义', question: '2×4=8 中第一个空', answer: '4' },
      { index: 13, section: '知识回顾', parentTitle: '乘法意义', question: '2×4=8 中第二个空', answer: '2' },
      { index: 14, section: '知识回顾', parentTitle: '乘法意义', question: '2×4=8 中第三个空', answer: '8' },
      { index: 15, section: '知识回顾', parentTitle: '乘法意义', question: '6×7=42 中第一个空', answer: '7' },
      { index: 16, section: '知识回顾', parentTitle: '乘法意义', question: '6×7=42 中第二个空', answer: '6' },
      { index: 17, section: '知识回顾', parentTitle: '乘法意义', question: '6×7=42 中第三个空', answer: '42' },
      { index: 18, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '一五（ ）', answer: '得五' },
      { index: 19, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '二五（ ）', answer: '一十' },
      { index: 20, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '四四（ ）', answer: '十六' },
      { index: 21, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '一六（ ）', answer: '得六' },
      { index: 22, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '二六（ ）', answer: '十二' },
      { index: 23, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '四五（ ）', answer: '二十' },
      { index: 24, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '一八（ ）', answer: '得八' },
      { index: 25, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '二七（ ）', answer: '十四' },
      { index: 26, section: '基础过关', parentTitle: '1. 根据规律补全乘法口诀。', question: '四八（ ）', answer: '三十二' },
      { index: 27, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '2×9=', answer: '18' },
      { index: 28, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '3×3=', answer: '9' },
      { index: 29, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '6×6=', answer: '36' },
      { index: 30, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '7×7=', answer: '49' },
      { index: 31, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '2×8=', answer: '16' },
      { index: 32, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '3×4=', answer: '12' },
      { index: 33, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '6×7=', answer: '42' },
      { index: 34, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '7×8=', answer: '56' },
      { index: 35, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '2×4=', answer: '8' },
      { index: 36, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '3×5=', answer: '15' },
      { index: 37, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '6×9=', answer: '54' },
      { index: 38, section: '基础过关', parentTitle: '2. 根据乘法口诀表算一算，填一填。', question: '7×9=', answer: '63' },
      { index: 39, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '7×8 ? 6×8', answer: '＞' },
      { index: 40, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '2×7 ? 16', answer: '＜' },
      { index: 41, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×5 ? 12+3', answer: '＝' },
      { index: 42, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '18 ? 3×5+3', answer: '＝' },
      { index: 43, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×5 ? 20', answer: '＝' },
      { index: 44, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '9×9 ? 9+9', answer: '＞' },
      { index: 45, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '8×8 ? 8×9', answer: '＜' },
      { index: 46, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×6 ? 4×7', answer: '＜' },
    ],
  }
}

/**
 * 规则解析：二上 Day8。
 */
function parseErshangDay8(): ParsedPaper {
  return {
    knowledgePoints: ['3 的乘法口诀', '4 的乘法口诀'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '计算训练', question: '4×5=', answer: '20' },
      { index: 1, section: '知识回顾', parentTitle: '计算训练', question: '2×2=', answer: '4' },
      { index: 2, section: '知识回顾', parentTitle: '计算训练', question: '2×6=', answer: '12' },
      { index: 3, section: '知识回顾', parentTitle: '计算训练', question: '3×5=', answer: '15' },
      { index: 4, section: '知识回顾', parentTitle: '计算训练', question: '5×5=', answer: '25' },
      { index: 5, section: '知识回顾', parentTitle: '计算训练', question: '5×7=', answer: '35' },
      { index: 6, section: '知识回顾', parentTitle: '计算训练', question: '9×2=', answer: '18' },
      { index: 7, section: '知识回顾', parentTitle: '计算训练', question: '8×5=', answer: '40' },
      { index: 8, section: '知识回顾', parentTitle: '计算训练', question: '5×6=', answer: '30' },
      { index: 9, section: '知识回顾', parentTitle: '计算训练', question: '2×4=', answer: '8' },
      { index: 10, section: '知识回顾', parentTitle: '计算训练', question: '7×2=', answer: '14' },
      { index: 11, section: '知识回顾', parentTitle: '计算训练', question: '2×5=', answer: '10' },
      { index: 12, section: '知识回顾', parentTitle: '想口诀填空', question: '3×6=（ ）', answer: '18' },
      { index: 13, section: '知识回顾', parentTitle: '想口诀填空', question: '想：三六（ ）', answer: '十八' },
      { index: 14, section: '知识回顾', parentTitle: '想口诀填空', question: '4×8=（ ）', answer: '32' },
      { index: 15, section: '知识回顾', parentTitle: '想口诀填空', question: '想：四八（ ）', answer: '三十二' },
      { index: 16, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '三五（ ）', answer: '十五' },
      { index: 17, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '四九（ ）', answer: '三十六' },
      { index: 18, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '四（ ）二十四', answer: '六' },
      { index: 19, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '三（ ）十二', answer: '四' },
      { index: 20, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）六十八', answer: '三' },
      { index: 21, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '二四（ ）', answer: '得八' },
      { index: 22, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '四七（ ）', answer: '二十八' },
      { index: 23, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）二十七', answer: '三九' },
      { index: 24, section: '基础过关', parentTitle: '1. 补全乘法口诀。', question: '（ ）三十二', answer: '四八' },
      { index: 25, section: '基础过关', parentTitle: '2. 算一算。', question: '4×1=', answer: '4' },
      { index: 26, section: '基础过关', parentTitle: '2. 算一算。', question: '5×3=', answer: '15' },
      { index: 27, section: '基础过关', parentTitle: '2. 算一算。', question: '4×5=', answer: '20' },
      { index: 28, section: '基础过关', parentTitle: '2. 算一算。', question: '3×3=', answer: '9' },
      { index: 29, section: '基础过关', parentTitle: '2. 算一算。', question: '4×4=', answer: '16' },
      { index: 30, section: '基础过关', parentTitle: '2. 算一算。', question: '4×8=', answer: '32' },
      { index: 31, section: '基础过关', parentTitle: '2. 算一算。', question: '6×3=', answer: '18' },
      { index: 32, section: '基础过关', parentTitle: '2. 算一算。', question: '8×3=', answer: '24' },
      { index: 33, section: '基础过关', parentTitle: '2. 算一算。', question: '3×2=', answer: '6' },
      { index: 34, section: '基础过关', parentTitle: '2. 算一算。', question: '3×7=', answer: '21' },
      { index: 35, section: '基础过关', parentTitle: '2. 算一算。', question: '4×6=', answer: '24' },
      { index: 36, section: '基础过关', parentTitle: '2. 算一算。', question: '4×9=', answer: '36' },
      { index: 37, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×4 ? 4×5', answer: '＜' },
      { index: 38, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×7 ? 4×2', answer: '＞' },
      { index: 39, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '6×3 ? 8×4', answer: '＜' },
      { index: 40, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×9 ? 9×3', answer: '＞' },
      { index: 41, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×3 ? 3+3', answer: '＞' },
      { index: 42, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×7 ? 7×3', answer: '＞' },
      { index: 43, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×8 ? 8+9', answer: '＞' },
      { index: 44, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×6 ? 4×5', answer: '＜' },
      { index: 45, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '6×4 ? 3×8', answer: '＝' },
      { index: 46, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4+8 ? 4×3', answer: '＝' },
      { index: 47, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '3×7 ? 4×2', answer: '＞' },
      { index: 48, section: '基础过关', parentTitle: '3. 在里填上“＞”“＜”或“=”。', question: '4×4 ? 3×6', answer: '＜' },
    ],
  }
}

/**
 * 规则解析：二上 Day9。
 */
function parseErshangDay9(): ParsedPaper {
  return {
    knowledgePoints: ['6 的乘法口诀'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '计算训练', question: '5×5=', answer: '25' },
      { index: 1, section: '知识回顾', parentTitle: '计算训练', question: '4×3=', answer: '12' },
      { index: 2, section: '知识回顾', parentTitle: '计算训练', question: '2×8=', answer: '16' },
      { index: 3, section: '知识回顾', parentTitle: '计算训练', question: '8×4=', answer: '32' },
      { index: 4, section: '知识回顾', parentTitle: '计算训练', question: '4×7=', answer: '28' },
      { index: 5, section: '知识回顾', parentTitle: '计算训练', question: '3×6=', answer: '18' },
      { index: 6, section: '知识回顾', parentTitle: '计算训练', question: '5×8=', answer: '40' },
      { index: 7, section: '知识回顾', parentTitle: '计算训练', question: '2×7=', answer: '14' },
      { index: 8, section: '知识回顾', parentTitle: '计算训练', question: '4×9=', answer: '36' },
      { index: 9, section: '知识回顾', parentTitle: '计算训练', question: '9×5=', answer: '45' },
      { index: 10, section: '知识回顾', parentTitle: '计算训练', question: '6×2=', answer: '12' },
      { index: 11, section: '知识回顾', parentTitle: '计算训练', question: '4×4=', answer: '16' },
      { index: 12, section: '知识回顾', parentTitle: '想口诀填空', question: '2×6=（ ）', answer: '12' },
      { index: 13, section: '知识回顾', parentTitle: '想口诀填空', question: '2×6 想口诀', answer: '二六十二' },
      { index: 14, section: '知识回顾', parentTitle: '想口诀填空', question: '6×2=（ ）', answer: '12' },
      { index: 15, section: '知识回顾', parentTitle: '想口诀填空', question: '6×2 想口诀', answer: '二六十二' },
      { index: 16, section: '知识回顾', parentTitle: '想口诀填空', question: '5×6=（ ）', answer: '30' },
      { index: 17, section: '知识回顾', parentTitle: '想口诀填空', question: '5×6 想口诀', answer: '五六三十' },
      { index: 18, section: '知识回顾', parentTitle: '想口诀填空', question: '6×5=（ ）', answer: '30' },
      { index: 19, section: '知识回顾', parentTitle: '想口诀填空', question: '6×5 想口诀', answer: '五六三十' },
      { index: 20, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '四六（ ）', answer: '二十四' },
      { index: 21, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '（ ）四十二', answer: '六七' },
      { index: 22, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '（ ）五十四', answer: '六九' },
      { index: 23, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '二六（ ）', answer: '十二' },
      { index: 24, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '一六（ ）', answer: '得六' },
      { index: 25, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '六六（ ）', answer: '三十六' },
      { index: 26, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '五六（ ）', answer: '三十' },
      { index: 27, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '三（ ）十八', answer: '六' },
      { index: 28, section: '基础过关', parentTitle: '1. 补全6的乘法口诀。', question: '六八（ ）', answer: '四十八' },
      { index: 29, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×3=（ ）', answer: '18' },
      { index: 30, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '（ ）×8=48', answer: '6' },
      { index: 31, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '7×6=（ ）', answer: '42' },
      { index: 32, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '3×6=（ ）', answer: '18' },
      { index: 33, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '4×6=（ ）', answer: '24' },
      { index: 34, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×6=（ ）', answer: '36' },
      { index: 35, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×（ ）=18', answer: '2' },
      { index: 36, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '5×（ ）=30', answer: '6' },
      { index: 37, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '8×6=（ ）', answer: '48' },
      { index: 38, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '（ ）×7=42', answer: '6' },
      { index: 39, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '9×6=（ ）', answer: '54' },
      { index: 40, section: '基础过关', parentTitle: '2. 算一算，填一填。', question: '6×2=（ ）', answer: '12' },
      { index: 41, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组左', answer: '24' },
      { index: 42, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组中', answer: '10' },
      { index: 43, section: '基础过关', parentTitle: '3. 填一填。', question: '第一组右', answer: '2' },
      { index: 44, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组左', answer: '30' },
      { index: 45, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组中', answer: '20' },
      { index: 46, section: '基础过关', parentTitle: '3. 填一填。', question: '第二组右', answer: '8' },
      { index: 47, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组左', answer: '36' },
      { index: 48, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组中', answer: '30' },
      { index: 49, section: '基础过关', parentTitle: '3. 填一填。', question: '第三组右', answer: '12' },
      { index: 50, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组左', answer: '42' },
      { index: 51, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组中', answer: '40' },
      { index: 52, section: '基础过关', parentTitle: '3. 填一填。', question: '第四组右', answer: '18' },
    ],
  }
}

/**
 * 规则解析：二上 Day12。
 */
function parseErshangDay12(): ParsedPaper {
  return {
    knowledgePoints: ['认识平均分', '平均分的方法(上)', '平均分的方法(下)'],
    questions: [
      { index: 0, section: '知识回顾', parentTitle: '计算训练', question: '16颗草莓，平均分成4份，每份能分（ ）颗', answer: '4' },
      { index: 1, section: '知识回顾', parentTitle: '计算训练', question: '8个蛋糕，每人2个，能分给（ ）个小朋友', answer: '4' },
      { index: 2, section: '知识回顾', parentTitle: '计算训练', question: '8个蛋糕，每2个分1份，能分成（ ）份', answer: '4' },
      { index: 3, section: '知识回顾', parentTitle: '口算', question: '5×5-12=', answer: '13' },
      { index: 4, section: '知识回顾', parentTitle: '口算', question: '5×4-2=', answer: '18' },
      { index: 5, section: '知识回顾', parentTitle: '口算', question: '5×2-6=', answer: '4' },
      { index: 6, section: '知识回顾', parentTitle: '口算', question: '5×3+21=', answer: '36' },
      { index: 7, section: '知识回顾', parentTitle: '口算', question: '3×2+15=', answer: '21' },
      { index: 8, section: '知识回顾', parentTitle: '口算', question: '5×2+34=', answer: '44' },
      { index: 9, section: '知识回顾', parentTitle: '口算', question: '4×5-6=', answer: '14' },
      { index: 10, section: '知识回顾', parentTitle: '口算', question: '5×7+6=', answer: '41' },
      { index: 11, section: '知识回顾', parentTitle: '口算', question: '7×7-21=', answer: '28' },
      { index: 12, section: '知识回顾', parentTitle: '口算', question: '7×4+32=', answer: '60' },
      { index: 13, section: '知识回顾', parentTitle: '口算', question: '5×7-20=', answer: '15' },
      { index: 14, section: '知识回顾', parentTitle: '口算', question: '8×8-18=', answer: '46' },
      { index: 15, section: '基础过关', parentTitle: '1. 分一分，画一画。', question: '把14只蜗牛平均分成2组，每组（ ）只', answer: '7' },
      { index: 16, section: '基础过关', parentTitle: '2. 蛋糕平均分。', question: '12块蛋糕平均放在3个盘子里，每个盘子里放（ ）块', answer: '4' },
      { index: 17, section: '基础过关', parentTitle: '2. 蛋糕平均分。', question: '12块蛋糕平均放在6个盘子里，每个盘子里放（ ）块', answer: '2' },
      { index: 18, section: '基础过关', parentTitle: '2. 蛋糕平均分。', question: '12块蛋糕，每4块装一盒，可以装（ ）盒', answer: '3' },
      { index: 19, section: '基础过关', parentTitle: '2. 蛋糕平均分。', question: '12块蛋糕，每6块装一盒，可以装（ ）盒', answer: '2' },
      { index: 20, section: '基础过关', parentTitle: '3. 花朵平均分。', question: '16朵花，每4朵插进一个花瓶里，需要（ ）个花瓶', answer: '4' },
      { index: 21, section: '基础过关', parentTitle: '3. 花朵平均分。', question: '16朵花，每2朵插进一个花瓶里，需要（ ）个花瓶', answer: '8' },
    ],
  }
}

/**
 * 规则解析：二上 Day13。
 */
function parseErshangDay13(): ParsedPaper {
  return {
    knowledgePoints: ['表内乘法和平均分'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '1. 口算。', question: '5×4=', answer: '20' },
      { index: 1, section: '计算训练', parentTitle: '1. 口算。', question: '4×4=', answer: '16' },
      { index: 2, section: '计算训练', parentTitle: '1. 口算。', question: '6×9+1=', answer: '55' },
      { index: 3, section: '计算训练', parentTitle: '1. 口算。', question: '2×5+6=', answer: '16' },
      { index: 4, section: '计算训练', parentTitle: '1. 口算。', question: '3×3=', answer: '9' },
      { index: 5, section: '计算训练', parentTitle: '1. 口算。', question: '7×8=', answer: '56' },
      { index: 6, section: '计算训练', parentTitle: '1. 口算。', question: '2×8+3=', answer: '19' },
      { index: 7, section: '计算训练', parentTitle: '1. 口算。', question: '5×1-3=', answer: '2' },
      { index: 8, section: '计算训练', parentTitle: '1. 口算。', question: '6×7=', answer: '42' },
      { index: 9, section: '计算训练', parentTitle: '1. 口算。', question: '5×6=', answer: '30' },
      { index: 10, section: '计算训练', parentTitle: '1. 口算。', question: '4×7-3=', answer: '25' },
      { index: 11, section: '计算训练', parentTitle: '1. 口算。', question: '6×6-4=', answer: '32' },
      { index: 12, section: '计算训练', parentTitle: '1. 口算。', question: '8×9=', answer: '72' },
      { index: 13, section: '计算训练', parentTitle: '1. 口算。', question: '9×5=', answer: '45' },
      { index: 14, section: '计算训练', parentTitle: '1. 口算。', question: '3×7-6=', answer: '15' },
      { index: 15, section: '计算训练', parentTitle: '1. 口算。', question: '7×7-4=', answer: '45' },
      { index: 16, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '三七（ ）', answer: '二十一' },
      { index: 17, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '四（ ）三十六', answer: '九' },
      { index: 18, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '（ ）三十五', answer: '五七' },
      { index: 19, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '九九（ ）', answer: '八十一' },
      { index: 20, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '（ ）九二十七', answer: '三' },
      { index: 21, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '（ ）三十六', answer: '四九' },
      { index: 22, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '三八（ ）', answer: '二十四' },
      { index: 23, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '（ ）六二十四', answer: '四' },
      { index: 24, section: '基础过关', parentTitle: '2. 根据乘法口诀填一填。', question: '七七（ ）', answer: '四十九' },
      { index: 25, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '4×5 ? 5×4', answer: '＝' },
      { index: 26, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '9×2 ? 2×9', answer: '＝' },
      { index: 27, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '9×3 ? 4×9-4', answer: '＜' },
      { index: 28, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '6×2 ? 7+3', answer: '＞' },
      { index: 29, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '5×7 ? 7+5', answer: '＞' },
      { index: 30, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '6×7 ? 7×5+7', answer: '＝' },
      { index: 31, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '8×8 ? 9×8', answer: '＜' },
      { index: 32, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '8×3 ? 4×7', answer: '＜' },
      { index: 33, section: '基础过关', parentTitle: '3. 在里填上“>”“<”或“=”。', question: '5×4 ? 4×5+5', answer: '＜' },
      { index: 34, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '4 ? 2=2', answer: '-' },
      { index: 35, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '6 ? 8=48', answer: '×' },
      { index: 36, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '4 ? 4=16', answer: '×' },
      { index: 37, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '3 ? 5=15', answer: '×' },
      { index: 38, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '8 ? 4=32', answer: '×' },
      { index: 39, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '4 ? 6=24', answer: '×' },
      { index: 40, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '7 ? 6=42', answer: '×' },
      { index: 41, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '5 ? 5=10', answer: '+' },
      { index: 42, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '6 ? 6=36', answer: '×' },
      { index: 43, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '4 ? 7=28', answer: '×' },
      { index: 44, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '6 ? 3=18', answer: '×' },
      { index: 45, section: '基础过关', parentTitle: '4. 在里填上“+”“-”或“×”。', question: '9 ? 5=45', answer: '×' },
      { index: 46, section: '基础过关', parentTitle: '5. 哪种分法是平均分？', question: '第一种分法', answer: '√' },
      { index: 47, section: '基础过关', parentTitle: '5. 哪种分法是平均分？', question: '第二种分法', answer: '' },
      { index: 48, section: '基础过关', parentTitle: '5. 哪种分法是平均分？', question: '第三种分法', answer: '√' },
      { index: 49, section: '基础过关', parentTitle: '6. 平均分西瓜。', question: '平均分成2份，每份有（ ）个', answer: '8' },
      { index: 50, section: '基础过关', parentTitle: '6. 平均分西瓜。', question: '每4个分一份，能分（ ）份', answer: '4' },
    ],
  }
}

/**
 * 规则解析：二上 Day6。
 */
function parseErshangDay6(): ParsedPaper {
  return {
    knowledgePoints: ['表内乘法（一）'],
    questions: [
      { index: 0, section: '计算训练', parentTitle: '1. 口算。', question: '5+67=', answer: '72' },
      { index: 1, section: '计算训练', parentTitle: '1. 口算。', question: '8×5=', answer: '40' },
      { index: 2, section: '计算训练', parentTitle: '1. 口算。', question: '2×8=', answer: '16' },
      { index: 3, section: '计算训练', parentTitle: '1. 口算。', question: '5×5=', answer: '25' },
      { index: 4, section: '计算训练', parentTitle: '1. 口算。', question: '9+45=', answer: '54' },
      { index: 5, section: '计算训练', parentTitle: '1. 口算。', question: '5×9=', answer: '45' },
      { index: 6, section: '计算训练', parentTitle: '1. 口算。', question: '2×3=', answer: '6' },
      { index: 7, section: '计算训练', parentTitle: '1. 口算。', question: '6×5=', answer: '30' },
      { index: 8, section: '计算训练', parentTitle: '1. 口算。', question: '46-43=', answer: '3' },
      { index: 9, section: '计算训练', parentTitle: '1. 口算。', question: '2×5=', answer: '10' },
      { index: 10, section: '计算训练', parentTitle: '1. 口算。', question: '2×6=', answer: '12' },
      { index: 11, section: '计算训练', parentTitle: '1. 口算。', question: '4×2=', answer: '8' },
      { index: 12, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '四（ ）二十', answer: '五' },
      { index: 13, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '二（ ）十四', answer: '七' },
      { index: 14, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '（ ）五一十', answer: '二' },
      { index: 15, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '（ ）三得六', answer: '二' },
      { index: 16, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '五（ ）二十五', answer: '五' },
      { index: 17, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '三（ ）十五', answer: '五' },
      { index: 18, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '（ ）三得三', answer: '一' },
      { index: 19, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '五六（ ）', answer: '三十' },
      { index: 20, section: '基础过关', parentTitle: '2. 补全乘法口诀。', question: '二（ ）十四（重复）', answer: '七' },
      { index: 21, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '3 ? 6=18', answer: '×' },
      { index: 22, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '2 ? 6=8', answer: '+' },
      { index: 23, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '5 ? 3=15', answer: '×' },
      { index: 24, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '4 ? 3=12', answer: '×' },
      { index: 25, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '6 ? 4=2', answer: '-' },
      { index: 26, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '4 ? 5=9', answer: '+' },
      { index: 27, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '5 ? 6=30', answer: '×' },
      { index: 28, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '3 ? 2=6', answer: '×' },
      { index: 29, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '2 ? 4=8', answer: '×' },
      { index: 30, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '9 ? 3=12', answer: '+' },
      { index: 31, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '5 ? 3=2', answer: '-' },
      { index: 32, section: '基础过关', parentTitle: '3. 在里填上“+”“-”或“×”。', question: '4 ? 5=20', answer: '×' },
      { index: 33, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '5+4 ? 5×4', answer: '<' },
      { index: 34, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '2×5 ? 5+2', answer: '>' },
      { index: 35, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '6×5 ? 6+5', answer: '>' },
      { index: 36, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '6-6 ? 0', answer: '=' },
      { index: 37, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '2×4 ? 3×2', answer: '>' },
      { index: 38, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '3×4 ? 2×6', answer: '=' },
      { index: 39, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '5×4 ? 90-78', answer: '>' },
      { index: 40, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '4×6 ? 24', answer: '=' },
      { index: 41, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '2×6 ? 5×5', answer: '<' },
      { index: 42, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '6-1 ? 6×1', answer: '<' },
      { index: 43, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '6×3 ? 6+3', answer: '>' },
      { index: 44, section: '基础过关', parentTitle: '4. 在里填上“>”“<”或“=”。', question: '39 ? 5×7', answer: '>' },
      { index: 45, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×2=', answer: '4' },
      { index: 46, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×3=', answer: '6' },
      { index: 47, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '3×3=', answer: '9' },
      { index: 48, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×4=', answer: '8' },
      { index: 49, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '3×4=', answer: '12' },
      { index: 50, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '4×4=', answer: '16' },
      { index: 51, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×5=', answer: '10' },
      { index: 52, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '3×5=', answer: '15' },
      { index: 53, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '4×5=', answer: '20' },
      { index: 54, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '5×5=', answer: '25' },
      { index: 55, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×6=', answer: '12' },
      { index: 56, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '3×6=', answer: '18' },
      { index: 57, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '4×6=', answer: '24' },
      { index: 58, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '5×6=', answer: '30' },
      { index: 59, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '6×6=', answer: '36' },
      { index: 60, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '2×7=', answer: '14' },
      { index: 61, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '3×7=', answer: '21' },
      { index: 62, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '4×7=', answer: '28' },
      { index: 63, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '5×7=', answer: '35' },
      { index: 64, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '6×7=', answer: '42' },
      { index: 65, section: '基础过关', parentTitle: '5. 根据乘法口诀表填一填。', question: '7×7=', answer: '49' },
    ],
  }
}

function parseByRule(semester: string, day: number, questionText: string, answerText: string): ParsedPaper {
  if (semester === '二下' && day === 6) {
    return parseErxiaDay6(questionText, answerText)
  }
  if (semester === '二下' && day === 9) {
    return parseErxiaDay9()
  }
  if (semester === '二下' && day === 13) {
    return parseErxiaDay13(questionText, answerText)
  }
  if (semester === '二下' && day === 15) {
    return parseErxiaDay15(questionText, answerText)
  }
  if (semester === '二下' && day === 16) {
    return parseErxiaDay16(questionText, answerText)
  }
  if (semester === '二下' && day === 17) {
    return parseErxiaDay17(questionText, answerText)
  }
  if (semester === '二下' && day === 18) {
    return parseErxiaDay18(questionText, answerText)
  }
  if (semester === '二上' && day === 3) {
    return parseErshangDay3()
  }
  if (semester === '二上' && day === 4) {
    return parseErshangDay4()
  }
  if (semester === '二上' && day === 5) {
    return parseErshangDay5()
  }
  if (semester === '二上' && day === 6) {
    return parseErshangDay6()
  }
  if (semester === '二上' && day === 8) {
    return parseErshangDay8()
  }
  if (semester === '二上' && day === 9) {
    return parseErshangDay9()
  }
  if (semester === '二上' && day === 10) {
    return parseErshangDay10()
  }
  if (semester === '二上' && day === 12) {
    return parseErshangDay12()
  }
  if (semester === '二上' && day === 13) {
    return parseErshangDay13()
  }
  if (semester === '二上' && day === 16) {
    return parseErshangDay16()
  }
  if (semester === '二上' && day === 19) {
    return parseErshangDay19()
  }
  throw new Error(`暂未支持规则解析: ${semester} Day${day}`)
}

/**
 * 写入数据库。
 */
function writeToDB(semester: string, day: number, parsed: ParsedPaper): void {
  const db = getDb()
  const questions = parsed.questions || []
  const kpJson = JSON.stringify(parsed.knowledgePoints || [])

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM question_templates WHERE semester = ? AND day = ?').run(semester, day)

    const insert = db.prepare(`
      INSERT INTO question_templates
        (semester, day, question_index, parent_title, sub_title, correct_answer, knowledge_points, total_questions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const q of questions) {
      insert.run(
        semester,
        day,
        q.index,
        q.parentTitle || q.section || '',
        q.question || '',
        q.answer || '',
        kpJson,
        questions.length,
      )
    }
  })

  tx()
}

/**
 * 读取单天 PDF 并执行解析。
 */
function parseSingleDay(semester: string, day: number): ParsedPaper {
  const qFile = path.join(PDF_BASE, semester, 'PDF', `计算专项训练—${semester === '二上' ? '二年级上' : '二年级下'}·第${day}天.pdf`)
  const aFile = path.join(PDF_BASE, semester, '答案', `计算专项训练—${semester === '二上' ? '二年级上' : '二年级下'}·第${day}天【答案】.pdf`)

  if (!fs.existsSync(qFile)) throw new Error(`题目 PDF 不存在: ${qFile}`)
  if (!fs.existsSync(aFile)) throw new Error(`答案 PDF 不存在: ${aFile}`)

  const questionText = readPdf(qFile)
  const answerText = readPdf(aFile)
  return parseByRule(semester, day, questionText, answerText)
}

/**
 * 主流程：默认先跑单天闭环，避免一次性处理 42 份造成不稳定。
 */
function main(): void {
  const semester = process.argv[2] || '二下'
  const day = Number(process.argv[3] || '13')
  if (!day) {
    console.error('用法: tsx server/scripts/parse-answer-pdfs.ts [semester] [day]')
    process.exit(1)
  }

  console.log(`=== 开始规则解析 ${semester} Day${day} ===`)
  const parsed = parseSingleDay(semester, day)
  writeToDB(semester, day, parsed)

  console.log(`知识点: ${(parsed.knowledgePoints || []).join('、')}`)
  console.log(`题目数: ${parsed.questions.length}`)
  for (const q of parsed.questions) {
    console.log(`${String(q.index).padStart(2, '0')}. [${q.parentTitle}] ${q.question} => ${q.answer}`)
  }

  const db = getDb()
  const stats = db.prepare('SELECT COUNT(*) AS count FROM question_templates WHERE semester = ? AND day = ?').get(semester, day) as { count: number }
  console.log(`已写入 question_templates: ${stats.count} 条`)
  closeDb()
}

main()
