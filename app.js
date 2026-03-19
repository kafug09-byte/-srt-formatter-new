/**
 * SRT整形ツール - UIコントローラー
 * 編集可能な整形結果 + 差分出力機能
 */

function getParseSRT() { return window.SRTFormatter.parseSRT; }
function getFormatSegments() { return window.SRTFormatter.formatSegments; }
function getSegmentsToSRT() { return window.SRTFormatter.segmentsToSRT; }

// ============================================================
// DOM要素
// ============================================================
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const clearFile = document.getElementById('clearFile');
const formatBtn = document.getElementById('formatBtn');
const previewSection = document.getElementById('previewSection');
const previewContent = document.getElementById('previewContent');
const statsEl = document.getElementById('stats');
const downloadBtn = document.getElementById('downloadBtn');
const diffBtn = document.getElementById('diffBtn');
const diffModal = document.getElementById('diffModal');
const diffOutput = document.getElementById('diffOutput');
const closeDiffModal = document.getElementById('closeDiffModal');
const copyDiffBtn = document.getElementById('copyDiffBtn');

// 設定
const charsPerLineInput = document.getElementById('charsPerLine');
const maxLinesSelect = document.getElementById('maxLines');
const removePunctuationCb = document.getElementById('removePunctuation');
const removeFillersCb = document.getElementById('removeFillers');
const splitSegmentsCb = document.getElementById('splitSegments');

// ============================================================
// ブラウザのデフォルトドラッグ動作を無効化
// ============================================================
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// ============================================================
// 状態
// ============================================================
let originalSegments = null;
let formattedSegments = null;    // 自動整形の結果（変更しない）
let originalSRT = '';
let formattedSRT = '';
let currentFileName = '';

// ============================================================
// ファイル読み込み
// ============================================================

uploadArea.addEventListener('click', (e) => {
  if (e.target.tagName === 'INPUT') return;
  fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.srt') || file.type === 'text/plain' || file.type === '') {
      loadFile(file);
    } else {
      alert('SRTファイルを選択してください');
    }
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) {
    loadFile(fileInput.files[0]);
  }
});

clearFile.addEventListener('click', () => {
  resetState();
});

function loadFile(file) {
  currentFileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    originalSRT = e.target.result;
    originalSegments = getParseSRT()(originalSRT);
    uploadArea.style.display = 'none';
    fileInfo.style.display = 'flex';
    fileName.textContent = `${file.name}（${originalSegments.length}セグメント）`;
    formatBtn.disabled = false;
    previewSection.style.display = 'none';
  };
  reader.readAsText(file, 'UTF-8');
}

function resetState() {
  originalSegments = null;
  formattedSegments = null;
  originalSRT = '';
  formattedSRT = '';
  currentFileName = '';
  fileInput.value = '';
  uploadArea.style.display = '';
  fileInfo.style.display = 'none';
  formatBtn.disabled = true;
  previewSection.style.display = 'none';
}

// ============================================================
// 整形実行
// ============================================================

formatBtn.addEventListener('click', () => {
  if (!originalSegments) return;

  const options = {
    shouldRemovePunctuation: removePunctuationCb.checked,
    shouldRemoveFillers: removeFillersCb.checked,
  };

  formattedSegments = getFormatSegments()(originalSegments, options);
  formattedSRT = getSegmentsToSRT()(formattedSegments);

  // 統計
  statsEl.innerHTML = `
    <div class="stat-item">元: <span class="stat-value">${originalSegments.length}</span>セグメント</div>
    <div class="stat-item">整形後: <span class="stat-value">${formattedSegments.length}</span>セグメント</div>
  `;

  previewSection.style.display = '';
  renderEditableSegments();
});

// ============================================================
// 編集可能なセグメント表示
// ============================================================

function renderEditableSegments() {
  previewContent.innerHTML = formattedSegments.map((seg, i) =>
    `<div class="segment editable-segment" data-index="${i}">` +
    `<span class="index">${seg.index}</span>` +
    `<span class="timestamp">${seg.startTime} --> ${seg.endTime}</span>` +
    `<div class="text editable-text" contenteditable="true" data-index="${i}">${escapeHtml(seg.text)}</div>` +
    `</div>`
  ).join('');
}

// ============================================================
// 差分出力
// ============================================================

diffBtn.addEventListener('click', () => {
  const editedSegments = getEditedSegments();
  const diffText = generateDiff(formattedSegments, editedSegments);
  diffOutput.value = diffText;
  diffModal.style.display = 'flex';
});

closeDiffModal.addEventListener('click', () => {
  diffModal.style.display = 'none';
});

copyDiffBtn.addEventListener('click', () => {
  diffOutput.select();
  document.execCommand('copy');
  copyDiffBtn.textContent = 'コピーしました!';
  setTimeout(() => { copyDiffBtn.textContent = '差分をコピー'; }, 2000);
});

/**
 * 画面上の編集済みテキストを取得
 */
function getEditedSegments() {
  const editables = previewContent.querySelectorAll('.editable-text');
  const edited = [];
  editables.forEach((el, i) => {
    if (i < formattedSegments.length) {
      edited.push({
        index: formattedSegments[i].index,
        startTime: formattedSegments[i].startTime,
        endTime: formattedSegments[i].endTime,
        text: el.innerText.trim(),
      });
    }
  });
  return edited;
}

/**
 * 自動整形と手動修正の差分テキストを生成
 */
function generateDiff(autoSegments, editedSegments) {
  const lines = [];
  lines.push('=== SRT整形 差分レポート ===');
  lines.push(`ファイル: ${currentFileName}`);
  lines.push(`日時: ${new Date().toLocaleString('ja-JP')}`);
  lines.push(`自動整形セグメント数: ${autoSegments.length}`);
  lines.push('');

  let changeCount = 0;

  for (let i = 0; i < autoSegments.length; i++) {
    const auto = autoSegments[i];
    const edited = editedSegments[i];
    if (!edited) continue;

    const autoText = auto.text.trim();
    const editedText = edited.text.trim();

    if (autoText !== editedText) {
      changeCount++;
      lines.push(`--- セグメント ${auto.index} [${auto.startTime} --> ${auto.endTime}] ---`);
      lines.push(`自動: ${autoText}`);
      lines.push(`修正: ${editedText}`);
      lines.push('');
    }
  }

  if (changeCount === 0) {
    lines.push('変更なし');
  } else {
    lines.push(`合計 ${changeCount} 箇所の修正`);
  }

  return lines.join('\n');
}

// ============================================================
// ダウンロード（編集後の内容を反映）
// ============================================================

downloadBtn.addEventListener('click', () => {
  const editedSegments = getEditedSegments();
  const srt = getSegmentsToSRT()(editedSegments);
  const outputName = currentFileName.replace(/\.srt$/i, '_formatted.srt');
  const blob = new Blob([srt], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ============================================================
// ユーティリティ
// ============================================================

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
