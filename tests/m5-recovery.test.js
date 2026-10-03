import test from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryStore } from '../src/store/inventoryStore.js'
import { createEmptyState, addProduct } from '../src/core/inventory.js'
import { createPackagingCheck } from '../src/core/packaging.js'
import { STORAGE_KEY, loadState } from '../src/core/storage.js'
import { RECOVERY_KEY, PRESERVED_RAW_KEY, MAX_RECOVERY_POINTS, readRecoveryPoints, stateFromRecoveryPoint } from '../src/core/recovery.js'
import { SETTINGS_KEY } from '../src/core/settings.js'
import { DIAGNOSTICS_KEY, MAX_DIAGNOSTIC_EVENTS, createDiagnostics } from '../src/core/diagnostics.js'

function storage(initial = {}) {
  return {
    data: new Map(Object.entries(initial)), writes: [], failReads: new Set(), failWrites: new Set(),
    getItem(key) { if (this.failReads.has(key)) throw new Error('private inventory contents'); return this.data.get(key) ?? null },
    setItem(key, value) { if (this.failWrites.has(key)) throw new Error('private OCR text'); this.data.set(key, value); this.writes.push(key) },
  }
}
const snapshot = store => JSON.parse(JSON.stringify(store.state))
const fixture = () => addProduct(createEmptyState(), { name: '导入商品' }, { id: 'imported', now: '2026-10-03T00:00:00.000Z' }).state

test('M5 再次损坏恢复必须明确授权替换旧原文，默认保留两份原始内容', () => {
  const backend = storage(), original = createInventoryStore(backend)
  original.addProduct({ name: '恢复目标' })
  const id = original.recovery.points[0].id
  backend.setItem(STORAGE_KEY, 'first damaged raw')
  createInventoryStore(backend).restoreRecoveryPoint(id)
  backend.setItem(STORAGE_KEY, 'second damaged raw')
  const damaged = createInventoryStore(backend)
  assert.throws(() => damaged.restoreRecoveryPoint(id), /确认替换/)
  assert.equal(backend.getItem(STORAGE_KEY), 'second damaged raw')
  assert.equal(damaged.exportPreservedRawData(), 'first damaged raw')
  assert.ok(damaged.error.value)
  damaged.restoreRecoveryPoint(id, { replacePreserved: true })
  assert.equal(damaged.error.value, '')
  assert.equal(damaged.exportPreservedRawData(), 'second damaged raw')
  backend.setItem(STORAGE_KEY, 'third damaged raw')
  const damagedAgain = createInventoryStore(backend)
  assert.throws(() => damagedAgain.restoreImportedState(fixture()), /确认替换/)
  assert.equal(backend.getItem(STORAGE_KEY), 'third damaged raw')
  damagedAgain.restoreImportedState(fixture(), { replacePreserved: true })
  assert.equal(damagedAgain.exportPreservedRawData(), 'third damaged raw')
})

test('M5 自动恢复点最近五个，预览无原始内容，重载不改主数据或流水版本', () => {
  const backend = storage(), store = createInventoryStore(backend)
  for (let i = 0; i < 8; i++) store.addProduct({ name: `商品${i}` })
  assert.equal(store.recovery.points.length, MAX_RECOVERY_POINTS)
  assert.deepEqual(store.recovery.points.map(point => point.productCount), [8, 7, 6, 5, 4])
  const before = backend.getItem(STORAGE_KEY), writes = backend.writes.filter(key => key === STORAGE_KEY).length
  const loaded = createInventoryStore(backend)
  assert.deepEqual(snapshot(loaded), snapshot(store))
  assert.equal(backend.getItem(STORAGE_KEY), before)
  assert.equal(backend.writes.filter(key => key === STORAGE_KEY).length, writes)
  assert.equal(JSON.parse(before).version, 3)
  const preview = loaded.previewRecoveryPoint(loaded.recovery.points[0].id)
  assert.deepEqual(Object.keys(preview).sort(), ['createdAt', 'id', 'movementCount', 'productCount', 'reason', 'unitCount'])
  preview.productCount = 0
  assert.equal(loaded.previewRecoveryPoint(preview.id).productCount, 8)
})

test('M5 主写失败不改内存、原文或恢复点，可重试', () => {
  const backend = storage(), store = createInventoryStore(backend)
  const product = store.addProduct({ name: '原商品' })
  const before = snapshot(store), raw = backend.getItem(STORAGE_KEY), points = backend.getItem(RECOVERY_KEY)
  backend.failWrites.add(STORAGE_KEY)
  assert.throws(() => store.recordMovement({ productId: product.id, type: 'in', quantity: 2 }), /保存库存/)
  assert.deepEqual(snapshot(store), before)
  assert.equal(backend.getItem(STORAGE_KEY), raw)
  assert.equal(backend.getItem(RECOVERY_KEY), points)
  backend.failWrites.clear()
  store.recordMovement({ productId: product.id, type: 'in', quantity: 2 })
  assert.equal(store.state.products[0].stock, 2)
})

