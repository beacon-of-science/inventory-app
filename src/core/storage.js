import { createEmptyState, normalizeBarcode } from './inventory.js'

export const STORAGE_KEY = 'inventory-mvp'
export const STORAGE_VERSION = 1

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validText(value, maximum, required = false) {
  return typeof value === 'string' && value.length <= maximum && (!required || value.trim().length > 0)
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validCount(value, positive = false) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0)
}

/** Reject broken or unsupported local data before it can be used or overwritten. */
export function validateState(state) {
  if (!object(state) || !Array.isArray(state.products) || !Array.isArray(state.movements)) {
    throw new Error('本地库存数据结构已损坏')
  }

  const ids = new Set()
  const skus = new Set()
  const barcodes = new Set()
  for (const product of state.products) {
    if (!object(product) || !validText(product.id, 200, true) ||
        !validText(product.name, 80, true) || !validText(product.sku, 40) ||
        !validText(product.unit, 12, true) || !validText(product.note, 300) ||
        !validCount(product.stock) || !validTime(product.createdAt) ||
        !validTime(product.updatedAt)) {
      throw new Error('本地商品记录已损坏')
    }
    if (ids.has(product.id)) throw new Error('本地商品标识重复')
    ids.add(product.id)
    if (Object.prototype.hasOwnProperty.call(product, 'category') &&
        (!validText(product.category, 40) || product.category !== product.category.trim())) {
      throw new Error('本地商品分类格式不正确')
    }
    if (Object.prototype.hasOwnProperty.call(product, 'lowStockThreshold') &&
        product.lowStockThreshold !== null && !validCount(product.lowStockThreshold)) {
      throw new Error('本地商品低库存阈值格式不正确')
    }
    if (Object.prototype.hasOwnProperty.call(product, 'barcode')) {
      const barcode = normalizeBarcode(product.barcode)
      if (barcode !== product.barcode) throw new Error('本地商品条码格式不正确')
      if (barcode && barcodes.has(barcode)) throw new Error('本地商品条码重复')
      if (barcode) barcodes.add(barcode)
    }
    if (product.sku) {
      const normalized = product.sku.toLowerCase()
      if (skus.has(normalized)) throw new Error('本地商品 SKU 重复')
      skus.add(normalized)
    }
  }

  const movementIds = new Set()
  const lastStockByProduct = new Map()
  for (const movement of state.movements) {
    if (!object(movement) || !validText(movement.id, 200, true) ||
        !validText(movement.productId, 200, true) || !validText(movement.productName, 80, true) ||
        !validText(movement.productSku, 40) || !validText(movement.unit, 12, true) ||
        !validText(movement.note, 300) || !validTime(movement.createdAt) ||
        (movement.type !== 'in' && movement.type !== 'out') ||
        !validCount(movement.quantity, true) || !validCount(movement.beforeStock) ||
        !validCount(movement.afterStock) ||
        (movement.type === 'in'
          ? movement.afterStock - movement.beforeStock !== movement.quantity
          : movement.beforeStock - movement.afterStock !== movement.quantity)) {
      throw new Error('本地出入库记录已损坏')
    }
    if (movementIds.has(movement.id)) throw new Error('本地流水标识重复')
    movementIds.add(movement.id)
    const previousStock = lastStockByProduct.get(movement.productId) ?? 0
    if (movement.beforeStock !== previousStock) throw new Error('本地出入库流水与库存不一致')
    lastStockByProduct.set(movement.productId, movement.afterStock)
  }
  for (const product of state.products) {
    const finalStock = lastStockByProduct.get(product.id) ?? 0
    if (product.stock !== finalStock) throw new Error('本地商品库存与流水不一致')
    lastStockByProduct.delete(product.id)
  }
  for (const finalStock of lastStockByProduct.values()) {
    if (finalStock !== 0) throw new Error('已删除商品的出入库流水未结清')
  }
  return state
}

export function loadState(storage) {
  let raw
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    throw new Error('无法读取本地库存数据，请检查浏览器存储权限')
  }
  if (raw === null) return createEmptyState()

  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch {
    throw new Error('本地库存数据无法解析，请先备份原数据')
  }
  if (!object(envelope) || !Object.prototype.hasOwnProperty.call(envelope, 'version')) {
    throw new Error('本地库存数据格式不受支持，请先备份原数据')
  }
  if (envelope.version !== STORAGE_VERSION) {
    throw new Error('本地库存数据版本不受支持，请先备份原数据')
  }
  return migrateState(envelope.state)
}

/** Add optional fields to old v1 records, without modifying their source or stock history. */
export function migrateState(source) {
  const state = validateState(source)
  return {
    ...state,
    products: state.products.map((product) => ({
      ...product,
      barcode: product.barcode ?? '',
      category: product.category ?? '',
      lowStockThreshold: product.lowStockThreshold ?? null,
    })),
  }
}

export function saveState(storage, state) {
  validateState(state)
  const raw = JSON.stringify({ version: STORAGE_VERSION, state })
  try {
    storage.setItem(STORAGE_KEY, raw)
  } catch {
    throw new Error('保存库存数据失败，请检查浏览器存储空间或权限')
  }
}
