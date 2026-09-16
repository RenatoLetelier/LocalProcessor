# LocalProcessor

Aplicación de escritorio (Windows, macOS, Linux) que convierte películas
(`.mkv`, `.mp4`, `.avi`…) en carpetas listas para **streaming adaptativo HLS y/o
DASH**, para que otro sistema las sirva. No reproduce ni distribuye: es el motor
de conversión que se sienta entre "tengo un archivo de video" y "tengo una
carpeta lista para streaming".

- Escalera de calidades configurable (2160p / 1080p / 720p / 480p…) sin
  upscaling: cada calidad es una caja máxima y el video se escala para caber en
  ella conservando el aspect ratio.
- Todas las pistas de audio y subtítulos del original se preservan: AAC/AC-3/E-AC-3
  se copian, el resto (DTS, TrueHD, FLAC…) se transcodifica a AAC conservando los
  canales; los subtítulos de texto se convierten a WebVTT.
- Un solo set de segmentos CMAF (fMP4) sirve tanto al `master.m3u8` como al
  `manifest.mpd`.
- Cola de trabajos persistente (SQLite), progreso en tiempo real y reanudación
  tras un cierre inesperado.
- Reprocesado incremental: agregar una calidad, una pista (del origen o de un
  archivo externo) o rehacer un título completo sin interrumpir lo ya publicado.
- Aceleración por hardware detectada al arrancar (NVENC, Quick Sync, AMF, VAAPI,
  VideoToolbox) con vuelta automática a CPU.
- API REST + WebSocket en `127.0.0.1:4700` para integrarse con otros programas.

Los documentos de diseño están en [`docs/`](docs/).

## Instalación

Descarga el instalador de tu sistema desde la página de *releases* y ejecútalo.
Todo viene incluido (ffmpeg, ffprobe, Shaka Packager); no hay que instalar nada
más. Al abrir la aplicación por primera vez te pedirá la carpeta de salida.

> Los instaladores no están firmados: Windows mostrará el aviso de SmartScreen
> ("editor desconocido") y macOS pedirá autorizar la aplicación en Privacidad y
> seguridad. En Apple Silicon, ffmpeg corre a través de Rosetta 2.

## Carpeta de salida

Cada título se publica en `<carpeta de salida>/<uuid>/`:

```
master.m3u8            HLS
manifest.mpd           DASH (mismos segmentos)
metadata.json          resumen del título para sistemas externos
video/<calidad>/       init.mp4, seg_00001.m4s…, playlist.m3u8
audio/<pista>/         init.mp4, seg_00001.m4s…, playlist.m3u8
subs/<pista>/          seg_00001.vtt…, playlist.m3u8
```

Los manifiestos y `metadata.json` se reemplazan siempre con un archivo temporal y
un *rename* atómico: un consumidor externo nunca ve un archivo a medio escribir.
Las carpetas `.tmp/` y `.uploads/` dentro de la carpeta de salida son de uso
interno.

## API local

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/titles` | Registra un archivo (`{ "sourcePath": "C:/peli.mkv" }` o multipart `file`) y lo encola |
| `GET` | `/titles`, `/titles/:id`, `/titles/:id/files` | Títulos, detalle y árbol de archivos publicado |
| `DELETE` | `/titles/:id` | Elimina el título y su carpeta |
| `POST` | `/titles/:id/reprocess` | `{ tipo: "agregar_calidad" \| "agregar_pista" \| "reprocesar_completo", … }` |
| `GET` | `/jobs`, `/jobs/:id` | Cola e historial |
| `POST` | `/jobs/:id/cancel` | Cancela un job |
| `WS` | `/jobs/stream` | Eventos en tiempo real (`job.progress`, `job.updated`, `title.updated`…) |
| `GET` / `PUT` | `/config` | Configuración (estándares, calidades, segmentos, codificador…) |
| `GET` | `/system` | Codificadores detectados y concurrencia |

La API escucha solo en `127.0.0.1` y no tiene autenticación (uso local).

## Desarrollo

Requisitos: Node.js 22+, npm.

```bash
npm install          # instala dependencias y descarga Electron
npm run fetch-bins   # descarga ffmpeg, ffprobe y Shaka Packager a resources/bin/
npm run dev          # Electron + Vite con recarga en caliente
npm test             # unitarios + integración real (usa los binarios descargados)
npm run typecheck
```

Herramientas de línea de comandos, útiles para probar el pipeline sin la UI:

```bash
npm run make-sample                                      # clip sintético en samples/
npm run process -- samples/sample.mkv --out C:/salida    # pipeline completo por CLI
```

La interfaz también se puede abrir en un navegador en `http://localhost:5173`
mientras `npm run dev` está corriendo (sin los diálogos nativos de archivos).

### Instaladores

```bash
npm run dist         # instalador para el sistema actual, en dist/
npm run dist:dir     # solo la carpeta desempaquetada (dist/*-unpacked)
```

Cada plataforma se construye en su propio sistema operativo; el flujo de GitHub
Actions en `.github/workflows/release.yml` genera los tres al publicar un tag
`v*`.

## Licencias

Código bajo licencia [MIT](LICENSE). Los binarios de ffmpeg/x264 (GPL) y Shaka
Packager (BSD) incluidos en el instalador se detallan en
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
