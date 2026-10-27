/*
 * JPEG の EXIF（APP1 セグメント）の中身は、TIFF 形式と同じ構造（"II"/"MM" のヘッダ + IFD と呼ばれるタグの表）で書かれている。
 * このファイルはその構造の読み書きを担当する。TIFF 画像ファイル自体には対応しない。
 */

/** IFD のエントリ。値は常にリトルエンディアンのバイト列で持つ */
export interface Entry {
  tag: number;
  type: number;
  count: number;
  value: Uint8Array;
}

export type Ifd = Map<number, Entry>;

export interface ExifData {
  ifd0: Ifd;
  exif: Ifd;
  gps: Ifd;
}

export const TYPE_ASCII = 2;
export const TYPE_LONG = 4;
export const TYPE_UNDEFINED = 7;

export const TAG_EXIF_IFD = 0x8769;
export const TAG_GPS_IFD = 0x8825;

/** 型ごとの「1要素のバイト数」と「エンディアン変換の単位」 */
const TYPE_INFO: Record<number, { size: number; unit: number }> = {
  1: { size: 1, unit: 1 }, // BYTE
  2: { size: 1, unit: 1 }, // ASCII
  3: { size: 2, unit: 2 }, // SHORT
  4: { size: 4, unit: 4 }, // LONG
  5: { size: 8, unit: 4 }, // RATIONAL
  6: { size: 1, unit: 1 }, // SBYTE
  7: { size: 1, unit: 1 }, // UNDEFINED
  8: { size: 2, unit: 2 }, // SSHORT
  9: { size: 4, unit: 4 }, // SLONG
  10: { size: 8, unit: 4 }, // SRATIONAL
  11: { size: 4, unit: 4 }, // FLOAT
  12: { size: 8, unit: 8 }, // DOUBLE
};

/**
 * 書き出し時に捨てるタグ。ファイル内の位置を指すため、そのままコピーすると壊れる。
 * IFD ポインタ（Exif / GPS）は書き出し時に作り直す。
 */
const DROP_TAGS = new Set([
  TAG_EXIF_IFD,
  TAG_GPS_IFD,
  0xa005, // InteroperabilityIFD
  0x927c, // MakerNote
  0x0111, // StripOffsets
  0x0117, // StripByteCounts
  0x014a, // SubIFDs
  0x0201, // JPEGInterchangeFormat
  0x0202, // JPEGInterchangeFormatLength
]);

export function emptyExif(): ExifData {
  return { ifd0: new Map(), exif: new Map(), gps: new Map() };
}

/** TIFF（Exif APP1 の "Exif\0\0" の後ろ）を読み、IFD0 / Exif / GPS のエントリを取り出す */
export function readTiff(tiff: Uint8Array): ExifData {
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error("TIFF ヘッダが不正です");
  const le = order === 0x4949;
  if (view.getUint16(2, le) !== 42) throw new Error("TIFF ヘッダが不正です");

  const readIfd = (offset: number): { ifd: Ifd; pointers: Map<number, number> } => {
    const ifd: Ifd = new Map();
    const pointers = new Map<number, number>();
    const n = view.getUint16(offset, le);
    for (let i = 0; i < n; i++) {
      const p = offset + 2 + i * 12;
      // 途中で範囲外になったら、そこまで読めたエントリだけを残す
      if (p + 12 > tiff.length) break;
      const tag = view.getUint16(p, le);
      const type = view.getUint16(p + 2, le);
      const count = view.getUint32(p + 4, le);
      if (tag === TAG_EXIF_IFD || tag === TAG_GPS_IFD) {
        pointers.set(tag, view.getUint32(p + 8, le));
        continue;
      }
      const info = TYPE_INFO[type];
      if (!info || DROP_TAGS.has(tag)) continue;
      const byteLength = info.size * count;
      const dataOffset = byteLength <= 4 ? p + 8 : view.getUint32(p + 8, le);
      if (dataOffset + byteLength > tiff.length) continue;
      const value = tiff.slice(dataOffset, dataOffset + byteLength);
      if (!le && info.unit > 1) {
        for (let j = 0; j < value.length; j += info.unit) {
          value.subarray(j, j + info.unit).reverse();
        }
      }
      ifd.set(tag, { tag, type, count, value });
    }
    return { ifd, pointers };
  };

  // Exif / GPS IFD が壊れていても、読めた IFD0 は残す
  const readSubIfd = (ptr: number | undefined): Ifd => {
    if (!ptr) return new Map();
    try {
      return readIfd(ptr).ifd;
    } catch {
      return new Map();
    }
  };

  const first = readIfd(view.getUint32(4, le));
  return {
    ifd0: first.ifd,
    exif: readSubIfd(first.pointers.get(TAG_EXIF_IFD)),
    gps: readSubIfd(first.pointers.get(TAG_GPS_IFD)),
  };
}

