/**
 * 简单的内存 TTL 缓存
 *
 * 用于缓存 dashboard/init、analytics 等读多写少的接口结果，
 * 避免短时间内重复执行相同的 SQLite 查询
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<any>>()

/**
 * @param ttlMs 缓存有效期（毫秒），默认 30 秒
 */
export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.data as T
}

export function cacheSet<T>(key: string, data: T, ttlMs = 30_000): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs })
}

/**
 * 使指定前缀的缓存失效（写操作后调用）
 */
export function cacheInvalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
