export interface ParsedLine {
  /** 元テキストでの行番号（1始まり） */
  lineNumber: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LINE_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/;

/** 日時テキストを解析する。空行は無視し、不正な行があればエラーを投げる */
export function parseDateLines(text: string): ParsedLine[] {
  const result: ParsedLine[] = [];
  const lines = text.replace(/^﻿/, "").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    const lineNumber = i + 1;
    const m = LINE_PATTERN.exec(line);
    if (!m) {
      throw new Error(`${lineNumber}行目の形式が不正です: ${line}`);
    }
    const [year, month, day, hour, minute] = m.slice(1).map(Number);
    if (!isValidDate(year, month, day) || hour > 23 || minute > 59) {
      throw new Error(`${lineNumber}行目の日時が不正です: ${line}`);
    }
    result.push({ lineNumber, year, month, day, hour, minute });
  });
  return result;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** EXIF の日時形式 `YYYY:MM:DD HH:mm:00` に変換する */
export function toExifDateTime(p: ParsedLine): string {
  return `${p.year}:${pad2(p.month)}:${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:00`;
}

/** 端末の現在のUTCオフセットを `+09:00` 形式で返す */
export function defaultOffset(date: Date = new Date()): string {
  const total = -date.getTimezoneOffset();
  const sign = total < 0 ? "-" : "+";
  const abs = Math.abs(total);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** `+09:00` 形式のオフセットとして妥当か（-12:00〜+14:00 を想定した緩めのチェック） */
export function isValidOffset(s: string): boolean {
  return /^[+-](0\d|1[0-4]):[0-5]\d$/.test(s);
}
