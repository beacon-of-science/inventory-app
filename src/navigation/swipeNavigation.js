export const SWIPE_TABS = Object.freeze(['products', 'stock', 'history'])
export const SWIPE_MIN_DISTANCE = 60
export const SWIPE_HORIZONTAL_RATIO = 1.5
export const SWIPE_MAX_DURATION_MS = 700
export const SWIPE_EDGE_MARGIN = 24

/** Return one adjacent home tab for an intentional horizontal gesture, otherwise null.
 * The caller excludes controls, overlays, multi-touch, and cancelled gestures.
 * Distances use CSS pixels; duration uses monotonic elapsed milliseconds.
 */
export function resolveSwipeNavigation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const { currentTab, startX, startY, endX, endY, durationMs, viewportWidth } = input
  const index = SWIPE_TABS.indexOf(currentTab)
  if (index === -1 || ![startX, startY, endX, endY, durationMs, viewportWidth].every(Number.isFinite)) return null
  if (durationMs < 0 || durationMs > SWIPE_MAX_DURATION_MS || viewportWidth <= SWIPE_EDGE_MARGIN * 2) return null
  if (startX <= SWIPE_EDGE_MARGIN || startX >= viewportWidth - SWIPE_EDGE_MARGIN || startY < 0 || endY < 0 || endX < 0 || endX > viewportWidth) return null
  const deltaX = endX - startX
  const deltaY = endY - startY
  if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_HORIZONTAL_RATIO) return null
  const targetIndex = index + (deltaX < 0 ? 1 : -1)
  return SWIPE_TABS[targetIndex] ?? null
}
