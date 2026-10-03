// Candidate ranking only. Never translate, repair OCR spelling, or verify a box.
const suffix = /\b(?:(?:co\.?|company)\s*,?\s*(?:ltd\.?|limited)|corporation\.?|corp\.?|incorporated\.?|inc\.?|l\.?l\.?c\.?|p\.?l\.?c\.?|limited\.?|ltd\.?|company\.?|co\.?)$/i
const manufacturerLabel = /^(?:manufacturer|manufactured\s+by|manufacturing\s+company)(?:\s*[:：]\s*|\s+)/i
const blocked = /\b(?:distributed|distributor|marketed|marketing|sales|licensed|licence|license|imported|importer|copyright|address|tel|telephone|fax|road|street|tablets?|capsules?|dosage|strength|mg|ml|expiry|batch|lot)\b|https?:|www\./i
export function isManufacturerRoleBoundary(value) {
  const label = value.normalize('NFKC').replace(/【/g,'[').replace(/】/g,']').trim()
  const productionLabel = /^(?:\[(?:生产企业|生产厂家|生产商|厂家)\]|(?:生产企业|生产厂家|生产商|厂家)|manufacturer|manufactured\s+by|manufacturing\s+company)\s*:?\s*$/i
  if ((/^\[[^\]]+\]\s*:?\s*$|^[\p{Script=Han}]{2,12}\s*:$|^[A-Za-z][A-Za-z ]{1,40}:$/u.test(label) && !productionLabel.test(label)) ||
      /(?:适应症|用法|用量|不良反应|禁忌|有效期|批准|批号|生产日期|说明|注意)/u.test(label)) return true
  return /(?:经销|销售|上市许可|地址|电话|传真)|\b(?:distributed|distributor|marketed|sales|licensed|licence|license|imported|importer|address|tel|telephone|fax)|^(?:product\s+name|specification|strength|dosage|batch|lot|expiry)\s*:?$/i.test(value) ||
    /^(?:\[(?:药品名称|通用名称|商品名称|品名|规格)\]|(?:药品名称|通用名称|商品名称|品名|规格))\s*:?\s*$/.test(value)
}
function candidateText(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(manufacturerLabel, '').trim() : ''
}
export function isEnglishManufacturer(value) {
  const text = candidateText(value), match = text.match(suffix)
  if (!match || text.length > 120 || !/^[A-Za-z0-9&()'’., /-]+$/.test(text) || blocked.test(text) || /\d+(?:\.\d+)?\s*(?:mg|ml|g|mcg|ug)\b/i.test(text)) return false
  const name = text.slice(0, match.index).trim().replace(/[,.]+$/, '').trim()
  return /[A-Za-z].*[A-Za-z]/.test(name) && !/^(?:co\.?|company)$/i.test(name)
}
export function englishManufacturerCandidates(lines, index) {
  const line = candidateText(lines[index])
  if (isEnglishManufacturer(line)) return [line]
  // Only a standalone legal suffix may join the immediately preceding line.
  if (!suffix.test(line) || line.match(suffix)?.index !== 0 || index === 0) return []
  const previous = candidateText(lines[index - 1])
  if (isEnglishManufacturer(previous) || isManufacturerRoleBoundary(lines[index - 1]) ||
      /[:：\[\]\d]/.test(previous) || (index > 1 && isManufacturerRoleBoundary(lines[index - 2]))) return []
  const joined = `${previous} ${line}`
  return isEnglishManufacturer(joined) ? [joined] : []
}
function unique(values) {
  const seen = new Set()
  return values.filter(value => {
    const key = isEnglishManufacturer(value) ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : value.normalize('NFKC').replace(/\s+/g, '')
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}
export function prioritizeManufacturerCandidates(values) {
  const choices = unique(values)
  return [...choices.filter(isEnglishManufacturer), ...choices.filter(value => !isEnglishManufacturer(value))]
}
export function preferredManufacturerCandidates(values) {
  const choices = prioritizeManufacturerCandidates(values), english = choices.filter(isEnglishManufacturer)
  return english.length ? english : choices
}
