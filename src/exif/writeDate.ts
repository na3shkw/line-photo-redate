import { splitJpeg, type Segment } from "./jpeg";
import { asciiEntry, emptyExif, readTiff, undefinedEntry, writeTiff, type ExifData } from "./tiff";

const APP0 = 0xe0;
const APP1 = 0xe1;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

const TAG_DATETIME = 0x0132;
const TAG_EXIF_VERSION = 0x9000;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_OFFSET_TIME = 0x9010;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_OFFSET_TIME_DIGITIZED = 0x9012;

/** OffsetTime 系のタグは Exif 2.31 で追加された */
const MIN_EXIF_VERSION = "0231";
const EXIF_VERSION = "0232";

function isExifSegment(s: Segment): boolean {
  return s.marker === APP1 && s.bytes.length >= 10 && EXIF_HEADER.every((b, i) => s.bytes[4 + i] === b);
}

function readExif(segment: Segment | undefined): ExifData {
  if (!segment) return emptyExif();
  try {
    return readTiff(segment.bytes.subarray(10));
  } catch {
    // 読み込めない EXIF は空の状態から作り直す
    return emptyExif();
  }
}

/**
 * JPEG の EXIF に撮影日時とタイムゾーンを書き込む。
 * 既存の IFD0 / Exif / GPS のタグは保持し、画像データはそのままコピーする。
 *
 * @param dateTime `YYYY:MM:DD HH:mm:ss`
 * @param offset `+09:00`
 */
export function writeDateTime(jpeg: Uint8Array, dateTime: string, offset: string): Uint8Array {
  const { segments, rest } = splitJpeg(jpeg);
  const data = readExif(segments.find(isExifSegment));

  data.ifd0.set(TAG_DATETIME, asciiEntry(TAG_DATETIME, dateTime));
  data.exif.set(TAG_DATETIME_ORIGINAL, asciiEntry(TAG_DATETIME_ORIGINAL, dateTime));
  data.exif.set(TAG_DATETIME_DIGITIZED, asciiEntry(TAG_DATETIME_DIGITIZED, dateTime));
  data.exif.set(TAG_OFFSET_TIME, asciiEntry(TAG_OFFSET_TIME, offset));
  data.exif.set(TAG_OFFSET_TIME_ORIGINAL, asciiEntry(TAG_OFFSET_TIME_ORIGINAL, offset));
  data.exif.set(TAG_OFFSET_TIME_DIGITIZED, asciiEntry(TAG_OFFSET_TIME_DIGITIZED, offset));

  const current = data.exif.get(TAG_EXIF_VERSION);
  const currentVersion = current?.value.length === 4 ? String.fromCharCode(...current.value) : "";
  if (!(/^\d{4}$/.test(currentVersion) && currentVersion >= MIN_EXIF_VERSION)) {
    const bytes = Uint8Array.from(EXIF_VERSION, (c) => c.charCodeAt(0));
    data.exif.set(TAG_EXIF_VERSION, undefinedEntry(TAG_EXIF_VERSION, bytes));
  }

  const tiff = writeTiff(data);
  const segmentLength = 2 + EXIF_HEADER.length + tiff.length;
  if (segmentLength > 0xffff) throw new Error("EXIF が大きすぎます");
  const app1 = new Uint8Array(2 + segmentLength);
  app1.set([0xff, APP1, segmentLength >> 8, segmentLength & 0xff, ...EXIF_HEADER]);
  app1.set(tiff, 10);

  // 既存の Exif APP1 を除き、JFIF の APP0 があればその直後、なければ SOI の直後に入れる
  const others = segments.filter((s) => !isExifSegment(s));
  const insertAt = others[0]?.marker === APP0 ? 1 : 0;
  const parts = others.map((s) => s.bytes);
  parts.splice(insertAt, 0, app1);

  const total = 2 + parts.reduce((n, p) => n + p.length, 0) + rest.length;
  const out = new Uint8Array(total);
  out.set([0xff, 0xd8]);
  let pos = 2;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  out.set(rest, pos);
  return out;
}
