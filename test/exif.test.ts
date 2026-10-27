import exifr from "exifr";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDateLines } from "../src/datetime";
import { writeDateTime } from "../src/exif/writeDate";
import { matchFiles } from "../src/matching";
import { buildZip } from "../src/process";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const APP0 = bytes([0xff, 0xe0, 0x00, 0x10], "JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0]);
// SOS 以降（画像データ + EOI）。中身は検証に使うだけのダミー
const SCAN = bytes([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0x56, 0xff, 0xd9]);

function jpeg(...segments: Uint8Array[]): Uint8Array {
  return bytes([0xff, 0xd8], ...segments.map((s) => [...s]), [...SCAN]);
}

function app1(tiff: Uint8Array): Uint8Array {
  const len = tiff.length + 8;
  return bytes([0xff, 0xe1, len >> 8, len & 0xff], "Exif\0\0", [...tiff]);
}

/** ビッグエンディアンの TIFF: IFD0 に Orientation=6, Make="Canon", ExifIFD に ExposureTime=1/125, DateTimeOriginal(古い値) */
function bigEndianTiff(): Uint8Array {
  const u16 = (n: number) => [n >> 8, n & 0xff];
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const ifd0At = 8;
  const ifd0Size = 2 + 3 * 12 + 4; // 3 entries
  const makeAt = ifd0At + ifd0Size; // "Canon\0" 6 bytes
  const exifAt = makeAt + 6;
  const exifSize = 2 + 2 * 12 + 4;
  const rationalAt = exifAt + exifSize;
  const dtoAt = rationalAt + 8;
  return bytes(
    "MM",
    u16(42),
    u32(ifd0At),
    u16(3),
    [...u16(0x010f), ...u16(2), ...u32(6), ...u32(makeAt)], // Make
    [...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0], // Orientation
    [...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt)], // ExifIFD
    u32(0),
    "Canon\0",
    u16(2),
    [...u16(0x829a), ...u16(5), ...u32(1), ...u32(rationalAt)], // ExposureTime
    [...u16(0x9003), ...u16(2), ...u32(20), ...u32(dtoAt)], // DateTimeOriginal
    u32(0),
    [...u32(1), ...u32(125)],
    "2000:01:01 00:00:00\0",
  );
}

const read = (buf: Uint8Array) =>
  exifr.parse(buf, {
    ifd0: true,
    exif: true,
    gps: true,
    translateKeys: false,
    translateValues: false,
    reviveValues: false,
    mergeOutput: false,
  } as never);

function expectDates(meta: Record<string, Record<number, unknown>>) {
  expect(meta.ifd0[0x0132]).toBe("2026:10:25 15:48:00");
  expect(meta.exif[0x9003]).toBe("2026:10:25 15:48:00");
  expect(meta.exif[0x9004]).toBe("2026:10:25 15:48:00");
  expect(meta.exif[0x9010]).toBe("+09:00");
  expect(meta.exif[0x9011]).toBe("+09:00");
  expect(meta.exif[0x9012]).toBe("+09:00");
}

function tail(buf: Uint8Array, n: number) {
  return [...buf.subarray(buf.length - n)];
}