test('M5 主写成功而自动恢复点失败，仅警告，后续成功清除警告', () => {
  const backend = storage(), store = createInventoryStore(backend)
  backend.failWrites.add(RECOVERY_KEY)
  assert.doesNotThrow(() => store.addProduct({ name: '已保存' }))
  assert.equal(loadState(backend).products[0].name, '已保存')
  assert.match(store.recovery.warning, /恢复点/)
  assert.equal(store.recovery.lastRecoveryAt, '')
  assert.equal(store.recovery.points.length, 0)
  backend.failWrites.clear()
  store.createRecoveryPoint()
  assert.equal(store.recovery.warning, '')
  assert.ok(store.recovery.lastRecoveryAt)
})

test('M5 设置与手动备份时间持久化，自动关闭仍允许手动恢复点', () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.updateSettings({ autoRecovery: false, reduceMotion: true })
  store.addProduct({ name: '无自动恢复点' })
  assert.equal(store.recovery.points.length, 0)
  store.createRecoveryPoint()
  assert.equal(store.recovery.points[0].reason, 'manual')
  assert.equal(store.markManualBackupExported(), true)
  const loaded = createInventoryStore(backend)
  assert.deepEqual({ ...loaded.settings }, { autoRecovery: false, reduceMotion: true })
  assert.equal(loaded.recovery.lastManualBackupAt, store.recovery.lastManualBackupAt)
  assert.ok(loaded.recovery.lastManualBackupAt)
})

test('M5 设置或备份时间写失败不假称成功、不改既有设置时间', () => {
  const backend = storage(), store = createInventoryStore(backend)
  backend.failWrites.add(SETTINGS_KEY)
  assert.throws(() => store.updateSettings({ autoRecovery: false }), /保存设置失败/)
  assert.equal(store.settings.autoRecovery, true)
  assert.equal(store.markManualBackupExported(), false)
  assert.equal(store.recovery.lastManualBackupAt, '')
  assert.match(store.recovery.warning, /文件已导出.*时间记录失败/)
  for (const patch of [null, [], { autoRecovery: 1 }, { token: 'secret' }]) assert.throws(() => store.updateSettings(patch), /格式/)
})

test('M5 导入前强制保护当前数据，即使自动恢复关闭', () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.updateSettings({ autoRecovery: false })
  store.addProduct({ name: '导入前' })
  const before = snapshot(store)
  store.importState(fixture())
  assert.equal(store.recovery.points[0].reason, 'before-import')
  assert.deepEqual(stateFromRecoveryPoint(readRecoveryPoints(backend).points[0]), before)
  assert.equal(store.state.products[0].name, '导入商品')
})

for (const action of ['import', 'restore']) test(`M5 ${action} 保护写失败中止，主写失败仍保留原数据`, () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.addProduct({ name: '原商品' })
  const id = store.recovery.points[0].id, before = snapshot(store), raw = backend.getItem(STORAGE_KEY)
  const perform = () => action === 'import' ? store.importState(fixture()) : store.restoreRecoveryPoint(id)
  backend.failWrites.add(RECOVERY_KEY)
  assert.throws(perform, /保存恢复点失败/)
  assert.deepEqual(snapshot(store), before)
  assert.equal(backend.getItem(STORAGE_KEY), raw)
  backend.failWrites.clear(); backend.failWrites.add(STORAGE_KEY)
  assert.throws(perform, /保存库存数据失败/)
  assert.deepEqual(snapshot(store), before)
  assert.equal(backend.getItem(STORAGE_KEY), raw)
  assert.equal(store.error.value, '')
})

test('M5 恢复目标处于末位仍能成功，恢复前版本可找回', () => {
  const backend = storage(), store = createInventoryStore(backend)
  for (let i = 0; i < 5; i++) store.addProduct({ name: `商品${i}` })
  const target = store.recovery.points.at(-1), before = snapshot(store)
  store.restoreRecoveryPoint(target.id)
  assert.equal(store.state.products.length, 1)
  const preserved = readRecoveryPoints(backend).points.find(point => point.reason === 'before-restore')
  assert.deepEqual(stateFromRecoveryPoint(preserved), before)
  assert.deepEqual(snapshot(createInventoryStore(backend)), snapshot(store))
})

