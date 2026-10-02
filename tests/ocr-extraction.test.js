import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPackagingFields, createPackagingCheck, validatePackagingCheck } from '../src/core/packaging.js'

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
