import { describe, expect, it } from "vitest";
import { defaultOffset, isValidOffset, parseDateLines, toExifDateTime } from "../src/datetime";

describe("parseDateLines / toExifDateTime", () => {
  it("YYYY/MM/DD HH:mm を YYYY:MM:DD HH:mm:00 に変換する", () => {
    const [line] = parseDateLines("2026/10/25 15:48\n");
    expect(toExifDateTime(line)).toBe("2026:10:25 15:48:00");
  });

  it("空行・前後の空白・CRLF・BOM を無視し、行番号を保持する", () => {
    const lines = parseDateLines("﻿2026/10/25 15:48\r\n\n  2026/01/02 03:04  \n\n");
    expect(lines.map(toExifDateTime)).toEqual(["2026:10:25 15:48:00", "2026:01:02 03:04:00"]);
    expect(lines.map((l) => l.lineNumber)).toEqual([1, 3]);
  });

  it("空のテキストは0件", () => {
    expect(parseDateLines("")).toEqual([]);
    expect(parseDateLines("\n\n")).toEqual([]);
  });

  it("形式が違う行は行番号付きでエラー", () => {
    expect(() => parseDateLines("2026/10/25 15:48\n2026-10-25 15:48")).toThrow("2行目の形式が不正です");
    expect(() => parseDateLines("2026/1/25 15:48")).toThrow("1行目の形式が不正です");
    expect(() => parseDateLines("2026/10/25 15:48:00")).toThrow("1行目の形式が不正です");
  });

  it("存在しない日時はエラー", () => {
    expect(() => parseDateLines("2026/02/29 00:00")).toThrow("1行目の日時が不正です");
    expect(() => parseDateLines("2026/13/01 00:00")).toThrow("日時が不正です");
    expect(() => parseDateLines("2026/10/25 24:00")).toThrow("日時が不正です");
    expect(() => parseDateLines("2026/10/25 23:60")).toThrow("日時が不正です");
    expect(parseDateLines("2028/02/29 23:59")).toHaveLength(1);
  });
});

describe("offset", () => {
  it("isValidOffset", () => {
    expect(isValidOffset("+09:00")).toBe(true);
    expect(isValidOffset("-05:30")).toBe(true);
    expect(isValidOffset("+14:00")).toBe(true);
    expect(isValidOffset("09:00")).toBe(false);
    expect(isValidOffset("+9:00")).toBe(false);
    expect(isValidOffset("+15:00")).toBe(false);
    expect(isValidOffset("+09:60")).toBe(false);
  });

  it("defaultOffset は端末のオフセットを ±HH:MM で返す", () => {
    const fake = (minutes: number) => ({ getTimezoneOffset: () => minutes }) as Date;
    expect(defaultOffset(fake(-540))).toBe("+09:00");
    expect(defaultOffset(fake(300))).toBe("-05:00");
    expect(defaultOffset(fake(-330))).toBe("+05:30");
    expect(defaultOffset(fake(0))).toBe("+00:00");
  });
});
