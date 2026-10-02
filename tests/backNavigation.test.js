import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseBackAction } from '../src/navigation/backNavigation.js'
test('返回优先关闭导入预览和确认对话框，不直接退后台',()=>{
  assert.equal(chooseBackAction({dialog:true,importPreview:true,busy:true}), 'dialog')
  assert.equal(chooseBackAction({importPreview:true,busy:true,backup:true}), 'import')
})
test('二级菜单返回逐层关闭，处理中保持当前状态',()=>{
  for(const layer of ['product','movement','detail','unknown','backup']) assert.equal(chooseBackAction({[layer]:true,tab:'stock'}),layer)
  assert.equal(chooseBackAction({product:true,busy:true}), 'wait')
})
test('筛选和搜索先收起，一级库存/记录回首页，只有首页允许退出',()=>{
  assert.equal(chooseBackAction({filters:true,search:true,tab:'history'}),'filters')
  assert.equal(chooseBackAction({search:true,tab:'stock'}),'search')
  assert.equal(chooseBackAction({tab:'stock'}),'home')
  assert.equal(chooseBackAction({tab:'history'}),'home')
  assert.equal(chooseBackAction({tab:'products'}),'root')
})
