import test from 'node:test'
import assert from 'node:assert/strict'
import {createPackagingCheck,extractPackagingFields} from '../src/core/packaging.js'
import {createEmptyState,addProduct,updateProduct,recordMovement} from '../src/core/inventory.js'
import {validateState,loadState} from '../src/core/storage.js'
import {exportInventory,parseInventoryImport} from '../src/core/dataTransfer.js'
import {createInventoryStore} from '../src/store/inventoryStore.js'
const now='2026-10-02T10:00:00.000Z'
const product={id:'p',name:'阿莫西林胶囊',specification:'0.25g*24粒',manufacturer:'甲制药有限公司',productType:'medicine',trackingMode:'unique'}
const capture=(text,id='face')=>({id,text,createdAt:now})
const full='药品名称:阿莫西林胶囊\n规格:0.25g*24粒\n生产企业:甲制药有限公司'
const check=(text=full,p=product)=>createPackagingCheck(p,'001',[capture(text)],{confirmedSameBox:true,checkedAt:now})
const base=()=>addProduct(createEmptyState(),product,{id:'p',now}).state
const input=(checks,type='in')=>({productId:'p',type,quantity:1,codes:['001'],confirmBinding:true,packagingChecks:checks})
test('M4 全字段保守匹配、前缀单位数字不含糊、多面冲突优先',()=>{
 assert.equal(check().status,'matched')
 assert.equal(check(full.replaceAll('\n',' ')).status,'matched')
 assert.equal(check('阿莫西林胶囊\n【规格】０．２５ｇ×２４粒\n生产厂家：甲制药有限公司').status,'matched')
 for(const wrong of ['0.25mg*24粒','0.25g*12粒','0.25g','0.25g*24粒其他']) assert.equal(check(full.replace('0.25g*24粒',wrong)).status,'conflict')
 assert.equal(check('推荐阿莫西林胶囊\n阿莫西林胶囊说明书').fields.name.status,'missing')
 const record=createPackagingCheck(product,'001',[capture(full),capture('规格:0.5g*24粒','other')],{confirmedSameBox:true,checkedAt:now})
 assert.equal(record.fields.specification.status,'conflict');assert.equal(record.status,'conflict')
 const multi=createPackagingCheck(product,'001',[capture('商品名称:阿莫西林胶囊'),capture('规格:0.25g*24粒','f2'),capture('厂家:甲制药有限公司','f3')],{confirmedSameBox:true,checkedAt:now})
 assert.equal(multi.status,'matched')
 assert.equal(check(full,{...product,manufacturer:''}).fields.manufacturer.status,'unconfigured')
 assert.equal(check(full,{...product,manufacturer:''}).status,'incomplete')
})
test('M4 同盒确认、capture数量文本标识时间严格验证',()=>{
 assert.throws(()=>createPackagingCheck(product,'001',[capture(full)],{}),/同一个/)
 for(const captures of [[],Array.from({length:7},(_,i)=>capture(full,String(i))),[capture('')],[capture('x'.repeat(4001))],[capture(full),capture(full)],[{...capture(full),createdAt:'invalid'}]]) assert.throws(()=>createPackagingCheck(product,'001',captures,{confirmedSameBox:true}))
})
test('M4 当前商品重算防伪，冲突禁止、未核实允许、单件归属限制',()=>{
 const s=base(),snapshot=JSON.stringify(s)
 const forged={...check(full.replace('0.25g','0.5g')),status:'matched',fields:check().fields}
 assert.throws(()=>recordMovement(s,input([forged]),{id:'m',now}),/冲突/);assert.equal(JSON.stringify(s),snapshot)
 for(const bad of [{...check(),unitCode:'other'},{...check(),productId:'other'},{...check(),confirmedSameBox:false}]) assert.throws(()=>recordMovement(s,input([bad]),{id:'m',now}))
 assert.throws(()=>recordMovement(s,input([check(),check()]),{id:'m',now}),/不一致/)
 const r=recordMovement(s,input([check('识别不清')]),{id:'m',now});assert.equal(r.movement.packagingChecks[0].status,'incomplete');validateState(r.state)
 const ordinary=addProduct(createEmptyState(),{name:'普通'},{id:'p',now}).state
 assert.throws(()=>recordMovement(ordinary,{productId:'p',type:'in',quantity:1,packagingChecks:[check()]},{id:'m',now}),/不一致/)
})
test('M4 历史快照编辑后不改，最新实例沿用历史且无本次check流水为空',()=>{
 let s=recordMovement(base(),input([check()]),{id:'m1',now}).state
 const original=structuredClone(s.movements[0].packagingChecks[0])
 s=updateProduct(s,'p',{specification:'0.5g*24粒',manufacturer:'乙药业'},{id:'x',now}).state
 validateState(s);assert.deepEqual(s.units[0].packagingCheck,original)
 s=recordMovement(s,input([],'out'),{id:'m2',now}).state
 assert.deepEqual(s.movements[1].packagingChecks,[]);assert.deepEqual(s.units[0].packagingCheck,original);validateState(s)
 const corrupted=JSON.parse(JSON.stringify(s));corrupted.units[0].packagingCheck.checkedAt='2026-10-03T00:00:00.000Z';assert.throws(()=>validateState(corrupted),/最新/)
 assert.deepEqual(parseInventoryImport(exportInventory(s)),s)
})
test('M4 原子保存失败与重新加载',()=>{
 let raw=null,fail=false
 const storage={getItem:()=>raw,setItem:(k,v)=>{if(fail)throw Error('quota');raw=v}}
 const store=createInventoryStore(storage);const p=store.addProduct(product)
 const value={...input([check(full,{...product,id:p.id})]),productId:p.id}
 const snapshot=JSON.stringify(store.state),previous=raw;fail=true
 assert.throws(()=>store.recordMovement(value),/保存/);assert.equal(JSON.stringify(store.state),snapshot);assert.equal(raw,previous)
 fail=false;store.recordMovement(value);assert.equal(JSON.parse(raw).version,3)
 const restored=createInventoryStore(storage);assert.equal(restored.state.units[0].packagingCheck.status,'matched');assert.deepEqual(JSON.parse(JSON.stringify(restored.state)),JSON.parse(JSON.stringify(store.state)))
})
test('M4 v1/v2迁移和版本隔离，不伪造旧版本包装数据',()=>{
 const legacy=addProduct(createEmptyState(),{name:'旧商品'},{id:'old',now}).state
 delete legacy.products[0].specification;delete legacy.products[0].manufacturer
 for(const version of [1,2]) {
  const migrated=loadState({getItem:()=>JSON.stringify({version,state:legacy})})
  assert.equal(migrated.products[0].manufacturer,'');assert.equal(migrated.products[0].specification,'')
  assert.deepEqual(parseInventoryImport(JSON.stringify({format:'inventory-app',version,exportedAt:now,state:legacy})),migrated)
 }
 const s=recordMovement(base(),input([check()]),{id:'m',now}).state
 const exported=JSON.parse(exportInventory(s));assert.equal(exported.version,3)
 for(const version of [1,2]) assert.throws(()=>parseInventoryImport(JSON.stringify({...exported,version})))
 for(const value of [null,1,'x'.repeat(121)]) assert.throws(()=>addProduct(createEmptyState(),{name:'x',specification:value}))
})

