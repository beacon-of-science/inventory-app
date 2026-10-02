import { reactive, ref } from 'vue'
import {
  addProduct as addProductToState,
  updateProduct as updateProductInState,
  deleteProduct as deleteProductFromState,
  recordMovement as recordMovementInState,
  createEmptyState,
} from '../core/inventory.js'
import { loadState, saveState, migrateState, validateState } from '../core/storage.js'

export function createInventoryStore(storage) {
  const state = reactive(createEmptyState())
  const error = ref('')
  let backend

  try {
    backend = storage === undefined ? globalThis.localStorage : storage
    const loaded = loadState(backend)
    state.products = loaded.products
    state.movements = loaded.movements
  } catch (cause) {
    error.value = `启动读取失败：${cause instanceof Error ? cause.message : '未知错误'}`
  }

  function commit(transition, valueKey) {
    if (error.value) throw new Error(`库存数据处于只读保护状态：${error.value}`)
    const result = transition()
    saveState(backend, result.state)
    state.products = result.state.products
    state.movements = result.state.movements
    return result[valueKey]
  }

  return {
    state,
    error,
    addProduct(input) {
      return commit(() => addProductToState(state, input), 'product')
    },
    updateProduct(id, input) {
      return commit(() => updateProductInState(state, id, input), 'product')
    },
    deleteProduct(id) {
      return commit(() => deleteProductFromState(state, id), 'product')
    },
    recordMovement(input) {
      return commit(() => recordMovementInState(state, input), 'movement')
    },
    importState(input) {
      return commit(() => {
        // Own the imported objects so later caller edits cannot bypass persistence.
        validateState(input)
        const imported = migrateState(JSON.parse(JSON.stringify(input)))
        return { state: imported, imported }
      }, 'imported')
    },
  }
}
