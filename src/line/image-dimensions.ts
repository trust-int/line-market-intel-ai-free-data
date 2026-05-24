export type ImageDimensions = {
  type: "jpeg" | "png" | "webp";
  width: number;
  height: number;
  pixels: number;
};

export function detectImageDimensions(buffer: Buffer): ImageDimensions | undefined {
  return detectPngDimensions(buffer) ?? detectJpegDimensions(buffer) ?? detectWebpDimensions(buffer);
}

function detectPngDimensions(buffer: Buffer): ImageDimensions | undefined {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) return undefined;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return buildDimensions("png", width, height);
}

function detectJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (offset + 2 > buffer.length) return undefined;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return undefined;
    if (isJpegSofMarker(marker) && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return buildDimensions("jpeg", width, height);
    }
    offset += segmentLength;
  }
  return undefined;
}

function detectWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return undefined;
  }
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    const width = readUint24LE(buffer, 24) + 1;
    const height = readUint24LE(buffer, 27) + 1;
    return buildDimensions("webp", width, height);
  }
  if (chunkType === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return buildDimensions("webp", width, height);
  }
  return undefined;
}

function buildDimensions(type: ImageDimensions["type"], width: number, height: number): ImageDimensions | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return { type, width, height, pixels: width * height };
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readUint24LE(buffer: Buffer, offset: number): number {
  return (buffer[offset] ?? 0) + ((buffer[offset + 1] ?? 0) << 8) + ((buffer[offset + 2] ?? 0) << 16);
}
