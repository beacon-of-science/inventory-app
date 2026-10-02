/** Inventory rules. Every transition returns a new state and leaves its input untouched. */

export function createEmptyState() {
  return { products: [], movements: [], units: [] }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function textField(value, label, maximum, { required = false, fallback } = {}) {
  const source = value === undefined ? fallback : value
  if (typeof source !== 'string') throw new Error(`${label}格式不正确`)
  const result = source.trim()
  if (required && !result) throw new Error(`请填写${label}`)
  if (result.length > maximum) throw new Error(`${label}不能超过${maximum}个字符`)
  return result
}

function productFields(input, previous) {
  if (!object(input)) throw new Error('商品信息格式不正确')
  if (Object.prototype.hasOwnProperty.call(input, 'stock')) throw new Error('库存只能通过入库或出库调整')

  const productType = input.productType === undefined ? previous?.productType ?? 'unknown' : input.productType
  const trackingMode = input.trackingMode === undefined ? previous?.trackingMode ?? 'quantity' : input.trackingMode
  if (!['unknown', 'ordinary', 'medicine'].includes(productType)) throw new Error('商品类型不正确')
  if (!['quantity', 'unique'].includes(trackingMode)) throw new Error('管理模式不正确')
  if (productType === 'medicine' && trackingMode !== 'unique') throw new Error('药品必须按单件唯一码管理')
  return {
    productType, trackingMode,
    name: textField(input.name, '商品名称', 80, {
      required: true,
      fallback: previous?.name,
    }),
    sku: textField(input.sku, 'SKU', 40, { fallback: previous?.sku ?? '' }),
    barcode: normalizeBarcode(input.barcode === undefined ? previous?.barcode ?? '' : input.barcode),
    category: textField(input.category, '分类', 40, { fallback: previous?.category ?? '' }),
    lowStockThreshold: normalizeLowStockThreshold(input.lowStockThreshold === undefined
      ? previous?.lowStockThreshold ?? null : input.lowStockThreshold),
    unit: textField(input.unit, '单位', 12, {
      required: true,
      fallback: previous?.unit ?? '件',
    }),
    note: textField(input.note, '备注', 300, { fallback: previous?.note ?? '' }),
  }
}

export function normalizeLowStockThreshold(value) {
  if (value === null || (typeof value === 'string' && !value.trim())) return null
  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value.trim())) throw new Error('低库存阈值必须是非负整数，留空可关闭')
    value = Number(value.trim())
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('低库存阈值必须是非负安全整数')
  return value
}

export function isLowStock(product) {
  return Number.isSafeInteger(product.lowStockThreshold) && product.lowStockThreshold >= 0 &&
    product.stock <= product.lowStockThreshold
}

/** Optional 1D code text. Never coerce to a number: leading zeroes are significant. */
export function normalizeBarcode(value) {
  if (typeof value !== 'string') throw new Error('商品条码格式不正确')
  // Inspect before trimming so control characters cannot hide at either end.
  if (!/^[\x20-\x7e]*$/.test(value)) throw new Error('商品条码只能包含可打印的 ASCII 字符')
  const result = value.trim()
  if (result.length > 80) throw new Error('商品条码不能超过80个字符')
  return result
}

/** Exact lookup only; scanning does not record a movement or change stock. */
export function findProductByBarcode(state, value) {
  const barcode = normalizeBarcode(value)
  if (!barcode) return null
  return state.products.find((product) => product.barcode === barcode) ?? null
}

/** UPC-A may be decoded as EAN-13 with a leading zero. Stored codes stay unchanged. */
export function findProductByScan(state, result) {
  const barcode = normalizeBarcode(result?.barcode)
  if (!barcode) return null
  const candidates = new Set([barcode])
  if (result.format === 'UPC_A' && /^[0-9]{12}$/.test(barcode)) {
    candidates.add(`0${barcode}`)
  } else if (result.format === 'EAN_13' && /^0[0-9]{12}$/.test(barcode)) {
    candidates.add(barcode.slice(1))
  }
  const matches = state.products.filter((product) => candidates.has(product.barcode))
  if (matches.length > 1) throw new Error('该条码对应多个商品，请检查 UPC-A 与 EAN-13 条码绑定后重试')
  return matches[0] ?? null
}

function uniqueBarcode(products, barcode, exceptId) {
  if (barcode && products.some((product) => product.id !== exceptId && product.barcode === barcode)) {
    throw new Error('商品条码已存在，请使用其他条码')
  }
}

function uniqueSku(products, sku, exceptId) {
  if (!sku) return
  if (products.some((product) => product.id !== exceptId && product.sku.toLowerCase() === sku.toLowerCase())) {
    throw new Error('SKU 已存在，请使用其他 SKU')
  }
}

function requireProduct(state, id) {
  const product = state.products.find((item) => item.id === id)
  if (!product) throw new Error('未找到该商品')
  return product
}

function metadata(meta) {
  const id = meta?.id ?? globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const now = meta?.now ?? new Date().toISOString()
  if (typeof id !== 'string' || !id.trim() || typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    throw new Error('记录标识或时间格式不正确')
  }
  return { id, now }
}

function quantityValue(value) {
  if (typeof value === 'string') {
    if (!/^[0-9]+$/.test(value.trim())) throw new Error('数量必须是正整数')
    value = Number(value.trim())
  }
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('数量必须是正的安全整数')
  return value
}

/** @returns {{state: object, product: object}} */
export function addProduct(state, input, meta) {
  const fields = productFields(input)
  uniqueSku(state.products, fields.sku)
  uniqueBarcode(state.products, fields.barcode)
  const { id, now } = metadata(meta)
  if (state.products.some((product) => product.id === id)) throw new Error('商品标识已存在')
  const product = { id, ...fields, stock: 0, createdAt: now, updatedAt: now }
  return { state: { ...state, units: state.units ?? [], products: [...state.products, product], movements: state.movements }, product }
}

