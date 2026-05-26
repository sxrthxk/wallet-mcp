import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Log to file since stdout is used for MCP protocol
const LOG_DIR = join(homedir(), '.wallet-mcp', 'logs')
const LOG_FILE = join(LOG_DIR, 'wallet-mcp.log')

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true })
}

// Check if debug mode is enabled
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1'

function formatLog(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString()
  const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : ''
  return `[${timestamp}] [${level}] ${message}${dataStr}\n`
}

export const logger = {
  info(message: string, data?: unknown) {
    const log = formatLog('INFO', message, data)
    if (DEBUG) {
      // Also write to stderr (visible in terminal, doesn't break MCP)
      process.stderr.write(log)
    }
    appendFileSync(LOG_FILE, log)
  },

  error(message: string, data?: unknown) {
    const log = formatLog('ERROR', message, data)
    // Always write errors to stderr
    process.stderr.write(log)
    appendFileSync(LOG_FILE, log)
  },

  debug(message: string, data?: unknown) {
    if (!DEBUG) return
    const log = formatLog('DEBUG', message, data)
    process.stderr.write(log)
    appendFileSync(LOG_FILE, log)
  },

  tool(name: string, args: unknown) {
    this.info(`Tool called: ${name}`, args)
  },

  result(name: string, result: unknown) {
    this.debug(`Tool result: ${name}`, result)
  },
}

export function getLogFile() {
  return LOG_FILE
}
