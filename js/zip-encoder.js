/* Minimal, dependency-free ZIP writer. Stores files uncompressed (method 0),
   which keeps the code small — fine for the couple of small files this site
   bundles (a WAV and a JSON note). No external libraries required.

   Everything is written directly into a preallocated Uint8Array via
   DataView, rather than building plain arrays and spreading them — spreading
   a multi-megabyte array into push() blows the JS call stack, which is
   exactly the failure this file used to have with real (non-tiny) WAVs. */

const _crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ _crcTable[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
  const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return { time, dosDate };
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob} a valid .zip file, application/zip
 */
function createZip(files) {
  const encoder = new TextEncoder();
  const { time, dosDate } = _dosDateTime(new Date());

  const entries = files.map((f) => {
    const nameBytes = encoder.encode(f.name);
    return {
      nameBytes,
      data: f.data,
      crc: crc32(f.data),
      localSize: LOCAL_HEADER_SIZE + nameBytes.length + f.data.length,
      centralSize: CENTRAL_HEADER_SIZE + nameBytes.length,
    };
  });

  const totalLocal = entries.reduce((sum, e) => sum + e.localSize, 0);
  const totalCentral = entries.reduce((sum, e) => sum + e.centralSize, 0);
  const buf = new Uint8Array(totalLocal + totalCentral + EOCD_SIZE);
  const view = new DataView(buf.buffer);

  let offset = 0;
  const localOffsets = [];

  // local file headers + data
  entries.forEach((e) => {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;        // version needed
    view.setUint16(offset, 0, true); offset += 2;         // flags
    view.setUint16(offset, 0, true); offset += 2;         // method: store
    view.setUint16(offset, time, true); offset += 2;
    view.setUint16(offset, dosDate, true); offset += 2;
    view.setUint32(offset, e.crc, true); offset += 4;
    view.setUint32(offset, e.data.length, true); offset += 4;  // compressed size
    view.setUint32(offset, e.data.length, true); offset += 4;  // uncompressed size
    view.setUint16(offset, e.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;         // extra field length
    buf.set(e.nameBytes, offset); offset += e.nameBytes.length;
    buf.set(e.data, offset); offset += e.data.length;
  });

  // central directory
  const centralStart = offset;
  entries.forEach((e, i) => {
    view.setUint32(offset, 0x02014b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;        // version made by
    view.setUint16(offset, 20, true); offset += 2;        // version needed
    view.setUint16(offset, 0, true); offset += 2;         // flags
    view.setUint16(offset, 0, true); offset += 2;         // method
    view.setUint16(offset, time, true); offset += 2;
    view.setUint16(offset, dosDate, true); offset += 2;
    view.setUint32(offset, e.crc, true); offset += 4;
    view.setUint32(offset, e.data.length, true); offset += 4;
    view.setUint32(offset, e.data.length, true); offset += 4;
    view.setUint16(offset, e.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;         // extra field length
    view.setUint16(offset, 0, true); offset += 2;         // comment length
    view.setUint16(offset, 0, true); offset += 2;         // disk number start
    view.setUint16(offset, 0, true); offset += 2;         // internal attrs
    view.setUint32(offset, 0, true); offset += 4;         // external attrs
    view.setUint32(offset, localOffsets[i], true); offset += 4;
    buf.set(e.nameBytes, offset); offset += e.nameBytes.length;
  });
  const centralSize = offset - centralStart;

  // end of central directory record
  view.setUint32(offset, 0x06054b50, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;          // disk number
  view.setUint16(offset, 0, true); offset += 2;          // disk with central dir
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint32(offset, centralSize, true); offset += 4;
  view.setUint32(offset, centralStart, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;          // comment length

  return new Blob([buf], { type: 'application/zip' });
}
