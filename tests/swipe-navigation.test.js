import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSwipeNavigation, SWIPE_TABS } from '../src/navigation/swipeNavigation.js'
const gesture = (changes = {}) => ({currentTab:'products',startX:240,startY:200,endX:140,endY:210,durationMs:180,viewportWidth:400,...changes})

test('左滑与右滑只切换相邻商品、出入库和记录页', () => {
  assert.deepEqual(SWIPE_TABS,['products','stock','history'])
  assert.equal(resolveSwipeNavigation(gesture()),'stock')
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'stock'})),'history')
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'stock',startX:140,endX:240})),'products')
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'history',startX:140,endX:240})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({startX:350,endX:30})),'stock')
})
test('最左及最右页面不循环也不越界', () => {
  assert.equal(resolveSwipeNavigation(gesture({startX:140,endX:240})),null)
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'history'})),null)
})
test('60像素门槛与横向明显优势过滤误触和纵向滚动', () => {
  assert.equal(resolveSwipeNavigation(gesture({endX:181})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:180,endY:200})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:180,endY:240})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:180,endY:241})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:235,endY:500})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:140,endY:310})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:240,endY:200})),null)
})
test('超过700毫秒的长按拖动不能切页', () => {
  assert.equal(resolveSwipeNavigation(gesture({durationMs:700})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({durationMs:701})),null)
  assert.equal(resolveSwipeNavigation(gesture({durationMs:-1})),null)
})
test('两侧24像素系统返回区域起点均排除', () => {
  for (const startX of [0,24,376,399,400]) assert.equal(resolveSwipeNavigation(gesture({startX,endX:startX<100?startX+100:startX-100,currentTab:'stock'})),null)
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'stock',startX:25,endX:125})),'products')
  assert.equal(resolveSwipeNavigation(gesture({startX:375,endX:275})),'stock')
})
test('坏坐标、时间、页签和视口不触发导航，输入不被修改', () => {
  for (const key of ['startX','startY','endX','endY','durationMs','viewportWidth']) {
    for (const value of [undefined,null,'100',NaN,Infinity,-Infinity]) assert.equal(resolveSwipeNavigation(gesture({[key]:value})),null)
  }
  for (const changes of [{currentTab:'settings'},{viewportWidth:48},{viewportWidth:-1},{startY:-1},{endY:-1},{endX:-1},{endX:401}]) assert.equal(resolveSwipeNavigation(gesture(changes)),null)
  for (const value of [null,undefined,[],false]) assert.equal(resolveSwipeNavigation(value),null)
  const frozen=Object.freeze(gesture())
  assert.equal(resolveSwipeNavigation(frozen),'stock')
  assert.deepEqual(frozen,gesture())
})
