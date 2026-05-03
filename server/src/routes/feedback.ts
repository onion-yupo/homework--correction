import process from 'node:process'
import { Hono } from 'hono'
import { streamText } from 'hono/streaming'
import { loadImageBase64Compressed } from '../lib/storage.js'

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1/text/chatcompletion_v2'
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.7'

interface CorrectionAnswer {
  handwriteInfo: string
  isCorrect: boolean
  reviewedCorrect: boolean
  rightAnswer: string
  knowledgePoints: string[]
  analysis: string
}

interface CorrectionQuestion {
  title: string
  answers: CorrectionAnswer[]
}

interface FeedbackRequest {
  jobId: string
  studentName: string
  grade: string
  totalCount: number
  correctCount: number
  wrongCount: number
  accuracy: number
  questions: CorrectionQuestion[]
  manualAnnotationCount?: number
  manualCorrectCount?: number
  manualWrongCount?: number
}

/**
 * 根据批改数据构建发给大模型的 prompt
 * 六模块结构：整体情况 → 书写评价 → 问题分析 → 改进计划 → 家长小提示 → 加练题目
 */
function buildPrompt(data: FeedbackRequest): string {
  const { studentName, grade, totalCount, correctCount, wrongCount, accuracy, questions } = data

  const questionsDetail = questions.map((q) => {
    const answersStr = q.answers.map((a) => {
      const status = a.reviewedCorrect ? '正确' : '错误'
      let line = `  - 学生答案: ${a.handwriteInfo || '未识别'} (${status})`
      if (!a.reviewedCorrect && a.rightAnswer)
        line += `，正确答案: ${a.rightAnswer}`
      if (a.knowledgePoints.length)
        line += `，知识点: ${a.knowledgePoints.join('、')}`
      if (a.analysis)
        line += `，分析: ${a.analysis}`
      return line
    }).join('\n')
    return `- ${q.title}\n${answersStr}`
  }).join('\n')

  const manualNote = data.manualAnnotationCount
    ? `\n- 其中 ${data.manualAnnotationCount} 道题为老师手动标注（正确 ${data.manualCorrectCount ?? 0} 题，错误 ${data.manualWrongCount ?? 0} 题），这些题未被机器识别到，请观察图片中对应区域进行分析`
    : ''

  return `你是一位专业、温和、懂家长与孩子心理的1-6年级小学数学计算学习分析师，擅长从孩子的计算作业错误中，精准定位问题本质，给出清晰、无指责、可落地的反馈，核心目标是帮孩子明确「错在哪、为什么错、怎么改」，同时缓解家长焦虑。
我会同时提供作业图片和机器批改结果，请你综合分析后生成个性化的反馈。

## 核心设计
- 先肯定再反馈，零焦虑开场：开头先正向总结孩子的计算基础，再进入问题分析
- 精准问题拆解，分层反馈：先按「知识点」归类（必须是具体题目考察类型），再按「计算习惯与过程规范」单独归类
- 错因具象化：每类问题用「题目+具体错误环节」举例
- 可落地改进：针对每个知识点或习惯问题，给出完整的解题步骤示例
- 零指责：只描述计算行为与规范问题，不评价态度、能力

## 学生信息
- 姓名：${studentName}
- 年级：${grade}
- 本次作业：共 ${totalCount} 题，正确 ${correctCount} 题，错误 ${wrongCount} 题，正确率 ${accuracy}%${manualNote}

## 批改详情
${questionsDetail}

## 请严格按以下六个模块结构生成反馈内容，使用 Markdown 格式：

### 一、整体情况反馈
用自然段落输出（不使用 bullet 列表），内容包含：
1. 正向总结：孩子本次作业已掌握的计算能力与知识点（先肯定再说问题）
2. 数据统计：自然融入"本次作业共${totalCount}题，正确${correctCount}题，出现${wrongCount}处计算偏差"
3. 如果全对，充分肯定，指出哪些知识点掌握扎实

### 二、书写评价
**仔细观察作业图片中学生手写的部分**，从三个维度进行评价。严格按以下格式输出（不使用 bullet 列表）：

整体书写|评价词
字迹清晰度|评价词
卷面整洁度|评价词

（空一行后）自然段落描述观察到的书写情况（2-3句）。如果发现修改/涂改痕迹，指出具体位置和内容；修改后正确则肯定自查意识，修改后仍错则分析原因。没有涂改痕迹则不提。

评价词示例："工整规范""清晰可辨""整洁""有待提高"等

### 三、问题分析

${wrongCount > 0 ? `（一）知识点类错误（按题目考察类型归类）

将错题按具体题目考察类型归类。对每个知识点类型，严格按以下三层结构输出（不得使用 bullet 列表符号 - 或 •）：

第一层（加粗标题行，独占一行）：
**知识点：XXX**

第二层（属性行，每个字段独占一行，字段之间用空行分隔）：
错题数量：X道

共性错因：一句话描述

典型错题示例：题目 + 错误环节 + 正确答案（简洁一句话，不要展开分析）

第三层（步骤区，与上方空一行）：
▶ 解题步骤示例（知识点名称）：

1. 具体操作（直接写操作内容，不要写"第X步"前缀）
2. 具体操作
...

知识点名称严禁使用"计算失误""粗心""抄错数"等模糊词汇，必须是具体的数学题目考察类型。如有多个知识点类型，重复上述完整结构，每个知识点之间空一行。

===== 参考示例（严格模仿此格式，不得增加 bullet 符号）=====

**知识点：整千数减三位数（连续退位）**

错题数量：2道

共性错因：被减数中间0被借位后未按9计算

典型错题示例：$1000-569$，百位0被十位借位后应按9计算，孩子误按10计算，导致第一步得341（正确应为431）

▶ 解题步骤示例（整千数减三位数）：

1. 列竖式：$1000 - 569$
2. 个位：$0-9$不够，向十位借，十位是0，继续向百位借，百位是0，继续向千位借。千位1借给百位，千位变0，百位变成10；百位借1给十位，百位变9，十位变成10；十位借1给个位，十位变9，个位变成10
3. 个位：$10-9=1$
4. 十位：$9-6=3$
5. 百位：$9-5=4$
6. 结果：431。可以简记为：被减数末尾连续0，从最高位借1后，中间的0全部变成9，最后一位变成10

===== 示例结束 =====

（二）计算习惯与过程规范（非知识点问题）

将抄录遗漏、符号混淆、竖式格式错误、进位标记遗漏等非知识点类问题归入此部分。同样使用三层结构，不使用 bullet，每个字段独占一行，字段之间用空行分隔：

**问题类型：XXX**

错题数量：X道

具体表现：描述习惯问题

典型错题示例：具体题目 + 错误表现

▶ 规范操作步骤：

1. 具体操作
2. 具体操作

如有多个习惯问题，重复上述完整结构。如果所有错误都属于知识点类，可省略（二）部分。` : `本次作业全部正确！具体指出哪些知识点掌握扎实，对核心知识点做简要的掌握情况总结。`}

### 四、整体改进计划
严格按以下三段结构输出，每段以加粗标题行开头，后面跟内容（不使用 bullet 列表 - 或 •）：

**每日1个核心目标：** 本周先聚焦哪个知识点或习惯问题（输出一句话）

**3分钟自查步骤：**
1. 第一条自查方法
2. 第二条自查方法
3. 第三条自查方法

**针对性练习建议：**
1. 第一条练习建议（含题型和数量）
2. 第二条练习建议
3. 第三条练习建议
${wrongCount === 0 ? '\n如果全对，改进计划侧重巩固和拓展，而非纠错。' : ''}

### 五、给家长的小提示
输出一段自然段落文字（不使用 bullet 列表），可以直接发给家长。内容包含：
1. 温和说明问题属于正常现象，缓解家长焦虑
2. 建议聚焦1-2个核心问题逐步突破，不要一次性纠正所有错误
3. 提到"已根据不同难度出了三组练习题，您可以根据孩子情况选择合适的"
语气温和、有实质内容，不要有标题

### 六、加练题目
分三个难度层级各出 3-5 道题，按以下顺序排列：

**基础巩固加练**
- 难度略低于本次作业，帮助夯实基本功
- **格式：先集中列出所有题目（编号 1、2、3...），然后用"**答案：**"分隔，再集中列出所有对应答案（编号 1、2、3...）**

**巩固加练**
- 与本次作业同等难度，针对涉及的知识点进行巩固
- **格式同上**

**挑战加练**
- 拔高题或思维拓展题，难度略高于本次作业，符合${grade}拔高水平
- **格式同上**

根据学生本次表现，在最适合的难度层级标题后加上【推荐】标记（全对推荐挑战，少量错误推荐巩固，较多错误推荐基础）。格式示例：**巩固加练**【推荐】

## 格式要求
- 严格按上述六个 ### 标题结构输出：一、整体情况反馈 / 二、书写评价 / 三、问题分析 / 四、整体改进计划 / 五、给家长的小提示 / 六、加练题目
- **模块一至五的输出内容中，一律禁止使用 bullet 列表符号（- 或 •）**。各模块严格按各自指定的格式输出
- "三、问题分析"使用"加粗标题行 → 属性文本行 → 编号步骤"三层结构，完全模仿上方参考示例。**每个属性字段（错题数量、共性错因、典型错题示例）必须独占一行，字段之间用空行分隔，严禁合并到同一行**
- "四、整体改进计划"使用"加粗标题行 → 编号列表"结构
- 解题步骤和自查步骤的编号直接写操作内容（如"1. 列竖式：..."），禁止写"第一步""第二步"等前缀
- 加练题目模块内部用 **基础巩固加练** / **巩固加练** / **挑战加练** 作为子标题
- 加练子模块内部格式示例：
  **题目：**
  1. 第一道题目...
  2. 第二道题目...
  3. 第三道题目...

  **答案：**
  1. 第一道答案...
  2. 第二道答案...
  3. 第三道答案...
- 数学公式用 $...$ 包裹（行内公式），例如 $2800+1000=3800$
- 每个 $ 必须紧贴公式内容，不能有多余空格，正确：$3+5=8$，错误：$ 3+5=8 $
- 纯数字计算也用 $...$ 包裹，例如 $24 \\div 6 = 4$
- 禁止使用 $$...$$，禁止使用 \\boxed{}
- $ 内只写 LaTeX 数学符号和数字，禁止在 $ 内写中文，中文写在 $ 外面
- 比较大小用 $>$ 和 $<$，不要用 > 和 <（会被 HTML 转义）
- 禁止使用 ~~ 删除线语法

## 禁词规则（严格遵守，违反任何一条即为不合格输出）
以下所有词汇及同类表述严禁出现，若出现对应问题必须替换为客观、具体、正向、可改进的描述：
- 笼统归因类：不认真、态度不端正、不踏实、浮躁、粗心、马虎、大意、敷衍、不上心、不用心、不仔细、疏忽
- 否定能力类：笨、脑子不转、没天赋、基础太差、蠢、傻、反应慢、不开窍、学不会、能力差
- 主观态度类：懒、懒惰、偷懒、懈怠、磨蹭、拖拉
- 贬低错误类：低级错误、弱智错误、不该错、莫名其妙
- 负面评判类：没救了、差劲、最差、屡教不改、无可救药

## 表述规则
1. 所有分析必须只描述行为与知识点问题，不评价性格、态度、天赋与智商
2. 语言客观、具体、可落地，不模糊、不指责
3. 如果确实无法判断具体错因，用"需要进一步确认"代替笼统归因
4. 知识点必须是具体的题目考察类型，严禁使用"计算失误""粗心""抄错数"等作为知识点

## 错因分析标准示范
错因与纠正建议必须参照以下句式风格：
- 看错数字（如 36 看成 63）→ 错因："审题时对数字顺序识别存在混淆，将数字 36 误看作 63"；纠正建议："读题时采用笔尖指读的方式逐位认读，做题前圈画关键数字，完成后将题目与答案回读核对"
- 数字混淆（如 0 和 6）→ 错因："对数字 0 和 6 的字形特征区分不够清晰，认读或书写时易出现混淆"；纠正建议："书写时强化 0 和 6 的字形差异，认读时适当放慢速度，日常增加相似数字对比辨认练习"
- 所有建议需具体、可操作、正向引导，指向可改进的学习行为

## 注意事项
- 语言要亲切自然，像一位有温度的老师在说话
- 数学表达要准确，适合${grade}水平
- 三组加练题是最核心的模块，请认真出题，题目要有质量、有区分度
- 书写评价必须基于图片的真实观察，是独立的结构化模块（第二模块），不要省略

## 输出规范（最高优先级）
- **严禁输出任何思考过程、推理过程、内心独白、自我对话、纠错过程**。例如禁止出现"让我想想""嗯不对""我先看看""那我们还是按……来整理"等表述
- 直接输出最终的结构化反馈结果，不要解释你在做什么
- 严格遵循每个模块的固定字段和格式，不得自行增减字段或改变层级结构`
}

