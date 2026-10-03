import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPackagingFields, createPackagingCheck } from '../src/core/packaging.js'
import { autofillProductDraft } from '../src/ocr/productAutofill.js'
const capture = text => ({id:'face',text,createdAt:'2026-10-03T05:54:00.000Z'})
const fields = text => extractPackagingFields([capture(text)])
const empty = () => ({name:'',specification:'',manufacturer:''})

test('单一无标签药名规格厂家自动填入草稿，仍属于推测',()=>{
  const text='卡维地洛片\n每片12.5mg, 内装14片\n齐鲁制药有限公司'
  const extracted=fields(text), draft=autofillProductDraft(empty(),extracted)
  assert.deepEqual(draft.values,{name:'卡维地洛片',specification:'每片12.5mg, 内装14片',manufacturer:'齐鲁制药有限公司'})
  assert.deepEqual(draft.automatic,draft.values)
  for(const field of Object.values(extracted)){assert.equal(field.status,'suggested');assert.equal(field.value,'')}
  const check=createPackagingCheck({id:'p',...draft.values},'unit1',[capture(text)],{confirmedSameBox:true})
  assert.equal(check.status,'incomplete')
  assert.equal(check.fields.specification.status,'missing')
})
test('含量包装描述保留原始数字，不吸纳服用说明和破碎剂量',()=>{
  for(const text of ['每片12.5mg，内装14片','每片含12.5mg 内装14片','每粒0.25g；内装24粒']) assert.equal(fields(text).specification.suggestions.length,1,text)
  for(const text of ['每次12.5mg, 内装14片','每日服用12.5mg','每片0|25g, 内装14片','每片12.5mg, 内装14片，请服用','每片12.5mg 内装1O片']) assert.equal(fields(text).specification.suggestions.length,0,text)
})
test('多个候选不填，补拍引出冲突时撤回仍未修改的自动草稿',()=>{
  const initial=autofillProductDraft(empty(),fields('卡维地洛片'))
  const conflict=autofillProductDraft(initial.values,fields('卡维地洛片\n布洛芬片'),initial.automatic)
  assert.equal(conflict.values.name,'');assert.deepEqual(conflict.automatic,{})
  assert.equal(autofillProductDraft(empty(),fields('通用名称:布洛芬片\n卡维地洛片')).values.name,'')
})
test('手动填写、已保存信息及人工选定候选不会被补拍覆盖',()=>{
  const original={name:'手动名称',specification:'手动规格',manufacturer:'伯兰特罗素'}
  assert.deepEqual(autofillProductDraft(original,fields('卡维地洛片\n每片12.5mg 内装14片\n齐鲁制药有限公司')).values,original)
  const initial=autofillProductDraft(empty(),fields('卡维地洛片'))
  initial.values.name='人工校正的名称'
  assert.equal(autofillProductDraft(initial.values,fields('布洛芬片'),initial.automatic).values.name,'人工校正的名称')
  assert.equal(autofillProductDraft({name:'卡维地洛片'},fields('布洛芬片'),{}).values.name,'卡维地洛片')
})
test('清除拍摄撤回自动内容但保留已修改内容，空白候选不填写',()=>{
  const initial=autofillProductDraft(empty(),fields('卡维地洛片\n齐鲁制药有限公司'))
  initial.values.manufacturer='人工厂家'
  const reset=autofillProductDraft(initial.values,{},initial.automatic)
  assert.equal(reset.values.name,'');assert.equal(reset.values.manufacturer,'人工厂家');assert.deepEqual(reset.automatic,{})
  assert.deepEqual(autofillProductDraft(empty(),fields('电话号码400-123-4567')).values,empty())
})
