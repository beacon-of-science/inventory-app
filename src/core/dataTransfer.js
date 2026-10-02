import { migrateState } from './storage.js'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

function checkSize(text) {
  if (typeof text !== 'string') throw new Error('导入文件必须是 JSON 文本')
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('库存文件不能超过 5 MiB')
  }
}

export function exportInventory(state) {
  const text = JSON.stringify({
    format: 'inventory-app', version: 3, exportedAt: new Date().toISOString(), state: migrateState(state),
  }, null, 2)
  checkSize(text)
  return text
}

export function parseInventoryImport(text) {
  checkSize(text)
  let data
  try { data = JSON.parse(text) } catch { throw new Error('库存文件不是有效的 JSON') }
  if (!data || Array.isArray(data) || typeof data !== 'object' || data.format !== 'inventory-app') {
    throw new Error('库存文件格式不受支持')
  }
  if (![1, 2, 3].includes(data.version)) throw new Error('库存文件版本不受支持')
  if (typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.exportedAt) ||
      !Number.isFinite(Date.parse(data.exportedAt)) || new Date(data.exportedAt).toISOString() !== data.exportedAt) {
    throw new Error('库存文件导出时间格式不正确')
  }
  if (data.version === 1 && ((data.state?.units?.length ?? 0) > 0 || data.state?.products?.some(p => p.trackingMode === 'unique' || p.productType === 'medicine') || data.state?.movements?.some(m => (m.codes?.length ?? 0) > 0))) throw new Error('版本1文件不能包含单件追溯数据')
  if (data.version >= 2 && (!Array.isArray(data.state?.units) || data.state.products?.some(p => p.productType === undefined || p.trackingMode === undefined) || data.state.movements?.some(m => !Array.isArray(m.codes)))) throw new Error('版本2文件缺少追溯字段')
  if (data.version < 3 && (data.state?.products?.some(p => p.specification || p.manufacturer) || data.state?.units?.some(u => u.packagingCheck !== undefined) || data.state?.movements?.some(m => (m.packagingChecks?.length ?? 0) > 0))) throw new Error('旧版本文件不能包含包装核对数据')
  if (data.version === 3 && (data.state?.products?.some(p => typeof p.specification !== 'string' || typeof p.manufacturer !== 'string') || data.state?.movements?.some(m => !Array.isArray(m.packagingChecks)))) throw new Error('版本3文件缺少包装字段')
  return migrateState(data.state)
}
