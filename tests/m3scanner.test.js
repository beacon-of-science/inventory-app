import test from 'node:test'
import assert from 'node:assert/strict'
import { createInventoryBatchScanner } from '../src/scanner/barcodeScanner.js'
const barcode='0012345678905'
const options={ mode:'multiple', barcode }
const make=fn=>createInventoryBatchScanner({platform:'android',plugin:{scanInventoryBatch:fn}})
test('同值不同实体计数保留重复码和前导零',async()=>{
  const result={cancelled:false,codes:[barcode,barcode],quantity:2}
  assert.deepEqual(await make(async()=>result)(options),result)
})
test('单件码允许120ASCII且拒绝重复或121字符',async()=>{
  const code='A'.repeat(120)
  assert.equal((await make(async()=>({cancelled:false,codes:[code],quantity:1}))({...options,mode:'unique'})).codes[0],code)
  for(const codes of [[code,code],['A'.repeat(121)],['中文'],['a\n']]) await assert.rejects(make(async()=>({cancelled:false,codes,quantity:codes.length}))({...options,mode:'unique'}),/识别结果无效/)
})
test('普通SKU不匹配、数量不等和无结果均拒绝',async()=>{
  for(const result of [{cancelled:false,codes:['other'],quantity:1},{cancelled:false,codes:[barcode],quantity:2},{cancelled:false,codes:[],quantity:0}]) await assert.rejects(make(async()=>result)(options),/识别结果无效/)
})
test('取消返回null，错误与并发后锁可释放',async()=>{
  let resolve
  const scan=make(()=>new Promise(r=>{resolve=r}))
  const pending=scan(options)
  await assert.rejects(scan(options),/正在进行/)
  resolve({cancelled:true}); assert.equal(await pending,null)
  const next=scan(options); resolve({cancelled:false,codes:[barcode],quantity:1}); assert.equal((await next).quantity,1)
  const denied=make(async()=>{throw {message:'未获得相机权限'}}); await assert.rejects(denied(options),/未获得相机权限/)
})
test('无效参数与浏览器不会调用插件',async()=>{
  let calls=0;const plugin={scanInventoryBatch:async()=>{calls++}}
  await assert.rejects(createInventoryBatchScanner({platform:'web',plugin})(options),/Android/)
  await assert.rejects(createInventoryBatchScanner({platform:'android',plugin})({mode:'other',barcode}),/参数无效/)
  assert.equal(calls,0)
})

test('无SKU条码的手选商品可扫描单件码',async()=>{
 const scan=make(async()=>({cancelled:false,codes:['trace'],quantity:1}))
 assert.equal((await scan({mode:'unique',barcode:''})).quantity,1)
 await assert.rejects(scan({mode:'single',barcode:''}),/参数无效/)
})
