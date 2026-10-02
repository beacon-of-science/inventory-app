/** Inventory rules. Every transition returns a new state and leaves its input untouched. */

export function createEmptyState() {
  return { products: [], movements: [] }
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

  return {
    name: textField(input.name, '商品名称', 80, {
      required: true,
      fallback: previous?.name,
    }),
    sku: textField(input.sku, 'SKU', 40, { fallback: previous?.sku ?? '' }),
    barcode: normalizeBarcode(input.barcode === undefined ? previous?.barcode ?? '' : input.barcode),
    unit: textField(input.unit, '单位', 12, {
      required: true,
      fallback: previous?.unit ?? '件',
    }),
    note: textField(input.note, '备注', 300, { fallback: previous?.note ?? '' }),
  }
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
  return { state: { products: [...state.products, product], movements: state.movements }, product }
}

/** @returns {{state: object, product: object}} */
export function updateProduct(state, id, input, meta) {
  const previous = requireProduct(state, id)
  const fields = productFields(input, previous)
  uniqueSku(state.products, fields.sku, id)
  uniqueBarcode(state.products, fields.barcode, id)
  const { now } = metadata(meta)
  const product = { ...previous, ...fields, updatedAt: now }
  return {
    state: {
      products: state.products.map((item) => item.id === id ? product : item),
      movements: state.movements,
    },
    product,
  }
}

/** A deleted product's movement snapshots remain in history. */
export function deleteProduct(state, id) {
  const product = requireProduct(state, id)
  if (product.stock > 0) throw new Error('该商品仍有库存，不能删除')
  return {
    state: { products: state.products.filter((item) => item.id !== id), movements: state.movements },
    product,
  }
}

/** @returns {{state: object, movement: object}} */
export function recordMovement(state, input, meta) {
  if (!object(input)) throw new Error('出入库信息格式不正确')
  const product = requireProduct(state, input.productId)
  if (input.type !== 'in' && input.type !== 'out') throw new Error('请选择入库或出库')
  const quantity = quantityValue(input.quantity)
  const note = textField(input.note, '备注', 300, { fallback: '' })
  const afterStock = input.type === 'in' ? product.stock + quantity : product.stock - quantity
  if (input.type === 'out' && afterStock < 0) throw new Error('库存不足，无法出库')
  if (!Number.isSafeInteger(afterStock)) throw new Error('库存数量超出安全范围')
  const { id, now } = metadata(meta)
  if (state.movements.some((movement) => movement.id === id)) throw new Error('流水标识已存在')
  const movement = {
    id,
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
      products: state.products.map((item) => item.id === product.id ? updatedProduct : item),
      movements: [...state.movements, movement],
    },
    movement,
  }
}
