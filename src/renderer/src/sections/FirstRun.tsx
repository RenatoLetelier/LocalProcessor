import { useState } from 'react'
import { bridge } from '@/lib/bridge'
import { ApiError } from '@/lib/api'
import { useAppState } from '@/state/AppState'

// Blocks the app until the output folder exists: nothing else makes sense without it
export function FirstRun() {
  const { saveConfig } = useAppState()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = async (): Promise<void> => {
    const folder = await bridge.pickFolder()
    if (!folder) return
    setBusy(true)
    setError(null)
    try {
      await saveConfig({ outputFolder: folder })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="first-run">
      <div className="card first-run__card">
        <h2>Bienvenido a LocalProcessor</h2>
        <p>
          Elige la carpeta donde se publicarán las películas convertidas. Cada título ocupará una subcarpeta con sus calidades, pistas de
          audio y manifiestos HLS/DASH, lista para que otro sistema la sirva por streaming.
        </p>
        <p className="muted">Conviene que esté en el disco con más espacio: los archivos temporales de cada conversión también viven ahí.</p>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void choose()}>
          Elegir carpeta de salida…
        </button>
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  )
}
