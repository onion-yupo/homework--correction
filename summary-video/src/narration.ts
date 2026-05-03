/**
 * 旁白生成模块
 *
 * 1. LLM 根据学生数据生成每个场景的老师台词
 * 2. 火山 TTS API 将台词转为语音 mp3
 * 3. ffprobe 获取每段语音时长
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { execSync } from 'node:child_process'
import type { SummaryVideoProps } from './types'

const AUDIO_DIR = path.resolve(__dirname, '../out/narration')

/** 火山 TTS 配置 */
const TTS_CONFIG = {
  appid: '7698604308',
  token: 'IZiJAy47FaZsZPmH6S126-C8aORtoiYG',
  cluster: 'volcano_tts',
  voiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
  speed: 0.95,
  volume: 1.0,
  pitch: 1.0,
  encoding: 'mp3',
}

/** 豆包 LLM 配置（复用主项目的） */
const ARK_API_KEY = process.env.ARK_API_KEY || '4c52784e-0f58-414a-8077-67885212fcfb'
const ARK_MODEL = process.env.ARK_MODEL || 'doubao-seed-2-0-lite-260215'
const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3'

/** 场景定义 */
export interface SceneScript {
  id: string
  label: string
  text: string
  audioPath?: string
  durationSec?: number
}

/**
 * Step 1: LLM 生成台词
 */
export async function generateScripts(props: SummaryVideoProps): Promise<SceneScript[]> {
  const { studentName, semester, term, submittedDays, totalDays, totalQuestions, totalCorrect, avgAccuracy, perfectDays, thumbsUp, dailyData, knowledgePoints, highlights, teacherComment } = props

  const bestKps = knowledgePoints.filter(k => k.accuracy >= 95).slice(0, 3).map(k => k.name).join('、') || '暂无'
  const weakKps = knowledgePoints.filter(k => k.accuracy < 80).slice(0, 3).map(k => k.name).join('、') || '暂无'
  const totalKps = knowledgePoints.length
  const masteredKps = knowledgePoints.filter(k => k.accuracy >= 95).length

  const dailyDetail = dailyData
    .map(d => `第${d.day}天: ${d.accuracy}%${d.isPerfect ? '(满分)' : ''}`)
    .join('；')
  const maxAcc = Math.max(...dailyData.map(d => d.accuracy))
  const minAcc = Math.min(...dailyData.map(d => d.accuracy))
  const accRange = maxAcc - minAcc

  const prompt = `你是一位小学数学辅导老师，正在为家长录制一段学生的**整期**计算练习总结视频旁白。
这是整个学期（${totalDays}天）的总结，不是某一周的总结。请始终使用"本期""整期""这一期"等措辞，禁止使用"本周""这周""这一周"。

请根据以下数据，为视频的5个场景各写一段旁白台词。

## 学生数据
- 姓名：${studentName}
- 学期：${semester}
- 期数：${term}
- 整期完成天数：${submittedDays}/${totalDays} 天
- 整期总题量：${totalQuestions} 题，正确 ${totalCorrect} 题
- 整期平均正确率：${avgAccuracy}%
- 整期满分天数：${perfectDays} 天
- 大拇指评分：${thumbsUp}/5
- 知识点总数：${totalKps} 个，完全掌握 ${masteredKps} 个
- 掌握最好的：${bestKps}
- 需要加强的：${weakKps}
- 整期亮点：${highlights}
- 老师评语：${teacherComment}

## 每日正确率明细（非常重要，CHART 场景必须基于此描述真实趋势）
${dailyDetail}
- 最高正确率：${maxAcc}%，最低正确率：${minAcc}%，波动幅度：${accRange.toFixed(1)}%

## 要求
1. 语气温和、亲切、鼓励为主，像在跟家长面对面聊天
2. 每段台词要简洁，适合朗读，不要太长（每段2-3句即可）
3. 提到具体数字时自然融入，不要像念报告
4. 不要用"各位家长好"这种群发感的开头
5. 禁止使用任何 markdown 格式
6. **CHART 场景：必须如实描述正确率趋势，参考每日明细数据。如果波动大就说波动大，不要美化。可以指出哪些天表现特别好，哪些天偏低。**

## 输出格式（严格按照以下格式，每段之间用 === 分隔）
===COVER===
（封面台词，1-2句，自然的开场白，介绍这是谁的整期计算练习总结，不要说"本周"）
===STATS===
（数据总览台词，2-3句，自然地提到完成天数、题量、正确率、满分天数）
===CHART===
（折线图台词，2-3句，必须基于每日明细如实描述正确率的变化趋势，波动大就说波动大，别说平稳）
===KNOWLEDGE===
（知识点台词，2-3句，总体掌握情况，点名表扬和需要加强的）
===COMMENT===
（寄语台词，2-3句，总结+鼓励+期望，温暖收尾）`

  console.log('  调用 LLM 生成台词...')
  const resp = await fetch(`${ARK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: ARK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  })

  const data = await resp.json() as any
  const content: string = data.choices?.[0]?.message?.content || ''

  const scenes: SceneScript[] = [
    { id: 'cover', label: '封面', text: '' },
    { id: 'stats', label: '数据总览', text: '' },
    { id: 'chart', label: '正确率趋势', text: '' },
    { id: 'knowledge', label: '知识点掌握', text: '' },
    { id: 'comment', label: '老师寄语', text: '' },
  ]

  const sectionMap: Record<string, string> = {
    COVER: 'cover',
    STATS: 'stats',
    CHART: 'chart',
    KNOWLEDGE: 'knowledge',
    COMMENT: 'comment',
  }

  const parts = content.split(/===(\w+)===/)
  for (let i = 1; i < parts.length; i += 2) {
    const key = sectionMap[parts[i]]
    const text = parts[i + 1]?.trim()
    if (key && text) {
      const scene = scenes.find(s => s.id === key)
      if (scene) scene.text = text
    }
  }

  for (const scene of scenes) {
    if (!scene.text) {
      console.warn(`  ⚠️  场景 "${scene.label}" 台词为空，使用默认`)
      scene.text = `${studentName}的${semester}计算练习总结。`
    }
  }

  return scenes
}

/**
 * Step 2: 火山 TTS 生成语音
 */
function callTTS(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reqid = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const body = JSON.stringify({
      app: {
        appid: TTS_CONFIG.appid,
        token: TTS_CONFIG.token,
        cluster: TTS_CONFIG.cluster,
      },
      user: { uid: 'summary_video' },
      audio: {
        voice_type: TTS_CONFIG.voiceType,
        encoding: TTS_CONFIG.encoding,
        speed_ratio: TTS_CONFIG.speed,
        volume_ratio: TTS_CONFIG.volume,
        pitch_ratio: TTS_CONFIG.pitch,
      },
      request: {
        reqid,
        text,
        text_type: 'plain',
        operation: 'query',
        with_frontend: 1,
        frontend_type: 'unitTson',
      },
    })

    const options = {
      hostname: 'openspeech.bytedance.com',
      port: 443,
      path: '/api/v1/tts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer;${TTS_CONFIG.token}`,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.code !== 3000) {
            reject(new Error(`TTS error ${result.code}: ${result.message}`))
            return
          }
          if (!result.data) {
            reject(new Error('TTS: no audio data'))
            return
          }
          resolve(Buffer.from(result.data, 'base64'))
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * Step 3: 为每个场景生成语音文件，返回时长
 */
export async function generateAudioFiles(scenes: SceneScript[]): Promise<SceneScript[]> {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true })
  }

  for (const scene of scenes) {
    const audioPath = path.join(AUDIO_DIR, `${scene.id}.mp3`)
    console.log(`  TTS [${scene.label}]: "${scene.text.slice(0, 30)}..."`)

    const audioBuffer = await callTTS(scene.text)
    fs.writeFileSync(audioPath, audioBuffer)

    const duration = getAudioDuration(audioPath)
    scene.audioPath = audioPath
    scene.durationSec = duration
    console.log(`    → ${duration.toFixed(1)}s (${(audioBuffer.length / 1024).toFixed(0)}KB)`)
  }

  return scenes
}

