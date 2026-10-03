import { Capacitor, registerPlugin } from '@capacitor/core'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

function validateContent(content) {
  if (typeof content !== 'string') throw new Error('文件内容无效，请选择 JSON 备份文件')
  // TextEncoder replaces lone surrogates; reject them instead of silently changing data.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(content)) {
    throw new Error('文件包含无效文本，请使用 UTF-8 JSON 文件')
  }
  if (content.length > MAX_FILE_BYTES || new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
    throw new Error('文件不能超过 5 MiB')
  }
  return content
}

export function createInventoryFiles({ platform, plugin, browser = createBrowserFileAccess() }) {
  let busy = false
  async function run(operation) {
    if (busy) throw new Error('文件操作正在进行，请先完成或取消当前操作')
    busy = true
    try { return await operation() }
    catch (error) {
      if (typeof error?.message === 'string' && /[\u4e00-\u9fff]/.test(error.message)) throw new Error(error.message)
      throw new Error('文件操作失败，请重试并检查文件访问权限')
    } finally { busy = false }
  }
  function backend() {
    return (typeof platform === 'function' ? platform() : platform) === 'android' ? plugin : browser
  }
  function exportJsonFile(content, prefix) {
    return run(async () => {
      validateContent(content)
      const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const result = await backend().exportFile({ content, fileName })
      if (!result || typeof result.cancelled !== 'boolean') throw new Error('未获得有效的文件保存结果，请重试')
      return result.confirmed === false ? { cancelled: result.cancelled, confirmed: false } : { cancelled: result.cancelled }
    })
  }
  return {
    exportInventoryFile(content) {
      return exportJsonFile(content, 'inventory-backup')
    },
    exportDiagnosticFile(content) { return exportJsonFile(content, 'inventory-diagnostics') },
    exportRawInventoryFile(content) { return exportJsonFile(content, 'inventory-recovery-raw') },
    importInventoryFile() {
      return run(async () => {
        const result = await backend().importFile()
        if (result?.cancelled === true) return null
        if (!result || result.cancelled !== false) throw new Error('未获得有效的文件读取结果，请重试')
        return validateContent(result.content)
      })
    },
  }
}

function createBrowserFileAccess() {
  return {
    async exportFile({ content, fileName }) {
      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        // A download request cannot confirm the user actually saved the file.
        return { cancelled: false, confirmed: false }
      } finally {
        link.remove()
        // Let the browser consume the URL before revoking it.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    },
    importFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json,text/plain'
        input.style.display = 'none'
        let settled = false
        let timer
        const finish = (result, error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          window.removeEventListener('focus', onFocus)
          input.remove()
          error ? reject(error) : resolve(result)
        }
        const onFocus = () => {
          // Fallback for browsers without the input cancel event.
          timer = setTimeout(() => {
            if (!input.files?.length) finish({ cancelled: true })
          }, 500)
        }
        input.addEventListener('cancel', () => finish({ cancelled: true }))
        input.addEventListener('change', async () => {
          const file = input.files?.[0]
          if (!file) { finish({ cancelled: true }); return }
          try {
            if (file.size > MAX_FILE_BYTES) throw new Error('文件不能超过 5 MiB')
            const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
            finish({ cancelled: false, content, fileName: file.name })
          } catch (error) {
            finish(null, /[\u4e00-\u9fff]/.test(error?.message || '') ? error : new Error('读取失败，请选择有效的 UTF-8 JSON 文件'))
          }
        })
        window.addEventListener('focus', onFocus)
        document.body.appendChild(input)
        try { input.click() } catch (error) { finish(null, error) }
      })
    },
  }
}

const files = createInventoryFiles({ platform: () => Capacitor.getPlatform(), plugin: registerPlugin('InventoryFiles') })
export const exportInventoryFile = files.exportInventoryFile
export const exportDiagnosticFile = files.exportDiagnosticFile
export const exportRawInventoryFile = files.exportRawInventoryFile
export const importInventoryFile = files.importInventoryFile
