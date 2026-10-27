# line-photo-redate

LINEアルバムからダウンロードした写真に、撮影日時をEXIFとして書き込むWebツールです。

LINEアルバムから一括ダウンロードした写真はEXIFの撮影日時などが削除されているため、写真アプリで撮影日順に並びません。このツールは、別途書き出した「作成日時」のテキストを写真のEXIFに書き込み、ZIPにまとめてダウンロードさせます。

処理はすべてブラウザ内で完結し、写真が外部に送信されることはありません。Android の Chrome での利用を主に想定しています。

## 使い方

1. 日時テキストを選ぶ
2. 写真（JPEG）をまとめて選ぶ
3. 必要ならタイムゾーンを変える（初期値は端末のタイムゾーン）
4. 「実行」を押すと、書き込み済みの写真が入った ZIP がダウンロードされる

### 日時テキストの形式

UTF-8、1行に1件、`YYYY/MM/DD HH:mm` の形式で書きます。空行は無視されます。

```
2026/10/25 15:48
2026/10/25 15:42
```

### 写真との対応付け

- 写真はファイル名の数値（例: `1792936238121.jpg`）の昇順に並べ、テキストの n 行目を n 番目の写真に書き込みます。
- 行数と写真の枚数が一致しない場合や、ファイル名が数値でない場合は、エラーを表示して処理しません。
- Android では、写真を「ファイル」アプリから選んでください。フォト選択ツール（ギャラリー）から選ぶと、ファイル名が別の名前に置き換わり、正しい順番で対応付けられません。

### 書き込む内容

| タグ | 値の例 |
| --- | --- |
| DateTime / DateTimeOriginal / DateTimeDigitized | `2026:10:25 15:48:00`（秒は 00） |
| OffsetTime / OffsetTimeOriginal / OffsetTimeDigitized | `+09:00` |

- 元の写真にEXIFがあれば、ほかのタグ（向き、GPSなど）は残します。サムネイルと MakerNote は削除します。
- 画像データは再圧縮せず、そのままコピーします。
- ZIP は無圧縮で、ファイル名は元のままです。

## 開発

Node.js のバージョンは `.node-version` で指定しています（CI も同じファイルを参照）。

```sh
npm ci
npm run dev      # 開発サーバー（http://localhost:5173/line-photo-redate/）
npm test         # テスト（Vitest）
npm run build    # dist/ にビルド
```

### 構成

| パス | 内容 |
| --- | --- |
| `src/datetime.ts` | 日時テキストの解析と EXIF 形式への変換 |
| `src/matching.ts` | ファイル名の並べ替えと日時との対応付け |
| `src/exif/` | EXIF の読み書き（自前実装） |
| `src/process.ts` | 1枚ずつ処理して ZIP を作る |
| `src/main.ts`, `index.html`, `src/style.css` | UI（デジタル庁デザインシステムのトークンを使用） |

## CI / デプロイ

プルリクエストと `main` への push では、`.github/workflows/ci.yml` がユニットテストを実行します。

`main` に push すると、GitHub Actions（`.github/workflows/deploy.yml`）がビルドを実行し、GitHub Pages にデプロイします。

初回のみ、リポジトリの Settings → Pages で Source を「GitHub Actions」にしてください。

## 制限

- 対応しているのは JPEG だけです。
- ZIP は 4GB を超えると作れません。
