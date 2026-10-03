import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyState, addProduct, updateProduct, recordMovement, isLowStock } from '../src/core/inventory.js'
import { loadState, STORAGE_KEY } from '../src/core/storage.js'
import { exportInventory, parseInventoryImport, MAX_IMPORT_BYTES } from '../src/core/dataTransfer.js'
import { createInventoryStore } from '../src/store/inventoryStore.js'

const meta = id => ({ id, now: '2026-10-02T10:00:00.000Z' })
function fixture() {
  let state = addProduct(createEmptyState(), { name: '商品', category: ' 文具 ', lowStockThreshold: '3', barcode: '0001' }, meta('p1')).state
  return recordMovement(state, { productId: 'p1', type: 'in', quantity: 3 }, meta('m1')).state
}
function backend(raw = null) {
  return { raw, writes: 0, fail: false, auxiliary: new Map(), getItem(key) { return key === STORAGE_KEY ? this.raw : this.auxiliary.get(key) ?? null }, setItem(key, value) { if (this.fail) throw Error('quota'); if (key === STORAGE_KEY) { this.raw = value; this.writes++ } else this.auxiliary.set(key, value) } }
}
const envelope = state => ({ format: 'inventory-app', version: 1, exportedAt: '2026-10-02T10:00:00.000Z', state })

test('分类及阈值新增规范、编辑保留、阈值零和关闭边界', () => {
  const state = fixture()
  assert.equal(state.products[0].category, '文具')
  assert.equal(state.products[0].lowStockThreshold, 3)
  assert.equal(isLowStock(state.products[0]), true)
  assert.equal(isLowStock({ stock: 4, lowStockThreshold: 3 }), false)
  assert.equal(isLowStock({ stock: 0, lowStockThreshold: 0 }), true)
  assert.equal(isLowStock({ stock: 0, lowStockThreshold: null }), false)
  assert.equal(isLowStock({ stock: 0 }), false)
  const updated = updateProduct(state, 'p1', { name: '改名' }).product
  assert.equal(updated.category, '文具')
  assert.equal(updated.lowStockThreshold, 3)
  assert.equal(updated.stock, 3)
  for (const value of ['', '  ', null]) assert.equal(updateProduct(state, 'p1', { lowStockThreshold: value }).product.lowStockThreshold, null)
  assert.equal(updateProduct(state, 'p1', { lowStockThreshold: '0000' }).product.lowStockThreshold, 0)
  assert.equal(updateProduct(state, 'p1', { lowStockThreshold: Number.MAX_SAFE_INTEGER }).product.lowStockThreshold, Number.MAX_SAFE_INTEGER)
})

for (const lowStockThreshold of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '-1', '1e2', '1.0', false, [], {}]) {
  test(`阈值拒绝非法值 ${String(lowStockThreshold)}`, () => {
    assert.throws(() => addProduct(createEmptyState(), { name: '商品', lowStockThreshold }), /阈值/)
    assert.throws(() => updateProduct(fixture(), 'p1', { lowStockThreshold }), /阈值/)
  })
}

test('分类类型、长度限制新增编辑一致', () => {
  for (const category of [null, 123, [], '字'.repeat(41)]) {
    assert.throws(() => addProduct(createEmptyState(), { name: '商品', category }), /分类/)
    assert.throws(() => updateProduct(fixture(), 'p1', { category }), /分类/)
  }
  assert.equal(updateProduct(fixture(), 'p1', { category: '字'.repeat(40) }).product.category.length, 40)
})

test('旧 v1 载入补齐所有可选字段，不写存储不丢库存历史', () => {
  const old = fixture()
  for (const field of ['barcode', 'category', 'lowStockThreshold']) delete old.products[0][field]
  const storage = backend(JSON.stringify({ version: 1, state: old }))
  const state = loadState(storage)
  assert.equal(state.products[0].barcode, '')
  assert.equal(state.products[0].category, '')
  assert.equal(state.products[0].lowStockThreshold, null)
  assert.equal(state.products[0].stock, 3)
  assert.deepEqual(state.movements, old.movements)
  assert.equal(storage.writes, 0)
})

