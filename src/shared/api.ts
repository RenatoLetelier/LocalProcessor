export interface HealthResponse {
  status: 'ok'
  app: string
  version: string
  uptimeSeconds: number
}

export interface ApiError {
  statusCode: number
  error: string
  message: string
}
