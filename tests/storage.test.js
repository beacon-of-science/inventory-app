import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyState, addProduct, recordMovement, deleteProduct } from '../src/core/inventory.js'
import { STORAGE_KEY, STORAGE_VERSION, validateState, loadState, saveState } from '../src/core/storage.js'

const meta = id => ({ id, now: '2026-10-01T10:00:00.000Z' })
function fixture() {
  let state = addProduct(createEmptyState(), { name: '商品', sku: 'SKU' }, meta('p1')).state
  state = recordMovement(state, { productId: 'p1', type: 'in', quantity: 5 }, meta('m1')).state
  return recordMovement(state, { productId: 'p1', type: 'out', quantity: 2 }, meta('m2')).state
}
function memoryStorage(raw = null) {
  return { raw, writes: 0, getItem(key) { assert.equal(key, STORAGE_KEY); return this.raw }, setItem(key, value) { assert.equal(key, STORAGE_KEY); this.raw = value; this.writes++ } }
}

test('空存储返回新状态，保存版本封套并可完整重载', () => {
  const storage = memoryStorage()
  assert.deepEqual(loadState(storage), createEmptyState())
  const state = fixture()
  saveState(storage, state)
  assert.equal(JSON.parse(storage.raw).version, STORAGE_VERSION)
  assert.deepEqual(loadState(storage), state)
  assert.notEqual(loadState(storage), state)
})

test('结清后删除的历史仍能持久化和重载', () => {
  const original = fixture()
  const zero = recordMovement(original, { productId: 'p1', type: 'out', quantity: 3 }, meta('m3')).state
  const state = deleteProduct(zero, 'p1').state
  const storage = memoryStorage()
  saveState(storage, state)
  assert.deepEqual(loadState(storage), state)
  assert.equal(loadState(storage).movements.length, 3)
})

test('交错商品的流水分别计算，不依赖连续排列', () => {
  let state = addProduct(fixture(), { name: '二号' }, meta('p2')).state
  state = recordMovement(state, { productId: 'p2', type: 'in', quantity: 7 }, meta('m3')).state
  state = recordMovement(state, { productId: 'p1', type: 'in', quantity: 4 }, meta('m4')).state
  assert.equal(validateState(state), state)
})

for (const [label, raw] of [
  ['破损 JSON', '{'], ['null 封套', 'null'], ['数组封套', '[]'], ['缺少版本', '{}'],
  ['旧版本', '{"version":0,"state":{"products":[],"movements":[]}}'],
  ['未来版本', '{"version":3,"state":{"products":[],"movements":[]}}'],
  ['字符串版本', '{"version":"1","state":{"products":[],"movements":[]}}'],
  ['缺失状态', '{"version":1}'],
]) {
  test(`损坏或不支持的封套不被改写：${label}`, () => {
    const storage = memoryStorage(raw)
    assert.throws(() => loadState(storage))
    assert.equal(storage.raw, raw)
    assert.equal(storage.writes, 0)
  })
}

const mutations = [
  ['产品数组缺失', state => { delete state.products }],
  ['流水数组无效', state => { state.movements = {} }],
  ['产品 ID 重复', state => { state.products.push({ ...state.products[0] }) }],
  ['SKU 忽略大小写重复', state => { state.products.push({ ...state.products[0], id: 'p2', sku: 'sku', stock: 0 }) }],
  ['商品空名称', state => { state.products[0].name = ' ' }],
  ['商品名称超长', state => { state.products[0].name = 'x'.repeat(81) }],
  ['商品负库存', state => { state.products[0].stock = -1 }],
  ['商品小数库存', state => { state.products[0].stock = 3.5 }],
  ['商品不安全库存', state => { state.products[0].stock = Number.MAX_SAFE_INTEGER + 1 }],
  ['商品时间无效', state => { state.products[0].updatedAt = 'invalid' }],
  ['商品单位空白', state => { state.products[0].unit = ' ' }],
  ['流水 ID 重复', state => { state.movements[1].id = state.movements[0].id }],
  ['流水数量零', state => { state.movements[0].quantity = 0 }],
  ['流水数量字符串', state => { state.movements[0].quantity = '5' }],
  ['流水类型无效', state => { state.movements[0].type = 'transfer' }],
  ['流水快照空名称', state => { state.movements[0].productName = '' }],
  ['流水时间无效', state => { state.movements[0].createdAt = null }],
  ['流水备注超长', state => { state.movements[0].note = 'x'.repeat(301) }],
  ['入库算术错误', state => { state.movements[0].quantity = 4 }],
  ['出库算术错误', state => { state.movements[1].quantity = 1 }],
  ['链起点非零', state => { state.movements[0].beforeStock = 1; state.movements[0].afterStock = 6 }],
  ['链中断但单笔算术正确', state => { state.movements[1].beforeStock = 6; state.movements[1].afterStock = 4 }],
  ['商品库存和链终点不同', state => { state.products[0].stock = 2 }],
  ['没有流水却有商品库存', state => { state.movements = [] }],
  ['删除商品但未结清历史', state => { state.products = [] }],
]
for (const [label, mutate] of mutations) {
  test(`schema 拒绝并阻止保存：${label}`, () => {
    const state = fixture()
    mutate(state)
    const storage = memoryStorage('existing-data')
    assert.throws(() => validateState(state))
    assert.throws(() => saveState(storage, state))
    assert.equal(storage.writes, 0)
    assert.equal(storage.raw, 'existing-data')
  })
}

test('存储读取及写入异常转为明确错误', () => {
  assert.throws(() => loadState({ getItem() { throw new Error('SecurityError') } }), /无法读取本地库存数据/)
  assert.throws(() => saveState({ setItem() { throw new Error('QuotaExceededError') } }, fixture()), /保存库存数据失败/)
})
