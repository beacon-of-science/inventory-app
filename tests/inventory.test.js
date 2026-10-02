import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyState, addProduct, updateProduct, deleteProduct, recordMovement } from '../src/core/inventory.js'

const time = '2026-10-01T10:00:00.000Z'
const meta = (id, now = time) => ({ id, now })
const productState = () => addProduct(createEmptyState(), { name: '螺丝', sku: 'P-01' }, meta('p1')).state
const clone = value => structuredClone(value)
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const movement = (state, type, quantity, id = 'm1') => recordMovement(state, { productId: 'p1', type, quantity }, meta(id))

test('商品新增修剪文本，默认库存为零，空 SKU 可以重复', () => {
  const original = freeze(createEmptyState())
  const { state, product } = addProduct(original, { name: '  螺丝  ', sku: '  P-01 ', unit: '  个 ', note: ' 测试 ' }, meta('p1'))
  assert.deepEqual(product, { id: 'p1', productType: 'unknown', trackingMode: 'quantity', specification: '', manufacturer: '', name: '螺丝', sku: 'P-01', barcode: '', category: '', lowStockThreshold: null, unit: '个', note: '测试', stock: 0, createdAt: time, updatedAt: time })
  assert.deepEqual(original, createEmptyState())
  assert.equal(state.products.length, 1)
  const first = addProduct(state, { name: '空编码一' }, meta('p2')).state
  assert.equal(addProduct(first, { name: '空编码二' }, meta('p3')).state.products.length, 3)
})

test('商品编辑保留未提供字段和库存，创建时间不变，原状态不变', () => {
  const original = freeze(movement(productState(), 'in', 4).state)
  const before = clone(original)
  const now = '2026-10-02T10:00:00.000Z'
  const { state, product } = updateProduct(original, 'p1', { name: '新名称', sku: 'p-01' }, meta('unused', now))
  assert.equal(product.name, '新名称')
  assert.equal(product.stock, 4)
  assert.equal(product.unit, '件')
  assert.equal(product.createdAt, time)
  assert.equal(product.updatedAt, now)
  assert.deepEqual(original, before)
  assert.notEqual(state.products[0], original.products[0])
})

test('SKU 新增和编辑都忽略大小写且拒绝重复，但允许自己的 SKU', () => {
  const state = addProduct(productState(), { name: '另一商品', sku: 'P-02' }, meta('p2')).state
  assert.throws(() => addProduct(state, { name: '重复', sku: ' p-01 ' }, meta('p3')), /SKU 已存在/)
  assert.throws(() => updateProduct(state, 'p2', { sku: 'p-01' }, meta('unused')), /SKU 已存在/)
  assert.equal(updateProduct(state, 'p1', { sku: 'p-01' }, meta('unused')).product.sku, 'p-01')
  assert.throws(() => addProduct(state, { name: '重复标识' }, meta('p1')), /商品标识已存在/)
})

for (const [label, input] of [
  ['空名称', { name: '  ' }], ['非文本名称', { name: 123 }], ['名称超长', { name: '字'.repeat(81) }],
  ['非文本 SKU', { name: '商品', sku: null }], ['SKU 超长', { name: '商品', sku: 'x'.repeat(41) }],
  ['空单位', { name: '商品', unit: ' ' }], ['单位超长', { name: '商品', unit: 'x'.repeat(13) }],
  ['非文本备注', { name: '商品', note: [] }], ['备注超长', { name: '商品', note: 'x'.repeat(301) }],
  ['直接设置库存', { name: '商品', stock: 0 }], ['空对象', {}], ['null 输入', null], ['数组输入', []],
]) {
  test(`拒绝非法商品文本：${label}`, () => assert.throws(() => addProduct(createEmptyState(), input, meta('p1'))))
}

test('商品文本长度上限可以使用；编辑也拒绝非法文本和直接修改库存', () => {
  const input = { name: '字'.repeat(80), sku: 'x'.repeat(40), unit: '件'.repeat(12), note: '字'.repeat(300) }
  assert.equal(addProduct(createEmptyState(), input, meta('p1')).product.name.length, 80)
  for (const bad of [{ name: '' }, { sku: false }, { unit: null }, { note: {} }, { stock: 1 }]) {
    assert.throws(() => updateProduct(productState(), 'p1', bad, meta('unused')))
  }
})

