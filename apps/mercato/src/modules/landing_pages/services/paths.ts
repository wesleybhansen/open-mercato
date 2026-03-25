import * as fs from 'fs'
import * as path from 'path'

// process.cwd() can be repo root or apps/mercato depending on context
// This resolves the correct templates directory either way
function resolveTemplatesDir(): string {
  const direct = path.join(process.cwd(), 'templates')
  if (fs.existsSync(direct)) return direct

  const nested = path.join(process.cwd(), 'apps', 'mercato', 'templates')
  if (fs.existsSync(nested)) return nested

  // Fallback — try relative to this file
  const fromFile = path.resolve(__dirname, '..', '..', '..', '..', 'templates')
  if (fs.existsSync(fromFile)) return fromFile

  return direct // default, will fail gracefully
}

export const TEMPLATES_DIR = resolveTemplatesDir()
