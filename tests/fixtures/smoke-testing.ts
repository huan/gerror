import {
  GError,
  VERSION,
}             from 'gerror'
import assert from 'assert'

async function main () {
  const gerr = GError.from(new Error('smoke testing'))
  assert(gerr, 'GError instanciated from Error')

  if (VERSION === '0.0.0') {
    throw new Error('version not set right before publish!')
  }

  console.log(`GError v${VERSION} smoke testing passed!`)
}

main()
  .catch(console.error)
