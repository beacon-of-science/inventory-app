<script setup>
const props = defineProps({
  version: { type: String, required: true },
  settings: { type: Object, required: true },
  recovery: { type: Object, required: true },
  storageError: { type: String, default: '' },
  busy: Boolean,
})
const emit = defineEmits(['update-settings', 'export', 'import', 'recover-import', 'create-point', 'preview-point', 'export-raw', 'export-preserved', 'export-diagnostics'])
function changeSetting(key, event) {
  emit('update-settings', { [key]: event.target.checked })
  // A rejected local save must not leave the switch showing an unsaved value.
  event.target.checked = props.settings[key]
}
const reasons = { auto: '自动保存', manual: '手动保存', 'before-import': '导入前保护', 'before-restore': '恢复前保护' }
function formatTime(value) {
  if (!value) return '尚未导出'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="settings-body">
    <section class="settings-about" aria-label="应用信息">
      <span class="settings-app-mark"><van-icon name="apps-o" /></span>
      <div><strong>简库存</strong><span>版本 {{ version }} · 本机库存管理</span></div>
    </section>
    <p class="settings-local-note">商品、库存、单件档案与识别原文保存在这台设备。卸载或清除应用数据前，请先导出备份。</p>

    <section v-if="storageError" class="settings-protection" aria-label="本机数据恢复">
      <h3><van-icon name="warning-o" />当前数据处于保护状态</h3>
      <p>{{ storageError }}</p>
      <p>可以先导出当前原始数据留存，再选择恢复点或备份文件。恢复前会另存当前原始内容；保护失败时不会覆盖。</p>
      <button class="button button-secondary" :disabled="busy" @click="$emit('export-raw')">导出当前原始数据</button>
      <button class="button button-secondary" :disabled="busy" @click="$emit('recover-import')">从备份文件恢复</button>
      <small class="settings-raw-help">原始数据归档供排查与留存，不能作为普通库存备份导入。</small>
    </section>

    <section class="settings-section" aria-label="文件备份">
      <h3>文件备份</h3>
      <p>JSON 文件包含商品、完整流水和单件档案。导入前可预览，确认后会替换当前数据。</p>
      <div class="settings-actions"><button class="button button-secondary" :disabled="busy || !!storageError" @click="$emit('export')">导出备份</button><button class="button button-secondary" :disabled="busy || !!storageError" @click="$emit('import')">导入备份</button></div>
      <p class="settings-meta">上次成功导出：{{ formatTime(recovery.lastManualBackupAt) }}</p>
    </section>

    <section class="settings-section" aria-label="本机恢复点">
      <h3>本机恢复点</h3>
      <label class="settings-toggle"><span><strong>自动保存恢复点</strong><small>保留最近 5 个恢复点，仍需定期导出文件备份。</small></span><input type="checkbox" role="switch" :checked="settings.autoRecovery" :disabled="busy" @change="changeSetting('autoRecovery', $event)" /></label>
      <p v-if="recovery.warning" class="settings-warning" role="alert">{{ recovery.warning }}</p>
      <button class="button button-secondary settings-full-button" :disabled="busy || !!storageError" @click="$emit('create-point')"><van-icon name="plus" />保存一个恢复点</button>
      <div v-if="recovery.points.length" class="recovery-list">
        <button v-for="point in recovery.points" :key="point.id" class="recovery-point" :disabled="busy" @click="$emit('preview-point', point.id)">
          <span><strong>{{ formatTime(point.createdAt) }}</strong><small>{{ reasons[point.reason] || '本机保存' }} · {{ point.productCount }} 种商品 · {{ point.movementCount }} 笔记录 · {{ point.unitCount }} 个单件档案</small></span><van-icon name="arrow" />
        </button>
      </div>
      <p v-else class="settings-meta">还没有恢复点。保存后可在这里查看并选择恢复。</p>
      <p class="settings-meta">恢复点与数据保存在同一台设备，卸载或清除应用数据后也会丢失。</p>
      <div v-if="recovery.preservedRawAvailable" class="preserved-raw"><p>恢复前的异常原始数据已另存，可继续导出归档；此归档不能作为普通库存备份导入。</p><button class="button button-secondary settings-full-button" :disabled="busy" @click="$emit('export-preserved')">导出恢复前原始数据</button></div>
    </section>

    <section class="settings-section" aria-label="界面与诊断">
      <h3>界面与诊断</h3>
      <label class="settings-toggle"><span><strong>减少界面动画</strong><small>系统的减少动态效果设置也会生效。</small></span><input type="checkbox" role="switch" :checked="settings.reduceMotion" :disabled="busy" @change="changeSetting('reduceMotion', $event)" /></label>
      <p>诊断日志仅包含操作结果代码与时间，不含商品名称、条码、照片或识别原文。</p>
      <button class="button button-secondary settings-full-button" :disabled="busy" @click="$emit('export-diagnostics')">导出诊断日志</button>
    </section>

    <details class="settings-help"><summary>简洁使用帮助<van-icon name="arrow-down" /></summary><ol><li>在“商品”中新建档案，包装拍照可自动填写信息；保存前对照实物核对。</li><li>在“库存”中记录入库与出库。药品按每盒单件码管理，不同盒的包装需要分别核对。</li><li>在“记录”中查看库存变化与当次包装校验。定期导出备份，导入和恢复前先查看预览。</li></ol></details>
    <p v-if="busy" class="settings-busy" role="status">正在处理文件或等待预览确认…</p>
  </div>
</template>