test('M4 显式标签分行读取紧邻非空值，空白和全半角可规范',()=>{
 const text='【药品名称】\n 阿莫西林胶囊 \n\n【规格】\n\n ０．２５ｇ×２４粒 \n生产企业：\n 甲制药有限公司 '
 const result=check(text)
 assert.equal(result.status,'matched')
 assert.deepEqual(result.fields.specification.observed,['0.25g×24粒'])
})
test('M4 标签分行冲突仍优先，不能忽略另一面或另一组明确冲突',()=>{
 const result=check('规格：\n0.25g*24粒\n【规格】\n0.5g*24粒\n药品名称：\n阿莫西林胶囊\n生产厂家：\n甲制药有限公司')
 assert.equal(result.fields.specification.status,'conflict');assert.equal(result.status,'conflict')
 assert.deepEqual(result.fields.specification.observed,['0.25g*24粒','0.5g*24粒'])
})
test('M4 标签之间不跨越，相邻标签缺值为missing，不串面补值',()=>{
 const result=check('规格：\n\n生产企业：\n甲制药有限公司\n药品名称：\n阿莫西林胶囊')
 assert.equal(result.fields.specification.status,'missing');assert.deepEqual(result.fields.specification.observed,[])
 assert.equal(result.fields.manufacturer.status,'matched');assert.equal(result.status,'incomplete')
 const unknown=check('规格：\n批准文号：国药准字000\n0.25g*24粒')
 assert.equal(unknown.fields.specification.status,'missing')
 const cross=createPackagingCheck(product,'001',[capture('【规格】'),capture('0.25g*24粒','second')],{confirmedSameBox:true,checkedAt:now})
 assert.equal(cross.fields.specification.status,'missing')
 const final=check('药品名称：\n阿莫西林胶囊\n规格：')
 assert.equal(final.fields.specification.status,'missing')
})


