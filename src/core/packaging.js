/** Conservative OCR text comparison. Camera text is evidence, never an identity lookup. */
import { englishManufacturerCandidates, isManufacturerRoleBoundary, prioritizeManufacturerCandidates } from './manufacturerCandidates.js'
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
  const copied = validateCaptures(captures)
  const observed = observeCaptures(copied,expected.name)
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

function validateCaptures(captures) {
  if (!Array.isArray(captures) || captures.length < 1 || captures.length > 6) throw new Error('包装核对须保留1至6面文字')
  const ids = new Set()
  const copied = captures.map(capture => {
    if (!object(capture) || typeof capture.id !== 'string' || !capture.id.trim() || capture.id !== capture.id.trim() || capture.id.length > 200 || ids.has(capture.id) || typeof capture.text !== 'string' || !capture.text.trim() || capture.text.length > 4000 || !time(capture.createdAt)) throw new Error('包装识别记录格式不正确或重复')
    ids.add(capture.id)
    return {id:capture.id,text:capture.text,createdAt:capture.createdAt}
  })
  return copied
}

function observeCaptures(copied,expectedName = '') {
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
      if (expectedName && normalizePackagingText(line) === normalizePackagingText(expectedName)) observed.name.push(line)
    }
  }
  return observed
}

/** Clean border marks at line edges only; never repair characters within evidence. */
export function cleanOcrCandidateLine(value) {
  if (typeof value !== 'string') throw new Error('OCR候选文字格式不正确')
  let line = value.normalize('NFKC').replace(/【/g, '[').replace(/】/g, ']').trim()
  if (/^[|丨_\u2500-\u257f\s+-]*$/u.test(line)) return ''
  let previous
  do {
    previous = line
    line = line.replace(/^[|丨_\u2500-\u257f\s]+|[|丨_\u2500-\u257f\s]+$/gu, '').trim()
    // A single hyphen belongs to text unless separated by whitespace as decoration.
    line = line.replace(/^(?:-{2,}\s*|-\s+)|(?:\s*-{2,}|\s+-)$/gu, '').trim()
  } while (line !== previous)
  return line
}

function inferOcrFieldOptions(copied) {
  const inferred = Object.fromEntries(FIELD_KEYS.map(key => [key, []]))
  // Suggestions are deliberately separate from the historical evidence parser.
  const unsafe = /(?:本品|用于|服用|适用|治疗|说明|注意|请|禁止|应当|建议|每天|每日|每次|一次|一日|用法|用量|适应症|不良反应|禁忌|批准|国药|批号|日期|有效期|生产日期|电话|传真|热线|地址|网址|www\.|https?:|广告|推荐|欢迎|首选|优惠|疗效|经销商|经销企业|销售商|上市许可持有人)/iu
  const dosageForm = '(?:肠溶胶囊|软胶囊|胶囊|缓释片|控释片|肠溶片|咀嚼片|分散片|含片|片|颗粒|口服液|口服溶液|口服混悬液|混悬液|注射液|注射用粉针剂|冻干粉针剂|滴眼液|滴鼻液|滴耳液|眼膏|软膏|乳膏|药膏|凝胶|栓剂|滴丸|丸|散剂|散|合剂|糖浆|喷雾剂|气雾剂|吸入剂|洗剂|搽剂|贴剂)'
  const title = new RegExp(`^[\\p{Script=Han}A-Za-z0-9()-]{2,50}${dosageForm}(?:\\([^()]{1,20}\\))?$`, 'u')
  const dose = '(?:[0-9]+(?:\\.[0-9]+)?\\s*(?:μg|ug|mcg|mg|kg|g|mL|ml|L|l|IU|万单位|单位|毫克|微克|克|毫升)(?:\\s*\\/\\s*(?:片|粒|支|袋|瓶|丸|mL|ml))?)'
  const count = '(?:[0-9]+\\s*(?:片|粒|支|袋|瓶|丸|贴|枚|包))'
  const spec = new RegExp(`^(?:${dose}|${count})(?:\\s*[×xX*]\\s*(?:${dose}|${count}|[0-9]+))*?(?:\\s*\\/\\s*(?:盒|瓶|袋|板|包))?$`, 'u')
  const descriptiveSpec = new RegExp(`^每(?:片|粒|支|袋|瓶|丸)\\s*(?:含\\s*)?${dose}(?:\\s*[,;，；]?\\s*(?:内装|装量|包装)\\s*${count}(?:\\s*\\/\\s*(?:盒|瓶|袋|板|包))?)?$`, 'u')
  const company = /^[\p{Script=Han}A-Za-z0-9()· -]{2,90}(?:股份有限公司|有限责任公司|有限公司|制药厂|药厂)$/u
  for (const capture of copied) {
    const lines = capture.text.split(/\r?\n/).map(cleanOcrCandidateLine).filter(Boolean)
    for (let index = 0; index < lines.length; index++) {
      let line = lines[index]
      if (unsafe.test(line)) continue
      const allLabels = Object.values(LABELS).flat().join('|')
      const labeled = line.match(new RegExp(`^(?:\\[(${allLabels})\\]\\s*:?\\s*|(${allLabels})(?:\\s*:\\s*|\\s+))(.+)$`))
      let labeledKey = labeled ? FIELD_KEYS.find(key => LABELS[key].includes(labeled[1] ?? labeled[2])) : null
      const previousLabel = !labeled && index > 0 ? lines[index - 1].match(new RegExp(`^(?:\\[(${allLabels})\\]|(${allLabels}))\\s*:?\\s*$`)) : null
      if (previousLabel) labeledKey = FIELD_KEYS.find(key => LABELS[key].includes(previousLabel[1] ?? previousLabel[2]))
      if (labeled) line = cleanOcrCandidateLine(labeled[3])
      if ((!labeledKey || labeledKey === 'manufacturer') &&
          !isManufacturerRoleBoundary(lines[index]) &&
          !(index > 0 && isManufacturerRoleBoundary(lines[index - 1])) &&
          !(index > 0 && !previousLabel && /^(?:\[[^\]]+\]\s*:?|[\p{Script=Han}]{2,12}:)$/u.test(lines[index - 1]))) {
        inferred.manufacturer.push(...englishManufacturerCandidates([...lines.slice(0,index),line], index))
      }
      if (/[:：|丨_\u2500-\u257f\ufffd]/u.test(line) || unsafe.test(line)) continue
      if (!labeled && index > 0 && (unsafe.test(lines[index - 1]) || (!previousLabel && /^(?:\[[^\]]+\]\s*:?|[\p{Script=Han}]{2,12}:)$/u.test(lines[index - 1])))) continue
      if ((!labeledKey || labeledKey === 'name') && title.test(line) && /\p{Script=Han}/u.test(line) && !/的/u.test(line)) inferred.name.push(line)
      const unwrapped = /^\([^()]+\)$/.test(line) ? line.slice(1, -1).trim() : line
      if ((!labeledKey || labeledKey === 'specification') && unwrapped.length <= 120 && (spec.test(unwrapped) || descriptiveSpec.test(unwrapped))) inferred.specification.push(line)
      if ((!labeledKey || labeledKey === 'manufacturer') && company.test(line)) inferred.manufacturer.push(line)
    }
  }
  return inferred
}

