import { Capacitor } from '@capacitor/core'
import { BARCODE_FORMATS, inventoryScannerPlugin } from './nativeScanner.js'
export { BARCODE_FORMATS } from './nativeScanner.js'
export { scanInventoryBatch, createInventoryBatchScanner } from './inventoryBatchScanner.js'


/** Dependencies can be injected for tests; production always invokes the native plugin. */
export function createBarcodeScanner({ platform, plugin }) {
  let scanning = false
  return async function scanBarcode() {
    const currentPlatform = typeof platform === 'function' ? platform() : platform
    if (currentPlatform !== 'android') throw new Error('请在 Android 手机 APK 中使用摄像头扫码，也可以手动输入商品条码')
    if (scanning) throw new Error('扫码正在进行，请先完成或取消当前扫码')
    scanning = true
    try {
      const result = await plugin.scan()
      if (result?.cancelled === true) return null
      if (!result || typeof result.barcode !== 'string' || !result.barcode.trim() ||
          result.barcode.length > 80 || /[^\x20-\x7e]/.test(result.barcode) || !BARCODE_FORMATS.includes(result.format)) {
        throw new Error('识别结果无效，请重新扫描商品一维条码')
      }
      // Keep the original string, including leading zeros. Never convert a barcode to a number.
      return { barcode: result.barcode, format: result.format }
    } catch (error) {
      if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error
      if (error && typeof error.message === 'string' && /[\u4e00-\u9fff]/.test(error.message)) throw new Error(error.message)
      throw new Error('扫码失败，请重试或手动输入商品条码')
    } finally {
      scanning = false
    }
  }
}

export const scanBarcode = createBarcodeScanner({
  platform: () => Capacitor.getPlatform(),
  plugin: inventoryScannerPlugin,
})
