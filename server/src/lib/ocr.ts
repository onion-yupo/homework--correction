import process from 'node:process'
import * as tencentcloud from 'tencentcloud-sdk-nodejs-ocr'

const OcrClient = tencentcloud.ocr.v20181119.Client

/**
 * 创建腾讯云 OCR 客户端实例
 * @see https://cloud.tencent.com/document/product/866/128273
 */
export function createOcrClient() {
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY

  if (!secretId || !secretKey) {
    throw new Error('缺少腾讯云密钥配置，请在 server/.env 中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY')
  }

  return new OcrClient({
    credential: { secretId, secretKey },
    region: '',
    profile: {
      httpProfile: {
        endpoint: 'ocr.tencentcloudapi.com',
      },
    },
  })
}