test('M5 损坏启动只读，原文可导出，恢复后保留损坏原文且正常写入', () => {
  const backend = storage(), good = createInventoryStore(backend)
  good.addProduct({ name: '正确版本' })
  const id = good.recovery.points[0].id, raw = '{broken raw 含不可解析数据'
  backend.data.set(STORAGE_KEY, raw)
  const broken = createInventoryStore(backend)
  assert.match(broken.error.value, /启动读取失败/)
  assert.equal(broken.exportRawData(), raw)
  assert.throws(() => broken.importState(fixture()), /只读/)
  assert.throws(() => broken.createRecoveryPoint(), /只读/)
  broken.restoreRecoveryPoint(id)
  assert.equal(broken.error.value, '')
  assert.equal(broken.state.products[0].name, '正确版本')
  assert.equal(broken.recovery.preservedRawAvailable, true)
  assert.equal(broken.exportPreservedRawData(), raw)
  assert.equal(createInventoryStore(backend).exportPreservedRawData(), raw)
  broken.addProduct({ name: '恢复后' })
  assert.equal(broken.state.products.length, 2)
})

for (const failingKey of [PRESERVED_RAW_KEY, STORAGE_KEY]) test(`M5 损坏启动恢复时 ${failingKey} 写失败保持只读和原文`, () => {
  const backend = storage(), good = createInventoryStore(backend)
  good.addProduct({ name: '正确版本' })
  const id = good.recovery.points[0].id
  backend.data.set(STORAGE_KEY, '{broken')
  const broken = createInventoryStore(backend), before = snapshot(broken)
  backend.failWrites.add(failingKey)
  assert.throws(() => broken.restoreRecoveryPoint(id))
  assert.match(broken.error.value, /启动读取失败/)
  assert.equal(backend.getItem(STORAGE_KEY), '{broken')
  assert.deepEqual(snapshot(broken), before)
})

test('M5 无恢复点的损坏主数据可从验证合格文件恢复，并隔离调用方对象', () => {
  const backend = storage({ [STORAGE_KEY]: '{broken' }), store = createInventoryStore(backend)
  const imported = fixture()
  assert.throws(() => store.restoreImportedState({ products: [] }))
  assert.equal(backend.getItem(PRESERVED_RAW_KEY), null)
  assert.equal(backend.getItem(STORAGE_KEY), '{broken')
  store.restoreImportedState(imported)
  imported.products[0].name = '外部篡改'
  assert.equal(store.state.products[0].name, '导入商品')
  assert.equal(store.error.value, '')
  assert.equal(store.exportPreservedRawData(), '{broken')
  assert.throws(() => store.restoreImportedState(fixture()), /普通导入/)
})

test('M5 损坏原文保护失败，文件恢复不可越过只读', () => {
  const backend = storage({ [STORAGE_KEY]: '{broken' }), store = createInventoryStore(backend)
  backend.failWrites.add(PRESERVED_RAW_KEY)
  assert.throws(() => store.restoreImportedState(fixture()), /保护损坏/)
  assert.equal(store.exportRawData(), '{broken')
  assert.ok(store.error.value)
})

test('M5 辅助设置/恢复点损坏不会锁住有效库存，不自动覆盖损坏索引', () => {
  const backend = storage({ [SETTINGS_KEY]: '{broken', [RECOVERY_KEY]: '{broken' })
  const store = createInventoryStore(backend)
  assert.equal(store.error.value, '')
  store.addProduct({ name: '依然可保存' })
  assert.equal(loadState(backend).products.length, 1)
  assert.equal(backend.getItem(RECOVERY_KEY), '{broken')
  assert.match(store.recovery.warning, /设置读取失败/)
  assert.match(store.recovery.warning, /恢复点读取失败/)
})

test('M5 单个恢复点损坏仅显示可用项，索引不静默覆写，缺失目标不能恢复', () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.addProduct({ name: '一个' }); store.addProduct({ name: '两个' })
  const data = JSON.parse(backend.getItem(RECOVERY_KEY)), badId = data.points[0].id
  data.points[0].raw = '{broken'
  const corrupted = JSON.stringify(data)
  backend.data.set(RECOVERY_KEY, corrupted)
  const loaded = createInventoryStore(backend)
  assert.equal(loaded.recovery.points.length, 1)
  assert.match(loaded.recovery.warning, /部分恢复点/)
  assert.throws(() => loaded.restoreRecoveryPoint(badId), /不存在或已损坏/)
  loaded.addProduct({ name: '三个' })
  assert.equal(backend.getItem(RECOVERY_KEY), corrupted)
  assert.equal(loadState(backend).products.length, 3)
})

test('M5 主存储不可读时不得以空数据覆盖，所有恢复入口中止', () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.addProduct({ name: '原库存' }); const id = store.recovery.points[0].id, before = backend.data.get(STORAGE_KEY)
  backend.failReads.add(STORAGE_KEY)
  const blocked = createInventoryStore(backend)
  assert.throws(() => blocked.restoreRecoveryPoint(id), /无法读取原始/)
  assert.throws(() => blocked.restoreImportedState(fixture()), /无法读取原始/)
  assert.equal(backend.data.get(STORAGE_KEY), before)
  assert.equal(backend.getItem(PRESERVED_RAW_KEY), null)
})

