export function getExifOrientation(exif) {
  if (!exif?.length) return 1
  // jpeg-js leaves the second NUL of the APP1 Exif identifier before the TIFF header.
  const tiff = exif[0] === 0 ? exif.subarray(1) : exif
  if (tiff.byteLength < 8) return 1
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const byteOrder = view.getUint16(0)
  const littleEndian = byteOrder === 0x4949
  if ((!littleEndian && byteOrder !== 0x4d4d) || view.getUint16(2, littleEndian) !== 42) return 1
  const directory = view.getUint32(4, littleEndian)
  if (directory < 8 || directory + 2 > view.byteLength) return 1
  const entries = view.getUint16(directory, littleEndian)
  for (let index = 0; index < entries; index++) {
    const field = directory + 2 + index * 12
    if (field + 12 > view.byteLength) break
    if (view.getUint16(field, littleEndian) !== 0x0112) continue
    if (view.getUint16(field + 2, littleEndian) !== 3 || view.getUint32(field + 4, littleEndian) !== 1) break
    const value = view.getUint16(field + 8, littleEndian)
    return value >= 1 && value <= 8 ? value : 1
  }
  return 1
}
