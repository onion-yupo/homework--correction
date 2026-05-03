import process from 'node:process'
import { Hono } from 'hono'
import { normalizeSemester } from '../lib/storage.js'

const app = new Hono()

const PROMPT = `提取图片中的作业所属的学期、作业是第几天的。
只输出以下格式，不要输出其他内容：
作业-学期：二下
作业-第几天：8

学期用简写，如"二下"表示二年级下学期，"三上"表示三年级上学期。

特殊要求：
对于输出的作业-第几天，需要特别注意：
1. 如果识别到"第一周易错点加练"，则输出：作业-第几天：22
2. 如果识别到"第二周易错点加练"，则输出：作业-第几天：23
3. 如果识别到"第三周易错点加练"，则输出：作业-第几天：24`

/**
 * 调用豆包视觉模型识别作业学期和天数。
 */
async function analyzeImageBase64(imageBase64: string) {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    throw new Error('缺少 ARK_API_KEY 配置')
  }

  const res = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'doubao-seed-2-0-mini-260215',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${imageBase64}`,
            },
            {
              type: 'input_text',
              text: PROMPT,
            },
          ],
        },
      ],
      reasoning: { effort: 'minimal' },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[Vision] API 调用失败: ${res.status}`, errText)
    throw new Error(`视觉识别失败: ${res.status}`)
  }

  const data = await res.json() as any
  const outputText = data.output?.find((item: any) => item.type === 'message')?.content
    ?.find((block: any) => block.type === 'output_text')?.text
    ?? ''

  console.log(`[Vision] 模型输出: ${outputText}`)

  const semesterMatch = outputText.match(/作业-学期[：:]\s*(.+)/)
  const dayMatch = outputText.match(/作业-第几天[：:]\s*(\d+)/)

  const rawSemester = semesterMatch?.[1]?.trim() ?? ''

  return {
    semester: rawSemester ? normalizeSemester(rawSemester) : '',
    day: dayMatch?.[1]?.trim() ?? '',
    raw: outputText,
  }
}

/**
 * POST /api/vision/analyze
 * 兼容旧版：接收 base64 图片。
 */
app.post('/analyze', async (c) => {
  try {
    const { imageBase64 } = await c.req.json<{ imageBase64: string }>()

    if (!imageBase64) {
      return c.json({ error: '缺少 imageBase64 参数' }, 400)
    }

    return c.json(await analyzeImageBase64(imageBase64))
  }
  catch (err: any) {
    console.error('[Vision] base64 请求异常:', err)
    return c.json({ error: err.message || '视觉识别请求失败' }, 500)
  }
})

/**
 * POST /api/vision/analyze-file
 * 新版：接收上传文件，由服务端转 base64 后再调用视觉模型。
 */
app.post('/analyze-file', async (c) => {
  try {
    const body = await c.req.parseBody()
    const file = body.image

    if (!(file instanceof File)) {
      return c.json({ error: '缺少 image 文件' }, 400)
    }

    const arrayBuffer = await file.arrayBuffer()
    const imageBase64 = Buffer.from(arrayBuffer).toString('base64')

    console.log(`[Vision] 收到文件识别请求: ${file.name}, ${file.size} bytes`)

    return c.json(await analyzeImageBase64(imageBase64))
  }
  catch (err: any) {
    console.error('[Vision] 文件请求异常:', err)
    return c.json({ error: err.message || '视觉识别请求失败' }, 500)
  }
})

export default app
