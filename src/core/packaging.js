/** Conservative OCR text comparison. Camera text is evidence, never an identity lookup. */
const FIELD_KEYS = ['name', 'specification', 'manufacturer']
const LABELS = { name: ['药品名称','通用名称','商品名称','品名'], specification: ['规格'], manufacturer: ['生产企业','生产厂家','生产商','厂家'] }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function time(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
export function normalizePackagingText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, '').replace(/[×✕]/g, '*').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}
function expectedText(value, maximum, label) {
  if (typeof value !== 'string' || value.length > maximum || value !== value.trim()) throw new Error(`${label}参考信息格式不正确`)
  return value
}
export function createPackagingCheck(product, unitCode, captures, options = {}) {
  if (!object(product) || typeof product.id !== 'string' || !product.id.trim()) throw new Error('包装核对商品不正确')
  if (typeof unitCode !== 'string' || !/^[\x20-\x7e]+$/.test(unitCode) || !unitCode.trim() || unitCode.trim().length > 120) throw new Error('包装核对唯一码不正确')
  unitCode = unitCode.trim()
  if (options.confirmedSameBox !== true) throw new Error('请确认各面照片均来自同一个药盒')
  const expected = {name: expectedText(product.name,80,'名称'), specification:expectedText(product.specification ?? '',120,'规格'), manufacturer:expectedText(product.manufacturer ?? '',120,'生产企业')}
  if (!Array.isArray(captures) || captures.length < 1 || captures.length > 6) throw new Error('包装核对须保留1至6面文字')
  const ids = new Set()
  const copied = captures.map(capture => {
    if (!object(capture) || typeof capture.id !== 'string' || !capture.id.trim() || capture.id !== capture.id.trim() || capture.id.length > 200 || ids.has(capture.id) || typeof capture.text !== 'string' || !capture.text.trim() || capture.text.length > 4000 || !time(capture.createdAt)) throw new Error('包装识别记录格式不正确或重复')
    ids.add(capture.id)
    return {id:capture.id,text:capture.text,createdAt:capture.createdAt}
  })
  const observed = Object.fromEntries(FIELD_KEYS.map(key => [key, []]))
  const allLabels = Object.values(LABELS).flat().join('|')
  const labelOnly = new RegExp(`^(?:\\[(${allLabels})\\]|(${allLabels}))\\s*:?\\s*$`)
  const labelStart = new RegExp(`^(?:\\[(?:${allLabels})\\]|(?:${allLabels})(?:$|\\s|:))`)
  for (const capture of copied) {
    const lines = capture.text.split(/\r?\n/).map(raw => raw.normalize('NFKC').replace(/【/g,'[').replace(/】/g,']').trim()).filter(Boolean)
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const standalone = line.match(labelOnly)
      if (standalone) {
        const next = lines[lineIndex + 1]
        // Stay within this capture and stop at any explicit label; blank lines carry no evidence.
        if (next && !labelStart.test(next) && !/^(?:\[[^\]]+\]|[\p{Script=Han}]{2,12}\s*:)/u.test(next)) {
          const label = standalone[1] ?? standalone[2]
          observed[FIELD_KEYS.find(key => LABELS[key].includes(label))].push(next)
        }
      }
      const markers = [...line.matchAll(new RegExp(`(?:^|\\s+)(?:\\[(${allLabels})\\]\\s*:?\\s*|(${allLabels})\\s*:\\s*)`, 'g'))]
      if (markers.length > 1) {
        markers.forEach((marker,index) => {
          const label = marker[1] ?? marker[2]
          const value = line.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? line.length).trim()
          const key = FIELD_KEYS.find(key => LABELS[key].includes(label))
          if (value) observed[key].push(value)
        })
      } else {
        for (const key of FIELD_KEYS) {
          const labels = LABELS[key].join('|')
          // Explicit label plus colon, brackets, or whitespace; never infer substrings.
          const match = line.match(new RegExp(`^(?:\\[(${labels})\\]\\s*:?\\s*|(${labels})(?:\\s*:\\s*|\\s+))(.+)$`))
          if (match) observed[key].push(match[3].trim())
        }
      }
      if (expected.name && normalizePackagingText(line) === normalizePackagingText(expected.name)) observed.name.push(line)
    }
  }
  const fields = {}
  for (const key of FIELD_KEYS) {
    const values = [...new Set(observed[key])]
    const target = normalizePackagingText(expected[key])
    fields[key] = {status: !target ? 'unconfigured' : values.some(value => normalizePackagingText(value) !== target) ? 'conflict' : values.length ? 'matched' : 'missing', observed:values}
  }
  const status = FIELD_KEYS.some(key => fields[key].status === 'conflict') ? 'conflict' : FIELD_KEYS.every(key => fields[key].status === 'matched') ? 'matched' : 'incomplete'
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  if (!time(checkedAt)) throw new Error('包装核对时间不正确')
  return {productId:product.id,unitCode,expected,captures:copied,fields,status,confirmedSameBox:true,checkedAt}
}
/** History must reproduce its own reference snapshot after product edits. */
export function validatePackagingCheck(record) {
  if (!object(record) || !object(record.expected) || record.unitCode !== record.unitCode?.trim() || !time(record.checkedAt)) throw new Error('包装核对快照格式不正确')
  const expected = createPackagingCheck({id:record.productId,...record.expected},record.unitCode,record.captures,{confirmedSameBox:record.confirmedSameBox,checkedAt:record.checkedAt})
  if (record.status === 'conflict' || stable(record) !== stable(expected)) throw new Error('包装核对快照损坏或存在冲突')
  return record
}

function stable(value) { return JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item) }
