/**
 * Minimal ZIP writer for the web demo download endpoint.
 *
 * The generated kit is already bounded by the web scan/output limits, so a
 * store-only archive is a good fit: it is portable, deterministic, and avoids
 * adding a native or third-party runtime dependency to the demo server.
 */

interface ZipEntry {
  name: string;
  content: Buffer;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function writeUInt32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/** Create a store-only ZIP archive from safe, relative file names. */
export function createZipArchive(entries: readonly ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = entry.content;
    const checksum = crc32(content);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20), // version needed
      writeUInt16(0), // flags
      writeUInt16(0), // store (no compression)
      writeUInt16(0), // time
      writeUInt16(0), // date
      writeUInt32(checksum),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0), // extra length
      name,
      content,
    ]);
    localParts.push(localHeader);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20), // version made by
      writeUInt16(20), // version needed
      writeUInt16(0), // flags
      writeUInt16(0), // store (no compression)
      writeUInt16(0), // time
      writeUInt16(0), // date
      writeUInt32(checksum),
      writeUInt32(content.length),
      writeUInt32(content.length),
      writeUInt16(name.length),
      writeUInt16(0), // extra length
      writeUInt16(0), // comment length
      writeUInt16(0), // disk number
      writeUInt16(0), // internal attributes
      writeUInt32(0), // external attributes
      writeUInt32(localOffset),
      name,
    ]);
    centralParts.push(centralHeader);
    localOffset += localHeader.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0), // disk number
    writeUInt16(0), // central directory disk
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(centralData.length),
    writeUInt32(localData.length),
    writeUInt16(0), // comment length
  ]);

  return Buffer.concat([localData, centralData, end]);
}
