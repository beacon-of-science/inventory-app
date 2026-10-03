<script setup>
import { computed } from 'vue'
import { getOcrFieldOptions } from '../core/packaging.js'
const props = defineProps({fields:Object,captures:Array,selected:Object,disabled:Boolean})
const emit = defineEmits(['select'])
const labels = {name:'名称',specification:'规格',manufacturer:'厂家'}
const limits = {name:80,specification:120,manufacturer:120}
const options = computed(() => getOcrFieldOptions(props.captures))
function choices(key) { return options.value[key] }
function selectLine(key,event) { if(event.target.value) emit('select',key,event.target.value); event.target.value = '' }
</script>
<template>
  <section class="ocr-picker" aria-label="OCR 字段核对">
    <h4>核对包装信息</h4><p>对照包装核对名称、规格和厂家；不准确时可重新拍摄或手动修改。</p>
    <div v-for="(field,key) in fields" :key="key" class="ocr-choice">
      <label>{{ labels[key] }}<output>{{ selected[key] || '尚未填写' }}</output></label>
      <small>{{ field.status === 'recognized' ? '标签或完整已有名称匹配' : choices(key).length ? '待确认候选' : '暂无合适候选，请补拍或在表单校正' }}</small>
      <div class="ocr-suggestions"><button v-for="candidate in choices(key)" :key="candidate" type="button" :class="{ selected: selected[key] === candidate }" :aria-pressed="selected[key] === candidate" :disabled="disabled || candidate.length > limits[key]" @click="emit('select',key,candidate)">{{ candidate }}</button></div>
      <select :aria-label="`从筛选文字选择${labels[key]}`" :disabled="disabled || !options[key].length" @change="selectLine(key,$event)"><option value="">{{ options[key].length ? `选择${labels[key]}候选…` : '未找到合适候选，请补拍' }}</option><option v-for="line in options[key].filter(value => value.length <= limits[key])" :key="line" :value="line">{{ line }}</option></select>
    </div>
    <details><summary>查看全部识别原文</summary><p v-for="capture in captures" :key="capture.id">{{ capture.text }}</p></details>
  </section>
</template>
