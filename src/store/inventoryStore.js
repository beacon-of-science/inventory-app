import { reactive, ref } from 'vue'
import {
  addProduct as addProductToState,
  updateProduct as updateProductInState,
  deleteProduct as deleteProductFromState,
  recordMovement as recordMovementInState,
  createEmptyState,
  validateScanBatch as previewScanBatch,
} from '../core/inventory.js'
import { loadState, saveState, migrateState, validateState } from '../core/storage.js'
import { STORAGE_KEY } from '../core/storage.js'
import { DEFAULT_SETTINGS, readSettings, writeSettings, applySettingsPatch } from '../core/settings.js'
import { createDiagnostics } from '../core/diagnostics.js'
import {
  readRecoveryPoints, recoveryPointMetadata, saveRecoveryPoint, stateFromRecoveryPoint,
  preserveDamagedRaw, PRESERVED_RAW_KEY,
} from '../core/recovery.js'

export function createInventoryStore(storage) {
  const state = reactive(createEmptyState())
  const error = ref('')
  const settings = reactive({ ...DEFAULT_SETTINGS })
  const recovery = reactive({ points: [], warning: '', lastRecoveryAt: '', lastManualBackupAt: '', preservedRawAvailable: false })
  const warnings = new Map()
  let backend

  function setWarning(key, message = '') {
    if (message) warnings.set(key, message)
    else warnings.delete(key)
    recovery.warning = [...warnings.values()].join('；')
  }

  function replaceState(next) {
    state.products = next.products
    state.movements = next.movements
    state.units = next.units
  }

  try {
    backend = storage === undefined ? globalThis.localStorage : storage
    const loaded = loadState(backend)
    replaceState(loaded)
  } catch (cause) {
    error.value = `启动读取失败：${cause instanceof Error ? cause.message : '未知错误'}`
  }

  const diagnostics = createDiagnostics(backend)
  diagnostics.record(error.value ? 'STARTUP_FAILED' : 'STARTUP_SUCCEEDED')
  try {
    const saved = readSettings(backend)
    settings.autoRecovery = saved.autoRecovery
    settings.reduceMotion = saved.reduceMotion
    recovery.lastManualBackupAt = saved.lastManualBackupAt
  } catch { setWarning('settings', '本机设置读取失败，已使用默认设置') }
  try {
    const loaded = readRecoveryPoints(backend)
    updateRecoveryList(loaded.points)
    setWarning('recovery', loaded.warning)
  } catch (cause) { setWarning('recovery', cause.message) }
  try { recovery.preservedRawAvailable = backend.getItem(PRESERVED_RAW_KEY) !== null }
  catch { setWarning('preserved', '暂时无法读取原始数据保护副本') }

  function updateRecoveryList(points) {
    recovery.points = points.map(recoveryPointMetadata)
    recovery.lastRecoveryAt = recovery.points[0]?.createdAt ?? ''
  }

  function createPoint(reason) {
    try {
      const result = saveRecoveryPoint(backend, state, reason)
      updateRecoveryList(result.points)
      setWarning('recovery')
      diagnostics.record('RECOVERY_CREATED')
      return recoveryPointMetadata(result.point)
    } catch (cause) {
      setWarning('recovery', cause.message)
      diagnostics.record('RECOVERY_FAILED')
      throw cause
    }
  }

  function autoRecover() {
    if (settings.autoRecovery) {
      try { createPoint('auto') } catch { /* Main inventory save already succeeded. Warning remains visible. */ }
    }
  }

  function requireWritable() {
    if (error.value) throw new Error(`库存数据处于只读保护状态：${error.value}`)
  }

  function findPoint(id) {
    const loaded = readRecoveryPoints(backend)
    updateRecoveryList(loaded.points)
    setWarning('recovery', loaded.warning)
    const point = loaded.points.find(item => item.id === id)
    if (!point) throw new Error('恢复点已不存在或已损坏，请重新选择')
    return point
  }

  function commit(transition, valueKey, beforeReason) {
    requireWritable()
    const result = transition()
    if (beforeReason) createPoint(beforeReason)
    try { saveState(backend, result.state) }
    catch (cause) { diagnostics.record('SAVE_FAILED'); throw cause }
    replaceState(result.state)
    autoRecover()
    return result[valueKey]
  }

  function saveRestored(restored, options = {}) {
    if (error.value) {
      let raw
      try { raw = backend.getItem(STORAGE_KEY) } catch { throw new Error('无法读取原始数据，已中止恢复') }
      preserveDamagedRaw(backend, raw, options.replacePreserved === true)
      recovery.preservedRawAvailable = true
      setWarning('preserved')
    } else createPoint('before-restore')
    try { saveState(backend, restored) }
    catch (cause) { diagnostics.record('SAVE_FAILED'); throw cause }
    replaceState(restored)
    error.value = ''
    diagnostics.record('RESTORE_SUCCEEDED')
    autoRecover()
  }

  return {
    state,
    error,
    settings,
    recovery,
    updateSettings(patch) {
      const next = applySettingsPatch(settings, patch)
      try { writeSettings(backend, { ...next, lastManualBackupAt: recovery.lastManualBackupAt }) }
      catch (cause) { diagnostics.record('SETTINGS_FAILED'); setWarning('settings', cause.message); throw cause }
      Object.assign(settings, next)
      setWarning('settings')
    },
    createRecoveryPoint() { requireWritable(); return createPoint('manual') },
    previewRecoveryPoint(id) { return recoveryPointMetadata(findPoint(id)) },
    restoreRecoveryPoint(id, options) {
      try {
        // Read and validate the target before rotating the list for the protection point.
        const target = findPoint(id)
        const restored = stateFromRecoveryPoint(target)
        saveRestored(restored, options)
        return recoveryPointMetadata(target)
      } catch (cause) { diagnostics.record('RESTORE_FAILED'); throw cause }
    },
    restoreImportedState(input, options) {
      if (!error.value) throw new Error('当前库存可正常使用，请使用普通导入')
      try {
        validateState(input)
        const imported = migrateState(JSON.parse(JSON.stringify(input)))
        saveRestored(imported, options)
        return imported
      } catch (cause) { diagnostics.record('RESTORE_FAILED'); throw cause }
    },
    exportRawData() {
      try { return backend.getItem(STORAGE_KEY) }
      catch { throw new Error('无法读取原始库存数据') }
    },
    exportPreservedRawData() {
      try { return backend.getItem(PRESERVED_RAW_KEY) }
      catch { throw new Error('无法读取原始数据保护副本') }
    },
    markManualBackupExported() {
      const at = new Date().toISOString()
      diagnostics.record('EXPORT_SUCCEEDED')
      try { writeSettings(backend, { ...settings, lastManualBackupAt: at }) }
      catch { setWarning('settings', '文件已导出，但备份时间记录失败'); diagnostics.record('SETTINGS_FAILED'); return false }
      recovery.lastManualBackupAt = at
      setWarning('settings')
      return true
    },
    recordDiagnostic(code) { return diagnostics.record(code) },
    getDiagnosticReport() { return diagnostics.report() },
    clearDiagnostics() { diagnostics.clear() },
    addProduct(input) {
      return commit(() => addProductToState(state, input), 'product')
    },
    updateProduct(id, input) {
      return commit(() => updateProductInState(state, id, input), 'product')
    },
    deleteProduct(id) {
      return commit(() => deleteProductFromState(state, id), 'product')
    },
    validateScanBatch(input) { return previewScanBatch(state, input) },
    recordMovement(input) {
      return commit(() => recordMovementInState(state, input), 'movement')
    },
    importState(input) {
      try {
        const imported = commit(() => {
          // Own the imported objects so later caller edits cannot bypass persistence.
          validateState(input)
          const imported = migrateState(JSON.parse(JSON.stringify(input)))
          return { state: imported, imported }
        }, 'imported', 'before-import')
        diagnostics.record('IMPORT_SUCCEEDED')
        return imported
      } catch (cause) { diagnostics.record('IMPORT_FAILED'); throw cause }
    },
  }
}