/** 用 ffprobe 获取音频时长 */
function getAudioDuration(filePath: string): number {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' },
    )
    return parseFloat(out.trim()) || 5
  } catch {
    return 5
  }
}

/**
 * Step 4: 根据旁白时长计算场景帧数（每段旁白结束后留 0.8s 余量）
 */
export function computeSceneDurations(scenes: SceneScript[], fps: number): { id: string; frames: number }[] {
  const PADDING_SEC = 1.0
  const MIN_SEC = 3
  return scenes.map((s) => {
    const sec = Math.max(MIN_SEC, (s.durationSec || 5) + PADDING_SEC)
    return { id: s.id, frames: Math.ceil(sec * fps) }
  })
}

/**
 * Step 5: ffmpeg 合并所有旁白音频为单轨（按场景时间线拼接）
 */
export function mergeNarrationTrack(
  scenes: SceneScript[],
  durations: { id: string; frames: number }[],
  fps: number,
  outputPath: string,
): void {
  const inputs: string[] = []
  const filters: string[] = []
  let offset = 0

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    if (!scene.audioPath) continue
    inputs.push(`-i "${scene.audioPath}"`)
    filters.push(`[${i}:a]adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)}[a${i}]`)
    offset += durations[i].frames / fps
  }

  const mixInputs = scenes.map((_, i) => `[a${i}]`).join('')
  filters.push(`${mixInputs}amix=inputs=${scenes.length}:duration=longest:dropout_transition=0[narration]`)

  const cmd = [
    'ffmpeg -y',
    inputs.join(' '),
    `-filter_complex "${filters.join(';')}"`,
    '-map "[narration]"',
    `-c:a libmp3lame -b:a 192k "${outputPath}"`,
  ].join(' ')

  execSync(cmd, { stdio: 'pipe', shell: '/bin/zsh' })
}
