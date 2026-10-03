import { loadState, STORAGE_VERSION, validateState } from './storage.js'

export const RECOVERY_KEY = 'inventory-app-recovery-v1'
export const PRESERVED_RAW_KEY = 'inventory-app-preserved-raw-v1'
export const MAX_RECOVERY_POINTS = 5
const reasons = new Set(['auto', 'manual', 'before-import', 'before-restore'])
let sequence = 0

export function stateFromRecoveryPoint(point) {
  if (!point || typeof point.id !== 'string' || !point.id || point.id.length > 200 ||
      typeof point.createdAt !== 'string' || !Number.isFinite(Date.parse(point.createdAt)) ||
      !reasons.has(point.reason) || typeof point.raw !== 'string') throw new Error('恢复点格式损坏')
  return loadState({ getItem: () => point.raw })
}

export function recoveryPointMetadata(point) {
  const state = stateFromRecoveryPoint(point)
  return {
    id: point.id, createdAt: point.createdAt, reason: point.reason,
    productCount: state.products.length, movementCount: state.movements.length, unitCount: state.units.length,
  }
}

export function readRecoveryPoints(storage) {
  let data
  try {
    const raw = storage.getItem(RECOVERY_KEY)
    if (raw === null) return { points: [], warning: '' }
    data = JSON.parse(raw)
  } catch { throw new Error('本机恢复点读取失败，原库存数据仍保留') }
  if (!data || data.version !== 1 || !Array.isArray(data.points)) throw new Error('本机恢复点格式不受支持，原库存数据仍保留')
  const points = [], seen = new Set()
  let skipped = false
  for (const point of data.points) {
    try {
      stateFromRecoveryPoint(point)
      if (seen.has(point.id)) throw new Error('duplicate')
      seen.add(point.id)
      points.push({ id: point.id, createdAt: point.createdAt, reason: point.reason, raw: point.raw })
    } catch { skipped = true }
  }
  return { points: points.slice(0, MAX_RECOVERY_POINTS), warning: skipped ? '部分恢复点已损坏，仅显示可用恢复点' : '' }
}

export function saveRecoveryPoint(storage, state, reason = 'manual') {
  validateState(state)
  if (!reasons.has(reason)) throw new Error('恢复点来源不正确')
  const { points, warning } = readRecoveryPoints(storage)
  if (warning) throw new Error('恢复点列表存在损坏，已保留原列表并暂停新增恢复点')
  const point = {
    id: globalThis.crypto?.randomUUID?.() ?? `recovery-${Date.now()}-${++sequence}`,
    createdAt: new Date().toISOString(), reason,
    raw: JSON.stringify({ version: STORAGE_VERSION, state }),
  }
  const next = [point, ...points].slice(0, MAX_RECOVERY_POINTS)
  try { storage.setItem(RECOVERY_KEY, JSON.stringify({ version: 1, points: next })) }
  catch { throw new Error('保存恢复点失败，请先导出文件并检查本机存储空间') }
  return { point, points: next }
}

export function preserveDamagedRaw(storage, raw, replacePreserved = false) {
  if (typeof raw !== 'string') throw new Error('无法读取原始数据，已中止恢复')
  let previous
  try { previous = storage.getItem(PRESERVED_RAW_KEY) }
  catch { throw new Error('无法读取已有原文保护副本，已中止恢复') }
  if (previous !== null && previous !== raw && replacePreserved !== true) {
    throw new Error('已有另一份异常原文，请先导出归档并明确确认替换保护副本')
  }
  try { storage.setItem(PRESERVED_RAW_KEY, raw) }
  catch { throw new Error('无法保护损坏的原始数据，已中止恢复') }
}
