export const DIAGNOSTICS_KEY = 'inventory-app-diagnostics-v1'
export const MAX_DIAGNOSTIC_EVENTS = 80
export const DIAGNOSTIC_CODES = Object.freeze([
  'STARTUP_SUCCEEDED', 'STARTUP_FAILED', 'SAVE_FAILED', 'RECOVERY_CREATED',
  'RECOVERY_FAILED', 'RESTORE_SUCCEEDED', 'RESTORE_FAILED', 'SETTINGS_FAILED',
  'EXPORT_SUCCEEDED', 'EXPORT_FAILED', 'IMPORT_SUCCEEDED', 'IMPORT_FAILED',
  'SCAN_FAILED', 'OCR_FAILED', 'UNEXPECTED_ERROR',
])
const allowedCodes = new Set(DIAGNOSTIC_CODES)

function readEvents(storage) {
  const data = JSON.parse(storage.getItem(DIAGNOSTICS_KEY))
  return data?.version === 1 && Array.isArray(data.events) ? data.events
      .filter(event => event && allowedCodes.has(event.code) && typeof event.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) && Number.isFinite(Date.parse(event.at)))
      .slice(-MAX_DIAGNOSTIC_EVENTS).map(({ code, at }) => ({ code, at })) : []
}

export function createDiagnostics(storage) {
  let events = [], unsaved = false
  function refresh() {
    if (!unsaved) {
      try { events = readEvents(storage) } catch { /* Diagnostics must never prevent inventory use. */ }
    }
  }
  refresh()
  return {
    record(code) {
      if (!allowedCodes.has(code)) return false
      refresh()
      events = [...events, { code, at: new Date().toISOString() }].slice(-MAX_DIAGNOSTIC_EVENTS)
      try { storage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ version: 1, events })); unsaved = false }
      catch { unsaved = true; return false }
      return true
    },
    report() { refresh(); return { version: 1, events: events.map(event => ({ ...event })) } },
    clear() {
      try { storage.setItem(DIAGNOSTICS_KEY, JSON.stringify({ version: 1, events: [] })) }
      catch { throw new Error('清理诊断记录失败') }
      events = []; unsaved = false
    },
  }
}
