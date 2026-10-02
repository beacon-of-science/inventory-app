import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSwipeNavigation, classifySwipeIntent, SWIPE_TABS } from '../src/navigation/swipeNavigation.js'
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
test('普通轻滑门槛随视口在28到36像素间，纵向及对角滚动不切页', () => {
  assert.equal(resolveSwipeNavigation(gesture({endX:209,durationMs:500})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:208,durationMs:500})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({viewportWidth:600,endX:205,durationMs:500})),null)
  assert.equal(resolveSwipeNavigation(gesture({viewportWidth:600,endX:204,durationMs:500})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({viewportWidth:300,startX:200,endX:172,durationMs:500})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:208,endY:227,durationMs:500})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:208,endY:230,durationMs:500})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:235,endY:500})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:140,endY:310})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:240,endY:200})),null)
})
test('短快甩只需16像素及0.3像素每毫秒，过短抖动或慢短滑不切页', () => {
  assert.equal(resolveSwipeNavigation(gesture({endX:224,endY:200,durationMs:50})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:225,endY:200,durationMs:10})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:224,endY:200,durationMs:60})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:224,endY:200,durationMs:0})),null)
  assert.equal(resolveSwipeNavigation(gesture({endX:210,endY:200,durationMs:100})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({endX:210,endY:200,durationMs:101})),null)
  assert.equal(resolveSwipeNavigation(gesture({currentTab:'stock',startX:150,endX:166,endY:200,durationMs:50})),'products')
})
test('慢滑可持续1200毫秒，不在700毫秒提前取消', () => {
  assert.equal(resolveSwipeNavigation(gesture({durationMs:701})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({durationMs:1200})),'stock')
  assert.equal(resolveSwipeNavigation(gesture({durationMs:1201})),null)
  assert.equal(resolveSwipeNavigation(gesture({durationMs:-1})),null)
})
test('10像素后明确锁向，抖动及45度对角保持pending', () => {
  assert.equal(classifySwipeIntent(9,0),'pending')
  assert.equal(classifySwipeIntent(10,0),'horizontal')
  assert.equal(classifySwipeIntent(-10,2),'horizontal')
  assert.equal(classifySwipeIntent(2,-10),'vertical')
  assert.equal(classifySwipeIntent(10,10),'pending')
  assert.equal(classifySwipeIntent(11.5,10),'horizontal')
  assert.equal(classifySwipeIntent(10,11.5),'vertical')
  for (const value of [null,undefined,'10',NaN,Infinity]) assert.equal(classifySwipeIntent(value,10),'pending')
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
