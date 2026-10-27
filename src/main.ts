import "@digital-go-jp/design-tokens/dist/tokens.css";
import "./style.css";
import { defaultOffset, isValidOffset, parseDateLines } from "./datetime";
import { matchFiles } from "./matching";
import { buildZip, zipFileName } from "./process";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("form");
const datesInput = $<HTMLInputElement>("dates");
const photosInput = $<HTMLInputElement>("photos");
const offsetInput = $<HTMLInputElement>("offset");
const runButton = $<HTMLButtonElement>("run");
const datesInfo = $<HTMLParagraphElement>("dates-info");
const photosInfo = $<HTMLParagraphElement>("photos-info");
const statusBox = $<HTMLDivElement>("status");
const errorBox = $<HTMLDivElement>("error");

offsetInput.value = defaultOffset();

let busy = false;

function showStatus(message: string) {
  statusBox.textContent = message;
  statusBox.hidden = false;
}

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearMessages() {
  statusBox.hidden = true;
  errorBox.hidden = true;
}

function updateState() {
  const datesFile = datesInput.files?.[0];
  const photoCount = photosInput.files?.length ?? 0;
  datesInfo.textContent = datesFile ? datesFile.name : "";
  photosInfo.textContent = photoCount > 0 ? `${photoCount}枚` : "";
  runButton.disabled = busy || !datesFile || photoCount === 0;
}

for (const input of [datesInput, photosInput]) {
  input.addEventListener("change", () => {
    clearMessages();
    updateState();
  });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // ダウンロード開始前に解放されないよう少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const datesFile = datesInput.files?.[0];
  const photos = [...(photosInput.files ?? [])];
  if (busy || !datesFile || photos.length === 0) return;

  clearMessages();
  const offset = offsetInput.value.trim();
  if (!isValidOffset(offset)) {
    showError("タイムゾーンは +09:00 の形式で入力してください");
    return;
  }

  busy = true;
  updateState();
  try {
    const lines = parseDateLines(await datesFile.text());
    const items = matchFiles(photos, lines);
    showStatus(`処理中 0 / ${items.length}`);
    const zip = await buildZip(items, offset, {
      onProgress: (done, total) => showStatus(`処理中 ${done} / ${total}`),
    });
    download(zip, zipFileName());
    showStatus(`${items.length}枚を処理しました`);
  } catch (e) {
    statusBox.hidden = true;
    showError(e instanceof Error ? e.message : String(e));
  } finally {
    busy = false;
    updateState();
  }
});

updateState();
