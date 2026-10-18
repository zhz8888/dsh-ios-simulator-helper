import { inflateSync } from 'node:zlib'

/**
 * Decode an 8-bit PNG into raw pixels.
 *
 * The icon is the only image this suite reads pixel by pixel, and the check it
 * needs — "did keying the flat backdrop out leave any half-blended tile pixel
 * behind?" — cannot be made from the header alone. Node ships `zlib`, so a
 * decoder of forty lines beats an image dependency the package would have to
 * carry for one assertion.
 *
 * Only the subset this repository's icons use is supported: 8-bit truecolour,
 * with or without alpha, non-interlaced. Anything else is reported as
 * unsupported rather than mis-decoded.
 *
 * @module test/helpers/decode-png
 */

/** Samples per pixel for each accepted colour type: 2 = RGB, 6 = RGBA. */
const CHANNELS = { 2: 3, 6: 4 }

/**
 * Read an `{ r, g, b, a }` pixel out of a decoded image.
 *
 * A truecolour image with no alpha channel reads back as fully opaque, so a
 * caller never has to branch on the colour type.
 *
 * @param {{width: number, channels: number, data: Buffer}} image - a {@link decodePng} result.
 * @param {number} x - column, zero-based.
 * @param {number} y - row, zero-based.
 * @returns {{r: number, g: number, b: number, a: number}} the pixel.
 */
export function pixelAt(image, x, y) {
  const at = (y * image.width + x) * image.channels
  return {
    r: image.data[at],
    g: image.data[at + 1],
    b: image.data[at + 2],
    a: image.channels === 4 ? image.data[at + 3] : 255,
  }
}

/** Undo one PNG scanline filter in place. */
function unfilter(filter, line, target, previous, channels) {
  const stride = line.length
  for (let i = 0; i < stride; i += 1) {
    const left = i >= channels ? target[i - channels] : 0
    const up = previous[i]
    const upLeft = i >= channels ? previous[i - channels] : 0
    let value = line[i]
    if (filter === 1) value += left
    else if (filter === 2) value += up
    else if (filter === 3) value += (left + up) >> 1
    else if (filter === 4) {
      // Paeth: pick whichever of left / up / up-left the gradient predicts.
      const estimate = left + up - upLeft
      const toLeft = Math.abs(estimate - left)
      const toUp = Math.abs(estimate - up)
      const toUpLeft = Math.abs(estimate - upLeft)
      value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
    }
    target[i] = value & 0xff
  }
}

/**
 * Decode a PNG file's pixels.
 *
 * @param {Buffer} bytes - the whole file.
 * @returns {{width: number, height: number, channels: number, data: Buffer}} the image.
 * @throws {Error} when the file is not an 8-bit, non-interlaced truecolour PNG.
 */
export function decodePng(bytes) {
  assertPngSignature(bytes)
  let width
  let height
  let colourType
  let bitDepth
  let interlace
  const idat = []
  let offset = 8
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      bitDepth = body.readUInt8(8)
      colourType = body.readUInt8(9)
      interlace = body.readUInt8(12)
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = CHANNELS[colourType]
  if (bitDepth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(
      `unsupported PNG: bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}`,
    )
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = Buffer.alloc(width * height * channels)
  let previous = Buffer.alloc(stride)
  let at = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[at]
    at += 1
    const line = raw.subarray(at, at + stride)
    at += stride
    const target = data.subarray(y * stride, (y + 1) * stride)
    unfilter(filter, line, target, previous, channels)
    previous = target
  }
  return { width, height, channels, data }
}

/**
 * Check the eight magic bytes every PNG starts with.
 *
 * @param {Buffer} bytes - the whole file.
 * @returns {void}
 * @throws {Error} when the signature is missing.
 */
function assertPngSignature(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error('not a PNG: the 8-byte signature is missing')
  }
}
