import { registerPlugin } from '@capacitor/core'
export const inventoryScannerPlugin = registerPlugin('InventoryScanner')
export const BARCODE_FORMATS = Object.freeze([
  'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'CODE_93', 'ITF', 'CODABAR',
])
