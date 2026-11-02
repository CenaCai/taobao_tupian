import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./ts-alias-hook.mjs', pathToFileURL(import.meta.filename))
