export function chooseBackAction(state) {
  if (state.dialog) return 'dialog'
  if (state.importPreview) return 'import'
  if (state.busy) return 'wait'
  for (const layer of ['product', 'movement', 'detail', 'unknown', 'backup']) if (state[layer]) return layer
  if (state.filters) return 'filters'
  if (state.search) return 'search'
  return state.tab === 'products' ? 'root' : 'home'
}
