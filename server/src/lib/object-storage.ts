import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

interface ObjectStorageConfig {
  bucket: string
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl?: string
}

let cachedClient: S3Client | null = null

function getConfig(): ObjectStorageConfig | null {
  const bucket = process.env.TOS_BUCKET
  const endpoint = process.env.TOS_ENDPOINT
  const accessKeyId = process.env.TOS_ACCESS_KEY_ID
  const secretAccessKey = process.env.TOS_SECRET_ACCESS_KEY

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null

  return {
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    region: process.env.TOS_REGION || 'cn-beijing',
    publicBaseUrl: process.env.TOS_PUBLIC_BASE_URL,
  }
}

function getClient(config: ObjectStorageConfig): S3Client {
  if (cachedClient) return cachedClient

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return cachedClient
}

export function objectStorageEnabled(): boolean {
  return getConfig() !== null
}

export function imageObjectKey(jobId: string, ext: string): string {
  return `homework-images/${jobId}.${ext}`
}

export function imagePublicUrl(jobId: string, ext: string): string | null {
  const config = getConfig()
  if (!config?.publicBaseUrl) return null
  return `${config.publicBaseUrl.replace(/\/$/, '')}/${imageObjectKey(jobId, ext)}`
}

export async function uploadImageObject(jobId: string, buffer: Buffer, ext: string): Promise<string | null> {
  const config = getConfig()
  if (!config) return null

  const key = imageObjectKey(jobId, ext)
  const contentType = ext === 'png'
    ? 'image/png'
    : ext === 'bmp'
      ? 'image/bmp'
      : 'image/jpeg'

  await getClient(config).send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))

  return imagePublicUrl(jobId, ext) || key
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0)
  if (body instanceof Uint8Array) return Buffer.from(body)
  const stream = body as AsyncIterable<Uint8Array>
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export async function downloadImageObject(jobId: string, ext: string): Promise<Buffer | null> {
  const config = getConfig()
  if (!config) return null

  try {
    const result = await getClient(config).send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: imageObjectKey(jobId, ext),
    }))
    return await streamToBuffer(result.Body)
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null
    throw err
  }
}
