import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import jpeg from 'jpeg-js'
import { extractImagePalettes } from './image-palette.js'
import { getExifOrientation } from './jpeg-orientation.js'

const IMAGE_ANALYSIS_JOB = 'dsh-bing-wallpaper-image-analysis'

if (!isMainThread && workerData?.job === IMAGE_ANALYSIS_JOB) {
  const { width, height, data, exifBuffer } = jpeg.decode(workerData.bytes, {
    useTArray: true, maxResolutionInMP: 16, maxMemoryUsageInMB: 256,
  })
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  const swapped = getExifOrientation(exifBuffer) >= 5
  parentPort.postMessage({
    imageWidth: swapped ? height : width,
    imageHeight: swapped ? width : height,
    imagePalette: extractImagePalettes(pixels, width, height),
  })
}

function analyzeInWorker(bytes, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const worker = new Worker(new URL(import.meta.url), { workerData: { job: IMAGE_ANALYSIS_JOB, bytes } })
    const abort = () => {
      reject(signal.reason)
      void worker.terminate()
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', code => {
      signal.removeEventListener('abort', abort)
      reject(new Error(`Wallpaper analysis worker exited with code ${code} before returning metadata`))
    })
  })
}

export function createImageAnalyzer() {
  // Different markets and resolutions can refresh together. Limit peak JPEG decode memory.
  let queue = Promise.resolve()
  return (bytes, signal) => {
    const result = queue.then(() => analyzeInWorker(bytes, signal))
    queue = result.catch(() => {})
    return result
  }
}
