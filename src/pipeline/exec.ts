import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface RunOptions {
  cwd?: string
  signal?: AbortSignal
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  // Lines of stderr kept for error messages
  stderrTailLines?: number
}

export interface RunResult {
  code: number
  stderrTail: string[]
}

export class ProcessError extends Error {
  constructor(
    public readonly command: string,
    public readonly code: number | null,
    public readonly stderrTail: string[],
    public readonly aborted: boolean
  ) {
    super(
      aborted
        ? `${command} cancelado`
        : `${command} terminó con código ${code}${stderrTail.length ? `:\n${stderrTail.join('\n')}` : ''}`
    )
    this.name = 'ProcessError'
  }
}

export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new ProcessError(bin, null, [], true))

    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const tail: string[] = []
    const tailSize = opts.stderrTailLines ?? 30
    let aborted = false

    const onAbort = (): void => {
      aborted = true
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    createInterface({ input: child.stdout }).on('line', (line) => opts.onStdoutLine?.(line))
    createInterface({ input: child.stderr }).on('line', (line) => {
      tail.push(line)
      if (tail.length > tailSize) tail.shift()
      opts.onStderrLine?.(line)
    })

    child.on('error', (error) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (aborted || code !== 0) reject(new ProcessError(bin, code, tail, aborted))
      else resolve({ code: 0, stderrTail: tail })
    })
  })
}

export async function capture(bin: string, args: string[], opts: Pick<RunOptions, 'cwd' | 'signal'> = {}): Promise<string> {
  const lines: string[] = []
  await run(bin, args, { ...opts, onStdoutLine: (line) => lines.push(line) })
  return lines.join('\n')
}
