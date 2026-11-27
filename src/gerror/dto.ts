/**
 * Canonical JSON Data Transfer Object (DTO) for cross-process,
 * gRPC, Redux, and CQRS event distribution.
 *
 * GErrorDTO is a pure, serializable plain JavaScript object
 * that survives JSON.stringify() and structuredClone() without
 * losing error properties or stack traces.
 */

/**
 * Primitive JSON-serializable values according to RFC 8259.
 */
export type JsonPrimitive = string | number | boolean | null

/**
 * Recursive JSON-serializable value.
 */
export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | JsonArray

/**
 * JSON-serializable object mapping string keys to JSON values.
 */
export interface JsonObject {
  [key: string]: JsonValue | undefined
}

/**
 * JSON-serializable array of JSON values.
 */
export type JsonArray = JsonValue[]

/**
 * Canonical JSON Data Transfer Object (DTO) interface.
 */
export interface GErrorDTO {
  readonly name: string
  readonly message: string
  readonly code: number | string
  readonly details?: string
  readonly stack?: string
  readonly cause?: GErrorDTO
  readonly data?: JsonObject
  readonly timestamp?: number
}

/**
 * Checks whether an unknown value is a JSON-safe value.
 * Validates finite numbers, arrays, and plain objects while preventing circular references.
 * Uses an active recursion stack to allow valid DAGs with shared object references.
 */
export function isJsonValue (
  value: unknown,
  activeStack: Set<object> = new Set(),
): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  if (typeof value === 'object') {
    if (activeStack.has(value)) {
      return false
    }
    activeStack.add(value)

    try {
      if (Array.isArray(value)) {
        return value.every(item => isJsonValue(item, activeStack))
      }

      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) {
        return false
      }

      for (const key of Object.keys(value)) {
        const val = (value as Record<string, unknown>)[key]
        if (val !== undefined && !isJsonValue(val, activeStack)) {
          return false
        }
      }

      return true
    } finally {
      activeStack.delete(value)
    }
  }

  return false
}

/**
 * Checks whether an unknown value is a JSON-safe object.
 */
export function isJsonObject (
  value: unknown,
  activeStack: Set<object> = new Set(),
): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return isJsonValue(value, activeStack)
}

/**
 * Normalizes arbitrary data into a JSON-safe object according to the following policy:
 * - Primitives (string, boolean, null): preserved.
 * - Finite numbers: preserved.
 * - Non-finite numbers (NaN, Infinity, -Infinity): normalized to null.
 * - BigInt: converted to string with 'n' suffix to prevent JSON.stringify() throwing.
 * - Date: converted to ISO 8601 string.
 * - Set: converted to Array.
 * - Map: converted to plain object.
 * - Circular references: replaced with '[Circular]'.
 * - Own '__proto__' properties: safely preserved without mutating object prototypes.
 * - Functions / symbols / undefined: omitted from objects.
 */
export function normalizeJsonData (
  data: unknown,
  activeStack: Set<object> = new Set(),
): JsonObject | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined
  }

  if (activeStack.has(data)) {
    return { '[Circular]': true }
  }
  activeStack.add(data)

  try {
    const result: JsonObject = {}

    if (data instanceof Map) {
      for (const [key, val] of data.entries()) {
        const stringKey = String(key)
        const normalizedVal = normalizeJsonValue(val, activeStack)
        if (normalizedVal !== undefined) {
          Object.defineProperty(result, stringKey, {
            value: normalizedVal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
      }
    } else {
      for (const key of Object.keys(data)) {
        const val = (data as Record<string, unknown>)[key]
        const normalizedVal = normalizeJsonValue(val, activeStack)
        if (normalizedVal !== undefined) {
          Object.defineProperty(result, key, {
            value: normalizedVal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
      }
    }

    return result
  } finally {
    activeStack.delete(data)
  }
}

/**
 * Internal recursive normalizer for JSON values according to the documented policy.
 */
export function normalizeJsonValue (
  value: unknown,
  activeStack: Set<object> = new Set(),
): JsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined
  }

  if (typeof value === 'object') {
    if (activeStack.has(value)) {
      return '[Circular]'
    }
    activeStack.add(value)

    try {
      if (value instanceof Set || Array.isArray(value)) {
        const arr = Array.from(value)
        return arr.map(item => {
          const norm = normalizeJsonValue(item, activeStack)
          return norm === undefined ? null : norm
        })
      }

      if (value instanceof Map) {
        const obj: JsonObject = {}
        for (const [k, v] of value.entries()) {
          const norm = normalizeJsonValue(v, activeStack)
          if (norm !== undefined) {
            Object.defineProperty(obj, String(k), {
              value: norm,
              writable: true,
              enumerable: true,
              configurable: true,
            })
          }
        }
        return obj
      }

      const obj: JsonObject = {}
      for (const key of Object.keys(value)) {
        const val = (value as Record<string, unknown>)[key]
        const norm = normalizeJsonValue(val, activeStack)
        if (norm !== undefined) {
          Object.defineProperty(obj, key, {
            value: norm,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        }
      }
      return obj
    } finally {
      activeStack.delete(value)
    }
  }

  return undefined
}

/**
 * Strict type guard validating that a payload conforms to the GErrorDTO contract:
 * - name: non-empty string (or string)
 * - message: string
 * - code: string or finite number
 * - details (optional): string
 * - stack (optional): string
 * - timestamp (optional): finite number
 * - cause (optional): recursively conforms to isGErrorDTO
 * - data (optional): JSON-safe object
 */
export const isGErrorDTO = (
  payload: unknown,
  activeStack: Set<object> = new Set(),
): payload is GErrorDTO => {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false
  }

  if (activeStack.has(payload)) {
    return false
  }
  activeStack.add(payload)

  try {
    const candidate = payload as Record<string, unknown>

    // Required name
    if (typeof candidate['name'] !== 'string') {
      return false
    }

    // Required message
    if (typeof candidate['message'] !== 'string') {
      return false
    }

    // Required code (finite number or string)
    const code = candidate['code']
    if (typeof code === 'number') {
      if (!Number.isFinite(code)) {
        return false
      }
    } else if (typeof code !== 'string') {
      return false
    }

    // Optional details
    if ('details' in candidate && candidate['details'] !== undefined) {
      if (typeof candidate['details'] !== 'string') {
        return false
      }
    }

    // Optional stack
    if ('stack' in candidate && candidate['stack'] !== undefined) {
      if (typeof candidate['stack'] !== 'string') {
        return false
      }
    }

    // Optional timestamp
    if ('timestamp' in candidate && candidate['timestamp'] !== undefined) {
      if (typeof candidate['timestamp'] !== 'number' || !Number.isFinite(candidate['timestamp'])) {
        return false
      }
    }

    // Optional data
    if ('data' in candidate && candidate['data'] !== undefined) {
      if (!isJsonObject(candidate['data'], activeStack)) {
        return false
      }
    }

    // Optional cause (recursively checked)
    if ('cause' in candidate && candidate['cause'] !== undefined) {
      if (!isGErrorDTO(candidate['cause'], activeStack)) {
        return false
      }
    }

    return true
  } finally {
    activeStack.delete(payload)
  }
}