test('M4 入库照片提取三字段，名称仅唯一短完整药品标题或明确标签',()=>{
 const extracted=extractPackagingFields([capture(full)])
 assert.equal(extracted.name.value,product.name);assert.equal(extracted.specification.value,product.specification);assert.equal(extracted.manufacturer.value,product.manufacturer)
 assert.equal(extractPackagingFields([capture('阿莫西林胶囊')]).name.status,'suggested')
 for(const text of ['请服用阿莫西林胶囊','本品用于治疗感染，属于阿莫西林胶囊','生产企业：\n阿莫西林胶囊']) assert.equal(extractPackagingFields([capture(text)]).name.status,'missing')
 assert.equal(extractPackagingFields([capture('阿莫西林胶囊\n布洛芬胶囊')]).name.status,'ambiguous')
 assert.equal(extractPackagingFields([capture('规格:0.25g*24粒\n规格:０．２５ｇ×２４粒')]).specification.status,'recognized')
 assert.equal(extractPackagingFields([capture('规格:0.25g*24粒\n规格:0.5g*24粒')]).specification.status,'ambiguous')
 assert.throws(()=>extractPackagingFields([]))
})
test('M4 照片参考填充空字段随流水原子提交，并用新参考核对同组文字',()=>{
 const empty={...product,specification:'',manufacturer:''}
 const s=addProduct(createEmptyState(),empty,{id:'p',now}).state
 const captures=[capture(full)]
 const value={...input([{unitCode:'001',captures,confirmedSameBox:true}]),referenceFromPackaging:{captures,confirmedSameBox:true}}
 const result=recordMovement(s,value,{id:'m',now})
 assert.equal(s.products[0].specification,'');assert.equal(s.products[0].manufacturer,'')
 assert.equal(result.state.products[0].specification,product.specification);assert.equal(result.state.products[0].manufacturer,product.manufacturer)
 assert.equal(result.movement.packagingChecks[0].status,'matched');validateState(result.state)
 assert.deepEqual(parseInventoryImport(exportInventory(result.state)),result.state)
})
test('M4 照片参考保护原值、错药及模糊名称拒绝；缺字段继续留空',()=>{
 for(const text of [full.replace(product.name,'布洛芬胶囊'),full.replace(product.specification,'0.5g*24粒'),full.replace(product.manufacturer,'其他药业'),full+'\n商品名称:布洛芬胶囊','规格:0.25g*24粒']) {
  const s=base(),snapshot=JSON.stringify(s)
  assert.throws(()=>recordMovement(s,{...input([]),referenceFromPackaging:{captures:[capture(text)],confirmedSameBox:true}},{id:'m',now}));assert.equal(JSON.stringify(s),snapshot)
 }
 const s=addProduct(createEmptyState(),{...product,specification:'',manufacturer:''},{id:'p',now}).state
 const r=recordMovement(s,{...input([]),referenceFromPackaging:{captures:[capture(product.name)],confirmedSameBox:true}},{id:'m',now})
 assert.equal(r.state.products[0].specification,'');assert.equal(r.state.products[0].manufacturer,'')
 assert.throws(()=>recordMovement(r.state,{...input([],'out'),referenceFromPackaging:{captures:[capture(full)],confirmedSameBox:true}},{id:'out',now}),/入库/)
})

test('M4 照片参考保存失败不更新规格企业，重试与重载保留提取结果',()=>{
 let raw=null,fail=false
 const storage={getItem:()=>raw,setItem:(key,value)=>{if(fail)throw Error('disk');raw=value}}
 const store=createInventoryStore(storage);const p=store.addProduct({...product,specification:'',manufacturer:''})
 const captures=[capture(full)],value={...input([{unitCode:'001',captures,confirmedSameBox:true}]),productId:p.id,referenceFromPackaging:{captures,confirmedSameBox:true}}
 const snapshot=JSON.stringify(store.state),previous=raw;fail=true
 assert.throws(()=>store.recordMovement(value),/保存/);assert.equal(JSON.stringify(store.state),snapshot);assert.equal(raw,previous)
 fail=false;store.recordMovement(value)
 const restored=createInventoryStore(storage);assert.equal(restored.state.products[0].specification,product.specification);assert.equal(restored.state.products[0].manufacturer,product.manufacturer);assert.equal(restored.state.units[0].packagingCheck.status,'matched')
})
