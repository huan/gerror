/**
 * Private `WeakMap`-backed metadata storage for `GError` instances.
 *
 * Keeps original/remote diagnostics, aggregate member errors, and omitted-cause
 * markers detached from public enumerable `Error` properties so local `stack`
 * and `name` are never overwritten while round-trips remain deterministic.
 */

import type { ErrorCause, ErrorDiagnostics } from './data.ts'

/**
 * Internal metadata associated with a `GError` instance.
 */
export interface GErrorMetadata {
  readonly diagnostics?: ErrorDiagnostics
  readonly errors?: readonly Error[]
  readonly omittedCause?: Extract<ErrorCause, { readonly kind: 'omitted' }>
}

const metadataStore = new WeakMap<object, GErrorMetadata>()
const gerrorInstances = new WeakSet<object>()

/**
 * Marks `instance` as a genuine `GError` instance for internal callers.
 */
export function markGErrorInstance (instance: object): void {
  gerrorInstances.add(instance)
}

/**
 * Returns `true` when `instance` was constructed by `GError`.
 */
export function isBrandedGError (instance: object): boolean {
  return gerrorInstances.has(instance)
}

/**
 * Associates internal metadata with a `GError` instance.
 */
export function setGErrorMetadata (instance: object, metadata: GErrorMetadata): void {
  metadataStore.set(instance, metadata)
}

/**
 * Retrieves internal metadata for a `GError` instance, if any.
 */
export function getGErrorMetadata (instance: object): GErrorMetadata | undefined {
  return metadataStore.get(instance)
}
