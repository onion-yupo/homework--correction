import 'dotenv/config'
import { uploadImageObject } from '../lib/object-storage.js'

const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/aAAwDAQACEAMQAAABpA//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ar//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
  'base64',
)

async function main() {
  const key = `tos-test-${Date.now()}`
  const url = await uploadImageObject(key, ONE_PIXEL_JPEG, 'jpg')
  if (!url) {
    throw new Error('TOS 未启用：请检查 TOS_BUCKET / TOS_ENDPOINT / TOS_ACCESS_KEY_ID / TOS_SECRET_ACCESS_KEY')
  }
  console.log(`TOS 上传成功：${url}`)
}

main().catch((err) => {
  console.error(`TOS 上传失败：${err.message}`)
  process.exit(1)
})