test('M5 诊断只允许固定事件码和标准时间，上限80且副本隔离，不含库存错误内容', () => {
  const backend = storage(), store = createInventoryStore(backend)
  store.addProduct({ name: '私人药名', barcode: '000012345' })
  assert.equal(store.recordDiagnostic('私人药名 OCR 原文'), false)
  for (let i = 0; i < 100; i++) store.recordDiagnostic('OCR_FAILED', '不可记录的错误内容')
  const report = store.getDiagnosticReport()
  assert.equal(report.events.length, MAX_DIAGNOSTIC_EVENTS)
  assert.ok(report.events.every(event => Object.keys(event).sort().join(',') === 'at,code'))
  assert.doesNotMatch(JSON.stringify(report), /私人|000012345|原文|不可记录/)
  report.events[0].code = '污染'
  assert.equal(store.getDiagnosticReport().events[0].code, 'OCR_FAILED')
  assert.equal(createInventoryStore(backend).getDiagnosticReport().events.length, MAX_DIAGNOSTIC_EVENTS)
})

test('M5 诊断读取去除未知事件和多余字段，写失败不阻断库存操作', () => {
  const backend = storage({ [DIAGNOSTICS_KEY]: JSON.stringify({ version: 1, events: [
    { code: 'OCR_FAILED', at: '2026-10-03T00:00:00.000Z', text: '秘密' },
    { code: '秘密', at: '2026-10-03T00:00:00.000Z' },
    { code: 'OCR_FAILED', at: '2026-10-03 (secret)' },
  ] }) })
  assert.deepEqual(createDiagnostics(backend).report().events, [{ code: 'OCR_FAILED', at: '2026-10-03T00:00:00.000Z' }])
  backend.failWrites.add(DIAGNOSTICS_KEY)
  const store = createInventoryStore(backend)
  assert.doesNotThrow(() => store.addProduct({ name: '正常保存' }))
  assert.equal(loadState(backend).products.length, 1)
  assert.equal(store.recordDiagnostic('EXPORT_FAILED'), false)
})

test('M5 恢复完整保留唯一码、包装识别内容和流水，诊断报告不包含它们', () => {
  const backend = storage(), store = createInventoryStore(backend)
  const product = store.addProduct({ name: '阿莫西林胶囊', specification: '0.25g*24粒', manufacturer: '甲制药有限公司', productType: 'medicine', trackingMode: 'unique' })
  const now = '2026-10-03T00:00:00.000Z', text = '药品名称:阿莫西林胶囊\n规格:0.25g*24粒\n生产企业:甲制药有限公司'
  const check = createPackagingCheck(product, '000101', [{ id: 'front', text, createdAt: now }], { confirmedSameBox: true, checkedAt: now })
  store.recordMovement({ productId: product.id, type: 'in', quantity: 1, codes: ['000101'], confirmBinding: true, packagingChecks: [check] })
  const before = snapshot(store), target = store.recovery.points[0].id
  store.recordMovement({ productId: product.id, type: 'out', quantity: 1, codes: ['000101'] })
  store.restoreRecoveryPoint(target)
  assert.deepEqual(snapshot(store), before)
  assert.deepEqual(snapshot(createInventoryStore(backend)), before)
  assert.doesNotMatch(JSON.stringify(store.getDiagnosticReport()), /阿莫西林|0.25g|甲制药|000101|药品名称/)
})

test('M5 多个诊断入口共享最近日志，互不覆盖已持久化事件', () => {
  const backend = storage(), first = createDiagnostics(backend), second = createDiagnostics(backend)
  first.record('STARTUP_SUCCEEDED'); second.record('UNEXPECTED_ERROR'); first.record('OCR_FAILED')
  assert.deepEqual(second.report().events.map(event => event.code), ['STARTUP_SUCCEEDED', 'UNEXPECTED_ERROR', 'OCR_FAILED'])
})

test('M5 明确同意替换后多次损坏恢复最多隔离一份原文，最新副本仍可导出', () => {
  const backend = storage({ [STORAGE_KEY]: '{first' }), first = createInventoryStore(backend)
  first.restoreImportedState(fixture())
  backend.data.set(STORAGE_KEY, '{second')
  const second = createInventoryStore(backend)
  second.restoreImportedState(fixture(), { replacePreserved: true })
  assert.equal(second.exportPreservedRawData(), '{second')
  assert.equal([...backend.data.keys()].filter(key => key.startsWith('inventory-app-preserved')).length, 1)
})
