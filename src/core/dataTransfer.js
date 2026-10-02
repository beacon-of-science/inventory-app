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
    format: 'inventory-app', version: 1, exportedAt: new Date().toISOString(), state: migrateState(state),
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
  if (data.version !== 1) throw new Error('库存文件版本不受支持')
  if (typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.exportedAt) ||
      !Number.isFinite(Date.parse(data.exportedAt)) || new Date(data.exportedAt).toISOString() !== data.exportedAt) {
    throw new Error('库存文件导出时间格式不正确')
  }
  return migrateState(data.state)
}
