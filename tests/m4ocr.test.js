import test from 'node:test'
import assert from 'node:assert/strict'
import {createPackagingOcr} from '../src/ocr/packagingOcr.js'
const make=capture=>createPackagingOcr({platform:'android',plugin:{capture}})
test('包装识别保留这一面原文，不对文字拼接或修改',async()=>{
 const text='  药名：阿莫西林胶囊\n规格：0.25g\n生产厂家：测试制药  '
 assert.deepEqual(await make(async()=>({cancelled:false,text}))(),{text})
})
test('包装OCR取消返回null并可重试',async()=>{let n=0;const capture=make(async()=>++n===1?{cancelled:true}:{cancelled:false,text:'文字'});assert.equal(await capture(),null);assert.equal((await capture()).text,'文字')})
test('包装OCR仅Android可启动',async()=>{let n=0;await assert.rejects(createPackagingOcr({platform:'web',plugin:{capture(){n++}}})(),/Android/);assert.equal(n,0)})
test('OCR并发拒绝，成功与错误均释放锁',async()=>{
 let resolve;const capture=make(()=>new Promise(r=>resolve=r));const pending=capture();await assert.rejects(capture(),/正在进行/);resolve({cancelled:false,text:'甲'});assert.equal((await pending).text,'甲');const next=capture();resolve({cancelled:true});assert.equal(await next,null)
 let n=0;const denied=make(async()=>{if(++n===1)throw {message:'未获得相机权限'};return {cancelled:false,text:'乙'}});await assert.rejects(denied(),/相机权限/);assert.equal((await denied()).text,'乙')
})
test('OCR无效结果与超过4000文字拒绝且可重试',async()=>{
 for(const value of [null,{}, {cancelled:false,text:''},{cancelled:false,text:' \n '},{cancelled:false,text:123},{cancelled:false,text:'字'.repeat(4001)},{text:'文字'}]){let n=0;const capture=make(async()=>++n===1?value:{cancelled:false,text:'有效文字'});await assert.rejects(capture(),/有效包装文字/);assert.equal((await capture()).text,'有效文字')}
 assert.equal((await make(async()=>({cancelled:false,text:'字'.repeat(4000)}))()).text.length,4000)
})
test('OCR外语错误转换为可读中文',async()=>{await assert.rejects(make(async()=>{throw new Error('unknown')})(),/包装文字识别失败/)})
