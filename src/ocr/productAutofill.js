import { normalizePackagingText } from '../core/packaging.js'
import { preferredManufacturerCandidates } from '../core/manufacturerCandidates.js'

const limits = { name: 80, specification: 120, manufacturer: 120 }
export function productFieldChoices(field, key) {
  const values = [...(field?.candidates ?? []), ...(field?.suggestions ?? [])]
  const choices = [...new Map(values.filter(value => typeof value === 'string' && value.trim() && value.length <= limits[key])
    .map(value => [normalizePackagingText(value), value])).values()]
  return key === 'manufacturer' ? preferredManufacturerCandidates(choices) : choices
}

// Draft fields only: never modifies OCR evidence or marks packaging as verified.
export function autofillProductDraft(current, fields, previousAutomatic = {}) {
  const values = { ...current }, automatic = {}
  for (const key of Object.keys(limits)) {
    const choices = productFieldChoices(fields[key], key)
    const wasAutomatic = Object.hasOwn(previousAutomatic, key) && current[key] === previousAutomatic[key]
    if (current[key] && !wasAutomatic) continue
    if (choices.length === 1) {
      values[key] = choices[0]; automatic[key] = choices[0]
    } else if (wasAutomatic) values[key] = ''
  }
  return { values, automatic }
}
