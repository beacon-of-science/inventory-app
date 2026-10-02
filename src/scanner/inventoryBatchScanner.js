import { Capacitor } from '@capacitor/core'
import { BARCODE_FORMATS, inventoryScannerPlugin } from './nativeScanner.js'

export function createInventoryBatchScanner({ platform, plugin }) {
  let busy = false
  return async function scanInventoryBatch(options = {}) {
    if ((typeof platform === 'function' ? platform() : platform) !== 'android') throw new Error('请在 Android 手机 APK 中使用摄像头扫码')
    const { mode, barcode, format } = options
    if (!['single', 'multiple', 'unique'].includes(mode) || typeof barcode !== 'string' || (mode !== 'unique' && !barcode.trim()) || (barcode !== '' && !barcode.trim()) || barcode.length > 80 || /[^\x20-\x7e]/.test(barcode) || (format !== undefined && !BARCODE_FORMATS.includes(format))) throw new Error('扫码参数无效')
    if (busy) throw new Error('扫码正在进行，请先完成或取消当前扫码')
    busy = true
    try {
      const result = await plugin.scanInventoryBatch({ mode, barcode, ...(format ? { format } : {}) })
      if (result?.cancelled === true || result === null) return null
      if (result?.cancelled !== false || !Array.isArray(result.codes) || !Number.isSafeInteger(result.quantity) || result.quantity < 1 || result.quantity !== result.codes.length || result.codes.some(code => typeof code !== 'string' || !code.trim() || code.length > (mode === 'unique' ? 120 : 80) || /[^\x20-\x7e]/.test(code)) || (mode === 'unique' ? new Set(result.codes).size !== result.quantity : result.codes.some(code => code !== barcode))) throw new Error('识别结果无效，请重新扫码')
      return { cancelled: false, codes: [...result.codes], quantity: result.quantity }
    } catch (error) {
      throw new Error(typeof error?.message === 'string' && /[\u4e00-\u9fff]/.test(error.message) ? error.message : '扫码失败，请重试或手动输入')
    } finally { busy = false }
  }
}

export const scanInventoryBatch = createInventoryBatchScanner({ platform: () => Capacitor.getPlatform(), plugin: inventoryScannerPlugin })
