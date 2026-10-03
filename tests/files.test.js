import test from 'node:test'
import assert from 'node:assert/strict'

test('浏览器下载仅报告发起，不把未确认保存误记为成功', async () => {
  const files = createInventoryFiles({ platform: 'web', browser: { async exportFile() { return { cancelled: false, confirmed: false } } } })
  assert.deepEqual(await files.exportInventoryFile('{}'), { cancelled: false, confirmed: false })
})
import { createInventoryFiles, MAX_FILE_BYTES } from '../src/files/inventoryFiles.js'

const sample = '{"name":"收纳盒","barcode":"00123"}'
function native(overrides = {}) {
  return createInventoryFiles({ platform: 'android', plugin: {
    async exportFile() { return { cancelled: false } },
    async importFile() { return { cancelled: false, content: sample, fileName: 'backup.json' } },
    ...overrides,
  } })
}

test('原生导出保留中文和条码前导零，生成合法JSON文件名', async () => {
  const files = native({ async exportFile(options) {
    assert.equal(options.content, sample)
    assert.match(options.fileName, /^inventory-backup-[\dTZ-]+\.json$/)
    assert.equal(options.fileName.includes(':'), false)
    return { cancelled: false }
  } })
  assert.deepEqual(await files.exportInventoryFile(sample), { cancelled: false })
})

test('原生导入原样返回内容，不在文件层修改库存或解析业务数据', async () => {
  assert.equal(await native().importInventoryFile(), sample)
  assert.equal(await native({ async importFile() { return { cancelled: false, content: 'not json' } } }).importInventoryFile(), 'not json')
})

test('诊断与损坏原文共用JSON导出入口，文件名区分用途且原文不解析', async () => {
  const captured = []
  const files = native({ async exportFile(options) { captured.push(options); return { cancelled: false } } })
  const raw = '{broken 原文00123'
  assert.deepEqual(await files.exportDiagnosticFile(sample), { cancelled: false })
  assert.deepEqual(await files.exportRawInventoryFile(raw), { cancelled: false })
  assert.match(captured[0].fileName, /^inventory-diagnostics-[\dTZ-]+\.json$/)
  assert.match(captured[1].fileName, /^inventory-recovery-raw-[\dTZ-]+\.json$/)
  assert.equal(captured[0].content, sample)
  assert.equal(captured[1].content, raw)
})

test('诊断和原文导出共享互斥与大小校验，取消与失败后都释放锁', async () => {
  let finish, calls = 0
  const files = native({ exportFile() { calls++; return new Promise(resolve => { finish = resolve }) } })
  const first = files.exportDiagnosticFile(sample)
  await assert.rejects(files.exportRawInventoryFile(sample), /正在进行/)
  await assert.rejects(files.importInventoryFile(), /正在进行/)
  assert.equal(calls, 1)
  finish({ cancelled: true })
  assert.deepEqual(await first, { cancelled: true })
  await assert.rejects(files.exportRawInventoryFile('中'.repeat(Math.floor(MAX_FILE_BYTES / 3) + 1)), /5 MiB/)
  assert.equal(calls, 1)
  const next = files.exportRawInventoryFile(sample)
  finish({ cancelled: false })
  assert.deepEqual(await next, { cancelled: false })
})

test('导出取消返回cancelled，导入取消返回null，后续仍能操作', async () => {
  const files = native({ async exportFile() { return { cancelled: true } }, async importFile() { return { cancelled: true } } })
  assert.deepEqual(await files.exportInventoryFile(sample), { cancelled: true })
  assert.equal(await files.importInventoryFile(), null)
  assert.deepEqual(await files.exportInventoryFile(sample), { cancelled: true })
})

test('跨导入导出互斥，第二次调用不会启动原生选择器', async () => {
  let finish, imports = 0
  const files = native({ exportFile() { return new Promise(resolve => { finish = resolve }) }, async importFile() { imports++; return { cancelled: true } } })
  const first = files.exportInventoryFile(sample)
  await assert.rejects(files.importInventoryFile(), /正在进行/)
  assert.equal(imports, 0)
  finish({ cancelled: false })
  await first
  assert.equal(await files.importInventoryFile(), null)
  assert.equal(imports, 1)
})

test('浏览器使用可测试文件入口，不调用Android插件', async () => {
  const files = createInventoryFiles({ platform: () => 'web', plugin: {
    exportFile() { assert.fail('native called') }, importFile() { assert.fail('native called') },
  }, browser: {
    async exportFile({ content }) { assert.equal(content, sample); return { cancelled: false } },
    async importFile() { return { cancelled: false, content: sample } },
  } })
  assert.deepEqual(await files.exportInventoryFile(sample), { cancelled: false })
  assert.equal(await files.importInventoryFile(), sample)
})

test('浏览器取消也返回null', async () => {
  const files = createInventoryFiles({ platform: 'web', browser: { async importFile() { return { cancelled: true } } } })
  assert.equal(await files.importInventoryFile(), null)
})

test('5MiB按UTF8字节限制，等于边界允许，中文超界拒绝', async () => {
  const ascii = 'a'.repeat(MAX_FILE_BYTES)
  assert.deepEqual(await native().exportInventoryFile(ascii), { cancelled: false })
  assert.equal(await native({ async importFile() { return { cancelled: false, content: ascii } } }).importInventoryFile(), ascii)
  await assert.rejects(native().exportInventoryFile('a'.repeat(MAX_FILE_BYTES + 1)), /5 MiB/)
  await assert.rejects(native().exportInventoryFile('中'.repeat(Math.floor(MAX_FILE_BYTES / 3) + 1)), /5 MiB/)
  await assert.rejects(native({ async importFile() { return { cancelled: false, content: 'a'.repeat(MAX_FILE_BYTES + 1) } } }).importInventoryFile(), /5 MiB/)
})

test('无效内容和孤立代理字符在开启文件选择器前被拒绝，合法emoji保留', async () => {
  let calls = 0
  const files = native({ async exportFile() { calls++; return { cancelled: false } } })
  for (const value of [null, undefined, 12, {}, '\ud800', '\udc00', 'a\udc00']) {
    await assert.rejects(files.exportInventoryFile(value), /无效/)
  }
  assert.equal(calls, 0)
  await files.exportInventoryFile('商品📦')
  assert.equal(calls, 1)
})

for (const result of [null, {}, { cancelled: 'false' }]) {
  test(`导出拒绝无效平台结果 ${JSON.stringify(result)}`, async () => {
    await assert.rejects(native({ async exportFile() { return result } }).exportInventoryFile(sample), /保存结果/)
  })
}
for (const result of [null, {}, { cancelled: false }, { cancelled: false, content: 123 }]) {
  test(`导入拒绝无效平台结果 ${JSON.stringify(result)}`, async () => {
    await assert.rejects(native({ async importFile() { return result } }).importInventoryFile(), /无效|读取结果/)
  })
}

test('中文IO错误保留且锁释放，非中文错误转为中文提示', async () => {
  let calls = 0
  const files = native({ async importFile() {
    calls++
    if (calls === 1) throw { message: '读取文件失败，权限已撤销' }
    if (calls === 2) throw new Error('ENOENT')
    return { cancelled: true }
  } })
  await assert.rejects(files.importInventoryFile(), /权限已撤销/)
  await assert.rejects(files.importInventoryFile(), /文件操作失败/)
  assert.equal(await files.importInventoryFile(), null)
})
