export const SETTINGS_KEY = 'inventory-app-settings-v1'
export const DEFAULT_SETTINGS = Object.freeze({ autoRecovery: true, reduceMotion: false })

export function readSettings(storage) {
  const raw = storage.getItem(SETTINGS_KEY)
  if (raw === null) return { ...DEFAULT_SETTINGS, lastManualBackupAt: '' }
  const data = JSON.parse(raw)
  if (!data || data.version !== 1 || typeof data.autoRecovery !== 'boolean' || typeof data.reduceMotion !== 'boolean' ||
      typeof data.lastManualBackupAt !== 'string' || (data.lastManualBackupAt && !Number.isFinite(Date.parse(data.lastManualBackupAt)))) {
    throw new Error('本机设置读取失败，已使用默认设置')
  }
  return { autoRecovery: data.autoRecovery, reduceMotion: data.reduceMotion, lastManualBackupAt: data.lastManualBackupAt }
}

export function writeSettings(storage, value) {
  if (typeof value.autoRecovery !== 'boolean' || typeof value.reduceMotion !== 'boolean') throw new Error('设置格式不正确')
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, autoRecovery: value.autoRecovery, reduceMotion: value.reduceMotion, lastManualBackupAt: value.lastManualBackupAt || '' }))
  } catch { throw new Error('保存设置失败，请检查本机存储空间或权限') }
}

export function applySettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(key => !Object.hasOwn(DEFAULT_SETTINGS, key) || typeof patch[key] !== 'boolean')) throw new Error('设置格式不正确')
  return { ...current, ...patch }
}
