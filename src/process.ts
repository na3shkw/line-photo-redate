import { Zip, ZipPassThrough } from "fflate";
import { pad2, toExifDateTime, type ParsedLine } from "./datetime";
import { writeDateTime } from "./exif/writeDate";
import type { Matched } from "./matching";

export interface InputFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BuildZipOptions {
  onProgress?: (done: number, total: number) => void;
  /** ZIP 全体の上限バイト数。fflate は ZIP64 非対応なので既定は 4GB 未満 */
  maxBytes?: number;
}

const ZIP32_MAX_BYTES = 0xffffffff;
// ファイルごとのヘッダ等の大きさ（ローカルヘッダ 30 + データディスクリプタ 16 + セントラルディレクトリ 46）
const PER_FILE_OVERHEAD = 30 + 16 + 46;
const END_OF_CENTRAL_DIRECTORY = 22;

/**
 * ZIP 内の更新日時。ZIP（DOS 形式）は 1980〜2099 年しか表せないので範囲内に丸める。
 * EXIF に書く日時には影響しない。
 */
function zipMtime(line: ParsedLine): Date {
  const date = new Date(line.year, line.month - 1, line.day, line.hour, line.minute);
  const min = new Date(1980, 0, 1, 0, 0);
  const max = new Date(2099, 11, 31, 23, 59);
  return date < min ? min : date > max ? max : date;
}

/**
 * 写真を1枚ずつ順番に処理し、無圧縮の ZIP を作る。
 * 出力チャンクはすぐ Blob にするので、大きな ZIP でもメモリに全部載せずに済む。
 * 1枚でも失敗したらエラーを投げる（一部だけ処理済みの ZIP は作らない）。
 */
export async function buildZip(
  items: readonly Matched<InputFile>[],
  offset: string,
  { onProgress, maxBytes = ZIP32_MAX_BYTES }: BuildZipOptions = {},
): Promise<Blob> {
  const parts: Blob[] = [];
  let zipError: Error | null = null;
  let finished = false;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      return;
    }
    parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
    if (final) finished = true;
  });

  const encoder = new TextEncoder();
  let estimatedBytes = END_OF_CENTRAL_DIRECTORY;

  try {
    for (const [i, { file, line }] of items.entries()) {
      try {
        const input = new Uint8Array(await file.arrayBuffer());
        const output = writeDateTime(input, toExifDateTime(line), offset);

        const nameBytes = encoder.encode(file.name).length;
        estimatedBytes += PER_FILE_OVERHEAD + nameBytes * 2 + output.length;
        if (estimatedBytes > maxBytes) {
          throw new Error("ZIP が 4GB を超えるため作成できません。写真を分けて処理してください");
        }

        const entry = new ZipPassThrough(file.name);
        entry.mtime = zipMtime(line);
        zip.add(entry);
        entry.push(output, true);
        if (zipError) throw zipError;
      } catch (e) {
        throw new Error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      onProgress?.(i + 1, items.length);
    }
    zip.end();
  } catch (e) {
    zip.terminate();
    throw e;
  }
  if (zipError) throw zipError;
  if (!finished) throw new Error("ZIP の作成に失敗しました");
  return new Blob(parts, { type: "application/zip" });
}

/** `line-photos-redated-YYYYMMDD-HHmmss.zip` */
export function zipFileName(now: Date = new Date()): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `line-photos-redated-${date}-${time}.zip`;
}
