import type { ParsedLine } from "./datetime";

export interface Matched<T> {
  file: T;
  line: ParsedLine;
}

/**
 * 写真をファイル名の数値の昇順に並べ、テキストの n 行目と n 番目の写真を対応付ける。
 * ファイル名が数値でない・重複している・件数が一致しない場合はエラーを投げる。
 */
export function matchFiles<T extends { name: string }>(files: readonly T[], lines: readonly ParsedLine[]): Matched<T>[] {
  const keyed = files.map((file) => {
    const m = /^(\d+)\.jpe?g$/i.exec(file.name);
    if (!m) {
      throw new Error(`ファイル名が数値ではありません: ${file.name}`);
    }
    return { file, key: BigInt(m[1]) };
  });

  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  for (let i = 1; i < keyed.length; i++) {
    if (keyed[i].key === keyed[i - 1].key) {
      throw new Error(`ファイル名が重複しています: ${keyed[i - 1].file.name}, ${keyed[i].file.name}`);
    }
  }

  if (keyed.length !== lines.length) {
    throw new Error(`件数が一致しません（テキスト ${lines.length}行 / 写真 ${keyed.length}枚）`);
  }

  return keyed.map(({ file }, i) => ({ file, line: lines[i] }));
}
