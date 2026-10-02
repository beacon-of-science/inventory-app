<script setup>
import { computed } from 'vue'
const props = defineProps({fields:Object,captures:Array,selected:Object,disabled:Boolean})
const emit = defineEmits(['select'])
const labels = {name:'名称',specification:'规格',manufacturer:'厂家'}
const limits = {name:80,specification:120,manufacturer:120}
const lines = computed(() => [...new Set(props.captures.flatMap(capture => capture.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)))])
function choices(field) { return [...new Set([...(field.candidates || []),...(field.suggestions || [])])] }
function selectLine(key,event) { if(event.target.value) emit('select',key,event.target.value); event.target.value = '' }
</script>
<template>
  <section class="ocr-picker" aria-label="OCR 字段核对">
    <h4>核对文字归类</h4><p>候选是规则推测，请对照包装点选；选取后仍可在表单校正。</p>
    <div v-for="(field,key) in fields" :key="key" class="ocr-choice">
      <label>{{ labels[key] }}<output>{{ selected[key] || '尚未填写' }}</output></label>
      <small>{{ field.status === 'recognized' ? '标签或完整已有名称匹配' : choices(field).length ? '待确认候选' : '暂无候选，可从原文指定' }}</small>
      <div class="ocr-suggestions"><button v-for="candidate in choices(field)" :key="candidate" type="button" :disabled="disabled || candidate.length > limits[key]" @click="emit('select',key,candidate)">{{ candidate }}</button></div>
      <select :aria-label="`从识别原文选择${labels[key]}`" :disabled="disabled" @change="selectLine(key,$event)"><option value="">从原文选择{{ labels[key] }}…</option><option v-for="line in lines.filter(value => value.length <= limits[key])" :key="line" :value="line">{{ line }}</option></select>
    </div>
    <details><summary>查看全部识别原文</summary><p v-for="capture in captures" :key="capture.id">{{ capture.text }}</p></details>
  </section>
</template>
