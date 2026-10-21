const MIN_IMAGE_BYTES = 8 * 1024;

function decodeImage(value) {
  const match = typeof value === 'string'
    ? value.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
    : null;
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.toString('base64') !== match[2]) return null;
  return { format: match[1], buffer };
}

function hasValidImageSignature(format, buffer) {
  if (format === 'png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (format === 'webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasUsefulVisualDetail(buffer) {
  const sampleSize = Math.min(buffer.length, 12000);
  let total = 0;
  let squared = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = buffer[index];
    total += value;
    squared += value * value;
  }
  const mean = total / sampleSize;
  const variance = (squared / sampleSize) - (mean * mean);
  return mean > 8 && mean < 247 && variance > 80;
}

function validateFaceImage(faceImage) {
  const decoded = decodeImage(faceImage);
  if (!decoded || decoded.buffer.length < MIN_IMAGE_BYTES) {
    return { valid: false, message: 'Face image is missing or too small.' };
  }
  if (!hasValidImageSignature(decoded.format, decoded.buffer)) {
    return { valid: false, message: 'Face image data is invalid.' };
  }
  if (!hasUsefulVisualDetail(decoded.buffer)) {
    return { valid: false, message: 'Please capture a clear, well-lit face. Black or blurry images are not accepted.' };
  }
  return { valid: true };
}

module.exports = { validateFaceImage };
