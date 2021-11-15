import { GError } from '../gerror/gerror.js'

class TimeoutPromiseGError extends GError {

  override name = 'Timeout'

}

export { TimeoutPromiseGError }
