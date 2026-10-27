export interface Segment {
  /** マーカーの2バイト目（APP1 なら 0xE1） */
  marker: number;
  /** マーカー・長さを含むセグメント全体のバイト列 */
  bytes: Uint8Array;
}

export interface SplitJpeg {
  /** SOI の後、SOS より前のセグメント */
  segments: Segment[];
  /** SOS 以降（画像データと EOI を含む）。そのままコピーする */
  rest: Uint8Array;
}

const SOS = 0xda;
const EOI = 0xd9;

export function isJpeg(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

/** JPEG を SOS より前のセグメント列と、SOS 以降に分ける */
export function splitJpeg(buf: Uint8Array): SplitJpeg {
  if (!isJpeg(buf)) throw new Error("JPEG ではありません");
  const segments: Segment[] = [];
  let pos = 2;
  while (pos < buf.length) {
    // セグメント間の余分なバイト（パディングなど）は次の 0xFF まで読み飛ばす
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    // マーカー前の埋め草 0xFF を読み飛ばす
    let markerPos = pos;
    while (markerPos + 1 < buf.length && buf[markerPos + 1] === 0xff) markerPos++;
    const marker = buf[markerPos + 1];
    if (marker === SOS || marker === EOI) {
      return { segments, rest: buf.subarray(markerPos) };
    }
    // 長さを持たないマーカー（TEM, RST0-7）
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, bytes: buf.subarray(pos, markerPos + 2) });
      pos = markerPos + 2;
      continue;
    }
    if (markerPos + 3 >= buf.length) break;
    const length = (buf[markerPos + 2] << 8) | buf[markerPos + 3];
    const end = markerPos + 2 + length;
    if (length < 2 || end > buf.length) throw new Error("JPEG の構造が不正です");
    segments.push({ marker, bytes: buf.subarray(pos, end) });
    pos = end;
  }
  throw new Error("JPEG の画像データが見つかりません");
}
