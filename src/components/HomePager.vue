<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { SWIPE_TABS, classifySwipeIntent, resolveSwipeNavigation } from '../navigation/swipeNavigation.js'

const props = defineProps({ modelValue: { type: String, required: true }, blocked: Boolean, reduceMotion: Boolean })
const emit = defineEmits(['navigate', 'motion'])
const viewport = ref(null), width = ref(1), drag = ref(0), duration = ref(220), systemReduced = ref(false)
const reduced = computed(() => systemReduced.value || props.reduceMotion)
const index = computed(() => Math.max(0, SWIPE_TABS.indexOf(props.modelValue)))
const dragging = ref(false)
const progress = computed(() => Math.max(0, Math.min(SWIPE_TABS.length - 1, index.value - (reduced.value ? 0 : drag.value / width.value))))
const trackStyle = computed(() => ({
  transform: `translate3d(calc(${-index.value * 100}% + ${reduced.value ? 0 : drag.value}px),0,0)`,
  transitionDuration: `${reduced.value || dragging.value ? 0 : duration.value}ms`
}))
let gesture = null, suppressClickUntil = 0, observer, media, settleTimer
let settling = false
function markSettling() {
  clearTimeout(settleTimer)
  settling = !reduced.value
  if (settling) settleTimer = setTimeout(() => { settling = false }, duration.value + 40)
}
function suppressClick() { suppressClickUntil = performance.now() + 400 }
function guardClick(event) {
  if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation() }
}
function clearGesture() { gesture = null; dragging.value = false }
function cancelGesture() {
  if (gesture?.intent === 'horizontal') suppressClick()
  const hadDrag = !!drag.value
  clearGesture(); duration.value = 180; drag.value = 0
  if (hadDrag) markSettling()
}
function begin(event) {
  if (event.touches.length !== 1) { cancelGesture(); return }
  if (props.blocked || settling) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input,textarea,select,summary,[contenteditable="true"],pre,code')) return
  const control = target?.closest('button,a,[role="button"]')
  if (control && !control.matches('.product-identity,.row-detail')) return
  const point = event.touches[0], bounds = viewport.value.getBoundingClientRect()
  if (point.clientX <= 24 || point.clientX >= window.innerWidth - 24) return
  width.value = bounds.width || 1
  gesture = { startX: point.clientX, startY: point.clientY, startedAt: performance.now(), currentTab: props.modelValue,
    viewportWidth: window.innerWidth, intent: 'pending' }
}
function move(event) {
  if (!gesture) return
  if (props.blocked || event.touches.length !== 1) { cancelGesture(); return }
  const dx = event.touches[0].clientX - gesture.startX, dy = event.touches[0].clientY - gesture.startY
  if (gesture.intent === 'pending') gesture.intent = classifySwipeIntent(dx, dy)
  if (gesture.intent !== 'horizontal') return
  if (event.cancelable) event.preventDefault()
  dragging.value = true
  const atEdge = (index.value === 0 && dx > 0) || (index.value === SWIPE_TABS.length - 1 && dx < 0)
  drag.value = atEdge ? dx * .15 : Math.max(-width.value, Math.min(width.value, dx))
}
function end(event) {
  if (!gesture) return
  const start = gesture
  if (props.blocked || event.touches.length || event.changedTouches.length !== 1 || start.currentTab !== props.modelValue) { cancelGesture(); return }
  const point = event.changedTouches[0]
  const horizontal = start.intent === 'horizontal' || (start.intent === 'pending' && classifySwipeIntent(point.clientX - start.startX, point.clientY - start.startY) === 'horizontal')
  if (!horizontal) { clearGesture(); return }
  suppressClick()
  const next = resolveSwipeNavigation({ ...start, endX: point.clientX, endY: point.clientY, durationMs: performance.now() - start.startedAt })
  clearGesture(); duration.value = next ? 220 : 180
  // Both values settle in one render: the released page never snaps back to its origin first.
  if (next) emit('navigate', next)
  drag.value = 0; markSettling()
}
watch(() => props.modelValue, () => { clearGesture(); drag.value = 0; duration.value = 220; markSettling() }, { flush: 'sync' })
watch(() => props.blocked, value => { if (value) cancelGesture() })
watch([progress, duration, dragging, reduced], () => emit('motion', { progress: progress.value, duration: reduced.value || dragging.value ? 0 : duration.value }), { immediate: true, flush: 'sync' })
watch(reduced, () => cancelGesture())
function updateReduced() { systemReduced.value = media.matches }
onMounted(() => {
  media = window.matchMedia('(prefers-reduced-motion: reduce)'); systemReduced.value = media.matches
  media.addEventListener('change', updateReduced)
  observer = new ResizeObserver(entries => {
    const nextWidth = entries[0]?.contentRect.width || 1
    if (Math.abs(nextWidth - width.value) > 1 && gesture) cancelGesture()
    width.value = nextWidth
  })
  observer.observe(viewport.value)
})
onUnmounted(() => { clearTimeout(settleTimer); observer?.disconnect(); media?.removeEventListener('change', updateReduced) })
</script>

<template>
  <div ref="viewport" class="home-pager page-stage" :class="{ 'is-dragging': dragging }" @touchstart.passive="begin" @touchmove="move" @touchend="end" @touchcancel="cancelGesture" @click.capture="guardClick">
    <div class="pager-track" :style="trackStyle">
      <div v-for="page in SWIPE_TABS" :key="page" class="pager-pane" :data-page="page" :inert="page !== modelValue" :aria-hidden="page !== modelValue">
        <slot :page="page" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-pager{flex:1;min-height:0;min-width:0;overflow:hidden;touch-action:pan-y pinch-zoom;isolation:isolate}
.pager-track{display:flex;width:100%;height:100%;transition-property:transform;transition-timing-function:cubic-bezier(.2,.8,.2,1);will-change:transform}
.pager-pane{flex:0 0 100%;min-width:0;height:100%;overflow:auto;overscroll-behavior-y:contain;touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable}
.pager-pane :deep(.product-identity),.pager-pane :deep(.row-detail){touch-action:pan-y pinch-zoom}
@media(prefers-reduced-motion:reduce){.pager-track{transition:none!important}}
</style>
