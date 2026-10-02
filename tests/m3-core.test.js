import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState,addProduct,updateProduct,deleteProduct,recordMovement,validateScanBatch,normalizeUnitCode,isLowStock} from '../src/core/inventory.js'
import {validateState,migrateState,loadState,STORAGE_KEY} from '../src/core/storage.js'
import {exportInventory,parseInventoryImport} from '../src/core/dataTransfer.js'
import {createInventoryStore} from '../src/store/inventoryStore.js'
const now='2026-10-02T00:00:00.000Z'
let seq=0
const meta=()=>({id:`id${++seq}`,now})
function base(){return addProduct(createEmptyState(),{name:'药品',productType:'medicine',trackingMode:'unique',lowStockThreshold:1}, {id:'p',now}).state}
const input=(type='in',codes=['001'],extra={})=>({productId:'p',type,codes,quantity:codes.length,...extra})
const move=(state,value)=>recordMovement(state,value,meta()).state

test('M3 首次绑定预览及确认、出库回库、唯一性和批次防重',()=>{
 let s=base();const snapshot=JSON.stringify(s)
 assert.deepEqual(validateScanBatch(s,input()).newCodes,['001'])
 assert.throws(()=>move(s,input()),/确认/);assert.equal(JSON.stringify(s),snapshot)
 s=move(s,input('in',['001'],{confirmBinding:true,batchId:'b1'}));validateState(s)
 assert.equal(s.units[0].code,'001');assert.equal(s.products[0].stock,1);assert.equal(isLowStock(s.products[0]),true)
 assert.throws(()=>move(s,input('in',['002'],{confirmBinding:true,batchId:'b1'})),/批次/)
 assert.throws(()=>move(s,input()),/在库/)
 assert.throws(()=>move(s,input('out',['001','001'])),/重复/)
 assert.throws(()=>move(s,{...input(),quantity:2}),/数量/)
 s=move(s,input('out'));validateState(s);assert.equal(s.units[0].status,'out')
 assert.throws(()=>move(s,input('out')),/在库/)
 assert.deepEqual(validateScanBatch(s,input()).returnCodes,['001'])
 s=move(s,input());validateState(s);assert.equal(s.products[0].stock,1)
 assert.throws(()=>updateProduct(s,'p',{trackingMode:'quantity',productType:'ordinary'}),/切换/)
 s=move(s,input('out'));assert.throws(()=>deleteProduct(s,'p'),/实例/)
 const second=addProduct(s,{name:'另一个',trackingMode:'unique'},{id:'p2',now}).state
 assert.throws(()=>move(second,{...input(),productId:'p2',confirmBinding:true}),/其他商品/)
 assert.deepEqual(parseInventoryImport(exportInventory(s)),s)
})
test('M3 单件输入保持前导零，拒绝控制字符及长度、数量模式拒绝codes',()=>{
 assert.equal(normalizeUnitCode(' 0001 '),'0001')
 for(const v of ['', 'x'.repeat(121),'\t001','中文',1]) assert.throws(()=>normalizeUnitCode(v))
 const s=addProduct(createEmptyState(),{name:'普通'},{id:'p',now}).state
 assert.throws(()=>move(s,input()),/数量商品/)
 assert.throws(()=>addProduct(s,{name:'药品',productType:'medicine'}),/药品/)
})
test('M3 旧库存归零才允许切换，旧版导入迁移不伪造实例',()=>{
 let s=addProduct(createEmptyState(),{name:'旧商品'},{id:'p',now}).state
 s=move(s,{productId:'p',type:'in',quantity:3})
 assert.throws(()=>updateProduct(s,'p',{trackingMode:'unique'}),/切换/)
 s=move(s,{productId:'p',type:'out',quantity:3})
 const old=JSON.parse(JSON.stringify(s));delete old.units
 for(const p of old.products){delete p.productType;delete p.trackingMode;delete p.category;delete p.lowStockThreshold;delete p.barcode}
 for(const m of old.movements)delete m.codes
 const migrated=loadState({getItem:()=>JSON.stringify({version:1,state:old})})
 assert.equal(migrated.products[0].productType,'unknown');assert.deepEqual(migrated.units,[])
 assert.deepEqual(parseInventoryImport(JSON.stringify({format:'inventory-app',version:1,exportedAt:now,state:old})),migrated)
 s=updateProduct(s,'p',{trackingMode:'unique'},meta()).state;s=move(s,input('in',['new'],{confirmBinding:true}));validateState(s)
 assert.throws(()=>parseInventoryImport(JSON.stringify({format:'inventory-app',version:1,exportedAt:now,state:s})),/版本1/)
})
test('M3 篡改单件状态、引用、唯一码历史和批次被拒绝',()=>{
 const s=move(base(),input('in',['001'],{confirmBinding:true,batchId:'batch'}))
 const edits=[x=>x.units[0].status='out',x=>x.units.push({...x.units[0]}),x=>x.units[0].productId='missing',x=>x.units[0].updatedAt='2026-10-03T00:00:00.000Z',x=>x.movements[0].codes=['002'],x=>x.movements[0].codes=[],x=>x.movements[0].codes=null]
 for(const edit of edits){const x=structuredClone(s);edit(x);assert.throws(()=>validateState(x))}
})
test('M3 保存失败不改内存或存储、批次持久化防重',()=>{
 let raw=null,fail=false,writes=0
 const storage={getItem:()=>raw,setItem:(key,value)=>{if(fail)throw Error('disk');assert.equal(key,STORAGE_KEY);raw=value;writes++}}
 const store=createInventoryStore(storage);const p=store.addProduct({name:'药品',trackingMode:'unique',productType:'medicine'})
 const value={...input('in',['001'],{confirmBinding:true,batchId:'persist'}),productId:p.id}
 const before=JSON.stringify(store.state),previous=raw;fail=true
 assert.throws(()=>store.recordMovement(value),/保存/);assert.equal(JSON.stringify(store.state),before);assert.equal(raw,previous)
 fail=false;store.recordMovement(value);assert.equal(writes,2);assert.equal(JSON.parse(raw).version,2)
 const restored=createInventoryStore(storage);assert.equal(restored.state.units.length,1)
 assert.throws(()=>restored.recordMovement(value),/批次/);assert.equal(writes,2)
})

test('M3 商品新增编辑删除及普通流水均保留其他商品单件实例',()=>{
 let s=move(base(),input('in',['001'],{confirmBinding:true}))
 const units=s.units
 s=addProduct(s,{name:'普通'},{id:'ordinary',now}).state;assert.deepEqual(s.units,units)
 s=updateProduct(s,'p',{productType:'ordinary'},meta()).state;assert.equal(s.products[0].trackingMode,'unique');assert.deepEqual(s.units,units)
 s=move(s,{productId:'ordinary',type:'in',quantity:2});assert.deepEqual(s.units,units)
 s=move(s,{productId:'ordinary',type:'out',quantity:2});assert.deepEqual(s.units,units)
 s=deleteProduct(s,'ordinary').state;assert.deepEqual(s.units,units);validateState(s)
})
test('M3 归零但建立过实例仍不能切换；空实例模式可自由切换',()=>{
 let s=base();s=updateProduct(s,'p',{productType:'ordinary',trackingMode:'quantity'},meta()).state
 s=updateProduct(s,'p',{trackingMode:'unique'},meta()).state
 s=move(s,input('in',['001'],{confirmBinding:true}));s=move(s,input('out'))
 assert.throws(()=>updateProduct(s,'p',{trackingMode:'quantity'},meta()),/切换/)
})