const paddedLength = (e: Entry) => (e.value.length > 4 ? e.value.length + (e.value.length & 1) : 0);

const ifdSize = (entries: Entry[]) => 2 + entries.length * 12 + 4 + entries.reduce((s, e) => s + paddedLength(e), 0);

function longEntry(tag: number, n: number): Entry {
  const value = new Uint8Array(4);
  new DataView(value.buffer).setUint32(0, n, true);
  return { tag, type: TYPE_LONG, count: 1, value };
}

/** IFD0 / Exif / GPS をリトルエンディアンの TIFF として書き出す */
export function writeTiff(data: ExifData): Uint8Array {
  const exifEntries = [...data.exif.values()];
  const gpsEntries = [...data.gps.values()];
  const hasExif = exifEntries.length > 0;
  const hasGps = gpsEntries.length > 0;

  // IFD0 にはポインタを仮の値で入れてサイズを確定させる
  const ifd0Entries = [...data.ifd0.values()];
  if (hasExif) ifd0Entries.push(longEntry(TAG_EXIF_IFD, 0));
  if (hasGps) ifd0Entries.push(longEntry(TAG_GPS_IFD, 0));

  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + ifdSize(ifd0Entries);
  const gpsOffset = exifOffset + (hasExif ? ifdSize(exifEntries) : 0);
  const total = gpsOffset + (hasGps ? ifdSize(gpsEntries) : 0);

  const fixed = ifd0Entries.map((e) =>
    e.tag === TAG_EXIF_IFD ? longEntry(e.tag, exifOffset) : e.tag === TAG_GPS_IFD ? longEntry(e.tag, gpsOffset) : e,
  );

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, ifd0Offset, true);

  const writeIfd = (offset: number, entries: Entry[]) => {
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    view.setUint16(offset, sorted.length, true);
    let dataPos = offset + 2 + sorted.length * 12 + 4;
    sorted.forEach((e, i) => {
      const p = offset + 2 + i * 12;
      view.setUint16(p, e.tag, true);
      view.setUint16(p + 2, e.type, true);
      view.setUint32(p + 4, e.count, true);
      if (e.value.length <= 4) {
        out.set(e.value, p + 8);
      } else {
        view.setUint32(p + 8, dataPos, true);
        out.set(e.value, dataPos);
        dataPos += paddedLength(e);
      }
    });
    // 次の IFD へのオフセットは 0（IFD1 は書かない）
  };

  writeIfd(ifd0Offset, fixed);
  if (hasExif) writeIfd(exifOffset, exifEntries);
  if (hasGps) writeIfd(gpsOffset, gpsEntries);
  return out;
}

export function asciiEntry(tag: number, s: string): Entry {
  const value = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) value[i] = s.charCodeAt(i);
  return { tag, type: TYPE_ASCII, count: value.length, value };
}

export function undefinedEntry(tag: number, bytes: Uint8Array): Entry {
  return { tag, type: TYPE_UNDEFINED, count: bytes.length, value: bytes };
}