/** Field-shaped, cleaned choices for manual review; does not upgrade historical evidence. */
export function getOcrFieldOptions(captures) {
  const inferred = inferOcrFieldOptions(validateCaptures(captures))
  return Object.fromEntries(FIELD_KEYS.map(key => {
    const values = [...new Map(inferred[key].map(value => [normalizePackagingText(value), value])).values()]
    return [key, key === 'manufacturer' ? prioritizeManufacturerCandidates(values) : values]
  }))
}

function safeExplicitCandidate(value, key) {
  // Filtering is for form autofill only; historical evidence remains untouched.
  if (cleanOcrCandidateLine(value) !== value || /[|丨_\u2500-\u257f\ufffd]/u.test(value)) return false
  if (value.length > (key === 'name' ? 80 : 120)) return false
  if (/^[\d\s().,+/\-]+$/u.test(value) || /^\d{4}年\d{1,2}月(?:\d{1,2}日)?$/u.test(value)) return false
  if (/(?:本品|用于|服用|适用|治疗|说明|注意|请|禁止|应当|建议|每天|每日|每次|一次|一日|用法|用量|适应症|不良反应|禁忌|批准|国药|批号|日期|有效期|电话|传真|热线|地址|网址|www\.|https?:|广告|推荐|欢迎|首选|优惠|疗效|经销商|经销企业|销售商|上市许可持有人)/iu.test(value)) return false
  return true
}

export function extractPackagingFields(captures, options = {}) {
  const copied = validateCaptures(captures)
  const observed = observeCaptures(copied, typeof options.expectedName === 'string' ? options.expectedName : '')
  const inferred = inferOcrFieldOptions(copied)
  const result = {}
  for (const key of FIELD_KEYS) {
    const unique = values => [...new Map(values.map(value => [normalizePackagingText(value), value])).values()]
    const explicit = unique(observed[key].filter(value => safeExplicitCandidate(value, key)))
    const suggestions = unique(inferred[key]).filter(value => !explicit.some(item => normalizePackagingText(item) === normalizePackagingText(value)))
    result[key] = {
      value: explicit.length === 1 ? explicit[0] : '',
      status: explicit.length === 1 ? 'recognized' : explicit.length > 1 ? 'ambiguous' : suggestions.length > 1 ? 'ambiguous' : suggestions.length ? 'suggested' : 'missing',
      candidates: explicit,
      suggestions,
    }
  }
  return result
}
