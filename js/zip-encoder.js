/* Minimal, dependency-free ZIP writer. Stores files uncompressed (method 0),
   which keeps the code small — fine for the couple of small files this site
   bundles (a WAV and a JSON note). No external libraries required. */

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

function _u16(arr, v) { arr.push(v & 0xFF, (v >> 8) & 0xFF); }
function _u32(arr, v) { arr.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }
function _bytes(arr, uint8) { for (let i = 0; i < uint8.length; i++) arr.push(uint8[i]); }

/**
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob} a valid .zip file, application/zip
 */
function createZip(files) {
  const encoder = new TextEncoder();
  const { time, dosDate } = _dosDateTime(new Date());
  const local = [];
  const central = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    // local file header
    const lh = [];
    _u32(lh, 0x04034b50);
    _u16(lh, 20);          // version needed
    _u16(lh, 0);           // flags
    _u16(lh, 0);           // method: store
    _u16(lh, time);
    _u16(lh, dosDate);
    _u32(lh, crc);
    _u32(lh, size);        // compressed size
    _u32(lh, size);        // uncompressed size
    _u16(lh, nameBytes.length);
    _u16(lh, 0);           // extra field length
    _bytes(lh, nameBytes);
    _bytes(lh, data);
    local.push(...lh);

    // central directory header
    const ch = [];
    _u32(ch, 0x02014b50);
    _u16(ch, 20);          // version made by
    _u16(ch, 20);          // version needed
    _u16(ch, 0);           // flags
    _u16(ch, 0);           // method
    _u16(ch, time);
    _u16(ch, dosDate);
    _u32(ch, crc);
    _u32(ch, size);
    _u32(ch, size);
    _u16(ch, nameBytes.length);
    _u16(ch, 0);           // extra field length
    _u16(ch, 0);           // comment length
    _u16(ch, 0);           // disk number start
    _u16(ch, 0);           // internal attrs
    _u32(ch, 0);           // external attrs
    _u32(ch, offset);      // offset of local header
    _bytes(ch, nameBytes);
    central.push(...ch);

    offset += lh.length;
  });

  const centralStart = offset;
  const eocd = [];
  _u32(eocd, 0x06054b50);
  _u16(eocd, 0);                    // disk number
  _u16(eocd, 0);                    // disk with central dir
  _u16(eocd, files.length);         // entries on this disk
  _u16(eocd, files.length);         // total entries
  _u32(eocd, central.length);       // size of central directory
  _u32(eocd, centralStart);         // offset of central directory
  _u16(eocd, 0);                    // comment length

  const allBytes = new Uint8Array(local.length + central.length + eocd.length);
  allBytes.set(local, 0);
  allBytes.set(central, local.length);
  allBytes.set(eocd, local.length + central.length);

  return new Blob([allBytes], { type: 'application/zip' });
}
