import test from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryStore } from '../src/store/inventoryStore.js'
import { STORAGE_KEY } from '../src/core/storage.js'

function memoryStorage(raw = null) {
  return {
    raw, writes: 0, failWrites: false,
    getItem(key) { assert.equal(key, STORAGE_KEY); return this.raw },
    setItem(key, value) { assert.equal(key, STORAGE_KEY); if (this.failWrites) throw new Error('quota'); this.raw = value; this.writes++ },
  }
}
const snapshot = store => JSON.parse(JSON.stringify(store.state))

test('store CRUD 和出入库经持久化后重载，删除保留历史快照', () => {
  const backend = memoryStorage()
  const store = createInventoryStore(backend)
  assert.equal(store.error.value, '')
  const product = store.addProduct({ name: '旧名', sku: 'OLD' })
  store.recordMovement({ productId: product.id, type: 'in', quantity: '3' })
  store.updateProduct(product.id, { name: '新名', sku: 'NEW' })
  store.recordMovement({ productId: product.id, type: 'out', quantity: 3 })
  const reloaded = createInventoryStore(backend)
  assert.deepEqual(snapshot(reloaded), snapshot(store))
  assert.equal(reloaded.state.movements[0].productName, '旧名')
  assert.equal(reloaded.state.movements[1].productName, '新名')
  reloaded.deleteProduct(product.id)
  const deleted = createInventoryStore(backend)
  assert.equal(deleted.state.products.length, 0)
  assert.equal(deleted.state.movements.length, 2)
  assert.equal(backend.writes, 5)
})

for (const operation of ['add', 'update', 'movement', 'delete']) {
  test(`写失败回滚内存和持久数据且可以重试：${operation}`, () => {
    const backend = memoryStorage()
    const store = createInventoryStore(backend)
    const product = store.addProduct({ name: '商品' })
    const stateBefore = snapshot(store)
    const rawBefore = backend.raw
    const productsBefore = store.state.products
    const movementsBefore = store.state.movements
    const perform = {
      add: () => store.addProduct({ name: '另一个' }),
      update: () => store.updateProduct(product.id, { name: '修改' }),
      movement: () => store.recordMovement({ productId: product.id, type: 'in', quantity: 2 }),
      delete: () => store.deleteProduct(product.id),
    }[operation]
    backend.failWrites = true
    assert.throws(perform, /保存库存数据失败/)
    assert.deepEqual(snapshot(store), stateBefore)
    assert.equal(store.state.products, productsBefore)
    assert.equal(store.state.movements, movementsBefore)
    assert.equal(backend.raw, rawBefore)
    assert.equal(backend.writes, 1)
    backend.failWrites = false
    assert.doesNotThrow(perform)
    assert.equal(backend.writes, 2)
  })
}

test('业务校验失败不产生写入或内存变更', () => {
  const backend = memoryStorage()
  const store = createInventoryStore(backend)
  const product = store.addProduct({ name: '商品', sku: 'ONE' })
  const before = snapshot(store)
  assert.throws(() => store.addProduct({ name: '重复', sku: 'one' }), /SKU 已存在/)
  assert.throws(() => store.recordMovement({ productId: product.id, type: 'out', quantity: 1 }), /库存不足/)
  assert.deepEqual(snapshot(store), before)
  assert.equal(backend.writes, 1)
})

for (const [label, raw] of [
  ['损坏 JSON', '{invalid'],
  ['不支持版本', '{"version":99,"state":{"products":[],"movements":[]}}'],
  ['损坏 schema', '{"version":1,"state":{"products":null,"movements":[]}}'],
]) {
  test(`启动失败进入只读保护，四种操作都不能覆盖数据：${label}`, () => {
    const backend = memoryStorage(raw)
    const store = createInventoryStore(backend)
    assert.match(store.error.value, /启动读取失败/)
    for (const action of [
      () => store.addProduct({ name: '商品' }), () => store.updateProduct('none', { name: '商品' }),
      () => store.deleteProduct('none'), () => store.recordMovement({ productId: 'none', type: 'in', quantity: 1 }),
    ]) assert.throws(action, /只读保护状态/)
    assert.equal(backend.raw, raw)
    assert.equal(backend.writes, 0)
    assert.deepEqual(snapshot(store), { products: [], movements: [] })
  })
}

test('读取权限异常、未提供可用存储均保持保护状态', () => {
  const store = createInventoryStore({ getItem() { throw new Error('SecurityError') } })
  assert.match(store.error.value, /无法读取/)
  assert.throws(() => store.addProduct({ name: '商品' }), /只读保护/)
  assert.match(createInventoryStore(null).error.value, /无法读取/)
})

test('全局 localStorage getter 本身抛错也被捕获；显式注入绕过它', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage disabled') } })
  try {
    const store = createInventoryStore()
    assert.match(store.error.value, /启动读取失败.*storage disabled/)
    assert.throws(() => store.addProduct({ name: '商品' }), /只读保护状态/)
    assert.equal(createInventoryStore(memoryStorage()).error.value, '')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})
