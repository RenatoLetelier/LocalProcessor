export interface HealthResponse {
  status: 'ok'
  app: string
  version: string
  uptimeSeconds: number
}
