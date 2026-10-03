<script setup>
import { computed, ref, reactive, unref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { showToast, showConfirmDialog, closeDialog } from 'vant'
import { createInventoryStore } from './store/inventoryStore.js'
import { scanBarcode, scanInventoryBatch } from './scanner/barcodeScanner.js'
import { normalizeBarcode, findProductByScan, isLowStock, validateScanBatch, normalizeUnitCode } from './core/inventory.js'
import { createPackagingCheck, extractPackagingFields, getOcrFieldOptions, normalizePackagingText } from './core/packaging.js'
import { capturePackagingText } from './ocr/packagingOcr.js'
import { exportInventory, parseInventoryImport } from './core/dataTransfer.js'
import { exportInventoryFile, importInventoryFile, exportDiagnosticFile, exportRawInventoryFile } from './files/inventoryFiles.js'
import { version as appVersion } from '../package.json'

import { installAndroidBackHandler, minimizeApp } from './navigation/androidNavigation.js'
import OcrFieldPicker from './components/OcrFieldPicker.vue'
import { autofillProductDraft } from './ocr/productAutofill.js'
import { chooseBackAction } from './navigation/backNavigation.js'
import HomePager from './components/HomePager.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import RecoveryPreview from './components/RecoveryPreview.vue'
const store = createInventoryStore()
const pagerMotion = ref({ progress: 0, duration: 220 })
const pagerBlocked = computed(() => productSheet.value || movementSheet.value || detailSheet.value || unknownSheet.value || importSheet.value || recoverySheet.value || backupSheet.value || dialogOpen.value || scanning.value || batchScanning.value || ocrBusy.value || productOcrBusy.value || transferBusy.value || submitting.value)
const pageStates = reactive(Object.fromEntries(['products','stock','history'].map(page => [page, { search: '', categoryFilter: 'all', lowStockOnly: false, filtersOpen: false }])))
function activePageField(field) {
  return computed({ get: () => pageStates[tab.value][field], set: value => { pageStates[tab.value][field] = value } })
}
const filtersOpen = activePageField('filtersOpen')
const dialogOpen = ref(false)
let lastRootBack = 0, stopAndroidBack = () => {}
function navigateTo(next) {
  if (!['products','stock','history'].includes(next) || tab.value === next) return
  tab.value = next; lastRootBack = 0
}
function handleBack() {
  const action = chooseBackAction({dialog:dialogOpen.value,importPreview:importSheet.value || recoverySheet.value,
    busy:scanning.value || batchScanning.value || ocrBusy.value || productOcrBusy.value || submitting.value || transferBusy.value,
    product:productSheet.value,movement:movementSheet.value,detail:detailSheet.value,unknown:unknownSheet.value,backup:backupSheet.value,
    filters:filtersOpen.value,search:search.value,tab:tab.value})
  if (action !== 'root') lastRootBack = 0
  if (action === 'dialog') closeDialog()
  else if (action === 'import') recoverySheet.value ? cancelRecovery() : cancelImport()
  else if (action === 'wait') notify('请先完成或取消当前操作')
  else if (action === 'product') productSheet.value = false
  else if (action === 'movement') movementSheet.value = false
  else if (action === 'detail') detailSheet.value = false
  else if (action === 'unknown') unknownSheet.value = false
  else if (action === 'backup') backupSheet.value = false
  else if (action === 'filters') filtersOpen.value = false
  else if (action === 'search') search.value = ''
  else if (action === 'home') navigateTo('products')
  else if (Date.now() - lastRootBack < 2000) { lastRootBack = 0; minimizeApp().catch(error => notify(error.message)) }
  else { lastRootBack = Date.now(); notify('再按一次返回键退出到后台') }
}
function escapeBack(event) { if (event.key === 'Escape') { event.preventDefault(); handleBack() } }
function recordUnexpected() { store.recordDiagnostic('UNEXPECTED_ERROR') }
watch(() => store.settings.reduceMotion, value => document.documentElement.classList.toggle('reduced-motion', value), { immediate: true })
onMounted(() => { stopAndroidBack = installAndroidBackHandler(handleBack); window.addEventListener('keydown',escapeBack); window.addEventListener('error',recordUnexpected); window.addEventListener('unhandledrejection',recordUnexpected) })
onUnmounted(() => { stopAndroidBack(); window.removeEventListener('keydown',escapeBack); window.removeEventListener('error',recordUnexpected); window.removeEventListener('unhandledrejection',recordUnexpected); document.documentElement.classList.remove('reduced-motion') })
const tab = ref('products')
const search = activePageField('search')
const historyFilter = ref('all')
const productSheet = ref(false)
const movementSheet = ref(false)
const detailSheet = ref(false)
const detailId = ref('')
const editingId = ref('')
const formError = ref('')
const movementError = ref('')
const status = ref('')
const scanning = ref(false)
const unknownBarcode = ref('')
const unknownSheet = ref(false)
const transferBusy = ref(false)
const importSheet = ref(false)
const backupSheet = ref(false)
const recoverySheet = ref(false)
const recoveryPreview = ref(null)
const replacePreserved = ref(false)
const importPreview = ref(null)
const importRecovery = ref(false)
const productForm = ref({ productType: 'unknown', trackingMode: 'quantity', specification: '', manufacturer: '', name: '', sku: '', barcode: '', category: '', lowStockThreshold: '', unit: '件', note: '' })
const movementForm = ref({ productId: '', type: 'in', quantity: '', note: '' })
const movementMode = ref('manual')
const batchCodeText = ref('')
const batchId = ref('')
const bindingConfirmed = ref(false)
const submitting = ref(false)
const batchScanning = ref(false)
const ocrBusy = ref(false)
const ocrUnitCode = ref('')
const packagingCaptures = ref(Object.create(null))
const sameBoxConfirmed = ref(Object.create(null))
const allowIncomplete = ref(false)
const intakeCaptures = ref([]), intakeUnitCode = ref('')
const intakeNameConfirmed = ref(false)
const productOcrCaptures = ref([]), productOcrBusy = ref(false)
const productOcrAutomatic = ref({})
const emptyExtraction = () => Object.fromEntries(['name','specification','manufacturer'].map(key => [key,{value:'',status:'missing',candidates:[]}]))
const intakeFields = computed(() => intakeCaptures.value.length ? extractPackagingFields(intakeCaptures.value,{expectedName:movementProduct.value?.name}) : emptyExtraction())
const intakeNameChoice = computed(() => intakeCaptures.value.length ? getOcrFieldOptions(intakeCaptures.value).name.find(value => normalizePackagingText(value) === normalizePackagingText(movementProduct.value?.name || '')) || '' : '')
const productOcrFields = computed(() => productOcrCaptures.value.length ? extractPackagingFields(productOcrCaptures.value) : emptyExtraction())
const extractionLabels = {recognized:'标签或已有名称匹配',missing:'未找到，请补拍或从原文选取',ambiguous:'多个候选，请点选核对',suggested:'推测候选，请点选核对'}
function useOcrCandidate(key, value) {
  productForm.value[key] = value
  delete productOcrAutomatic.value[key]
  notify(`已选为${fieldLabels[key]}，请核对包装`)
}
const intakeProblem = computed(() => {
  if (!intakeCaptures.value.length) return ''
  if (intakeFields.value.name.status !== 'recognized') return intakeNameChoice.value ? (intakeNameConfirmed.value ? '' : '清理后的名称与当前商品相同，请对照包装并确认下方药名。') : '未提取到明确药名，请拍清药名或通用名称，再翻面补拍。'
  if (normalizePackagingText(intakeFields.value.name.value) !== normalizePackagingText(movementProduct.value?.name || '')) return '拍到的药名与当前商品不同，请检查是否选错商品或拿错盒。'
  return ''
})
const movementReference = computed(() => {
  const product = movementProduct.value
  if (!product || movementForm.value.type !== 'in' || product.trackingMode !== 'unique') return product
  return {...product,...Object.fromEntries(['specification','manufacturer'].filter(key => !product[key] && intakeFields.value[key].status === 'recognized').map(key => [key,intakeFields.value[key].value]))}
})
async function captureProductFace() {
  if (productOcrBusy.value || scanning.value || productOcrCaptures.value.length >= 6) return
  productOcrBusy.value = true; formError.value = ''
  try {
    const result = await capturePackagingText()
    if (!result || !productSheet.value) return
    productOcrCaptures.value.push({id:freshBatchId(),text:result.text,createdAt:new Date().toISOString()})
    const draft = autofillProductDraft(productForm.value, productOcrFields.value, productOcrAutomatic.value)
    productForm.value = draft.values; productOcrAutomatic.value = draft.automatic
    notify('唯一候选已填入，请对照包装核对')
  } catch(error) { store.recordDiagnostic('OCR_FAILED'); formError.value = error.message }
  finally { productOcrBusy.value = false }
}
function resetProductOcr() {
  const draft = autofillProductDraft(productForm.value, {}, productOcrAutomatic.value)
  productForm.value = draft.values; productOcrAutomatic.value = {}
  productOcrCaptures.value = []; formError.value = ''
}
async function captureIntakeFace() {
  const productId = movementProduct.value?.id, operation = batchId.value
  if (!movementSheet.value || movementForm.value.type !== 'in' || movementProduct.value?.trackingMode !== 'unique' || ocrBusy.value || batchScanning.value || intakeCaptures.value.length >= 6) return
  ocrBusy.value = true; movementError.value = ''
  try {
    const result = await capturePackagingText()
    if (!result || !movementSheet.value || movementProduct.value?.id !== productId || batchId.value !== operation) return
    intakeCaptures.value.push({id:freshBatchId(),text:result.text,createdAt:new Date().toISOString()})
    intakeNameConfirmed.value = false
    bindIntakeToFirstCode()
    if (intakeUnitCode.value) { packagingCaptures.value[intakeUnitCode.value] = [...intakeCaptures.value]; sameBoxConfirmed.value[intakeUnitCode.value] = false; ocrUnitCode.value = intakeUnitCode.value }
    allowIncomplete.value = false
    notify('已提取，可翻面补拍')
  } catch(error) { store.recordDiagnostic('OCR_FAILED'); movementError.value = error.message }
  finally { ocrBusy.value = false }
}
function bindIntakeToFirstCode() {
  if (!intakeUnitCode.value && intakeCaptures.value.length && batchCodes.value.length) {
    intakeUnitCode.value = batchCodes.value[0]; packagingCaptures.value[intakeUnitCode.value] = [...intakeCaptures.value]
    sameBoxConfirmed.value[intakeUnitCode.value] = false; ocrUnitCode.value = intakeUnitCode.value
  }
}
function resetIntakePhoto() {
  if (ocrBusy.value) return
  if (intakeUnitCode.value) { delete packagingCaptures.value[intakeUnitCode.value]; delete sameBoxConfirmed.value[intakeUnitCode.value] }
  intakeCaptures.value = []; intakeUnitCode.value = ''; intakeNameConfirmed.value = false; allowIncomplete.value = false
}
const packagingStatusLabels = { matched: '文字一致', conflict: '信息冲突', incomplete: '未完全核实' }
const fieldStatusLabels = { matched: '一致', conflict: '冲突', missing: '未核实', unconfigured: '参考信息未配置' }
const fieldLabels = { name: '名称', specification: '规格', manufacturer: '厂家' }
const packagingPreviews = computed(() => {
  const product = movementReference.value
  if (!product) return {}
  const previews = Object.create(null)
  for (const code of batchCodes.value) {
    const captures = packagingCaptures.value[code] || []
    if (!captures.length) continue
    try { previews[code] = createPackagingCheck(product, code, captures, { confirmedSameBox: true }) }
    catch(error) { previews[code] = { status: 'incomplete', error: error.message } }
  }
  return previews
})
const hasPackagingConflict = computed(() => Object.values(packagingPreviews.value).some(check => check.status === 'conflict'))
const incompleteCount = computed(() => batchCodes.value.filter(code => packagingPreviews.value[code]?.status !== 'matched').length)
const selectedCaptures = computed(() => packagingCaptures.value[ocrUnitCode.value] || [])
const selectedPackaging = computed(() => packagingPreviews.value[ocrUnitCode.value])
function selectOcrUnit(code) { if (!ocrBusy.value) ocrUnitCode.value = code }
function resetPackagingDraft() {
  packagingCaptures.value = Object.create(null); sameBoxConfirmed.value = Object.create(null); ocrUnitCode.value = ''; allowIncomplete.value = false; intakeCaptures.value = []; intakeUnitCode.value = ''; intakeNameConfirmed.value = false
}
function removePackagingCapture(code, index) {
  if (ocrBusy.value) return
  packagingCaptures.value[code] = (packagingCaptures.value[code] || []).filter((_, i) => i !== index)
  if (code === intakeUnitCode.value) { intakeCaptures.value = [...packagingCaptures.value[code]]; intakeNameConfirmed.value = false }
  sameBoxConfirmed.value[code] = false; allowIncomplete.value = false
}
async function captureBoxFace() {
  if (ocrUnitCode.value === intakeUnitCode.value && movementForm.value.type === 'in') return captureIntakeFace()
  const code = ocrUnitCode.value, productId = movementProduct.value?.id, operation = batchId.value
  if (!code || !batchCodes.value.includes(code) || ocrBusy.value || submitting.value) return
  if ((packagingCaptures.value[code] || []).length >= 6) { movementError.value = '每盒最多采集 6 个面，请移除无效面后重拍。'; return }
  ocrBusy.value = true; movementError.value = ''
  try {
    const result = await capturePackagingText()
    if (!result) { notify('已取消 OCR，当前库存未改变'); return }
    if (!movementSheet.value || movementProduct.value?.id !== productId || batchId.value !== operation || !batchCodes.value.includes(code)) return
    const capture = { id: freshBatchId(), text: result.text, createdAt: new Date().toISOString() }
    packagingCaptures.value[code] = [...(packagingCaptures.value[code] || []), capture]
    sameBoxConfirmed.value[code] = false; allowIncomplete.value = false
    notify('这面文字已绑定当前单件码，可翻面继续采集')
  } catch(error) { store.recordDiagnostic('OCR_FAILED'); movementError.value = error.message || 'OCR 失败，请重新拍摄。' }
  finally { ocrBusy.value = false }
}
const batchCodes = computed(() => batchCodeText.value.split(/\r?\n/).map(code => code.trim()).filter(Boolean))
const units = computed(() => store.state.units || [])
const detailUnits = computed(() => units.value.filter(unit => unit.productId === detailId.value))
const submittedPreview = ref(null)
const batchPreview = computed(() => {
  if (!movementSheet.value && submittedPreview.value) return submittedPreview.value
  if (!movementProduct.value || movementProduct.value.productType === 'unknown') return { error: '请先确认商品类型。' }
  try {
    return validateScanBatch(store.state, {
      ...movementForm.value,
      quantity: movementProduct.value.trackingMode === 'unique' ? batchCodes.value.length : Number(movementForm.value.quantity),
      codes: movementProduct.value.trackingMode === 'unique' ? batchCodes.value : [], batchId: batchId.value,
    })
  } catch (error) { return { error: error.message } }
})
watch(() => [movementForm.value.productId, movementForm.value.type], () => resetBatch())
watch(batchCodeText, () => {
  bindingConfirmed.value = false; allowIncomplete.value = false
  const retained = new Set(batchCodes.value)
  for (const code of Object.keys(packagingCaptures.value)) if (!retained.has(code)) { delete packagingCaptures.value[code]; delete sameBoxConfirmed.value[code] }
  if (intakeUnitCode.value && !retained.has(intakeUnitCode.value)) { intakeCaptures.value = []; intakeUnitCode.value = '' }
  if (!retained.has(ocrUnitCode.value)) ocrUnitCode.value = ''
  bindIntakeToFirstCode()
})
function freshBatchId() { return globalThis.crypto?.randomUUID?.() || 'batch-' + Date.now() + '-' + Math.random().toString(36).slice(2) }
function resetBatch() {
  submittedPreview.value = null
  resetPackagingDraft()
  batchCodeText.value = ''; bindingConfirmed.value = false; movementMode.value = 'manual'
  movementForm.value.quantity = ''; movementError.value = ''; batchId.value = freshBatchId()
}
function productTypeLabel(product) { return product.productType === 'medicine' ? '药品' : product.productType === 'ordinary' ? '普通商品' : '类型待确认' }
function removeBatchCode(index) { batchCodeText.value = batchCodes.value.filter((_, i) => i !== index).join('\n') }
function generateLocalCode() {
  if (movementProduct.value?.productType === 'medicine') return
  batchCodeText.value = [...batchCodes.value, 'LOCAL-' + freshBatchId()].join('\n')
}
function setProductType() {
  if (productForm.value.productType === 'medicine') productForm.value.trackingMode = 'unique'
}
function classifyMovementProduct(productType) {
  const product = movementProduct.value
  if (!product || batchScanning.value || submitting.value) return
  try {
    store.updateProduct(product.id, { productType, trackingMode: productType === 'medicine' ? 'unique' : 'quantity' })
    resetBatch()
  } catch (error) { movementError.value = error.message }
}
async function scanMovementBatch() {
  const product = movementProduct.value
  if (!product || batchScanning.value || submitting.value || storageError.value) return
  const productId = product.id, type = movementForm.value.type
  const mode = product.trackingMode === 'unique' ? 'unique' : movementMode.value
  batchScanning.value = true; movementError.value = ''
  try {
    const result = await scanInventoryBatch({ mode, barcode: product.barcode || '' })
    if (!result) { notify('已取消扫描，库存未更改'); return }
    if (!movementSheet.value || movementForm.value.productId !== productId || movementForm.value.type !== type) return
    if (product.trackingMode === 'unique') {
      const incoming = result.codes.map(normalizeUnitCode)
      const merged = new Set(batchCodes.value)
      let duplicates = 0
      for (const code of incoming) { if (merged.has(code)) duplicates++; else merged.add(code) }
      batchCodeText.value = [...merged].join('\n')
      notify(duplicates ? '重复码已忽略；请核对待提交清单' : '单件码已加入待提交清单')
    } else {
      movementForm.value.quantity = String(result.quantity)
      notify('数量已填入，请核对实物后确认；库存尚未更改')
    }
  } catch (error) { store.recordDiagnostic('SCAN_FAILED'); movementError.value = error.message || '扫描失败，请重试。' }
  finally { batchScanning.value = false }
}
const storageError = computed(() => unref(store.error) || '')
const products = computed(() => store.state.products)
const movements = computed(() => store.state.movements)
const inStockCount = computed(() => products.value.filter(product => product.stock > 0).length)
const lowStockCount = computed(() => products.value.filter(isLowStock).length)
const categories = computed(() => [...new Set(products.value.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const pageProducts = computed(() => Object.fromEntries(Object.entries(pageStates).map(([page, state]) => {
  const query = state.search.trim().toLowerCase()
  const list = [...products.value].filter(product => state.categoryFilter === 'all' || (state.categoryFilter === 'uncategorized' ? !product.category : product.category === state.categoryFilter.slice(9)))
    .filter(product => !state.lowStockOnly || isLowStock(product))
    .filter(product => !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query) || (product.barcode || '').toLowerCase().includes(query) || (product.category || '').toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return [page, list]
})))
const filteredMovements = computed(() => [...movements.value]
  .filter(movement => historyFilter.value === 'all' || movement.type === historyFilter.value)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const detailProduct = computed(() => products.value.find(product => product.id === detailId.value))
const movementProduct = computed(() => products.value.find(product => product.id === movementForm.value.productId))
const pageTitles = { products: '商品管理', stock: '当前库存', history: '出入库记录' }
const pageDescriptions = { products: '管理商品，随时掌握库存', stock: '看清库存，及时记录每一次变化', history: '查看每一次入库和出库' }

function formatDate(value, full = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...(full ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
function notify(message) {
  status.value = message
  showToast({ message, position: 'top' })
}
function openProduct(product, barcode = '') {
  if (storageError.value || transferBusy.value) return
  editingId.value = product?.id || ''
  productOcrCaptures.value = []
  productOcrAutomatic.value = {}
  productForm.value = { productType: product?.productType || 'unknown', trackingMode: product?.trackingMode || 'quantity', specification: product?.specification || '', manufacturer: product?.manufacturer || '', name: product?.name || '', sku: product?.sku || '', barcode: product?.barcode || barcode, category: product?.category || '', lowStockThreshold: product?.lowStockThreshold == null ? '' : String(product.lowStockThreshold), unit: product?.unit || '件', note: product?.note || '' }
  formError.value = ''
  productSheet.value = true
}
async function startScan(target = 'lookup') {
  if (scanning.value || storageError.value || transferBusy.value) return
  scanning.value = true
  try {
    const result = await scanBarcode()
    if (!result) { notify('已取消扫码'); return }
    const barcode = normalizeBarcode(result.barcode)
    if (!barcode) {
      notify('条码内容为空，请重新扫描或手动输入。')
      return
    }
    if (target === 'form') {
      if (!productSheet.value) return
      productForm.value.barcode = barcode
      formError.value = ''
      notify('条码已填入，请确认商品信息后保存')
      return
    }
    const product = findProductByScan(store.state, { barcode, format: result.format })
    if (product) {
      openDetail(product)
      notify(`已找到商品：${product.name}`)
    } else {
      unknownBarcode.value = barcode
      unknownSheet.value = true
    }
  } catch (error) {
    store.recordDiagnostic('SCAN_FAILED')
    notify(error.message || '扫码失败，请重试或手动输入条码。')
  } finally {
    scanning.value = false
  }
}
function addScannedProduct() {
  unknownSheet.value = false
  openProduct(undefined, unknownBarcode.value)
}
function saveProduct() {
  if (storageError.value || scanning.value || productOcrBusy.value || transferBusy.value) return
  const input = Object.fromEntries(Object.entries(productForm.value).map(([key, value]) => [key, key === 'barcode' ? value : value.trim()]))
  if (!input.name) { formError.value = '请输入商品名称。'; return }
  if (input.productType === 'unknown') { formError.value = '请人工确认商品类型，条码本身不能判断是否为药品。'; return }
  if (!input.unit) { formError.value = '请输入计量单位，例如件、箱或千克。'; return }
  if (input.lowStockThreshold && (!/^\d+$/.test(input.lowStockThreshold) || !Number.isSafeInteger(Number(input.lowStockThreshold)))) { formError.value = '低库存阈值必须是非负整数，留空可关闭提醒。'; return }
  input.lowStockThreshold = input.lowStockThreshold === '' ? null : Number(input.lowStockThreshold)
  try {
    if (editingId.value) store.updateProduct(editingId.value, input)
    else {
      const product = store.addProduct(input)
      if (productOcrCaptures.value.length && input.trackingMode === 'unique') {
        const photos = [...productOcrCaptures.value]
        productSheet.value = false
        openMovement('in',product,false)
        nextTick(() => { intakeCaptures.value = photos; bindIntakeToFirstCode() })
        notify('档案已建立，包装文字已带入入库；请扫描当前盒的单件码')
        return
      }
    }
    productSheet.value = false
    notify(editingId.value ? '商品信息已更新' : '商品已添加，可以开始入库了')
  } catch (error) { formError.value = error.message || '保存失败，请重试。' }
}
function openDetail(product) {
  detailId.value = product.id
  detailSheet.value = true
}
function editDetail() {
  const product = detailProduct.value
  detailSheet.value = false
  openProduct(product)
}
async function removeProduct() {
  const product = detailProduct.value
  if (!product || storageError.value || transferBusy.value || product.stock > 0) return
  try {
    dialogOpen.value = true
    await showConfirmDialog({ title: '删除商品', message: `确定删除“${product.name}”吗？已有出入库记录会保留。`, confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonColor: '#c74c4c' })
  } catch { return } finally { dialogOpen.value = false }
  try {
    store.deleteProduct(product.id)
    detailSheet.value = false
    notify('商品已删除，历史记录已保留')
  } catch (error) { notify(error.message || '删除失败，请重试。') }
}
function openMovement(type, product, startPhoto = true) {
  if (storageError.value || transferBusy.value || submitting.value || batchScanning.value) return
  movementForm.value = { productId: product?.id || products.value[0]?.id || '', type, quantity: '', note: '' }
  resetBatch()
  detailSheet.value = false
  movementSheet.value = true
  if (type === 'in' && startPhoto && movementProduct.value?.trackingMode === 'unique') nextTick(() => captureIntakeFace())
}
function saveMovement() {
  if (!movementSheet.value || storageError.value || transferBusy.value || submitting.value || batchScanning.value || ocrBusy.value) return
  movementError.value = ''
  const preview = batchPreview.value
  if (preview.error) { movementError.value = preview.error; return }
  if (preview.requiresBindingConfirmation && !bindingConfirmed.value) {
    movementError.value = '请确认新单件码确实属于当前商品，再提交。'; return
  }
  if (movementForm.value.type === 'in' && movementProduct.value.trackingMode === 'unique') {
    if (!intakeCaptures.value.length) { movementError.value = '请先拍摄本批第一盒包装，自动提取关键信息后再入库。'; return }
    if (intakeProblem.value) { movementError.value = intakeProblem.value; return }
  }
  const packagingChecks = []
  if (movementProduct.value.trackingMode === 'unique') {
    for (const code of preview.codes) {
      const captures = packagingCaptures.value[code] || []
      if (!captures.length) continue
      if (!sameBoxConfirmed.value[code]) { movementError.value = '请确认单件码 ' + code + ' 的所有照片来自同一盒，再提交。'; return }
      try {
        const check = createPackagingCheck(movementReference.value, code, captures, { confirmedSameBox: true })
        if (check.status === 'conflict') { movementError.value = '包装文字存在冲突，请核对当前药盒和参考信息；不能提交。'; return }
        packagingChecks.push(check)
      } catch(error) { movementError.value = error.message; return }
    }
    if (incompleteCount.value && !allowIncomplete.value) { movementError.value = '本次有未完全核实的单件，请阅读并确认提示后再提交。'; return }
  }
  submitting.value = true
  try {
    store.recordMovement({ ...movementForm.value, quantity: preview.quantity,
      packagingChecks, ...(movementForm.value.type === 'in' && movementProduct.value.trackingMode === 'unique' ? {referenceFromPackaging:{captures:intakeCaptures.value,confirmedSameBox:true,...(intakeNameConfirmed.value && intakeNameChoice.value ? {confirmedNameCandidate:intakeNameChoice.value} : {})}} : {}), codes: preview.codes, confirmBinding: bindingConfirmed.value, batchId: batchId.value,
      note: movementForm.value.note.trim() })
    submittedPreview.value = preview
    movementSheet.value = false
    notify(movementForm.value.type === 'in' ? '入库成功，库存、单件状态和记录已一起保存' : '出库成功，库存、单件状态和记录已一起保存')
  } catch (error) { movementError.value = error.message || '记录失败，当前库存未更改。' }
  finally { submitting.value = false }
}
function resetFilters(page = tab.value) {
  if (typeof page !== 'string' || !pageStates[page]) page = tab.value
  Object.assign(pageStates[page], { search: '', categoryFilter: 'all', lowStockOnly: false })
}
async function exportData() {
  if (transferBusy.value || scanning.value || storageError.value) return
  transferBusy.value = true
  try {
    const result = await exportInventoryFile(exportInventory(store.state))
    if (!result?.cancelled && result.confirmed !== false) store.markManualBackupExported()
    notify(result?.cancelled ? '已取消导出' : result.confirmed === false ? '已发起下载，请检查浏览器是否保存；尚未记录为成功备份。' : '库存数据已导出为 JSON 文件')
  } catch (error) { store.recordDiagnostic('EXPORT_FAILED'); notify(error.message || '导出失败，请重试。') }
  finally { transferBusy.value = false }
}
async function prepareImport(recover = false) {
  if (transferBusy.value || scanning.value || (storageError.value && !recover)) return
  transferBusy.value = true
  try {
    const content = await importInventoryFile()
    if (content === null) { notify('已取消导入'); transferBusy.value = false; return }
    importPreview.value = parseInventoryImport(content)
    replacePreserved.value = false
    importRecovery.value = !!storageError.value && recover
    importSheet.value = true
  } catch (error) { store.recordDiagnostic('IMPORT_FAILED'); notify(error.message || '导入文件无效，当前数据未更改。'); transferBusy.value = false }
}
function cancelImport() {
  importSheet.value = false
  importPreview.value = null
  importRecovery.value = false
  transferBusy.value = false
}
function confirmImport() {
  if (!importPreview.value || (storageError.value && !importRecovery.value)) return
  try {
    if (storageError.value && importRecovery.value) store.restoreImportedState(importPreview.value, { replacePreserved: replacePreserved.value })
    else store.importState(importPreview.value)
    detailSheet.value = false
    resetFilters()
    notify('导入成功，当前商品和出入库记录已替换')
  } catch (error) { notify(error.message || '导入失败，当前数据未更改。') }
  finally { cancelImport() }
}
function updateSettings(patch) {
  try { store.updateSettings(patch) }
  catch (error) { notify(error.message || '设置未保存，请重试。') }
}
function createRecoveryPoint() {
  if (transferBusy.value || storageError.value) return
  try { store.createRecoveryPoint(); notify('恢复点已保存') }
  catch (error) { notify(error.message || '恢复点保存失败，当前数据未更改。') }
}
function previewRecoveryPoint(id) {
  if (transferBusy.value) return
  try {
    recoveryPreview.value = store.previewRecoveryPoint(id)
    replacePreserved.value = false
    recoverySheet.value = true
  } catch (error) { notify(error.message || '恢复点无法读取，当前数据未更改。') }
}
function cancelRecovery() { recoverySheet.value = false; recoveryPreview.value = null }
function confirmRecovery() {
  if (!recoveryPreview.value || transferBusy.value) return
  transferBusy.value = true
  try {
    store.restoreRecoveryPoint(recoveryPreview.value.id, { replacePreserved: replacePreserved.value })
    detailSheet.value = false
    resetFilters()
    notify('恢复成功，当前商品和记录已替换')
    cancelRecovery()
  } catch (error) { notify(error.message || '恢复失败，当前数据未更改。') }
  finally { transferBusy.value = false }
}
async function exportRawData(preserved = false) {
  if (transferBusy.value) return
  transferBusy.value = true
  try {
    const content = preserved ? store.exportPreservedRawData() : store.exportRawData()
    if (content === null) { notify('没有可导出的原始数据'); return }
    const archive = JSON.stringify({ format: 'inventory-app-raw', version: 1, exportedAt: new Date().toISOString(), raw: content })
    const result = await exportRawInventoryFile(archive)
    if (!result?.cancelled && result.confirmed !== false) store.recordDiagnostic('EXPORT_SUCCEEDED')
    notify(result?.cancelled ? '已取消导出' : result.confirmed === false ? '已发起原文下载，请检查保存结果。' : '原始数据已导出，未修改本机记录')
  } catch (error) { store.recordDiagnostic('EXPORT_FAILED'); notify(error.message || '原始数据导出失败，请重试。') }
  finally { transferBusy.value = false }
}
async function exportDiagnostics() {
  if (transferBusy.value) return
  transferBusy.value = true
  try {
    const result = await exportDiagnosticFile(JSON.stringify(store.getDiagnosticReport(), null, 2))
    if (!result?.cancelled && result.confirmed !== false) store.recordDiagnostic('EXPORT_SUCCEEDED')
    notify(result?.cancelled ? '已取消导出' : result.confirmed === false ? '已发起日志下载，请检查保存结果。' : '诊断日志已导出')
  } catch (error) { store.recordDiagnostic('EXPORT_FAILED'); notify(error.message || '诊断日志导出失败，请重试。') }
  finally { transferBusy.value = false }
}
</script>

<template>
  <div class="app-shell" :class="{ 'reduced-motion': store.settings.reduceMotion }">
    <aside class="desktop-rail">
      <a class="brand" href="#" @click.prevent="navigateTo('products')" aria-label="简库存首页">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.7"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.2 8 4.5" stroke="currentColor" stroke-width="1.7"/></svg></span>
        <span>简库存<small>本机库存管理</small></span>
      </a>
      <nav class="rail-nav" aria-label="主导航">
        <button v-for="item in [{ id: 'products', label: '商品', icon: 'apps-o' }, { id: 'stock', label: '库存', icon: 'orders-o' }, { id: 'history', label: '记录', icon: 'clock-o' }]" :key="item.id" :class="{ active: tab === item.id }" @click="navigateTo(item.id)" :aria-current="tab === item.id ? 'page' : undefined"><van-icon :name="item.icon" /><span>{{ item.label }}</span></button>
      </nav>
      <div class="rail-note"><span class="connection-dot"></span> 本机保存<small>简单记录，安心管理</small></div>
    </aside>

    <div class="main-layout">
      <header class="mobile-brand"><span class="mini-mark"><van-icon name="apps-o" /></span><span>简库存</span><button class="backup-entry" aria-label="打开设置与备份" @click="backupSheet = true"><van-icon name="setting-o" />设置</button></header>
      <button v-if="store.recovery.warning && !storageError" class="recovery-status" @click="backupSheet = true"><van-icon name="warning-o" />本机备份需要检查 · 打开设置查看</button>
      <HomePager :model-value="tab" :blocked="pagerBlocked" :reduce-motion="store.settings.reduceMotion" @navigate="navigateTo" @motion="pagerMotion = $event"><template #default="{ page }"><main class="refined-main">
        <div class="page-heading">
          <div><h1>{{ pageTitles[page] }}</h1><p class="page-subtitle">{{ pageDescriptions[page] }}</p></div><button class="backup-entry desktop-backup" aria-label="打开设置与备份" @click="backupSheet = true"><van-icon name="setting-o" />设置与备份</button>
          <button v-if="page === 'products' && products.length" class="button button-primary desktop-add" :disabled="!!storageError || transferBusy" @click="openProduct()"><van-icon name="plus" />新增商品</button>
          <div v-if="page === 'stock'" class="heading-actions"><button class="button button-secondary" :disabled="!!storageError || transferBusy || !products.length" @click="openMovement('out')"><van-icon name="minus" />出库</button><button class="button button-primary" :disabled="!!storageError || transferBusy || !products.length" @click="openMovement('in')"><van-icon name="plus" />入库</button></div>
        </div>

        <div v-if="storageError" class="storage-alert" role="alert"><van-icon name="warning-o" /><div><strong>暂时无法使用本机数据</strong><p>{{ storageError }}</p><p>为保护现有记录，新增、修改和出入库暂不可用。</p><button class="button button-secondary" @click="backupSheet = true">查看恢复选项</button></div></div>

        <section v-if="page !== 'history' && products.length" class="inventory-strip" aria-label="库存概览"><div><span>商品</span><strong>{{ products.length }}</strong><small>种</small></div><div><span>有库存</span><strong>{{ inStockCount }}</strong><small>种</small></div><button :class="{ warning: lowStockCount, active: pageStates[page].lowStockOnly }" :aria-pressed="pageStates[page].lowStockOnly" aria-label="切换低库存筛选" @click="pageStates[page].lowStockOnly = !pageStates[page].lowStockOnly"><span>低库存</span><strong>{{ lowStockCount }}</strong><small>种</small><van-icon name="arrow" /></button></section>
        <section v-if="page === 'products' || page === 'stock'" class="content-panel">
          <div class="panel-toolbar"><h2>{{ page === 'products' ? '商品列表' : '库存清单' }}<span>{{ pageProducts[page].length }}</span></h2><div class="lookup-tools"><button class="button button-secondary scan-lookup" :disabled="scanning || !!storageError || transferBusy" :aria-busy="scanning" aria-label="扫码查找商品" @click="startScan()"><van-icon name="scan" />{{ scanning ? '扫码中…' : '扫码' }}</button><div v-if="products.length" class="search-field"><van-icon name="search" /><input v-model="pageStates[page].search" type="search" aria-label="搜索商品名称、编号、条码或分类" placeholder="搜索商品、编号或条码" /><button v-if="pageStates[page].search" class="search-clear" aria-label="清空搜索" @click="pageStates[page].search = ''"><van-icon name="cross" /></button></div></div></div>
          <details v-if="products.length" class="catalog-filter-drawer" :open="pageStates[page].filtersOpen" @toggle="pageStates[page].filtersOpen = $event.target.open"><summary><van-icon name="filter-o" />筛选<span>{{ pageStates[page].categoryFilter === 'all' ? '全部分类' : pageStates[page].categoryFilter === 'uncategorized' ? '未分类' : pageStates[page].categoryFilter.slice(9) }}{{ pageStates[page].lowStockOnly ? ' · 低库存' : '' }}</span><van-icon name="arrow-down" /></summary><div class="catalog-filters"><label>分类<select v-model="pageStates[page].categoryFilter" aria-label="筛选商品分类"><option value="all">全部分类</option><option value="uncategorized">未分类</option><option v-for="category in categories" :key="category" :value="'category:' + category">{{ category }}</option></select></label><label class="low-stock-toggle"><input v-model="pageStates[page].lowStockOnly" type="checkbox" />只看低库存</label><button v-if="pageStates[page].search || pageStates[page].categoryFilter !== 'all' || pageStates[page].lowStockOnly" class="text-button" @click="resetFilters(page)">重置筛选</button></div></details>
          <div v-if="storageError" class="empty-state compact"><van-icon name="shield-o" class="empty-icon" /><h3>现有记录已暂停读取</h3><p>请在设置中导出原始数据，<br />再从恢复点或备份文件恢复。</p><button class="button button-secondary" @click="backupSheet = true">打开设置与备份</button></div>
          <div v-else-if="!products.length" class="empty-state"><div class="empty-illustration"><svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="17" y="33" width="66" height="49" rx="9" fill="#e8f2f3"/><path d="M19 36 50 20l31 16-31 17-31-17Z" fill="#d0e6e7"/><path d="M50 53v28M34 29l31 17" stroke="#7baeb0" stroke-width="2"/><rect x="60" y="64" width="25" height="25" rx="12.5" fill="#1d8a7a"/><path d="M72.5 70v13m-6.5-6.5h13" stroke="white" stroke-width="2" stroke-linecap="round"/></svg></div><h3>从第一件商品开始</h3><p>添加商品信息，再记录入库数量。<br />商品和库存变化会保存在这台设备上。</p><button class="button button-primary" :disabled="!!storageError || transferBusy" @click="openProduct()"><van-icon name="plus" />添加第一件商品</button></div>
          <div v-else-if="!pageProducts[page].length" class="empty-state compact"><van-icon name="search" class="empty-icon" /><h3>没有找到相关商品</h3><p>调整搜索、分类或低库存筛选试试。</p><button class="text-button" @click="resetFilters(page)">重置筛选</button></div>
          <div v-else class="product-list">
            <div class="list-column-labels"><span>商品信息</span><span>当前库存</span><span>{{ page === 'stock' ? '库存操作' : '' }}</span></div>
            <article v-for="product in pageProducts[page]" :key="product.id" class="product-row">
              <button class="product-identity" @click="openDetail(product)" :aria-label="`查看商品 ${product.name}`"><span class="product-avatar">{{ product.name.slice(0, 1) }}</span><span class="product-text"><strong>{{ product.name }}</strong><small v-if="product.specification || product.sku">{{ product.specification || `编号 ${product.sku}` }}</small><small v-else>{{ productTypeLabel(product) }} · {{ product.unit }}</small><small v-if="product.category" class="category-label">{{ product.category }}</small></span></button>
              <div class="stock-number" :class="{ 'zero-stock': product.stock === 0 }"><strong>{{ product.stock.toLocaleString('zh-CN') }}</strong><span>{{ product.unit }}</span><small v-if="isLowStock(product)" class="low-stock-badge">低库存</small><small v-else-if="product.stock === 0">暂无库存</small></div>
              <div v-if="page === 'stock'" class="row-actions"><button class="small-button stock-out" :disabled="!!storageError || transferBusy || product.stock === 0" @click="openMovement('out', product)" :aria-label="`${product.name} 出库`">出库</button><button class="small-button stock-in" :disabled="!!storageError || transferBusy" @click="openMovement('in', product)" :aria-label="`${product.name} 入库`">入库</button></div>
              <button v-else class="row-detail" @click="openDetail(product)" :aria-label="`${product.name} 商品详情`"><span>查看详情</span><van-icon name="arrow" /></button>
            </article>
          </div>
        </section>

        <section v-if="page === 'history'" class="content-panel history-panel">
          <div class="panel-toolbar"><h2>历史记录<span>{{ movements.length }}</span></h2><div class="filter-group" aria-label="筛选出入库类型"><button v-for="item in [{ id: 'all', name: '全部' }, { id: 'in', name: '入库' }, { id: 'out', name: '出库' }]" :key="item.id" :class="{ active: historyFilter === item.id }" @click="historyFilter = item.id" :aria-pressed="historyFilter === item.id">{{ item.name }}</button></div></div>
          <div v-if="!filteredMovements.length" class="empty-state"><div class="empty-icon-wrap"><van-icon name="clock-o" /></div><h3>{{ movements.length ? '暂无此类记录' : '还没有出入库记录' }}</h3><p>{{ movements.length ? '切换筛选，查看其他库存变化。' : '完成一次入库或出库后，记录会显示在这里。' }}</p><button v-if="!movements.length" class="button button-secondary" @click="navigateTo('stock')">前往库存</button></div>
          <div v-else class="history-list"><article v-for="movement in filteredMovements" :key="movement.id" class="history-row"><span class="movement-icon" :class="movement.type"><van-icon :name="movement.type === 'in' ? 'down' : 'up'" /></span><div class="movement-content"><div class="movement-title"><strong>{{ movement.productName }}</strong><span class="movement-tag" :class="movement.type">{{ movement.type === 'in' ? '入库' : '出库' }}</span></div><p class="movement-meta">{{ formatDate(movement.createdAt, true) }}<span v-if="movement.productSku"> · {{ movement.productSku }}</span></p><p v-if="movement.note" class="movement-note">{{ movement.note }}</p><p class="stock-change">库存 {{ movement.beforeStock }} → {{ movement.afterStock }} {{ movement.unit }}</p><p v-if="movement.codes?.length" class="movement-meta">本次包装文字一致 {{ (movement.packagingChecks || []).filter(check => check.status === 'matched').length }} / {{ movement.codes.length }} 件<span v-if="(movement.packagingChecks || []).filter(check => check.status === 'matched').length < movement.codes.length">，其余未完全核实</span></p><details v-if="movement.packagingChecks?.length" class="history-codes"><summary>查看本次包装校验</summary><div v-for="check in movement.packagingChecks" :key="check.unitCode"><p>{{ check.unitCode }} · {{ packagingStatusLabels[check.status] }}</p><p>参考：{{ check.expected.name }} / {{ check.expected.specification }} / {{ check.expected.manufacturer }}</p><p v-for="capture in check.captures" :key="capture.id">{{ capture.text }}</p></div></details><details v-if="movement.codes?.length" class="history-codes"><summary>查看 {{ movement.codes.length }} 个单件码</summary><p v-for="code in movement.codes" :key="code">{{ code }}</p></details></div><div class="movement-quantity" :class="movement.type"><strong>{{ movement.type === 'in' ? '+' : '−' }}{{ movement.quantity.toLocaleString('zh-CN') }}</strong><span>{{ movement.unit }}</span></div></article></div>
        </section>

        <footer class="data-footer"><van-icon name="shield-o" /><p>本机保存 · 随时可备份</p></footer>
      </main></template></HomePager>
      <div class="screen-reader-only" role="status" aria-live="polite">{{ status }}</div>
    </div>


    <van-popup v-model:show="backupSheet" position="bottom" round :close-on-click-overlay="!transferBusy" :closeable="!transferBusy" class="sheet-popup settings-popup" aria-label="设置与备份"><header class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>设置与备份</h2><p>本机数据、文件备份与恢复。</p></header><SettingsPanel :version="appVersion" :settings="store.settings" :recovery="store.recovery" :storage-error="storageError" :busy="transferBusy || scanning" @update-settings="updateSettings" @export="exportData" @import="prepareImport(false)" @recover-import="prepareImport(true)" @create-point="createRecoveryPoint" @preview-point="previewRecoveryPoint" @export-raw="exportRawData(false)" @export-preserved="exportRawData(true)" @export-diagnostics="exportDiagnostics" /></van-popup>
    <van-popup v-model:show="recoverySheet" position="bottom" round :closeable="!transferBusy" :close-on-click-overlay="!transferBusy" class="sheet-popup" aria-label="确认恢复本机数据" @closed="cancelRecovery"><header class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>恢复点预览</h2><p>确认覆盖前，请核对恢复时间与记录数量。</p></header><RecoveryPreview v-if="recoveryPreview" :point="recoveryPreview" v-model:replace-preserved="replacePreserved" :preserved-raw="store.recovery.preservedRawAvailable" :current="{ products: products.length, movements: movements.length, units: units.length }" :storage-error="storageError" :busy="transferBusy" @cancel="cancelRecovery" @confirm="confirmRecovery" /></van-popup>
    <nav class="bottom-nav" :style="{'--page-progress': pagerMotion.progress, '--motion-duration': pagerMotion.duration + 'ms'}" aria-label="底部导航"><span class="nav-indicator" aria-hidden="true"></span><button v-for="item in [{ id: 'products', label: '商品', icon: 'apps-o' }, { id: 'stock', label: '库存', icon: 'orders-o' }, { id: 'history', label: '记录', icon: 'clock-o' }]" :key="item.id" :class="{ active: tab === item.id }" @click="navigateTo(item.id)" :aria-current="tab === item.id ? 'page' : undefined"><van-icon :name="item.icon" /><span>{{ item.label }}</span></button></nav>

    <van-popup v-model:show="productSheet" position="bottom" round :closeable="!productOcrBusy && !scanning" class="sheet-popup" :close-on-click-overlay="false" aria-label="商品信息表单">
      <div class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>{{ editingId ? '编辑商品' : '新增商品' }}</h2><p>{{ editingId ? '更新商品资料，库存数量保持不变。' : '先建立商品档案，初始库存为 0。' }}</p></div>
      <form class="sheet-form" @submit.prevent="saveProduct"><section class="product-photo-card" aria-label="包装信息自动填写"><h3>拍包装，自动填写商品信息</h3><p>拍清药名、规格和厂家，可翻面补拍。唯一候选会自动填入，仍需对照包装核对；多个候选请点选。</p><button type="button" class="button button-primary" @click="captureProductFace" :disabled="productOcrBusy || scanning || productOcrCaptures.length >= 6" :aria-busy="productOcrBusy"><van-icon name="photograph" />{{ productOcrBusy ? '正在识别…' : productOcrCaptures.length ? '翻面补拍信息' : '拍摄包装' }}</button><OcrFieldPicker v-if="productOcrCaptures.length" :fields="productOcrFields" :captures="productOcrCaptures" :selected="productForm" :automatic="productOcrAutomatic" :disabled="productOcrBusy" @select="useOcrCandidate" /><button v-if="productOcrCaptures.length" type="button" class="text-button" :disabled="productOcrBusy" @click="resetProductOcr">清除识别原文后重拍</button></section><fieldset class="movement-fields" :disabled="productOcrBusy || scanning">
        <label class="form-field"><span>商品名称 <em>*</em></span><input v-model="productForm.name" name="product-name" placeholder="例如：一次性检查手套" maxlength="80" autocomplete="off" required /><small>{{ productForm.name.length }}/80</small></label>
        <div class="form-grid"><label class="form-field"><span>商品编号</span><input v-model="productForm.sku" name="product-sku" placeholder="选填，例如 SKU001" maxlength="40" autocomplete="off" /></label><label class="form-field"><span>计量单位 <em>*</em></span><input v-model="productForm.unit" name="product-unit" placeholder="例如：件" maxlength="12" required /></label></div>
        <div class="form-field"><label for="product-barcode" class="barcode-label">商品条码</label><div class="barcode-input"><input id="product-barcode" v-model="productForm.barcode" name="product-barcode" type="text" placeholder="选填，扫描或手动输入" maxlength="80" autocomplete="off" :disabled="scanning" /><button type="button" class="button button-secondary" :disabled="scanning || !!storageError || transferBusy" :aria-busy="scanning" aria-label="扫码填写商品条码" @click="startScan('form')"><van-icon name="scan" />{{ scanning ? '扫码中' : '扫码' }}</button></div><small class="barcode-help">条码与商品编号分别保存，支持前导 0。{{ productForm.barcode.length }}/80</small></div>
        <label class="form-field"><span>包装规格（自动提取，可校正）</span><input v-model="productForm.specification" name="product-specification" maxlength="120" placeholder="例如 0.25g×24粒" /><small class="barcode-help">按包装完整填写；数字、单位不同应视为冲突。</small></label>
        <label class="form-field"><span>生产厂家（自动提取，可校正）</span><input v-model="productForm.manufacturer" name="product-manufacturer" maxlength="120" placeholder="按包装填写完整企业名称" /><small class="barcode-help">拍摄后自动填写；没有识别到时请翻面补拍。</small></label>
        <label class="form-field"><span>商品类型 <em>*</em></span><select v-model="productForm.productType" name="product-type" @change="setProductType"><option value="unknown" disabled>请人工确认商品类型</option><option value="ordinary">普通商品</option><option value="medicine">药品（每盒唯一追踪）</option></select><small class="barcode-help">条码本身不能判断是否为药品，请根据实际包装选择。</small></label>
        <label class="form-field"><span>库存管理方式</span><select v-model="productForm.trackingMode" name="product-tracking" :disabled="productForm.productType === 'medicine'"><option value="quantity">仅管理数量</option><option value="unique">每件唯一身份</option></select><small class="barcode-help">药品使用唯一单件码。切换管理方式须库存为 0 且尚未建立单件档案。</small></label>
        <label class="form-field"><span>商品分类</span><input v-model="productForm.category" name="product-category" maxlength="40" placeholder="选填，例如药品、耗材" list="category-suggestions" /><datalist id="category-suggestions"><option v-for="category in categories" :key="category" :value="category" /></datalist></label>
        <label class="form-field"><span>低库存阈值</span><input v-model="productForm.lowStockThreshold" name="product-threshold" type="text" inputmode="numeric" placeholder="留空关闭提醒，例如 5" /><small class="barcode-help">库存小于或等于阈值时提醒；0 表示仅在缺货时提醒。</small></label>
        <label class="form-field"><span>备注</span><textarea v-model="productForm.note" name="product-note" placeholder="选填，记录规格或其他说明" maxlength="300" rows="3"></textarea><small>{{ productForm.note.length }}/300</small></label>
        <p v-if="formError" class="form-error" role="alert"><van-icon name="warning-o" />{{ formError }}</p>
        <div class="form-actions"><button type="button" class="button button-secondary" @click="productSheet = false">取消</button><button type="submit" class="button button-primary" :disabled="!!storageError || scanning">{{ editingId ? '保存修改' : productOcrCaptures.length && productForm.trackingMode === 'unique' ? '保存并继续入库' : '保存商品' }}</button></div></fieldset>
      </form>
    </van-popup>

    <van-popup v-model:show="movementSheet" position="bottom" round :closeable="!batchScanning && !submitting && !ocrBusy" class="sheet-popup" :close-on-click-overlay="false" aria-label="出入库表单">
      <div class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><span class="sheet-kicker">{{ movementForm.type === 'in' ? '拍包装 → 扫单件码 → 确认入库' : '选单件 → 核对 → 确认出库' }}</span><h2>记录{{ movementForm.type === 'in' ? '入库' : '出库' }}</h2><p>药品入库先拍当前盒包装，信息自动提取；确认提交后才改变库存。</p></div>
      <form class="sheet-form" @submit.prevent="saveMovement">
        <fieldset :disabled="batchScanning || submitting || ocrBusy" class="movement-fields">
        <div class="movement-switch" aria-label="出入库类型"><button type="button" :class="{ active: movementForm.type === 'in' }" @click="movementForm.type = 'in'" :aria-pressed="movementForm.type === 'in'">入库 / 回库</button><button type="button" :class="{ active: movementForm.type === 'out' }" @click="movementForm.type = 'out'" :aria-pressed="movementForm.type === 'out'">出库</button></div>
        <label class="form-field"><span>选择商品 <em>*</em></span><select v-model="movementForm.productId" name="movement-product" required><option value="" disabled>请选择商品</option><option v-for="product in products" :key="product.id" :value="product.id">{{ product.name }}{{ product.sku ? ' · ' + product.sku : '' }}</option></select></label>
        <div v-if="movementProduct" class="current-stock"><span>{{ productTypeLabel(movementProduct) }} · 当前库存</span><strong>{{ movementProduct.stock }} <small>{{ movementProduct.unit }}</small></strong></div>
        <div v-if="movementProduct?.productType === 'unknown'" class="type-confirm"><p>条码不能判断是否为药品。请确认一次并保存商品类型。</p><div class="form-actions"><button type="button" class="button button-secondary" @click="classifyMovementProduct('ordinary')">普通商品</button><button type="button" class="button button-secondary" @click="classifyMovementProduct('medicine')">药品 · 唯一追踪</button></div><small>原有数量库存无法直接转换为单件码；先出库归零，再编辑管理方式。</small></div>
        <template v-else-if="movementProduct">
          <template v-if="movementProduct.trackingMode !== 'unique'">
            <label class="form-field"><span>记录方式</span><select v-model="movementMode" name="movement-mode"><option value="manual">手动输入数量</option><option value="single">连续单件扫描</option><option value="multiple">同画面多码计数</option></select></label>
            <div v-if="movementMode !== 'manual'" class="scan-mode-note"><p>{{ movementMode === 'multiple' ? '适合整排、条码同向且无遮挡的商品。只统计当前画面，不跨帧累加；漏扫请改用手动数量。' : '适合散件。每件都需确认计数，同一码重新出现不会自动判定为新的一件。' }}</p><button type="button" class="button button-secondary" :disabled="!movementProduct.barcode" @click="scanMovementBatch">开始{{ movementMode === 'multiple' ? '多码计数' : '连续扫描' }}</button><small v-if="!movementProduct.barcode">请先编辑商品并绑定商品条码。</small></div>
            <label class="form-field"><span>待确认{{ movementForm.type === 'in' ? '入库' : '出库' }}数量 <em>*</em></span><div class="quantity-input"><input v-model="movementForm.quantity" name="movement-quantity" type="number" inputmode="numeric" min="1" step="1" placeholder="核对实物后填写正整数" required /><span>{{ movementProduct.unit }}</span></div></label>
          </template>
          <template v-else>
            <section v-if="movementForm.type === 'in'" class="intake-photo" aria-label="入库拍照提取信息"><h3><span>1</span>拍当前盒包装</h3><p>对准药名、规格和厂家，记录包装原文；不同面可补拍。已有药名会与完整文字行匹配，无标签的规格和厂家暂作候选，需人工核对。</p><button type="button" class="button button-primary" @click="captureIntakeFace" :disabled="intakeCaptures.length >= 6"><van-icon name="photograph" />{{ intakeCaptures.length ? '翻面补拍关键信息' : '拍包装，自动提取' }}</button><div v-if="intakeCaptures.length" class="extracted-fields"><div v-for="(field,key) in intakeFields" :key="key"><span>{{ fieldLabels[key] }}</span><strong>{{ field.value || (field.suggestions || []).join(' / ') || extractionLabels[field.status] }}</strong><small :class="field.status">{{ extractionLabels[field.status] }}</small></div></div><label v-if="intakeNameChoice && intakeFields.name.status !== 'recognized'" class="ocr-name-confirm"><input v-model="intakeNameConfirmed" type="checkbox" />我已对照包装，确认清理后的药名为「{{ movementProduct.name }}」<small>这是人工核对；包装文字仍可能标记为未完全核实。</small></label><p v-if="intakeProblem" class="form-error">{{ intakeProblem }}</p><p v-if="intakeUnitCode" class="batch-help">本次照片对应：{{ intakeUnitCode }}。其他盒需分别补拍，未拍不会记为已核实。</p><details v-if="intakeCaptures.length" class="intake-original"><summary>查看拍摄原文 · {{ intakeCaptures.length }} 面</summary><p v-for="capture in intakeCaptures" :key="capture.id">{{ capture.text }}</p></details><button v-if="intakeCaptures.length" type="button" class="text-button" @click="resetIntakePhoto">清除本盒照片文字并重新拍摄</button></section><h3 class="flow-step"><span>{{ movementForm.type === 'in' ? '2' : '1' }}</span>{{ movementForm.type === 'in' ? '扫描当前盒单件码' : '选择在库单件码' }}</h3>
            <div class="scan-mode-note"><p>每个唯一单件码对应一件实物。已在库码不能再次入库；已出库码可回库；出库只接受当前商品的在库码。</p><button type="button" class="button button-secondary" @click="scanMovementBatch">连续扫描单件码</button></div>
            <label class="form-field"><span>待提交单件码（每行一个）</span><textarea v-model="batchCodeText" name="movement-codes" rows="4" placeholder="扫描或逐行输入追溯码 / 实例码，保留前导零" spellcheck="false"></textarea><small class="barcode-help">本地唯一性不能验证药品真伪，也不能自动证明该码属于当前商品。</small></label>
            <button v-if="movementProduct.productType !== 'medicine' && movementForm.type === 'in'" type="button" class="text-button" @click="generateLocalCode">为当前实物生成本地实例码</button>
            <p v-if="movementProduct.productType !== 'medicine'" class="batch-help">生成的 LOCAL 码需自行贴到对应实物上保存；不是药品追溯码。</p>
            <div v-if="batchCodes.length" class="pending-codes"><strong>待提交 {{ batchCodes.length }} 件</strong><div v-for="(code, index) in batchCodes" :key="index"><code>{{ code }}</code><button type="button" class="ocr-unit-button" @click="selectOcrUnit(code)">{{ packagingStatusLabels[packagingPreviews[code]?.status] || '未核实' }} · 翻面 OCR</button><button type="button" :aria-label="'移除单件码 ' + code" @click="removeBatchCode(index)">移除</button></div></div>
            <section v-if="ocrUnitCode && batchCodes.includes(ocrUnitCode)" class="ocr-panel" aria-label="当前单件多面 OCR 校验">
              <h3 class="flow-step"><span>{{ movementForm.type === 'in' ? '3' : '2' }}</span>核对当前这一盒</h3><p class="ocr-current-code">{{ ocrUnitCode }}</p><p>保持同一盒，拍清名称、规格和厂家；它们可以分布在不同面。完成当前盒后，再选择下一件。</p>
              <div class="ocr-reference"><strong>参考信息</strong><span>名称：{{ movementProduct.name }}</span><span>规格：{{ movementReference.specification || '请翻面补拍' }}</span><span>厂家：{{ movementReference.manufacturer || '请翻面补拍' }}</span></div>
              <button type="button" class="button button-secondary" @click="captureBoxFace">{{ selectedCaptures.length ? '翻面并补拍文字' : '拍摄包装文字' }}</button>
              <article v-for="(capture, index) in selectedCaptures" :key="capture.id" class="ocr-capture"><strong>第 {{ index + 1 }} 面</strong><pre>{{ capture.text }}</pre><button type="button" class="text-button" @click="removePackagingCapture(ocrUnitCode, index)">移除这一面，重新拍摄</button></article>
              <div v-if="selectedPackaging && !selectedPackaging.error" class="ocr-fields"><div v-for="(field, key) in selectedPackaging.fields" :key="key"><strong>{{ fieldLabels[key] }}</strong><span :class="field.status">{{ fieldStatusLabels[field.status] }}</span><small v-if="field.observed?.length">识别：{{ field.observed.join(' / ') }}</small></div><p :class="selectedPackaging.status">{{ packagingStatusLabels[selectedPackaging.status] }}。未识别的字段不能当作一致，信息冲突时禁止提交。</p></div>
              <p v-if="selectedPackaging?.error" class="form-error">{{ selectedPackaging.error }}</p>
              <label v-if="selectedCaptures.length" class="ocr-confirm"><input v-model="sameBoxConfirmed[ocrUnitCode]" type="checkbox" name="same-box-confirm" />我确认这些文字来自同一盒，且对应当前单件码；翻面过程中未换盒。</label>
            </section>
            <label v-if="batchCodes.length && incompleteCount && !hasPackagingConflict" class="ocr-incomplete-confirm"><input v-model="allowIncomplete" type="checkbox" name="allow-incomplete" />本次 {{ incompleteCount }} 件未完全核实，我已人工核对并知晓；记录将保留未核实状态。</label>
            <div v-if="batchPreview.requiresBindingConfirmation" class="binding-confirm"><p>新绑定 {{ batchPreview.newCodes.length }} 件；已出库回库 {{ batchPreview.returnCodes.length }} 件。</p><label><input v-model="bindingConfirmed" type="checkbox" name="binding-confirm" />我已核对包装，确认这些新单件码属于「{{ movementProduct.name }}」</label></div>
          </template>
          <p v-if="!batchPreview.error" class="batch-preview">待提交：{{ movementForm.type === 'in' ? '+' : '−' }}{{ batchPreview.quantity }} {{ movementProduct.unit }} · 提交前库存不变</p>
          <p v-else-if="batchCodes.length || movementForm.quantity" class="form-error" role="alert">{{ batchPreview.error }}</p>
          <label class="form-field"><span>备注</span><textarea v-model="movementForm.note" name="movement-note" maxlength="300" rows="2" placeholder="选填，记录本次库存变更原因"></textarea></label>
        </template>
        <p v-if="movementError" class="form-error" role="alert">{{ movementError }}</p>
        <div class="form-actions"><button type="button" class="button button-secondary" @click="movementSheet = false">取消</button><button type="submit" class="button button-primary" :disabled="!!storageError || transferBusy || !products.length || movementProduct?.productType === 'unknown'">确认{{ movementForm.type === 'in' ? '入库' : '出库' }}</button></div>
        </fieldset><p v-if="batchScanning || submitting || ocrBusy" class="batch-help" role="status">{{ ocrBusy ? '正在拍摄包装文字，请保持同一盒…' : batchScanning ? '正在扫描，取消扫描不会改变库存…' : '正在保存…' }}</p>
      </form>
    </van-popup>

    <van-popup v-model:show="importSheet" position="bottom" round closeable class="sheet-popup" aria-label="确认导入库存数据" @closed="cancelImport"><div class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>{{ importRecovery ? '从文件恢复本机数据' : '确认覆盖当前数据' }}</h2><p>{{ importRecovery ? '当前原始内容会先另存保护，再用此备份文件恢复；保护失败时不会覆盖。' : '导入会替换本机全部商品和出入库记录，不会与当前数据合并。请先导出当前数据留存。' }}</p></div><div v-if="importPreview" class="detail-body"><div class="import-counts"><div><span>{{ importRecovery ? '将恢复' : '将导入' }}</span><strong>{{ importPreview.products.length }} 种商品 · {{ importPreview.movements.length }} 笔记录 · {{ importPreview.units?.length || 0 }} 个单件档案</strong></div><div><span>当前本机</span><strong v-if="importRecovery">原始数据读取异常，无法可靠统计</strong><strong v-else>{{ products.length }} 种商品 · {{ movements.length }} 笔记录</strong></div></div><p class="import-warning">确认后当前数据将被完整替换；取消不会更改任何记录。</p><label v-if="importRecovery && store.recovery.preservedRawAvailable" class="archive-confirm"><input type="checkbox" v-model="replacePreserved" />我已导出并留存之前的异常原文，同意用本次原文替换本机保护副本（仅保留一份）。</label><div class="form-actions"><button class="button button-secondary" @click="cancelImport">{{ importRecovery ? '取消恢复' : '取消导入' }}</button><button class="button button-danger" :disabled="(!!storageError && !importRecovery) || (importRecovery && store.recovery.preservedRawAvailable && !replacePreserved)" @click="confirmImport">{{ importRecovery ? '确认保护原文并恢复' : '确认覆盖并导入' }}</button></div></div></van-popup>
    <van-popup v-model:show="unknownSheet" position="bottom" round closeable class="sheet-popup" aria-label="未找到条码对应商品">
      <div class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>尚未登记这个条码</h2><p>本机商品中没有对应条码。你可以建立商品档案，库存不会自动变化。已有商品请取消后打开商品详情，在编辑中绑定条码。</p></div>
      <div class="detail-body"><div class="unknown-barcode"><span>扫描结果</span><strong>{{ unknownBarcode }}</strong></div><div class="form-actions"><button type="button" class="button button-secondary" @click="unknownSheet = false">取消</button><button type="button" class="button button-primary" :disabled="!!storageError || transferBusy" @click="addScannedProduct">新增商品并填入条码</button></div></div>
    </van-popup>

    <van-popup v-model:show="detailSheet" position="bottom" round closeable class="sheet-popup detail-popup" aria-label="商品详情">
      <template v-if="detailProduct"><div class="sheet-header"><button type="button" class="sheet-back" aria-label="返回上一级" @click="handleBack"><van-icon name="arrow-left" /></button><h2>商品详情</h2></div><div class="detail-body"><div class="detail-product"><span class="product-avatar large">{{ detailProduct.name.slice(0, 1) }}</span><div><h3>{{ detailProduct.name }}</h3><p>{{ detailProduct.sku ? `编号 ${detailProduct.sku}` : '未设置商品编号' }}</p></div></div><div class="detail-stock"><span>当前库存</span><strong>{{ detailProduct.stock.toLocaleString('zh-CN') }}<small>{{ detailProduct.unit }}</small></strong><div class="detail-stock-actions"><button class="button button-secondary" :disabled="!!storageError || transferBusy || detailProduct.stock === 0" @click="openMovement('out', detailProduct)">出库</button><button class="button button-primary" :disabled="!!storageError || transferBusy" @click="openMovement('in', detailProduct)">入库</button></div></div><dl class="detail-meta"><div><dt>包装规格</dt><dd>{{ detailProduct.specification || '未配置 OCR 参考' }}</dd></div><div><dt>生产厂家</dt><dd>{{ detailProduct.manufacturer || '未配置 OCR 参考' }}</dd></div><div><dt>商品类型</dt><dd>{{ productTypeLabel(detailProduct) }} · {{ detailProduct.trackingMode === 'unique' ? '每件唯一身份' : '仅管理数量' }}</dd></div><div><dt>分类</dt><dd>{{ detailProduct.category || '未分类' }}</dd></div><div><dt>低库存阈值</dt><dd>{{ detailProduct.lowStockThreshold == null ? '提醒关闭' : detailProduct.lowStockThreshold + ' ' + detailProduct.unit }}<span v-if="isLowStock(detailProduct)" class="low-stock-badge"> · 当前低库存</span></dd></div><div><dt>商品条码</dt><dd class="barcode-value">{{ detailProduct.barcode || '未设置条码' }}</dd></div><div><dt>备注</dt><dd>{{ detailProduct.note || '暂无备注' }}</dd></div><div><dt>创建时间</dt><dd>{{ formatDate(detailProduct.createdAt, true) }}</dd></div><div><dt>更新时间</dt><dd>{{ formatDate(detailProduct.updatedAt, true) }}</dd></div></dl><section v-if="detailProduct.trackingMode === 'unique'" class="unit-ledger"><h3>单件档案</h3><p>在库 {{ detailUnits.filter(unit => unit.status === 'in').length }} 件 · 已出库 {{ detailUnits.filter(unit => unit.status === 'out').length }} 件</p><div v-for="unit in detailUnits" :key="unit.code"><code>{{ unit.code }}</code><span :class="unit.status">{{ unit.status === 'in' ? '在库' : '已出库' }}</span><details v-if="unit.packagingCheck" class="unit-packaging"><summary>上次包装校验：{{ packagingStatusLabels[unit.packagingCheck.status] }}</summary><p>{{ formatDate(unit.packagingCheck.checkedAt, true) }} · 按当时参考信息校验</p><div v-for="(field, key) in unit.packagingCheck.fields" :key="key">{{ fieldLabels[key] }}：{{ fieldStatusLabels[field.status] }}</div><p v-for="capture in unit.packagingCheck.captures" :key="capture.id">{{ capture.text }}</p></details><small v-else class="unit-packaging">包装文字未核实</small></div><p v-if="!detailUnits.length">尚未登记单件码。</p></section><div class="detail-bottom-actions"><button class="button button-secondary" :disabled="!!storageError || transferBusy" @click="editDetail"><van-icon name="edit" />编辑商品</button><button class="button button-danger" :disabled="!!storageError || transferBusy || detailProduct.stock > 0 || detailUnits.length > 0" @click="removeProduct"><van-icon name="delete-o" />删除商品</button></div><p v-if="detailProduct.stock > 0 || detailUnits.length" class="delete-help">有库存或已建立单件档案的商品不能删除。</p></div></template>
    </van-popup>
  </div>
</template>

<style scoped>
.nav-indicator{transform:translateX(calc(var(--page-progress,0)*100%));transition:transform var(--motion-duration,220ms) cubic-bezier(.2,.8,.2,1)}
@media(prefers-reduced-motion:reduce){.nav-indicator{transition:none!important}}
</style>

