<script setup>
defineProps({ point: { type: Object, required: true }, current: { type: Object, required: true }, storageError: { type: String, default: '' }, busy: Boolean, preservedRaw: Boolean, replacePreserved: Boolean })
defineEmits(['cancel', 'confirm', 'update:replacePreserved'])
function formatTime(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
</script>

<template>
  <div class="detail-body recovery-preview">
    <div class="import-counts"><div><span>将恢复 · {{ formatTime(point.createdAt) }}</span><strong>{{ point.productCount }} 种商品 · {{ point.movementCount }} 笔记录 · {{ point.unitCount }} 个单件档案</strong></div><div><span>当前本机</span><strong v-if="!storageError">{{ current.products }} 种商品 · {{ current.movements }} 笔记录 · {{ current.units }} 个单件档案</strong><strong v-else>原始数据读取异常，无法可靠统计</strong></div></div>
    <p class="import-warning">确认后会完整替换当前数据。{{ storageError ? '当前原始内容会先另存保护，保护失败时不会恢复。' : '当前数据会先保存为恢复点，保护失败时不会恢复。' }}取消不会更改任何记录。</p>
    <label v-if="storageError && preservedRaw" class="archive-confirm"><input type="checkbox" :checked="replacePreserved" @change="$emit('update:replacePreserved', $event.target.checked)" />我已导出并留存之前的异常原文，同意用本次原文替换本机保护副本（仅保留一份）。</label><div class="form-actions"><button class="button button-secondary" :disabled="busy" @click="$emit('cancel')">取消恢复</button><button class="button button-danger" :disabled="busy || (!!storageError && preservedRaw && !replacePreserved)" @click="$emit('confirm')">确认覆盖并恢复</button></div>
  </div>
</template>
