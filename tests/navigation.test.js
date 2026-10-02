import test from 'node:test'
import assert from 'node:assert/strict'
import { createAndroidNavigation } from '../src/navigation/androidNavigation.js'

test('Android返回事件交给Web且cleanup幂等', () => {
  const target = new EventTarget()
  const navigation = createAndroidNavigation({ platform: 'android', plugin: {}, target })
  let count = 0
  const cleanup = navigation.installAndroidBackHandler(event => { assert.equal(event.type, 'inventory-back'); count++ })
  target.dispatchEvent(new Event('inventory-back')); assert.equal(count, 1)
  cleanup(); cleanup(); target.dispatchEvent(new Event('inventory-back')); assert.equal(count, 1)
})
test('重复安装替换旧监听，旧cleanup不会移除新监听', () => {
  const target = new EventTarget()
  const navigation = createAndroidNavigation({ platform: 'android', plugin: {}, target })
  let old = 0, current = 0
  const before = navigation.installAndroidBackHandler(() => old++)
  const after = navigation.installAndroidBackHandler(() => current++)
  before(); target.dispatchEvent(new Event('inventory-back'))
  assert.equal(old, 0); assert.equal(current, 1); after()
})
test('浏览器不安装Android处理且不调用原生minimize', async () => {
  const target = new EventTarget(); let count = 0
  const navigation = createAndroidNavigation({ platform: 'web', plugin: { minimize: () => count++ }, target })
  const cleanup = navigation.installAndroidBackHandler(() => count++)
  target.dispatchEvent(new Event('inventory-back')); cleanup(); await navigation.minimizeApp(); assert.equal(count, 0)
})
test('minimize接口等待原生结果，错误转换中文', async () => {
  let count = 0
  await createAndroidNavigation({ platform: () => 'android', plugin: { async minimize() { count++ } } }).minimizeApp()
  assert.equal(count, 1)
  await assert.rejects(createAndroidNavigation({ platform: 'android', plugin: { async minimize() { throw new Error('native failure') } } }).minimizeApp(), /无法返回桌面/)
  await assert.rejects(createAndroidNavigation({ platform: 'android', plugin: { async minimize() { throw { message: '当前页面已关闭' } } } }).minimizeApp(), /当前页面已关闭/)
})
test('无窗口时安全清理，错误handler明确拒绝', () => {
  const navigation = createAndroidNavigation({ platform: 'android', plugin: {}, target: null })
  navigation.installAndroidBackHandler(() => {})()
  assert.throws(() => navigation.installAndroidBackHandler(null), /处理函数无效/)
})
