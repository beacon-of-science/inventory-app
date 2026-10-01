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
    unit: textField(input.unit, '单位', 12, {
      required: true,
      fallback: previous?.unit ?? '件',
    }),
    note: textField(input.note, '备注', 300, { fallback: previous?.note ?? '' }),
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