test('入出库记录准确且不改变原状态，其他商品保持原对象', () => {
  const original = freeze(addProduct(productState(), { name: '另一个' }, meta('p2')).state)
  const before = clone(original)
  const incoming = movement(original, 'in', ' 0005 ')
  assert.equal(incoming.movement.quantity, 5)
  assert.equal(incoming.movement.beforeStock, 0)
  assert.equal(incoming.movement.afterStock, 5)
  assert.equal(incoming.state.products[1], original.products[1])
  assert.deepEqual(original, before)
  const outgoing = movement(freeze(incoming.state), 'out', 5, 'm2')
  assert.equal(outgoing.state.products[0].stock, 0)
  assert.equal(outgoing.state.movements.length, 2)
  assert.equal(incoming.state.products[0].stock, 5)
})

for (const [label, quantity] of [
  ['零', 0], ['负数', -1], ['小数', 0.5], ['NaN', NaN], ['无限大', Infinity], ['负无限大', -Infinity],
  ['不安全整数', Number.MAX_SAFE_INTEGER + 1], ['空字符串', ''], ['空白', ' '], ['字符串零', '0'],
  ['负数字符串', '-1'], ['正号字符串', '+1'], ['小数字符串', '1.0'], ['科学计数', '1e3'], ['十六进制', '0x10'],
  ['全角数字', '１'], ['混合文本', '1件'], ['null', null], ['undefined', undefined], ['布尔', true],
  ['数组', [1]], ['对象', { value: 1 }], ['BigInt', 1n],
]) {
  test(`拒绝非法正整数：${label}`, () => {
    const state = freeze(productState())
    assert.throws(() => movement(state, 'in', quantity), /数量必须/)
    assert.equal(state.products[0].stock, 0)
    assert.equal(state.movements.length, 0)
  })
}

test('最大安全整数入库可以使用；超范围累加和不足出库失败且原状态完整', () => {
  const maximum = freeze(movement(productState(), 'in', Number.MAX_SAFE_INTEGER).state)
  const before = clone(maximum)
  assert.throws(() => movement(maximum, 'in', 1, 'm2'), /超出安全范围/)
  assert.deepEqual(maximum, before)
  assert.throws(() => movement(productState(), 'out', 1), /库存不足/)
  assert.equal(movement(maximum, 'out', String(Number.MAX_SAFE_INTEGER), 'm2').state.products[0].stock, 0)
})

test('流水类型、商品、备注、重复 ID 和元数据错误被拒绝', () => {
  const state = movement(productState(), 'in', 2).state
  assert.throws(() => movement(state, 'invalid', 1), /请选择/)
  assert.throws(() => recordMovement(state, { productId: 'missing', type: 'in', quantity: 1 }), /未找到/)
  assert.throws(() => recordMovement(state, null), /格式/)
  assert.throws(() => recordMovement(state, { productId: 'p1', type: 'in', quantity: 1, note: 'x'.repeat(301) }), /备注/)
  assert.throws(() => movement(state, 'in', 1), /流水标识已存在/)
  for (const badMeta of [meta(''), meta(1), meta('new', 'not-a-date')]) {
    assert.throws(() => addProduct(createEmptyState(), { name: '商品' }, badMeta), /标识或时间/)
  }
})

test('编辑和删除不改写历史快照；有库存禁止删除，结清后删除保留历史', () => {
  let state = movement(productState(), 'in', 3).state
  const snapshot = clone(state.movements[0])
  assert.throws(() => deleteProduct(state, 'p1'), /仍有库存/)
  state = updateProduct(state, 'p1', { name: '改名', sku: 'NEW', unit: '箱' }, meta('unused')).state
  assert.deepEqual(state.movements[0], snapshot)
  state = movement(state, 'out', 3, 'm2').state
  assert.equal(state.movements[1].productName, '改名')
  const before = clone(state)
  const deleted = deleteProduct(freeze(state), 'p1')
  assert.equal(deleted.state.products.length, 0)
  assert.deepEqual(deleted.state.movements, before.movements)
  assert.deepEqual(state, before)
  assert.throws(() => deleteProduct(deleted.state, 'p1'), /未找到/)
  assert.throws(() => updateProduct(deleted.state, 'p1', { name: '不存在' }), /未找到/)
})