/**
 * 构建多模态消息内容（图片 + 文本）
 * 如果有图片则返回数组格式，否则返回纯文本
 */
function buildMessageContent(prompt: string, imageBase64: string | null, imageExt: string): any {
  if (!imageBase64) return prompt

  const mimeType = imageExt === 'png' ? 'image/png' : 'image/jpeg'
  return [
    { type: 'text', text: prompt },
    {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBase64}` },
    },
  ]
}

const app = new Hono()

function miniMaxApiKey(): string | null {
  return process.env.MINIMAX_API_KEY || null
}

async function requestMiniMaxStream(prompt: string, imageBase64: string | null, imageExt: string) {
  const apiKey = miniMaxApiKey()
  if (!apiKey) throw new Error('缺少 MINIMAX_API_KEY 配置')
  const supportsImageInput = MINIMAX_MODEL === 'MiniMax-Text-01'

  const body: Record<string, unknown> = {
    model: MINIMAX_MODEL,
    messages: [
      {
        role: 'user',
        name: 'User',
        content: supportsImageInput ? buildMessageContent(prompt, imageBase64, imageExt) : prompt,
      },
    ],
    stream: true,
    temperature: Number(process.env.MINIMAX_TEMPERATURE || 0.7),
  }

  const maxTokens = Number(process.env.MINIMAX_MAX_COMPLETION_TOKENS || 0)
  if (maxTokens > 0) body.max_completion_tokens = maxTokens

  return fetch(MINIMAX_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  })
}

async function readMiniMaxBusinessError(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return null

  const data = await response.clone().json().catch(() => null) as any
  const statusCode = data?.base_resp?.status_code
  if (!statusCode || statusCode === 0) return null

  return data?.base_resp?.status_msg || `MiniMax 业务错误: ${statusCode}`
}

async function pipeOpenAICompatibleStream(response: Response, stream: Parameters<Parameters<typeof streamText>[1]>[0]) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        await stream.write('[DONE]')
        return
      }

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content
        if (content) {
          await stream.write(content)
        }
      }
      catch {
        // skip malformed JSON chunks
      }
    }
  }
}

/**
 * POST /api/feedback/generate
 * 调用 MiniMax 大模型（多模态）生成反馈建议，流式返回
 */
app.post('/generate', async (c) => {
  if (!miniMaxApiKey()) {
    return c.json({ error: '缺少 MINIMAX_API_KEY 配置' }, 500)
  }

  const body = await c.req.json<FeedbackRequest>()

  if (!body.questions?.length) {
    return c.json({ error: '缺少批改数据' }, 400)
  }

  const prompt = buildPrompt(body)

  let imageBase64: string | null = null
  let imageExt = 'jpg'
  if (body.jobId) {
    const img = await loadImageBase64Compressed(body.jobId)
    if (img) {
      imageBase64 = img.base64
      imageExt = img.ext
      console.log(`[Feedback] 已加载压缩图片: ${body.jobId}, ${(imageBase64.length * 0.75 / 1024).toFixed(0)}KB`)
    }
    else {
      console.warn(`[Feedback] 未找到图片: ${body.jobId}，将使用纯文本模式`)
    }
  }

  console.log(`[Feedback] 请求生成反馈，学生: ${body.studentName}，正确率: ${body.accuracy}%，provider=MiniMax，model=${MINIMAX_MODEL}，多模态: ${!!imageBase64}`)

  const llmResponse = await requestMiniMaxStream(prompt, imageBase64, imageExt)

  if (!llmResponse.ok) {
    const errText = await llmResponse.text()
    console.error(`[Feedback] MiniMax API 错误: ${llmResponse.status}`, errText)
    return c.json({ error: `MiniMax API 调用失败: ${llmResponse.status}` }, 502)
  }
  const businessError = await readMiniMaxBusinessError(llmResponse)
  if (businessError) {
    console.error(`[Feedback] MiniMax 业务错误: ${businessError}`)
    return c.json({ error: `MiniMax API 调用失败: ${businessError}` }, 502)
  }

  console.log(`[Feedback] MiniMax API 已响应，开始流式输出`)

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return streamText(c, async (stream) => {
    await pipeOpenAICompatibleStream(llmResponse, stream)
  })
})

/**
 * POST /api/feedback/regenerate-module
 * 单模块重新生成：接收模块标题、当前内容、补充指令，只返回该模块的新内容（流式）
 */
interface RegenModuleRequest extends FeedbackRequest {
  moduleTitle: string
  currentContent: string
  instruction: string
}

app.post('/regenerate-module', async (c) => {
  if (!miniMaxApiKey()) {
    return c.json({ error: '缺少 MINIMAX_API_KEY 配置' }, 500)
  }

  const body = await c.req.json<RegenModuleRequest>()
  const { moduleTitle, currentContent, instruction } = body

  if (!moduleTitle) {
    return c.json({ error: '缺少 moduleTitle' }, 400)
  }

  const basePrompt = buildPrompt(body)

  let imageBase64: string | null = null
  let imageExt = 'jpg'
  if (body.jobId) {
    const img = await loadImageBase64Compressed(body.jobId)
    if (img) {
      imageBase64 = img.base64
      imageExt = img.ext
    }
  }

  const regenPrompt = `${basePrompt}

---

以上是完整的反馈生成要求。现在请你只重新生成其中的"${moduleTitle}"模块。

该模块当前内容如下：
${currentContent}

${instruction ? `老师的补充指令：${instruction}` : '老师希望重新生成这个模块，请给出不同的版本。'}

请只输出"${moduleTitle}"模块的内容（不要输出标题行 ### ...，只输出正文内容），严格遵守上述所有规则。`

  console.log(`[Feedback] 重新生成模块: ${moduleTitle}，补充指令: ${instruction || '(无)'}`)

  const llmResponse = await requestMiniMaxStream(regenPrompt, imageBase64, imageExt)

  if (!llmResponse.ok) {
    const errText = await llmResponse.text()
    console.error(`[Feedback] MiniMax API 错误: ${llmResponse.status}`, errText)
    return c.json({ error: `MiniMax API 调用失败: ${llmResponse.status}` }, 502)
  }
  const businessError = await readMiniMaxBusinessError(llmResponse)
  if (businessError) {
    console.error(`[Feedback] MiniMax 业务错误: ${businessError}`)
    return c.json({ error: `MiniMax API 调用失败: ${businessError}` }, 502)
  }

  console.log(`[Feedback] 模块重新生成 MiniMax API 已响应，开始流式输出`)

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return streamText(c, async (stream) => {
    await pipeOpenAICompatibleStream(llmResponse, stream)
  })
})

/**
 * POST /api/feedback/save
 * 保存反馈内容到服务端（与批改结果关联）
 */
app.post('/save', async (c) => {
  const { jobId, content } = await c.req.json<{ jobId: string, content: string }>()

  if (!jobId || !content) {
    return c.json({ error: '缺少 jobId 或 content' }, 400)
  }

  const { saveFeedback } = await import('../lib/storage.js')
  saveFeedback(jobId, content)

  // 双写 SQLite
  try {
    const { updateJobFeedback } = await import('../lib/db-sync.js')
    updateJobFeedback(jobId, content)
  } catch (e) { console.error('[Feedback] SQLite 同步失败:', e) }

  console.log(`[Feedback] 反馈已保存: ${jobId}`)

  return c.json({ ok: true })
})

/**
 * GET /api/feedback/load/:jobId
 * 加载已保存的反馈内容
 */
app.get('/load/:jobId', async (c) => {
  const jobId = c.req.param('jobId')

  const { loadFeedback } = await import('../lib/storage.js')
  const content = loadFeedback(jobId)

  if (!content) {
    return c.json({ error: '未找到反馈记录' }, 404)
  }

  return c.json({ jobId, content })
})

export default app
