import test from 'node:test'
import assert from 'node:assert/strict'
import { addProduct, createEmptyState, updateProduct, recordMovement, normalizeBarcode, findProductByBarcode, findProductByScan } from '../src/core/inventory.js'
import { STORAGE_KEY, loadState, saveState, validateState } from '../src/core/storage.js'
import { createInventoryStore } from '../src/store/inventoryStore.js'

const meta = id => ({ id, now: '2026-10-01T10:00:00.000Z' })
const initial = () => addProduct(createEmptyState(), { name: '商品', sku: 'SKU', barcode: ' 001234 ' }, meta('p1')).state
function storage(raw = null) {
  return { raw, writes: 0, auxiliary: new Map(), getItem(key) { return key === STORAGE_KEY ? this.raw : this.auxiliary.get(key) ?? null }, setItem(key, value) { if (key === STORAGE_KEY) { this.raw = value; this.writes++ } else this.auxiliary.set(key, value) } }
}

test('条码修剪且保留前导零；SKU 与条码独立且精确查找不改库存', () => {
  const state = initial()
  assert.equal(state.products[0].barcode, '001234')
  const before = structuredClone(state)
  assert.equal(findProductByBarcode(state, ' 001234 '), state.products[0])
  for (const value of ['', ' ', '1234', 'SKU', 'unknown']) assert.equal(findProductByBarcode(state, value), null)
  assert.deepEqual(state, before)
  assert.equal(addProduct(state, { name: '另一商品', sku: '001234', barcode: 'SKU' }, meta('p2')).product.barcode, 'SKU')
})

test('新增和编辑拒绝重复非空条码，自己的条码及多个空条码允许', () => {
  const state = addProduct(initial(), { name: '另一个' }, meta('p2')).state
  assert.throws(() => addProduct(state, { name: '重复', barcode: ' 001234 ' }, meta('p3')), /条码已存在/)
  assert.throws(() => updateProduct(state, 'p2', { barcode: '001234' }), /条码已存在/)
  assert.equal(updateProduct(state, 'p1', { barcode: '001234' }).product.barcode, '001234')
  assert.equal(addProduct(state, { name: '无条码' }, meta('p3')).product.barcode, '')
  assert.equal(updateProduct(state, 'p1', { barcode: ' ' }).product.barcode, '')
})

test('编辑保留未提供的条码，区分大小写；库存和历史保持', () => {
  const stocked = recordMovement(initial(), { productId: 'p1', type: 'in', quantity: 4 }, meta('m1')).state
  const result = updateProduct(stocked, 'p1', { name: '新名称' }).state
  assert.equal(result.products[0].barcode, '001234')
  assert.equal(result.products[0].stock, 4)
  assert.deepEqual(result.movements, stocked.movements)
  const changed = updateProduct(result, 'p1', { barcode: 'Code-128' }).state
  const second = addProduct(changed, { name: '区分大小写', barcode: 'code-128' }, meta('p2')).state
  assert.equal(findProductByBarcode(second, 'Code-128').id, 'p1')
  assert.equal(findProductByBarcode(second, 'code-128').id, 'p2')
})

for (const value of [123, null, false, [], '中文', '１２３', 'a\nb', '\t123', '123\r', '\x00123', 'x'.repeat(81)]) {
  test(`条码拒绝非法类型或内容 ${JSON.stringify(value)}`, () => {
    assert.throws(() => normalizeBarcode(value), /条码/)
    assert.throws(() => addProduct(createEmptyState(), { name: '商品', barcode: value }), /条码/)
    assert.throws(() => updateProduct(initial(), 'p1', { barcode: value }), /条码/)
    assert.throws(() => findProductByBarcode(initial(), value), /条码/)
  })
}

test('允许 80 字符边界及 Code 128 可打印 ASCII 内容', () => {
  assert.equal(normalizeBarcode('x'.repeat(80)), 'x'.repeat(80))
  assert.equal(normalizeBarcode('  ABC-12 /#.$  '), 'ABC-12 /#.$')
})

test('旧 v1 缺少 barcode 可载入，保留库存流水且不重写；后续保存携带新字段', () => {
  const old = recordMovement(initial(), { productId: 'p1', type: 'in', quantity: 7 }, meta('m1')).state
  delete old.products[0].barcode
  const raw = JSON.stringify({ version: 1, state: old })
  const backend = storage(raw)
  const loaded = loadState(backend)
  assert.equal(loaded.products[0].barcode, '')
  assert.equal(loaded.products[0].stock, 7)
  assert.deepEqual(loaded.movements, old.movements)
  assert.equal(backend.raw, raw)
  assert.equal(backend.writes, 0)
  const updated = updateProduct(loaded, 'p1', { barcode: '0007' }).state
  saveState(backend, updated)
  assert.deepEqual(loadState(backend), updated)
})

