import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPackagingFields, getOcrFieldOptions, createPackagingCheck, validatePackagingCheck } from '../src/core/packaging.js'
import { isEnglishManufacturer, prioritizeManufacturerCandidates, preferredManufacturerCandidates } from '../src/core/manufacturerCandidates.js'
import { autofillProductDraft, productFieldChoices } from '../src/ocr/productAutofill.js'

const now = '2026-10-03T10:00:00.000Z'
const capture = (text, id = 'face') => ({ id, text, createdAt: now })
const fields = text => extractPackagingFields([capture(text)])
const blank = () => ({ name: '', specification: '', manufacturer: '' })
const chinese = '齐鲁制药有限公司'
const english = 'Qilu Pharmaceutical Co., Ltd.'

test('英文企业完整后缀保留原文，英文候选不成为明确包装证据', () => {
  for (const value of ['Acme Ltd.', 'Acme Ltd', 'Acme Limited', 'Acme Corp.', 'Acme Corp', 'Acme Corporation', 'Acme Inc.', 'Acme Inc', 'Acme LLC', 'Acme PLC', 'Acme Co.', 'Acme Co', 'Acme Company', english, 'Alpha-Beta (UK) Limited', 'ACME LTD.']) {
    assert.equal(isEnglishManufacturer(value), true, value)
    const extracted = fields(value).manufacturer
    assert.equal(extracted.status, 'suggested', value)
    assert.equal(extracted.value, '', value)
    assert.deepEqual(extracted.candidates, [], value)
    assert.deepEqual(extracted.suggestions, [value], value)
    assert.equal(autofillProductDraft(blank(), fields(value)).values.manufacturer, value)
  }
})

test('厂家优先英文，中文仍可人工选择，没有英文时用原中文候选', () => {
  const source = [chinese, english]
  assert.deepEqual(prioritizeManufacturerCandidates(source), [english, chinese])
  assert.deepEqual(preferredManufacturerCandidates(source), [english])
  assert.deepEqual(source, [chinese, english])
  const extracted = fields(`${chinese}\n${english}`)
  assert.deepEqual(getOcrFieldOptions([capture(`${chinese}\n${english}`)]).manufacturer, [english, chinese])
  assert.deepEqual(productFieldChoices(extracted.manufacturer, 'manufacturer'), [english])
  assert.equal(autofillProductDraft(blank(), extracted).values.manufacturer, english)
  assert.deepEqual(preferredManufacturerCandidates([chinese]), [chinese])
  assert.equal(autofillProductDraft(blank(), fields(chinese)).values.manufacturer, chinese)
})

test('多个英文厂家保留歧义，不自动选择或回退中文', () => {
  const second = 'Another Pharmaceutical Limited'
  const extracted = fields(`${chinese}\n${english}\n${second}`)
  assert.deepEqual(productFieldChoices(extracted.manufacturer, 'manufacturer'), [english, second])
  const draft = autofillProductDraft(blank(), extracted)
  assert.equal(draft.values.manufacturer, '')
  assert.deepEqual(draft.automatic, {})
})

test('补拍英文替换未修改的自动中文，英文冲突撤回自动草稿', () => {
  const initial = autofillProductDraft(blank(), fields(chinese))
  const updated = autofillProductDraft(initial.values, fields(`${chinese}\n${english}`), initial.automatic)
  assert.equal(updated.values.manufacturer, english)
  assert.equal(updated.automatic.manufacturer, english)
  const ambiguous = autofillProductDraft(updated.values, fields(`${english}\nOther Company`), updated.automatic)
  assert.equal(ambiguous.values.manufacturer, '')
  assert.deepEqual(ambiguous.automatic, {})
})

test('手动校正、已保存和人工选定中文不会被英文优先覆盖', () => {
  const extracted = fields(`${chinese}\n${english}`)
  for (const value of ['人工校正厂家', chinese, 'Saved Manufacturer LLC']) {
    const current = { ...blank(), manufacturer: value }
    assert.deepEqual(autofillProductDraft(current, extracted).values, current)
  }
  const initial = autofillProductDraft(blank(), fields(chinese))
  initial.values.manufacturer = '手动改过的厂家'
  assert.equal(autofillProductDraft(initial.values, extracted, initial.automatic).values.manufacturer, '手动改过的厂家')
})

test('英文生产标签只能给候选，名称与规格仍按各自字段提取', () => {
  for (const label of ['Manufacturer', 'Manufactured by', 'Manufacturing company']) {
    for (const text of [`${label}: ${english}`, `${label}:${english}`, `${label}:\n${english}`]) {
      const extracted = fields(`卡维地洛片\n12.5mg×14片\n${text}`)
      assert.deepEqual(extracted.manufacturer.suggestions, [english], text)
      assert.deepEqual(extracted.manufacturer.candidates, [], text)
      assert.equal(extracted.manufacturer.status, 'suggested', text)
      assert.deepEqual(extracted.name.suggestions, ['卡维地洛片'])
      assert.deepEqual(extracted.specification.suggestions, ['12.5mg×14片'])
    }
  }
})