test('导出导入 roundtrip 包含分类条码阈值及流水，导入对象独立', () => {
  const original = fixture()
  const text = exportInventory(original)
  const data = JSON.parse(text)
  assert.equal(data.format, 'inventory-app')
  assert.equal(data.version, 3)
  const parsed = parseInventoryImport(text)
  assert.deepEqual(parsed, original)
  parsed.products[0].name = '修改副本'
  parsed.movements[0].note = '修改副本'
  assert.equal(original.products[0].name, '商品')
  assert.equal(original.movements[0].note, '')
  const legacy = fixture()
  delete legacy.products[0].category
  delete legacy.products[0].lowStockThreshold
  const migrated = parseInventoryImport(JSON.stringify(envelope(legacy)))
  assert.equal(migrated.products[0].category, '')
  assert.equal(migrated.products[0].lowStockThreshold, null)
})

test('非法格式、版本、时间、商品字段、流水算术不通过导入', () => {
  for (const text of ['{', 'null', '[]', '{}', '42']) assert.throws(() => parseInventoryImport(text))
  for (const change of [
    data => { data.format = 'other' }, data => { data.version = 4 }, data => { data.version = '1' },
    data => { data.exportedAt = '2026-02-30T10:00:00.000Z' }, data => { delete data.exportedAt },
    data => { data.state.products[0].stock = 10 }, data => { data.state.movements[0].quantity = 2 },
    data => { data.state.products[0].category = ' x ' }, data => { data.state.products[0].lowStockThreshold = '3' },
    data => { data.state.products[0].lowStockThreshold = -1 }, data => { data.state.products[0].barcode = 1 },
  ]) {
    const data = envelope(fixture())
    change(data)
    assert.throws(() => parseInventoryImport(JSON.stringify(data)))
  }
})

test('导入大小按 UTF-8 限制 5 MiB 而非字符数', () => {
  assert.throws(() => parseInventoryImport(' '.repeat(MAX_IMPORT_BYTES + 1)), /5 MiB/)
  assert.throws(() => parseInventoryImport('字'.repeat(Math.floor(MAX_IMPORT_BYTES / 3) + 1)), /5 MiB/)
  assert.throws(() => parseInventoryImport(null), /JSON 文本/)
})

test('store 导入原子保存、失败不改内存存储，成功替换并隔离调用方对象', () => {
  const storage = backend()
  const store = createInventoryStore(storage)
  store.addProduct({ name: '原商品' })
  const before = JSON.parse(JSON.stringify(store.state))
  const rawBefore = storage.raw
  const imported = fixture()
  storage.fail = true
  assert.throws(() => store.importState(imported), /保存恢复点失败/)
  assert.deepEqual(JSON.parse(JSON.stringify(store.state)), before)
  assert.equal(storage.raw, rawBefore)
  storage.fail = false
  const broken = fixture()
  broken.products[0].lowStockThreshold = NaN
  assert.throws(() => store.importState(broken), /阈值/)
  assert.equal(storage.raw, rawBefore)
  store.importState(imported)
  assert.deepEqual(JSON.parse(JSON.stringify(store.state)), imported)
  imported.products[0].name = '调用方修改'
  imported.movements[0].note = '调用方修改'
  assert.equal(store.state.products[0].name, '商品')
  assert.equal(store.state.movements[0].note, '')
  assert.deepEqual(JSON.parse(JSON.stringify(createInventoryStore(storage).state)), JSON.parse(JSON.stringify(store.state)))
})

test('损坏启动只读保护禁止通过导入覆盖', () => {
  const storage = backend('{broken')
  const store = createInventoryStore(storage)
  assert.throws(() => store.importState(fixture()), /只读保护/)
  assert.equal(storage.raw, '{broken')
  assert.equal(storage.writes, 0)
})
