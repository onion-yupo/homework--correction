/**
 * 图片压缩工具
 * 腾讯云试题批改 API 要求 base64 不超过 10MB
 * 原始文件 ÷ 1.37 ≈ base64 大小，所以原始文件上限约 7.3MB
 *
 * 所有图片都会经过 canvas 重绘，确保 EXIF 旋转信息被消除，
 * 避免 API 返回的坐标与前端显示的图片方向不一致。
 *
 * 如果 OffscreenCanvas 不可用（部分移动端浏览器），降级为普通 Canvas；
 * 如果压缩整体超时（15s），直接返回原始文件，保证上传不会卡死。
 */

/** 原始文件大小上限：10MB / 1.37 ≈ 7.3MB */
const MAX_FILE_SIZE = Math.floor(10 * 1024 * 1024 / 1.37)

/** 图片长边上限（px），超过则等比缩小，大幅减少上传体积 */
const MAX_LONG_EDGE = 2000

/** 压缩超时时间 */
const COMPRESS_TIMEOUT = 15_000

/**
 * 带超时的 Promise 包装
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('compress timeout')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * 通过 canvas 重绘图片（消除 EXIF 旋转），超限时降低 JPEG 质量。
 * 如果压缩失败或超时，返回原始文件。
 */
export async function compressImage(file: File): Promise<File> {
  console.log(`[Compress] 开始，原始文件: ${file.name}, ${(file.size / 1024).toFixed(1)}KB, type=${file.type}`)
  try {
    const result = await withTimeout(doCompress(file), COMPRESS_TIMEOUT)
    console.log(`[Compress] 完成，输出: ${(result.size / 1024).toFixed(1)}KB`)
    return result
  }
  catch (err) {
    console.warn('[Compress] 压缩失败或超时，使用原始文件:', err)
    return file
  }
}

async function doCompress(file: File): Promise<File> {
  console.log('[Compress] 1/4 createImageBitmap...')
  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  console.log(`[Compress] 2/4 bitmap 创建完成: ${width}x${height}`)

  const longEdge = Math.max(width, height)
  if (longEdge > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / longEdge
    width = Math.round(width * scale)
    height = Math.round(height * scale)
    console.log(`[Compress] 2/4 缩放至: ${width}x${height}`)
  }

  let blob: Blob

  if (typeof OffscreenCanvas !== 'undefined') {
    console.log('[Compress] 3/4 使用 OffscreenCanvas')
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    console.log('[Compress] 3/4 drawImage 完成，开始 convertToBlob...')
    blob = await compressOnOffscreen(canvas, file.size)
  }
  else {
    console.log('[Compress] 3/4 使用普通 Canvas（OffscreenCanvas 不可用）')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    console.log('[Compress] 3/4 drawImage 完成，开始 toBlob...')
    blob = await compressOnCanvas(canvas, file.size)
  }

  console.log(`[Compress] 4/4 blob 生成完成: ${(blob.size / 1024).toFixed(1)}KB`)
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
}

async function compressOnOffscreen(canvas: OffscreenCanvas, originalSize: number): Promise<Blob> {
  if (originalSize <= MAX_FILE_SIZE) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
  }
  let quality = 0.9
  while (quality >= 0.4) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    if (blob.size <= MAX_FILE_SIZE) return blob
    quality -= 0.1
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.4 })
}

function compressOnCanvas(canvas: HTMLCanvasElement, originalSize: number): Promise<Blob> {
  return new Promise((resolve) => {
    const quality = originalSize > MAX_FILE_SIZE ? 0.6 : 0.95
    canvas.toBlob(
      blob => resolve(blob!),
      'image/jpeg',
      quality,
    )
  })
}