test('其他字段标签不能把整行公司或折行后缀重新归到厂家', () => {
  for (const label of ['通用名称', '规格', 'Product name', 'Specification', 'Strength', 'Dosage', 'Batch', 'Expiry']) {
    for (const text of [`${label}:\n${english}`, `${label}:\nQilu Pharmaceutical\nCo., Ltd.`]) {
      assert.deepEqual(getOcrFieldOptions([capture(text)]).manufacturer, [], text)
    }
  }
})

test('仅同拍摄内有效企业名加纯后缀可合并，原始拍摄不改变', () => {
  for (const text of ['Qilu Pharmaceutical\nCo., Ltd.', 'Manufacturer:\nQilu Pharmaceutical\nCo., Ltd.']) {
    const captures = [capture(text)]
    const before = structuredClone(captures)
    assert.deepEqual(getOcrFieldOptions(captures).manufacturer, [english], text)
    assert.equal(autofillProductDraft(blank(), extractPackagingFields(captures)).values.manufacturer, english)
    assert.deepEqual(captures, before)
  }
  const separate = [capture('Qilu Pharmaceutical', 'front'), capture('Co., Ltd.', 'side')]
  assert.deepEqual(getOcrFieldOptions(separate).manufacturer, [])
})

test('不从不完整或损坏企业名猜词，不把后缀子串当公司', () => {
  for (const value of ['Qilu Pharmaceutical', 'Co., Ltd.', 'Ltd.', 'Clinic', 'Incorporated dosage', 'Qilu Pharmaceutical 1nc.', 'Acme│Company', 'Acme�Company', '500mg LLC', '2026-10-03 LLC']) {
    assert.equal(isEnglishManufacturer(value), false, value)
    assert.deepEqual(getOcrFieldOptions([capture(value)]).manufacturer, [], value)
  }
  const typo = 'Qilu PharmaceuticaI Co., Ltd.'
  assert.deepEqual(getOcrFieldOptions([capture(typo)]).manufacturer, [typo])
  assert.equal(autofillProductDraft(blank(), fields(typo)).values.manufacturer, typo)
})

test('生产以外标签与地址营销等正文不成为英文厂家或折行企业', () => {
  for (const text of [
    `Distributor: ${english}`, `Distributed by:\n${english}`, `Address:\n${english}`,
    `经销商:\n${english}`, `地址:\n${english}`, `上市许可持有人:\n${english}`,
    'Cardiovascular tablets\nCo., Ltd.', '500mg\nCo., Ltd.',
    '123 Industrial Road\nCo., Ltd.', 'Manufactured by:\nAddress:\nAcme Company',
    'Qilu Pharmaceutical\n规格:500mg\nCo., Ltd.',
    '[适应症]\nQilu Pharmaceutical\nCo., Ltd.', '用法用量:\nQilu Pharmaceutical\nCo., Ltd.',
  ]) assert.deepEqual(getOcrFieldOptions([capture(text)]).manufacturer, [], text)
})

test('英文优先不能过滤明确中文历史冲突，提取前后快照重算一致', () => {
  const captures = [capture(`通用名称:卡维地洛片\n规格:12.5mg\n生产企业:${chinese}\n${english}`)]
  const product = { id: 'p', name: '卡维地洛片', specification: '12.5mg', manufacturer: english }
  const options = { confirmedSameBox: true, checkedAt: now }
  const before = createPackagingCheck(product, 'unit1', captures, options)
  assert.equal(before.status, 'conflict')
  assert.deepEqual(before.fields.manufacturer.observed, [chinese])
  const extracted = extractPackagingFields(captures)
  assert.equal(extracted.manufacturer.status, 'recognized')
  assert.equal(extracted.manufacturer.value, chinese)
  assert.deepEqual(extracted.manufacturer.candidates, [chinese])
  assert.deepEqual(productFieldChoices(extracted.manufacturer, 'manufacturer'), [english])
  assert.deepEqual(createPackagingCheck(product, 'unit1', captures, options), before)
  assert.throws(() => validatePackagingCheck(before), /冲突/)
})

test('英文标签与折行候选不升级历史状态，旧快照仍可验证', () => {
  const captures = [capture('通用名称:卡维地洛片\n规格:12.5mg\nManufacturer:\nQilu Pharmaceutical\nCo., Ltd.')]
  const product = { id: 'p', name: '卡维地洛片', specification: '12.5mg', manufacturer: english }
  const options = { confirmedSameBox: true, checkedAt: now }
  const before = createPackagingCheck(product, 'unit1', captures, options)
  assert.equal(before.status, 'incomplete')
  assert.equal(before.fields.manufacturer.status, 'missing')
  const original = structuredClone(captures)
  getOcrFieldOptions(captures)
  extractPackagingFields(captures)
  assert.deepEqual(captures, original)
  assert.deepEqual(createPackagingCheck(product, 'unit1', captures, options), before)
  assert.deepEqual(validatePackagingCheck(before), before)
})
