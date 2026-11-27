/**
 * Canonical JSON Data Transfer Object (DTO) for cross-process,
 * gRPC, Redux, and CQRS event distribution.
 *
 * GErrorDTO is a pure, serializable plain JavaScript object
 * that survives JSON.stringify() and structuredClone() without
 * losing error properties or stack traces.
 */
export interface GErrorDTO {
  readonly name: string
  readonly message: string
  readonly code: number | string
  readonly details?: string
  readonly stack?: string
  readonly cause?: GErrorDTO
  readonly data?: Record<string, unknown>
  readonly timestamp?: number
}

export const isGErrorDTO = (payload: unknown): payload is GErrorDTO =>
  typeof payload === 'object' &&
  payload !== null &&
  'name' in payload &&
  typeof (payload as { name: unknown }).name === 'string' &&
  'message' in payload &&
  typeof (payload as { message: unknown }).message === 'string' &&
  'code' in payload &&
  (typeof (payload as { code: unknown }).code === 'number' ||
   typeof (payload as { code: unknown }).code === 'string')