/** @returns {{state: object, product: object}} */
export function updateProduct(state, id, input, meta) {
  const previous = requireProduct(state, id)
  const fields = productFields(input, previous)
  if (fields.trackingMode !== (previous.trackingMode ?? 'quantity') && (previous.stock !== 0 || (state.units ?? []).some(u => u.productId === id))) throw new Error('仅库存为零且从未建立单件实例时可切换模式')
  uniqueSku(state.products, fields.sku, id)
  uniqueBarcode(state.products, fields.barcode, id)
  const { now } = metadata(meta)
  const product = { ...previous, ...fields, updatedAt: now }
  return {
    state: {
      ...state, units: state.units ?? [],
      products: state.products.map((item) => item.id === id ? product : item),
      movements: state.movements,
    },
    product,
  }
}

/** A deleted product's movement snapshots remain in history. */
export function deleteProduct(state, id) {
  const product = requireProduct(state, id)
  if ((state.units ?? []).some(u => u.productId === id)) throw new Error('已有单件实例的商品不能删除')
  if (product.stock > 0) throw new Error('该商品仍有库存，不能删除')
  return {
    state: { ...state, units: state.units ?? [], products: state.products.filter((item) => item.id !== id), movements: state.movements },
    product,
  }
}

/** @returns {{state: object, movement: object}} */
export function recordMovement(state, input, meta) {
  if (!object(input)) throw new Error('出入库信息格式不正确')
  const product = requireProduct(state, input.productId)
  if (input.type !== 'in' && input.type !== 'out') throw new Error('请选择入库或出库')
  const preview = validateScanBatch(state, input)
  const quantity = preview.quantity
  if (preview.newCodes.length && input.confirmBinding !== true) throw new Error('首次绑定唯一码须人工确认商品')
  const note = textField(input.note, '备注', 300, { fallback: '' })
  const afterStock = input.type === 'in' ? product.stock + quantity : product.stock - quantity
  if (input.type === 'out' && afterStock < 0) throw new Error('库存不足，无法出库')
  if (!Number.isSafeInteger(afterStock)) throw new Error('库存数量超出安全范围')
  const { id, now } = metadata(meta)
  if (state.movements.some((movement) => movement.id === id)) throw new Error('流水标识已存在')
  const movement = {
    id, codes: preview.codes,
    ...(input.batchId === undefined ? {} : { batchId: input.batchId.trim() }),
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    unit: product.unit,
    type: input.type,
    quantity,
    beforeStock: product.stock,
    afterStock,
    note,
    createdAt: now,
  }
  const updatedProduct = { ...product, stock: afterStock, updatedAt: now }
  return {
    state: {
      ...state, units: [...(state.units ?? []).map(u => preview.codes.includes(u.code) ? {...u, status: input.type, updatedAt: now} : u), ...preview.newCodes.map(code => ({code, productId: product.id, status: 'in', createdAt: now, updatedAt: now}))],
      products: state.products.map((item) => item.id === product.id ? updatedProduct : item),
      movements: [...state.movements, movement],
    },
    movement,
  }
}

export function normalizeUnitCode(value) {
  if (typeof value !== 'string' || !/^[\x20-\x7e]*$/.test(value)) throw new Error('唯一码只能包含可打印ASCII字符')
  const code = value.trim()
  if (!code || code.length > 120) throw new Error('唯一码须为1至120个字符')
  return code
}
export function validateScanBatch(state, input) {
  if (!object(input)) throw new Error('出入库信息格式不正确')
  const product = requireProduct(state, input.productId)
  if (!['in','out'].includes(input.type)) throw new Error('请选择入库或出库')
  const quantity = quantityValue(input.quantity)
  if (input.batchId !== undefined) {
    const batchId = textField(input.batchId, '批次标识', 200, { required: true })
    if (state.movements.some(m => m.batchId === batchId)) throw new Error('该批次已提交，请勿重复提交')
  }
  if (input.codes !== undefined && !Array.isArray(input.codes)) throw new Error('唯一码列表格式不正确')
  const codes = (input.codes ?? []).map(normalizeUnitCode)
  if (new Set(codes).size !== codes.length) throw new Error('批次包含重复唯一码')
  const newCodes = [], returnCodes = [], existingCodes = []
  if ((product.trackingMode ?? 'quantity') === 'quantity') {
    if (codes.length) throw new Error('数量商品不能提交单件唯一码')
  } else {
    if (!codes.length || codes.length !== quantity) throw new Error('数量须等于非空唯一码列表长度')
    for (const code of codes) {
      const unit = (state.units ?? []).find(u => u.code === code)
      if (unit && unit.productId !== product.id) throw new Error('唯一码已绑定其他商品')
      if (input.type === 'in') {
        if (!unit) newCodes.push(code)
        else if (unit.status === 'in') throw new Error('唯一码已在库，不能重复入库')
        else returnCodes.push(code)
      } else {
        if (!unit || unit.status !== 'in') throw new Error('出库唯一码必须为该商品的在库单件')
        existingCodes.push(code)
      }
    }
  }
  const afterStock = product.stock + (input.type === 'in' ? quantity : -quantity)
  if (afterStock < 0) throw new Error('库存不足，无法出库')
  if (!Number.isSafeInteger(afterStock)) throw new Error('库存数量超出安全范围')
  return {productId: product.id, type: input.type, quantity, codes, newCodes, returnCodes, existingCodes, requiresBindingConfirmation: newCodes.length > 0}
}
