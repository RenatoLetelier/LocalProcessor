// Error carrying an HTTP status; Fastify's error handler turns it into the
// standard { statusCode, error, message } body plus any extra fields.
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly extra: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>): HttpError => new HttpError(400, message, extra)
export const notFound = (message: string): HttpError => new HttpError(404, message)
export const conflict = (message: string, extra?: Record<string, unknown>): HttpError => new HttpError(409, message, extra)