describe("writeDateTime", () => {
  it("EXIF がない JPEG に書き込む（APP0 の直後に入れる）", async () => {
    const out = writeDateTime(jpeg(APP0), "2026:10:25 15:48:00", "+09:00");
    expect([...out.subarray(0, 2 + APP0.length)]).toEqual([0xff, 0xd8, ...APP0]);
    expect([...out.subarray(2 + APP0.length, 2 + APP0.length + 2)]).toEqual([0xff, 0xe1]);
    expect(tail(out, SCAN.length)).toEqual([...SCAN]);
    expectDates(await read(out));
  });

  it("APP0 がなければ SOI の直後に入れる", async () => {
    const out = writeDateTime(jpeg(), "2026:10:25 15:48:00", "+09:00");
    expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expectDates(await read(out));
  });

  it("既存の EXIF（ビッグエンディアン）のタグを保持して日時を上書きする", async () => {
    const out = writeDateTime(jpeg(APP0, app1(bigEndianTiff())), "2026:10:25 15:48:00", "+09:00");
    const meta = await read(out);
    expectDates(meta);
    expect(meta.ifd0[0x010f]).toBe("Canon");
    expect(meta.ifd0[0x0112]).toBe(6);
    expect(meta.exif[0x829a]).toBeCloseTo(1 / 125);
    expect(tail(out, SCAN.length)).toEqual([...SCAN]);
    // Exif APP1 は1つだけ
    const app1Count = [...out].filter((b, i) => b === 0xff && out[i + 1] === 0xe1).length;
    expect(app1Count).toBe(1);
  });

  it("2回書き込んでも壊れない", async () => {
    const once = writeDateTime(jpeg(APP0), "2000:01:01 00:00:00", "+00:00");
    const twice = writeDateTime(once, "2026:10:25 15:48:00", "+09:00");
    expectDates(await read(twice));
    expect(twice.length).toBe(once.length);
  });

  it("Exif / GPS IFD が壊れていても IFD0 のタグは残す", async () => {
    const tiff = bigEndianTiff();
    // ExifIFD のポインタ（IFD0 の3番目のエントリの値）を範囲外にする
    tiff.set([0x00, 0xff, 0xff, 0xff], 8 + 2 + 2 * 12 + 8);
    const out = writeDateTime(jpeg(APP0, app1(tiff)), "2026:10:25 15:48:00", "+09:00");
    const meta = await read(out);
    expectDates(meta);
    expect(meta.ifd0[0x0112]).toBe(6);
    expect(meta.ifd0[0x010f]).toBe("Canon");
    expect(meta.exif[0x829a]).toBeUndefined();
  });

  it("セグメント間の余分なバイトは読み飛ばす", async () => {
    const out = writeDateTime(jpeg(APP0, bytes([0x00, 0x00])), "2026:10:25 15:48:00", "+09:00");
    expectDates(await read(out));
    expect(tail(out, SCAN.length)).toEqual([...SCAN]);
  });

  it("壊れた EXIF は空の状態から書き込む", async () => {
    const broken = app1(bytes("MM", [0, 42, 0xff, 0xff, 0xff, 0x00]));
    const out = writeDateTime(jpeg(APP0, broken), "2026:10:25 15:48:00", "+09:00");
    expectDates(await read(out));
  });

  it("JPEG でなければエラー", () => {
    expect(() => writeDateTime(bytes("\x89PNG\r\n"), "2026:10:25 15:48:00", "+09:00")).toThrow("JPEG ではありません");
  });
});

describe("buildZip", () => {
  it("元のファイル名のまま無圧縮の ZIP にまとめる", async () => {
    const src = jpeg(APP0);
    const file = (name: string) => ({ name, arrayBuffer: async () => src.slice().buffer });
    const items = matchFiles([file("20.jpg"), file("3.jpg")], parseDateLines("2026/10/25 15:48\n2026/10/25 15:42"));
    const progress: number[] = [];
    const blob = await buildZip(items, "+09:00", { onProgress: (done) => progress.push(done) });
    expect(progress).toEqual([1, 2]);

    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["20.jpg", "3.jpg"]);
    expect((await read(files["3.jpg"])).exif[0x9003]).toBe("2026:10:25 15:48:00");
    expect((await read(files["20.jpg"])).exif[0x9003]).toBe("2026:10:25 15:42:00");
  });

  it("ZIP で表せない年でも処理できる（ZIP 内の日時だけ丸める）", async () => {
    const src = jpeg(APP0);
    const items = matchFiles(
      [{ name: "1.jpg", arrayBuffer: async () => src.slice().buffer }],
      parseDateLines("1970/01/01 00:00"),
    );
    const files = unzipSync(new Uint8Array(await (await buildZip(items, "+09:00")).arrayBuffer()));
    expect((await read(files["1.jpg"])).exif[0x9003]).toBe("1970:01:01 00:00:00");
  });

  it("上限サイズを超えるとファイル名付きでエラー", async () => {
    const src = jpeg(APP0);
    const file = (name: string) => ({ name, arrayBuffer: async () => src.slice().buffer });
    const items = matchFiles([file("1.jpg"), file("2.jpg")], parseDateLines("2026/10/25 15:48\n2026/10/25 15:42"));
    await expect(buildZip(items, "+09:00", { maxBytes: 600 })).rejects.toThrow("2.jpg: ZIP が 4GB を超えるため");
  });

  it("1枚でも失敗したらファイル名付きでエラー", async () => {
    const items = matchFiles(
      [{ name: "1.jpg", arrayBuffer: async () => new ArrayBuffer(8) }],
      parseDateLines("2026/10/25 15:48"),
    );
    await expect(buildZip(items, "+09:00")).rejects.toThrow("1.jpg: JPEG ではありません");
  });
});
