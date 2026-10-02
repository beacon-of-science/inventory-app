import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPackagingFields, createPackagingCheck, validatePackagingCheck, cleanOcrCandidateLine, getOcrFieldOptions } from '../src/core/packaging.js'
import { createEmptyState, addProduct, recordMovement } from '../src/core/inventory.js'

const capture = (text, id = 'face') => ({ id, text, createdAt: '2026-10-03T10:00:00.000Z' })
const extract = text => extractPackagingFields([capture(text)])

test('明确标签保持识别，推测单独输出且不自动成为参考值', () => {
  const fields = extract('药品名称：阿莫西林胶囊\n规格：0.25g×24粒\n生产企业：甲制药有限公司')
  for (const field of Object.values(fields)) {
    assert.equal(field.status, 'recognized')
    assert.ok(field.value)
    assert.equal(field.candidates.length, 1)
  }
  const suggested = extract('阿莫西林胶囊\n0.25g×24粒\n甲制药有限公司')
  for (const field of Object.values(suggested)) {
    assert.equal(field.status, 'suggested')
    assert.equal(field.value, '')
    assert.deepEqual(field.candidates, [])
    assert.equal(field.suggestions.length, 1)
  }
})

for (const name of ['盐酸氨溴索口服溶液', '布洛芬混悬液', '双氯芬酸钠缓释片', '维生素B12片', '红霉素眼膏', '复方醋酸地塞米松乳膏', '硝酸咪康唑栓剂', '云南白药气雾剂', '藿香正气丸', '复方氨酚烷胺胶囊(成人用)']) {
  test(`无标签剂型名只作为候选 ${name}`, () => {
    const field = extract(name).name
    assert.equal(field.status, 'suggested')
    assert.equal(field.value, '')
    assert.deepEqual(field.suggestions, [name])
  })
}

test('括号或剂量单独一行可建议，不拼装成看似确定的规格', () => {
  for (const text of ['0.25g', '(0.25g)', '500mg', '5mL×10支/盒', '24粒', '0.25g/粒×24粒']) {
    const field = extract(text).specification
    assert.equal(field.status, 'suggested', text)
    assert.equal(field.value, '')
    assert.deepEqual(field.suggestions, [text])
  }
  const field = extract('阿莫西林胶囊\n(0.25g)\n24粒').specification
  assert.equal(field.status, 'ambiguous')
  assert.deepEqual(field.suggestions, ['(0.25g)', '24粒'])
  assert.deepEqual(field.candidates, [])
})

test('公司及药厂完整行只作为候选，重复候选规范去重', () => {
  for (const company of ['甲乙制药股份有限公司', '甲乙医药有限责任公司', '甲乙制药有限公司', '甲乙制药厂', '甲乙药厂']) {
    assert.deepEqual(extract(company).manufacturer.suggestions, [company])
  }
  const field = extract('0.25g×24粒\n０．２５ｇ*２４粒').specification
  assert.equal(field.status, 'suggested')
  assert.equal(field.suggestions.length, 1)
})

test('明确冲突维持 ambiguous，多个无标签推测仍空值', () => {
  const explicit = extract('规格:0.25g\n规格:0.5g').specification
  assert.equal(explicit.status, 'ambiguous')
  assert.equal(explicit.value, '')
  assert.equal(explicit.candidates.length, 2)
  const inferred = extract('阿莫西林胶囊\n布洛芬胶囊').name
  assert.equal(inferred.status, 'ambiguous')
  assert.equal(inferred.value, '')
  assert.deepEqual(inferred.candidates, [])
  assert.equal(inferred.suggestions.length, 2)
})

test('营销适应症批准文号电话号码日期与其他字段正文不建议规格厂家药名', () => {
  for (const text of [
    '请服用阿莫西林胶囊', '本品用于治疗感染，属于阿莫西林胶囊', '推荐阿莫西林胶囊',
    '国药准字H12345678', '批准文号\n12345678', '电话:4001234567', '400-123-4567',
    '生产日期:2026-10-03', '2026.10.03', '20261003', '每日500mg', '每次2片',
    '欢迎选择甲乙制药有限公司', '地址：甲乙制药有限公司', '生产企业：\n阿莫西林胶囊',
    '[适应症]\n阿莫西林胶囊', '用法用量\n500mg', '适应症\n阿莫西林胶囊', '经销商\n甲乙制药有限公司',
  ]) {
    const fields = extract(text)
    for (const field of Object.values(fields)) assert.deepEqual(field.suggestions, [], text)
  }
})

test('已有药名仅完整原文严格规范匹配可识别，不能子串或由参考补齐', () => {
  const options = { expectedName: '阿莫西林胶囊' }
  assert.equal(extractPackagingFields([capture('阿莫西林 胶囊')], options).name.status, 'recognized')
  for (const text of ['请服用阿莫西林胶囊', '阿莫西林', '阿莫西林胶囊0.25g', '布洛芬胶囊']) {
    assert.notEqual(extractPackagingFields([capture(text)], options).name.status, 'recognized')
    assert.equal(extractPackagingFields([capture(text)], options).name.value, '')
  }
})

