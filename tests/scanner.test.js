import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarcodeScanner } from '../src/scanner/barcodeScanner.js'
import { addProduct, createEmptyState, findProductByBarcode, recordMovement } from '../src/core/inventory.js'

const success = { barcode: '0012345678905', format: 'EAN_13' }
test('浏览器拒绝扫码，且不会调用原生摄像头插件', async () => {
  let calls = 0
  const scan = createBarcodeScanner({ platform: 'web', plugin: { scan() { calls++ } } })
  await assert.rejects(scan(), /Android/)
  assert.equal(calls, 0)
})
test('成功扫码保留前导零，精确定位商品而不改库存或历史', async () => {
  const state = recordMovement(addProduct(createEmptyState(), { name: '商品', barcode: success.barcode }, { id: 'p' }).state,
    { productId: 'p', type: 'in', quantity: 5 }).state
  const before = structuredClone(state)
  const scan = createBarcodeScanner({ platform: () => 'android', plugin: { async scan() { return success } } })
  assert.deepEqual(await scan(), success)
  assert.equal(findProductByBarcode(state, (await scan()).barcode).id, 'p')
  assert.deepEqual(state, before)
})
test('扫码取消返回 null，随后仍可再次扫码', async () => {
  let calls = 0
  const scan = createBarcodeScanner({ platform: 'android', plugin: { async scan() { return ++calls === 1 ? { cancelled: true } : success } } })
  assert.equal(await scan(), null)
  assert.deepEqual(await scan(), success)
})
test('并发请求不会启动第二个原生扫码，完成后锁释放', async () => {
  let resolveFirst, calls = 0
  const scan = createBarcodeScanner({ platform: 'android', plugin: { scan() { calls++; return calls === 1 ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve(success) } } })
  const pending = scan()
  await assert.rejects(scan(), /正在进行/)
  assert.equal(calls, 1)
  resolveFirst(success)
  assert.deepEqual(await pending, success)
  assert.deepEqual(await scan(), success)
})
test('相机权限失败保留中文说明，并允许重试', async () => {
  let calls = 0
  const scan = createBarcodeScanner({ platform: 'android', plugin: { async scan() { if (++calls === 1) throw { message: '未获得相机权限', code: 'CAMERA_DENIED' }; return success } } })
  await assert.rejects(scan(), /未获得相机权限/)
  assert.deepEqual(await scan(), success)
})
test('无摄像头、超时与中断错误不会被吞掉', async () => {
  for (const message of ['此设备没有可用摄像头', '未识别到商品条码，请重试', '扫码已中断']) {
    const scan = createBarcodeScanner({ platform: 'android', plugin: { async scan() { throw new Error(message) } } })
    await assert.rejects(scan(), error => error.message === message)
  }
})
test('非中文平台错误转换为用户能理解的错误', async () => {
  const scan = createBarcodeScanner({ platform: 'android', plugin: { async scan() { throw new Error('not implemented') } } })
  await assert.rejects(scan(), /扫码失败/)
})
for (const result of [null, {}, { barcode: 123, format: 'EAN_13' }, { barcode: '', format: 'EAN_13' },
  { barcode: 'abc\n', format: 'CODE_128' }, { barcode: 'abc', format: 'QR_CODE' },
  { barcode: '中文', format: 'CODE_128' }, { barcode: 'x'.repeat(81), format: 'CODE_128' }]) {
  test(`无效原生结果被拒绝并释放扫描锁 ${JSON.stringify(result)}`, async () => {
    let calls = 0
    const scan = createBarcodeScanner({ platform: 'android', plugin: { async scan() { return ++calls === 1 ? result : success } } })
    await assert.rejects(scan(), /识别结果无效/)
    assert.deepEqual(await scan(), success)
  })
}
