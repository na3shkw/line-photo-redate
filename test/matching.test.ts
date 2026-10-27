import { describe, expect, it } from "vitest";
import { parseDateLines, toExifDateTime } from "../src/datetime";
import { matchFiles } from "../src/matching";

const files = (...names: string[]) => names.map((name) => ({ name }));

describe("matchFiles", () => {
  it("ファイル名の数値の昇順に並べて n 行目と対応付ける", () => {
    const lines = parseDateLines("2026/10/25 15:48\n2026/10/25 15:42\n2026/10/24 09:00\n");
    const result = matchFiles(files("1792936238300.jpg", "1792936238121.jpg", "1792936238200.JPG"), lines);
    expect(result.map((r) => [r.file.name, toExifDateTime(r.line)])).toEqual([
      ["1792936238121.jpg", "2026:10:25 15:48:00"],
      ["1792936238200.JPG", "2026:10:25 15:42:00"],
      ["1792936238300.jpg", "2026:10:24 09:00:00"],
    ]);
  });

  it("文字列順ではなく数値順に並べる", () => {
    const lines = parseDateLines("2026/01/01 00:01\n2026/01/01 00:02\n2026/01/01 00:03");
    const result = matchFiles(files("100.jpg", "9.jpg", "10.jpg"), lines);
    expect(result.map((r) => r.file.name)).toEqual(["9.jpg", "10.jpg", "100.jpg"]);
  });

  it("空行は対応付けに影響しない", () => {
    const lines = parseDateLines("\n2026/01/01 00:01\n\n2026/01/01 00:02\n");
    const result = matchFiles(files("2.jpg", "1.jpg"), lines);
    expect(result.map((r) => [r.file.name, r.line.lineNumber])).toEqual([
      ["1.jpg", 2],
      ["2.jpg", 4],
    ]);
  });

  it("件数が一致しなければエラー", () => {
    const lines = parseDateLines("2026/01/01 00:01\n2026/01/01 00:02");
    expect(() => matchFiles(files("1.jpg"), lines)).toThrow("件数が一致しません（テキスト 2行 / 写真 1枚）");
    expect(() => matchFiles(files("1.jpg", "2.jpg", "3.jpg"), lines)).toThrow("テキスト 2行 / 写真 3枚");
  });

  it("ファイル名が数値でなければエラー", () => {
    const lines = parseDateLines("2026/01/01 00:01");
    expect(() => matchFiles(files("IMG_0001.jpg"), lines)).toThrow("ファイル名が数値ではありません: IMG_0001.jpg");
    expect(() => matchFiles(files("123.png"), lines)).toThrow("ファイル名が数値ではありません");
  });

  it("同じ数値のファイル名はエラー", () => {
    const lines = parseDateLines("2026/01/01 00:01\n2026/01/01 00:02");
    expect(() => matchFiles(files("1.jpg", "001.jpg"), lines)).toThrow("ファイル名が重複しています");
  });
});