test('候选抽取不改变历史包装核对重算结果或快照 schema', () => {
  const product = { id: 'p', name: '阿莫西林胶囊', specification: '0.25g', manufacturer: '甲乙制药有限公司' }
  const captures = [capture('阿莫西林胶囊\n0.25g\n甲乙制药有限公司')]
  const options = { confirmedSameBox: true, checkedAt: '2026-10-03T10:00:00.000Z' }
  const check = createPackagingCheck(product, 'unit001', captures, options)
  const before = structuredClone(check)
  extractPackagingFields(captures)
  assert.deepEqual(createPackagingCheck(product, 'unit001', captures, options), before)
  assert.equal(check.status, 'incomplete')
  assert.equal(check.fields.specification.status, 'missing')
  assert.equal(check.fields.manufacturer.status, 'missing')
  assert.deepEqual(validatePackagingCheck(check), before)
})

test('清洗仅边缘装饰线，保留公司内部连字符与规格内部标点和数字', () => {
  for (const [raw, expected] of [
    ['| 0.25g×24粒 |', '0.25g×24粒'], ['- 0.25g×24粒 -', '0.25g×24粒'],
    ['- │ 0.25g×24粒 │ -', '0.25g×24粒'],
    ['│阿莫西林胶囊┃', '阿莫西林胶囊'], ['丨甲乙制药有限公司丨', '甲乙制药有限公司'],
    ['━━甲乙-丙丁制药有限公司──', '甲乙-丙丁制药有限公司'],
    ['_0.25g/粒×24粒_', '0.25g/粒×24粒'], ['0|25g', '0|25g'], ['O.25g', 'O.25g'],
  ]) assert.equal(cleanOcrCandidateLine(raw), expected)
  for (const decoration of ['│', '━━', '_', '┌───┐', '| ┃ ─ _ |', '-----', '']) assert.equal(cleanOcrCandidateLine(decoration), '')
})

test('装饰包裹的标签清洗后仅建议，不产生recognized历史证据', () => {
  const captures = [capture('|通用名称：阿莫西林胶囊|\n| 规格：0.25g×24粒 |\n│生产企业：甲乙制药有限公司│')]
  const options = getOcrFieldOptions(captures)
  assert.deepEqual(options, { name: ['阿莫西林胶囊'], specification: ['0.25g×24粒'], manufacturer: ['甲乙制药有限公司'] })
  const extracted = extractPackagingFields(captures)
  for (const field of Object.values(extracted)) {
    assert.equal(field.status, 'suggested')
    assert.equal(field.value, '')
    assert.deepEqual(field.candidates, [])
  }
  assert.ok(captures[0].text.startsWith('|通用名称'))
})

test('候选按字段形状筛选，不把电话号码纯数字批准说明或内嵌竖线作为规格', () => {
  const options = getOcrFieldOptions([capture('───\n|阿莫西林胶囊|\n|0.25g×24粒|\n┃甲乙-丙丁制药有限公司┃\n0|25g\nO.25g\n4001234567\n2026-10-03\n国药准字H12345678\n地址：甲乙制药有限公司\n欢迎选择甲乙制药有限公司\n经销商\n甲乙制药有限公司')])
  assert.deepEqual(options, {name:['阿莫西林胶囊'],specification:['0.25g×24粒'],manufacturer:['甲乙-丙丁制药有限公司']})
})

test('独立标签加下一行清洗候选仍按其字段归类且不拼接剂量药名', () => {
  const options = getOcrFieldOptions([capture('【通用名称】\n阿莫西林胶囊\n│规格：│\n|0.25g|\n生产企业：\n甲乙制药有限公司\n0.5g\n24粒')])
  assert.deepEqual(options.name, ['阿莫西林胶囊'])
  assert.deepEqual(options.specification, ['0.25g', '0.5g', '24粒'])
  assert.deepEqual(options.manufacturer, ['甲乙制药有限公司'])
})

test('标签值有边缘装饰不能自动填写，只保留清洗后的建议', () => {
  const fields = extract('通用名称:阿莫西林胶囊|\n规格:│0.25g×24粒│\n生产企业:甲乙制药有限公司─')
  for (const field of Object.values(fields)) {
    assert.equal(field.status, 'suggested')
    assert.equal(field.value, '')
    assert.deepEqual(field.candidates, [])
    assert.equal(field.suggestions.length, 1)
  }
  assert.deepEqual(fields.name.suggestions, ['阿莫西林胶囊'])
})

