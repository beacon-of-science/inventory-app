import { Capacitor, registerPlugin } from '@capacitor/core'

export function createPackagingOcr({ platform, plugin }) {
  let busy = false
  return async function capturePackagingText() {
    if ((typeof platform === 'function' ? platform() : platform) !== 'android') throw new Error('请在 Android 手机 APK 中拍摄包装文字，也可以手动填写')
    if (busy) throw new Error('包装文字识别正在进行，请先完成或取消')
    busy = true
    try {
      const result = await plugin.capture()
      if (result?.cancelled === true) return null
      if (result?.cancelled !== false || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 4000) throw new Error('未获得有效包装文字，请重拍或手动填写')
      return { text: result.text }
    } catch (error) {
      throw new Error(typeof error?.message === 'string' && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '包装文字识别失败，请重试或手动填写')
    } finally { busy = false }
  }
}

export const capturePackagingText = createPackagingOcr({ platform: () => Capacitor.getPlatform(), plugin: registerPlugin('InventoryOcr') })