test('存储校验拒绝重复、非规范条码和坏类型，不覆盖原数据', () => {
  for (const value of [' 001234 ', '\n001234', null, 123, '中文', 'x'.repeat(81)]) {
    const state = initial()
    state.products[0].barcode = value
    const backend = storage('existing')
    assert.throws(() => validateState(state), /条码/)
    assert.throws(() => saveState(backend, state), /条码/)
    assert.equal(backend.raw, 'existing')
  }
  const state = addProduct(initial(), { name: '另一商品' }, meta('p2')).state
  state.products[1].barcode = '001234'
  assert.throws(() => validateState(state), /条码重复/)
})

test('条码经 store 保存重载，重复编辑失败不产生写入，旧数据可编辑', () => {
  const backend = storage()
  const store = createInventoryStore(backend)
  const one = store.addProduct({ name: '商品', barcode: '0001' })
  const two = store.addProduct({ name: '另一商品' })
  const before = backend.raw
  assert.throws(() => store.updateProduct(two.id, { barcode: '0001' }), /条码已存在/)
  assert.equal(backend.raw, before)
  assert.equal(backend.writes, 2)
  const loaded = createInventoryStore(backend)
  assert.equal(findProductByBarcode(loaded.state, '0001').id, one.id)
  const legacy = JSON.parse(backend.raw)
  legacy.state.products.forEach(product => { delete product.barcode })
  const oldBackend = storage(JSON.stringify(legacy))
  const oldStore = createInventoryStore(oldBackend)
  assert.equal(oldStore.error.value, '')
  oldStore.updateProduct(one.id, { barcode: '0002' })
  assert.equal(createInventoryStore(oldBackend).state.products[0].barcode, '0002')
})

test('UPC-A 与前置零 EAN-13 扫描双向定位同一商品，条码库存历史保持', () => {
  for (const [stored, barcode, format] of [
    ['0012345678905', '012345678905', 'UPC_A'],
    ['012345678905', '0012345678905', 'EAN_13'],
  ]) {
    let state = addProduct(createEmptyState(), { name: '商品', barcode: stored }, meta('p1')).state
    state = recordMovement(state, { productId: 'p1', type: 'in', quantity: 5 }, meta('m1')).state
    const before = structuredClone(state)
    assert.equal(findProductByScan(state, { barcode: ` ${barcode} `, format }).id, 'p1')
    assert.deepEqual(state, before)
    assert.equal(findProductByBarcode(state, barcode), null)
  }
})

test('Code 128、未知格式、长度不符和无前置零的 EAN-13 不使用 UPC 别名', () => {
  const state = addProduct(createEmptyState(), { name: '商品', barcode: '0012345678905' }, meta('p1')).state
  for (const format of ['CODE_128', 'EAN_13', '', undefined, 'UPC_E']) {
    assert.equal(findProductByScan(state, { barcode: '012345678905', format }), null)
  }
  assert.equal(findProductByScan(state, { barcode: '0012345678905', format: 'CODE_128' }).id, 'p1')
  assert.equal(findProductByScan(state, { barcode: '1234567890123', format: 'EAN_13' }), null)
  assert.equal(findProductByScan(state, { barcode: '123', format: 'UPC_A' }), null)
  assert.equal(findProductByScan(state, { barcode: '', format: 'UPC_A' }), null)
})

test('UPC/EAN 两个别名同时绑定不同商品时拒绝歧义，不优先选择精确项', () => {
  let state = addProduct(createEmptyState(), { name: 'EAN商品', barcode: '0012345678905' }, meta('p1')).state
  state = addProduct(state, { name: 'UPC商品', barcode: '012345678905' }, meta('p2')).state
  const before = structuredClone(state)
  for (const [barcode, format] of [['0012345678905', 'EAN_13'], ['012345678905', 'UPC_A']]) {
    assert.throws(() => findProductByScan(state, { barcode, format }), /对应多个商品/)
  }
  assert.equal(findProductByScan(state, { barcode: '012345678905', format: 'CODE_128' }).id, 'p2')
  assert.deepEqual(state, before)
})
