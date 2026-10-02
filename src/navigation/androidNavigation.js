import { Capacitor, registerPlugin } from '@capacitor/core'

export function createAndroidNavigation({ platform, plugin, target }) {
  const isAndroid = () => (typeof platform === 'function' ? platform() : platform) === 'android'
  let currentCleanup = null
  function installAndroidBackHandler(handler) {
    if (typeof handler !== 'function') throw new TypeError('返回键处理函数无效')
    if (currentCleanup) currentCleanup()
    if (!isAndroid() || !target?.addEventListener) return () => {}
    let active = true
    const listener = event => { if (active) handler(event) }
    target.addEventListener('inventory-back', listener)
    const cleanup = () => {
      if (!active) return
      active = false
      target.removeEventListener('inventory-back', listener)
      if (currentCleanup === cleanup) currentCleanup = null
    }
    currentCleanup = cleanup
    return cleanup
  }
  async function minimizeApp() {
    if (!isAndroid()) return
    try { await plugin.minimize() }
    catch (error) { throw new Error(typeof error?.message === 'string' && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '暂时无法返回桌面，请重试') }
  }
  return { installAndroidBackHandler, minimizeApp }
}

const navigation = createAndroidNavigation({ platform: () => Capacitor.getPlatform(), plugin: registerPlugin('InventoryNavigation'), target: typeof window === 'undefined' ? null : window })
export const installAndroidBackHandler = navigation.installAndroidBackHandler
export const minimizeApp = navigation.minimizeApp