test('明确标签内部装饰或乱码不能识别，也不猜成正常规格药名厂家', () => {
  for (const [key, label, value] of [
    ['name', '通用名称', '阿莫|西林胶囊'], ['specification', '规格', '0|25g'],
    ['manufacturer', '生产企业', '甲乙│制药有限公司'], ['name', '通用名称', '阿莫�西林胶囊'],
    ['name', '通用名称', '阿莫西林胶囊(成|人用)'], ['name', '通用名称', '阿莫西林胶囊(�)'],
  ]) {
    const field = extract(`${label}:${value}`)[key]
    assert.equal(field.status, 'missing')
    assert.equal(field.value, '')
    assert.deepEqual(field.candidates, [])
    assert.deepEqual(field.suggestions, [])
  }
})

test('明确短厂名保留识别兼容，批准电话日期纯数字及说明正文不自动填', () => {
  assert.equal(extract('生产企业:制药').manufacturer.value, '制药')
  assert.equal(extract('生产企业:制药').manufacturer.status, 'recognized')
  for (const value of ['国药准字H12345678', '400-123-4567', '2026-10-03', '2026年10月03日', '12345678', '请服用阿莫西林胶囊', '详见说明书', '地址甲乙制药有限公司']) {
    for (const [key, label] of [['name', '通用名称'], ['specification', '规格'], ['manufacturer', '生产企业']]) {
      const field = extract(`${label}:${value}`)[key]
      assert.equal(field.value, '', value)
      assert.deepEqual(field.candidates, [], value)
      assert.deepEqual(field.suggestions, [], value)
    }
  }
})

test('有装饰的历史明确证据仍按原文重算冲突，表单过滤不改变它', () => {
  const product = { id: 'p', name: '阿莫西林胶囊', specification: '0.25g', manufacturer: '甲乙制药有限公司' }
  const captures = [capture('通用名称:阿莫西林胶囊|\n规格:0.25g\n生产企业:甲乙制药有限公司')]
  const before = createPackagingCheck(product, 'unit001', captures, {confirmedSameBox:true})
  assert.equal(before.status, 'conflict')
  assert.deepEqual(before.fields.name.observed, ['阿莫西林胶囊|'])
  assert.equal(extractPackagingFields(captures).name.status, 'suggested')
  assert.equal(createPackagingCheck(product, 'unit001', captures, {confirmedSameBox:true,checkedAt:before.checkedAt}).status, 'conflict')
})

function candidateIntake(text, confirmedNameCandidate) {
  const state = addProduct(createEmptyState(), {name:'阿莫西林胶囊',productType:'medicine',trackingMode:'unique'}, {id:'medicine',now:'2026-10-03T10:00:00.000Z'}).state
  const captures = [capture(text)]
  const input = {productId:'medicine',type:'in',quantity:1,codes:['unit001'],confirmBinding:true,
    referenceFromPackaging:{captures,confirmedSameBox:true,...(confirmedNameCandidate === undefined ? {} : {confirmedNameCandidate})},
    packagingChecks:[{unitCode:'unit001',captures,confirmedSameBox:true}]}
  return {state,input}
}

test('人工确认原文清洗候选后可入库，原文核对仍incomplete不升级证据', () => {
  const {state,input} = candidateIntake('│阿莫西林胶囊│', '阿莫西林胶囊')
  const result = recordMovement(state,input,{id:'intake',now:'2026-10-03T10:00:00.000Z'})
  assert.equal(result.state.products[0].stock,1)
  assert.equal(state.products[0].stock,0)
  const check = result.movement.packagingChecks[0]
  assert.equal(check.status,'incomplete')
  assert.equal(check.fields.name.status,'missing')
  assert.equal(check.captures[0].text,'│阿莫西林胶囊│')
  assert.equal(Object.prototype.hasOwnProperty.call(check,'confirmedNameCandidate'),false)
  assert.deepEqual(validatePackagingCheck(check),check)
})

test('未确认、伪造其他候选或无候选原文不允许人工确认绕过', () => {
  for (const [text,confirmed] of [
    ['│阿莫西林胶囊│',undefined],['│阿莫西林胶囊│','布洛芬胶囊'],
    ['只看到普通文字','阿莫西林胶囊'],['│布洛芬胶囊│','阿莫西林胶囊'],['│阿莫西林胶囊│',true],
  ]) {
    const {state,input} = candidateIntake(text,confirmed)
    assert.throws(()=>recordMovement(state,input),/药品名称/)
    assert.equal(state.products[0].stock,0)
    assert.equal(state.movements.length,0)
  }
})

test('明确错药即使有当前药名建议和人工确认仍不能绕过', () => {
  const {state,input} = candidateIntake('通用名称:布洛芬胶囊\n│阿莫西林胶囊│','阿莫西林胶囊')
  assert.throws(()=>recordMovement(state,input),/药品名称/)
})

test('人工确认仍保留旧包装冲突阻断', () => {
  const {state,input} = candidateIntake('通用名称:阿莫西林胶囊|','阿莫西林胶囊')
  assert.throws(()=>recordMovement(state,input),/包装文字存在冲突/)
})
