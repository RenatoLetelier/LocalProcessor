export type SectionId = 'process' | 'jobs' | 'library' | 'settings'

export interface Section {
  id: SectionId
  label: string
  description: string
}

export const SECTIONS: Section[] = [
  { id: 'process', label: 'Procesar', description: 'Selecciona películas y encólalas para transcodificar.' },
  { id: 'jobs', label: 'Jobs', description: 'Progreso en tiempo real de los trabajos activos y en cola.' },
  { id: 'library', label: 'Biblioteca', description: 'Explora los títulos generados en la carpeta de salida.' },
  { id: 'settings', label: 'Configuración', description: 'Estándar de salida, calidades, duración de segmento y carpeta de salida.' }
]
