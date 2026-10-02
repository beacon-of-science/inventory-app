<script setup>
import { computed, ref, unref } from 'vue'
import { showToast, showConfirmDialog } from 'vant'
import { createInventoryStore } from './store/inventoryStore.js'
import { scanBarcode } from './scanner/barcodeScanner.js'
import { normalizeBarcode, findProductByScan } from './core/inventory.js'

const store = createInventoryStore()
const tab = ref('products')
const search = ref('')
const historyFilter = ref('all')
const productSheet = ref(false)
const movementSheet = ref(false)
const detailSheet = ref(false)
const detailId = ref('')
const editingId = ref('')
const formError = ref('')
const movementError = ref('')
const status = ref('')
const scanning = ref(false)
const unknownBarcode = ref('')
const unknownSheet = ref(false)
const productForm = ref({ name: '', sku: '', barcode: '', unit: '件', note: '' })
const movementForm = ref({ productId: '', type: 'in', quantity: '', note: '' })
const storageError = computed(() => unref(store.error) || '')
const products = computed(() => store.state.products)
const movements = computed(() => store.state.movements)
const totalStock = computed(() => products.value.reduce((sum, product) => sum + product.stock, 0))
const inStockCount = computed(() => products.value.filter(product => product.stock > 0).length)
const filteredProducts = computed(() => {
  const query = search.value.trim().toLowerCase()
  return [...products.value].filter(product => !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query) || (product.barcode || '').toLowerCase().includes(query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})
const filteredMovements = computed(() => [...movements.value]
  .filter(movement => historyFilter.value === 'all' || movement.type === historyFilter.value)
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const detailProduct = computed(() => products.value.find(product => product.id === detailId.value))
const movementProduct = computed(() => products.value.find(product => product.id === movementForm.value.productId))
const pageTitle = computed(() => ({ products: '商品管理', stock: '当前库存', history: '出入库记录' }[tab.value]))
const pageDescription = computed(() => ({ products: '每一件商品，都井井有条。', stock: '看清库存，及时记录每一次变化。', history: '从入库到出库，变化都有迹可循。' }[tab.value]))

function formatDate(value, full = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', ...(full ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
function notify(message) {
  status.value = message
  showToast({ message, position: 'top' })
}
function openProduct(product, barcode = '') {
  if (storageError.value) return
  editingId.value = product?.id || ''
  productForm.value = { name: product?.name || '', sku: product?.sku || '', barcode: product?.barcode || barcode, unit: product?.unit || '件', note: product?.note || '' }
  formError.value = ''
  productSheet.value = true
}
async function startScan(target = 'lookup') {
  if (scanning.value || storageError.value) return
  scanning.value = true
  try {
    const result = await scanBarcode()
    if (!result) { notify('已取消扫码'); return }
    const barcode = normalizeBarcode(result.barcode)
    if (!barcode) {
      notify('条码内容为空，请重新扫描或手动输入。')
      return
    }
    if (target === 'form') {
      if (!productSheet.value) return
      productForm.value.barcode = barcode
      formError.value = ''
      notify('条码已填入，请确认商品信息后保存')
      return
    }
    const product = findProductByScan(store.state, { barcode, format: result.format })
    if (product) {
      openDetail(product)
      notify(`已找到商品：${product.name}`)
    } else {
      unknownBarcode.value = barcode
      unknownSheet.value = true
    }
  } catch (error) {
    notify(error.message || '扫码失败，请重试或手动输入条码。')
  } finally {
    scanning.value = false
  }
}
function addScannedProduct() {
  unknownSheet.value = false
  openProduct(undefined, unknownBarcode.value)
}
function saveProduct() {
  if (storageError.value || scanning.value) return
  const input = Object.fromEntries(Object.entries(productForm.value).map(([key, value]) => [key, key === 'barcode' ? value : value.trim()]))
  if (!input.name) { formError.value = '请输入商品名称。'; return }
  if (!input.unit) { formError.value = '请输入计量单位，例如件、箱或千克。'; return }
  try {
    if (editingId.value) store.updateProduct(editingId.value, input)
    else store.addProduct(input)
    productSheet.value = false
    notify(editingId.value ? '商品信息已更新' : '商品已添加，可以开始入库了')
  } catch (error) { formError.value = error.message || '保存失败，请重试。' }
}
function openDetail(product) {
  detailId.value = product.id
  detailSheet.value = true
}
function editDetail() {
  const product = detailProduct.value
  detailSheet.value = false
  openProduct(product)
}
async function removeProduct() {
  const product = detailProduct.value
  if (!product || storageError.value || product.stock > 0) return
  try {
    await showConfirmDialog({ title: '删除商品', message: `确定删除“${product.name}”吗？已有出入库记录会保留。`, confirmButtonText: '确认删除', cancelButtonText: '取消', confirmButtonColor: '#c74c4c' })
  } catch { return }
  try {
    store.deleteProduct(product.id)
    detailSheet.value = false
    notify('商品已删除，历史记录已保留')
  } catch (error) { notify(error.message || '删除失败，请重试。') }
}
function openMovement(type, product) {
  if (storageError.value) return
  movementForm.value = { productId: product?.id || products.value[0]?.id || '', type, quantity: '', note: '' }
  movementError.value = ''
  detailSheet.value = false
  movementSheet.value = true
}
function saveMovement() {
  if (storageError.value) return
  const quantity = Number(movementForm.value.quantity)
  if (!movementForm.value.productId) { movementError.value = '请先选择商品。'; return }
  if (!/^[1-9]\d*$/.test(String(movementForm.value.quantity)) || !Number.isSafeInteger(quantity)) { movementError.value = '数量必须是大于 0 的整数。'; return }
  if (movementForm.value.type === 'out' && quantity > (movementProduct.value?.stock || 0)) { movementError.value = '出库数量不能超过当前库存。'; return }
  try {
    store.recordMovement({ ...movementForm.value, quantity, note: movementForm.value.note.trim() })
    movementSheet.value = false
    notify(movementForm.value.type === 'in' ? '入库成功，库存已更新' : '出库成功，库存已更新')
  } catch (error) { movementError.value = error.message || '记录失败，请重试。' }
}
</script>

<template>
  <div class="app-shell">
    <aside class="desktop-rail">
      <a class="brand" href="#" @click.prevent="tab = 'products'" aria-label="简库存首页">
        <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" stroke-width="1.7"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.2 8 4.5" stroke="currentColor" stroke-width="1.7"/></svg></span>
        <span>简库存<small>INVENTORY</small></span>
      </a>
      <nav class="rail-nav" aria-label="主导航">
        <button v-for="item in [{ id: 'products', label: '商品', icon: 'apps-o' }, { id: 'stock', label: '库存', icon: 'orders-o' }, { id: 'history', label: '记录', icon: 'clock-o' }]" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id; search = ''" :aria-current="tab === item.id ? 'page' : undefined"><van-icon :name="item.icon" /><span>{{ item.label }}</span></button>
      </nav>
      <div class="rail-note"><span class="connection-dot"></span> 本机保存<small>简单记录，安心管理</small></div>
    </aside>

    <div class="main-layout">
      <header class="mobile-brand"><span class="mini-mark"><van-icon name="box" /></span><span>简库存</span><span class="local-badge"><i></i> 本机保存</span></header>
      <main>
        <div class="page-heading">
          <div><p class="eyebrow">YOUR EVERYDAY INVENTORY</p><h1>{{ pageTitle }}</h1><p class="page-subtitle">{{ pageDescription }}</p></div>
          <button v-if="tab === 'products'" class="button button-primary desktop-add" :disabled="!!storageError" @click="openProduct()"><van-icon name="plus" />新增商品</button>
          <div v-if="tab === 'stock'" class="heading-actions"><button class="button button-secondary" :disabled="!!storageError || !products.length" @click="openMovement('out')"><van-icon name="minus" />出库</button><button class="button button-primary" :disabled="!!storageError || !products.length" @click="openMovement('in')"><van-icon name="plus" />入库</button></div>
        </div>

        <div v-if="storageError" class="storage-alert" role="alert"><van-icon name="warning-o" /><div><strong>暂时无法使用本机数据</strong><p>{{ storageError }}</p><p>为保护现有记录，新增、修改和出入库暂不可用。</p></div></div>

        <section v-if="tab !== 'history'" class="overview-grid" aria-label="库存概览">
          <div class="overview-card overview-main"><div><span class="stat-label">商品种类</span><div class="stat-value">{{ products.length }}<small>种</small></div><span class="stat-caption">已建立的商品档案</span></div><span class="stat-symbol"><van-icon name="apps-o" /></span></div>
          <div class="overview-card"><div><span class="stat-label">有库存商品</span><div class="stat-value">{{ inStockCount }}<small>种</small></div><span class="stat-caption">{{ products.length ? `${products.length - inStockCount} 种商品暂无库存` : '添加商品后即可记录库存' }}</span></div><span class="stat-symbol mint"><van-icon name="orders-o" /></span></div>
          <div class="overview-card"><div><span class="stat-label">出入库记录</span><div class="stat-value">{{ movements.length }}<small>笔</small></div><span class="stat-caption">每次库存变化都会留存</span></div><span class="stat-symbol blue"><van-icon name="exchange" /></span></div>
        </section>

        <section v-if="tab === 'products' || tab === 'stock'" class="content-panel">
          <div class="panel-toolbar"><h2>{{ tab === 'products' ? '全部商品' : '库存清单' }}<span>{{ products.length }}</span></h2><div class="lookup-tools"><button class="button button-secondary scan-lookup" :disabled="scanning || !!storageError" :aria-busy="scanning" aria-label="扫码查找商品" @click="startScan()"><van-icon name="scan" />{{ scanning ? '正在扫码…' : '扫码查商品' }}</button><div class="search-field"><van-icon name="search" /><input v-model="search" type="search" aria-label="搜索商品名称、编号或条码" placeholder="搜索名称、编号或条码" /><button v-if="search" class="search-clear" aria-label="清空搜索" @click="search = ''"><van-icon name="cross" /></button></div></div></div>
          <div v-if="!products.length" class="empty-state"><div class="empty-illustration"><svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="17" y="33" width="66" height="49" rx="9" fill="#e8f2f3"/><path d="M19 36 50 20l31 16-31 17-31-17Z" fill="#d0e6e7"/><path d="M50 53v28M34 29l31 17" stroke="#7baeb0" stroke-width="2"/><rect x="60" y="64" width="25" height="25" rx="12.5" fill="#1d8a7a"/><path d="M72.5 70v13m-6.5-6.5h13" stroke="white" stroke-width="2" stroke-linecap="round"/></svg></div><h3>从第一件商品开始</h3><p>添加商品信息，再记录入库数量。<br />商品和库存变化会保存在这台设备上。</p><button class="button button-primary" :disabled="!!storageError" @click="openProduct()"><van-icon name="plus" />添加第一件商品</button></div>
          <div v-else-if="!filteredProducts.length" class="empty-state compact"><van-icon name="search" class="empty-icon" /><h3>没有找到相关商品</h3><p>换一个名称、商品编号或条码试试。</p><button class="text-button" @click="search = ''">清空搜索</button></div>
          <div v-else class="product-list">
            <div class="list-column-labels"><span>商品信息</span><span>当前库存</span><span>{{ tab === 'stock' ? '库存操作' : '' }}</span></div>
            <article v-for="product in filteredProducts" :key="product.id" class="product-row">
              <button class="product-identity" @click="openDetail(product)" :aria-label="`查看商品 ${product.name}`"><span class="product-avatar">{{ product.name.slice(0, 1) }}</span><span class="product-text"><strong>{{ product.name }}</strong><small>{{ product.sku ? `编号 ${product.sku}` : '未设置商品编号' }}</small></span></button>
              <div class="stock-number" :class="{ 'zero-stock': product.stock === 0 }"><strong>{{ product.stock.toLocaleString('zh-CN') }}</strong><span>{{ product.unit }}</span><small v-if="product.stock === 0">暂无库存</small></div>
              <div v-if="tab === 'stock'" class="row-actions"><button class="small-button stock-out" :disabled="!!storageError || product.stock === 0" @click="openMovement('out', product)" :aria-label="`${product.name} 出库`">出库</button><button class="small-button stock-in" :disabled="!!storageError" @click="openMovement('in', product)" :aria-label="`${product.name} 入库`">入库</button></div>
              <button v-else class="row-detail" @click="openDetail(product)" :aria-label="`${product.name} 商品详情`"><span>查看详情</span><van-icon name="arrow" /></button>
            </article>
          </div>
        </section>

        <section v-if="tab === 'history'" class="content-panel history-panel">
          <div class="panel-toolbar"><h2>历史记录<span>{{ movements.length }}</span></h2><div class="filter-group" aria-label="筛选出入库类型"><button v-for="item in [{ id: 'all', name: '全部' }, { id: 'in', name: '入库' }, { id: 'out', name: '出库' }]" :key="item.id" :class="{ active: historyFilter === item.id }" @click="historyFilter = item.id" :aria-pressed="historyFilter === item.id">{{ item.name }}</button></div></div>
          <div v-if="!filteredMovements.length" class="empty-state"><div class="empty-icon-wrap"><van-icon name="clock-o" /></div><h3>{{ movements.length ? '暂无此类记录' : '还没有出入库记录' }}</h3><p>{{ movements.length ? '切换筛选，查看其他库存变化。' : '完成一次入库或出库后，记录会显示在这里。' }}</p><button v-if="!movements.length" class="button button-secondary" @click="tab = 'stock'">前往库存</button></div>
          <div v-else class="history-list"><article v-for="movement in filteredMovements" :key="movement.id" class="history-row"><span class="movement-icon" :class="movement.type"><van-icon :name="movement.type === 'in' ? 'down' : 'up'" /></span><div class="movement-content"><div class="movement-title"><strong>{{ movement.productName }}</strong><span class="movement-tag" :class="movement.type">{{ movement.type === 'in' ? '入库' : '出库' }}</span></div><p class="movement-meta">{{ formatDate(movement.createdAt, true) }}<span v-if="movement.productSku"> · {{ movement.productSku }}</span></p><p v-if="movement.note" class="movement-note">{{ movement.note }}</p><p class="stock-change">库存 {{ movement.beforeStock }} → {{ movement.afterStock }} {{ movement.unit }}</p></div><div class="movement-quantity" :class="movement.type"><strong>{{ movement.type === 'in' ? '+' : '−' }}{{ movement.quantity.toLocaleString('zh-CN') }}</strong><span>{{ movement.unit }}</span></div></article></div>
        </section>

        <footer class="data-footer"><van-icon name="shield-o" /><p>数据保存在本机，请使用同一设备和浏览器查看。<span>清除应用数据或浏览器数据会移除记录。</span></p></footer>
        <div class="screen-reader-only" role="status" aria-live="polite">{{ status }}</div>
      </main>
    </div>

    <button v-if="tab === 'products' && products.length" class="mobile-fab" :disabled="!!storageError" @click="openProduct()" aria-label="新增商品"><van-icon name="plus" /><span>新增商品</span></button>
    <nav class="bottom-nav" aria-label="底部导航"><button v-for="item in [{ id: 'products', label: '商品', icon: 'apps-o' }, { id: 'stock', label: '库存', icon: 'orders-o' }, { id: 'history', label: '记录', icon: 'clock-o' }]" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id; search = ''" :aria-current="tab === item.id ? 'page' : undefined"><van-icon :name="item.icon" /><span>{{ item.label }}</span></button></nav>

    <van-popup v-model:show="productSheet" position="bottom" round closeable class="sheet-popup" :close-on-click-overlay="false" aria-label="商品信息表单">
      <div class="sheet-header"><span class="sheet-kicker">PRODUCT DETAILS</span><h2>{{ editingId ? '编辑商品' : '新增商品' }}</h2><p>{{ editingId ? '更新商品资料，库存数量保持不变。' : '先建立商品档案，初始库存为 0。' }}</p></div>
      <form class="sheet-form" @submit.prevent="saveProduct">
        <label class="form-field"><span>商品名称 <em>*</em></span><input v-model="productForm.name" name="product-name" placeholder="例如：纯棉短袖 T 恤" maxlength="80" autocomplete="off" required /><small>{{ productForm.name.length }}/80</small></label>
        <div class="form-grid"><label class="form-field"><span>商品编号</span><input v-model="productForm.sku" name="product-sku" placeholder="选填，例如 SKU001" maxlength="40" autocomplete="off" /></label><label class="form-field"><span>计量单位 <em>*</em></span><input v-model="productForm.unit" name="product-unit" placeholder="例如：件" maxlength="12" required /></label></div>
        <div class="form-field"><label for="product-barcode" class="barcode-label">商品条码</label><div class="barcode-input"><input id="product-barcode" v-model="productForm.barcode" name="product-barcode" type="text" placeholder="选填，扫描或手动输入" maxlength="80" autocomplete="off" :disabled="scanning" /><button type="button" class="button button-secondary" :disabled="scanning || !!storageError" :aria-busy="scanning" aria-label="扫码填写商品条码" @click="startScan('form')"><van-icon name="scan" />{{ scanning ? '扫码中' : '扫码' }}</button></div><small class="barcode-help">条码与商品编号分别保存，支持前导 0。{{ productForm.barcode.length }}/80</small></div>
        <label class="form-field"><span>备注</span><textarea v-model="productForm.note" name="product-note" placeholder="选填，记录规格或其他说明" maxlength="300" rows="3"></textarea><small>{{ productForm.note.length }}/300</small></label>
        <p v-if="formError" class="form-error" role="alert"><van-icon name="warning-o" />{{ formError }}</p>
        <div class="form-actions"><button type="button" class="button button-secondary" @click="productSheet = false">取消</button><button type="submit" class="button button-primary" :disabled="!!storageError || scanning">{{ editingId ? '保存修改' : '保存商品' }}</button></div>
      </form>
    </van-popup>

    <van-popup v-model:show="movementSheet" position="bottom" round closeable class="sheet-popup" :close-on-click-overlay="false" aria-label="出入库表单">
      <div class="sheet-header"><span class="sheet-kicker">STOCK MOVEMENT</span><h2>记录{{ movementForm.type === 'in' ? '入库' : '出库' }}</h2><p>确认商品和数量，库存会随记录一起更新。</p></div>
      <form class="sheet-form" @submit.prevent="saveMovement">
        <div class="movement-switch" aria-label="出入库类型"><button type="button" :class="{ active: movementForm.type === 'in' }" @click="movementForm.type = 'in'; movementError = ''" :aria-pressed="movementForm.type === 'in'"><van-icon name="plus" />入库</button><button type="button" :class="{ active: movementForm.type === 'out' }" @click="movementForm.type = 'out'; movementError = ''" :aria-pressed="movementForm.type === 'out'"><van-icon name="minus" />出库</button></div>
        <label class="form-field"><span>选择商品 <em>*</em></span><select v-model="movementForm.productId" name="movement-product" required><option value="" disabled>请选择商品</option><option v-for="product in products" :key="product.id" :value="product.id">{{ product.name }}{{ product.sku ? ` · ${product.sku}` : '' }}</option></select></label>
        <div v-if="movementProduct" class="current-stock"><span>当前库存</span><strong>{{ movementProduct.stock }} <small>{{ movementProduct.unit }}</small></strong></div>
        <label class="form-field"><span>{{ movementForm.type === 'in' ? '入库数量' : '出库数量' }} <em>*</em></span><div class="quantity-input"><input v-model="movementForm.quantity" name="movement-quantity" type="number" inputmode="numeric" min="1" step="1" placeholder="请输入正整数" required /><span>{{ movementProduct?.unit || '件' }}</span></div></label>
        <label class="form-field"><span>备注</span><textarea v-model="movementForm.note" name="movement-note" maxlength="300" rows="2" :placeholder="movementForm.type === 'in' ? '选填，例如采购到货' : '选填，例如销售出库'"></textarea></label>
        <p v-if="movementError" class="form-error" role="alert"><van-icon name="warning-o" />{{ movementError }}</p>
        <div class="form-actions"><button type="button" class="button button-secondary" @click="movementSheet = false">取消</button><button type="submit" class="button button-primary" :disabled="!!storageError || !products.length">确认{{ movementForm.type === 'in' ? '入库' : '出库' }}</button></div>
      </form>
    </van-popup>

    <van-popup v-model:show="unknownSheet" position="bottom" round closeable class="sheet-popup" aria-label="未找到条码对应商品">
      <div class="sheet-header"><span class="sheet-kicker">BARCODE LOOKUP</span><h2>尚未登记这个条码</h2><p>本机商品中没有对应条码。你可以建立商品档案，库存不会自动变化。已有商品请取消后打开商品详情，在编辑中绑定条码。</p></div>
      <div class="detail-body"><div class="unknown-barcode"><span>扫描结果</span><strong>{{ unknownBarcode }}</strong></div><div class="form-actions"><button type="button" class="button button-secondary" @click="unknownSheet = false">取消</button><button type="button" class="button button-primary" :disabled="!!storageError" @click="addScannedProduct">新增商品并填入条码</button></div></div>
    </van-popup>

    <van-popup v-model:show="detailSheet" position="bottom" round closeable class="sheet-popup detail-popup" aria-label="商品详情">
      <template v-if="detailProduct"><div class="sheet-header"><span class="sheet-kicker">PRODUCT DETAILS</span><h2>商品详情</h2></div><div class="detail-body"><div class="detail-product"><span class="product-avatar large">{{ detailProduct.name.slice(0, 1) }}</span><div><h3>{{ detailProduct.name }}</h3><p>{{ detailProduct.sku ? `编号 ${detailProduct.sku}` : '未设置商品编号' }}</p></div></div><div class="detail-stock"><span>当前库存</span><strong>{{ detailProduct.stock.toLocaleString('zh-CN') }}<small>{{ detailProduct.unit }}</small></strong><div class="detail-stock-actions"><button class="button button-secondary" :disabled="!!storageError || detailProduct.stock === 0" @click="openMovement('out', detailProduct)">出库</button><button class="button button-primary" :disabled="!!storageError" @click="openMovement('in', detailProduct)">入库</button></div></div><dl class="detail-meta"><div><dt>商品条码</dt><dd class="barcode-value">{{ detailProduct.barcode || '未设置条码' }}</dd></div><div><dt>备注</dt><dd>{{ detailProduct.note || '暂无备注' }}</dd></div><div><dt>创建时间</dt><dd>{{ formatDate(detailProduct.createdAt, true) }}</dd></div><div><dt>更新时间</dt><dd>{{ formatDate(detailProduct.updatedAt, true) }}</dd></div></dl><div class="detail-bottom-actions"><button class="button button-secondary" :disabled="!!storageError" @click="editDetail"><van-icon name="edit" />编辑商品</button><button class="button button-danger" :disabled="!!storageError || detailProduct.stock > 0" @click="removeProduct"><van-icon name="delete-o" />删除商品</button></div><p v-if="detailProduct.stock > 0" class="delete-help">商品仍有库存，出库归零后才能删除。</p></div></template>
    </van-popup>
  </div>
</template>
