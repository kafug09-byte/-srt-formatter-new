/**
 * SRT整形ツール - UIコントローラー
 * 編集可能な整形結果 + セグメント分割/結合 + 差分出力
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
let autoFormattedSegments = null;  // 自動整形の結果（差分比較用、変更しない）
let editSegments = [];             // 編集中のセグメント（ユーザーが操作する）
let originalSRT = '';
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
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

clearFile.addEventListener('click', () => resetState());

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
  autoFormattedSegments = null;
  editSegments = [];
  originalSRT = '';
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

  autoFormattedSegments = getFormatSegments()(originalSegments, options);
  // 編集用にディープコピー
  editSegments = JSON.parse(JSON.stringify(autoFormattedSegments));

  statsEl.innerHTML = `
    <div class="stat-item">元: <span class="stat-value">${originalSegments.length}</span>セグメント</div>
    <div class="stat-item">整形後: <span class="stat-value">${autoFormattedSegments.length}</span>セグメント</div>
  `;

  previewSection.style.display = '';
  renderEditor();
});

// ============================================================
// エディタ表示
// ============================================================

function renderEditor() {
  let html = '';

  for (let i = 0; i < editSegments.length; i++) {
    const seg = editSegments[i];

    html += `<div class="segment editable-segment" data-index="${i}">`;
    html += `<div class="segment-header">`;
    html += `<span class="index">${i + 1}</span>`;
    html += `<span class="timestamp">${seg.startTime} --> ${seg.endTime}</span>`;
    html += `</div>`;
    html += `<div class="text editable-text" contenteditable="true" data-index="${i}">${escapeHtml(seg.text)}</div>`;

    // 結合ボタン（最後のセグメント以外）
    if (i < editSegments.length - 1) {
      html += `<div class="segment-actions">`;
      html += `<button class="merge-btn" data-index="${i}" title="下のセグメントと結合">↕ 結合</button>`;
      html += `<button class="split-btn" data-index="${i}" title="このセグメントをカーソル位置で分割">✂ 分割</button>`;
      html += `</div>`;
    } else {
      html += `<div class="segment-actions">`;
      html += `<button class="split-btn" data-index="${i}" title="このセグメントをカーソル位置で分割">✂ 分割</button>`;
      html += `</div>`;
    }

    html += `</div>`;
  }

  previewContent.innerHTML = html;

  // イベント登録
  previewContent.querySelectorAll('.editable-text').forEach(el => {
    el.addEventListener('input', onTextEdit);
  });
  previewContent.querySelectorAll('.merge-btn').forEach(el => {
    el.addEventListener('click', onMerge);
  });
  previewContent.querySelectorAll('.split-btn').forEach(el => {
    el.addEventListener('click', onSplit);
  });

  updateStats();
}

function updateStats() {
  statsEl.innerHTML = `
    <div class="stat-item">元: <span class="stat-value">${originalSegments.length}</span>セグメント</div>
    <div class="stat-item">自動整形: <span class="stat-value">${autoFormattedSegments.length}</span></div>
    <div class="stat-item">現在: <span class="stat-value">${editSegments.length}</span></div>
  `;
}

// ============================================================
// テキスト編集
// ============================================================

function onTextEdit(e) {
  const idx = parseInt(e.target.dataset.index);
  if (idx >= 0 && idx < editSegments.length) {
    editSegments[idx].text = e.target.innerText;
  }
}

// ============================================================
// セグメント結合
// ============================================================

function onMerge(e) {
  const idx = parseInt(e.target.dataset.index);
  if (idx < 0 || idx >= editSegments.length - 1) return;

  // 現在の編集内容を保存
  syncEditsFromDOM();

  // 結合
  editSegments[idx].text = editSegments[idx].text + '\n' + editSegments[idx + 1].text;
  editSegments[idx].endTime = editSegments[idx + 1].endTime;
  editSegments.splice(idx + 1, 1);

  renderEditor();
}

// ============================================================
// セグメント分割
// ============================================================

function onSplit(e) {
  const idx = parseInt(e.target.dataset.index);
  if (idx < 0 || idx >= editSegments.length) return;

  // 現在の編集内容を保存
  syncEditsFromDOM();

  const seg = editSegments[idx];
  const fullText = seg.text;

  // テキストエリア内のカーソル位置を取得
  const textEl = previewContent.querySelector(`.editable-text[data-index="${idx}"]`);
  const sel = window.getSelection();
  let offset = -1;

  if (sel && sel.rangeCount > 0 && textEl.contains(sel.anchorNode)) {
    // カーソル位置を計算
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(textEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    offset = preRange.toString().length;
  }

  if (offset <= 0 || offset >= fullText.length) {
    // カーソルがない場合は中間で分割
    offset = Math.floor(fullText.length / 2);
  }

  const textBefore = fullText.substring(0, offset);
  const textAfter = fullText.substring(offset);

  // 時間を文字数比率で按分
  const startMs = window.SRTFormatter.timeToMs(seg.startTime);
  const endMs = window.SRTFormatter.timeToMs(seg.endTime);
  const ratio = offset / fullText.length;
  const splitMs = startMs + Math.round((endMs - startMs) * ratio);
  const splitTime = window.SRTFormatter.msToTime(splitMs);

  // 分割実行
  editSegments[idx].text = textBefore;
  editSegments[idx].endTime = splitTime;

  editSegments.splice(idx + 1, 0, {
    index: idx + 2,
    startTime: splitTime,
    endTime: seg.endTime,
    text: textAfter,
  });

  renderEditor();
}

// ============================================================
// DOM → editSegments 同期
// ============================================================

function syncEditsFromDOM() {
  previewContent.querySelectorAll('.editable-text').forEach(el => {
    const idx = parseInt(el.dataset.index);
    if (idx >= 0 && idx < editSegments.length) {
      editSegments[idx].text = el.innerText;
    }
  });
}

// ============================================================
// 差分出力
// ============================================================

diffBtn.addEventListener('click', () => {
  syncEditsFromDOM();
  const diffText = generateDiff(autoFormattedSegments, editSegments);
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
 * 自動整形と手動修正の差分テキストを生成
 * セグメント分割・結合・テキスト変更を全て検出
 */
function generateDiff(autoSegs, editedSegs) {
  const lines = [];
  lines.push('=== SRT整形 差分レポート ===');
  lines.push(`ファイル: ${currentFileName}`);
  lines.push(`日時: ${new Date().toLocaleString('ja-JP')}`);
  lines.push(`自動整形: ${autoSegs.length} セグメント`);
  lines.push(`手動修正後: ${editedSegs.length} セグメント`);
  lines.push('');

  // 自動整形のテキストを時間順に並べる
  lines.push('--- 自動整形 ---');
  autoSegs.forEach((seg, i) => {
    lines.push(`[${i + 1}] ${seg.startTime} --> ${seg.endTime}`);
    lines.push(seg.text);
    lines.push('');
  });

  lines.push('--- 手動修正 ---');
  editedSegs.forEach((seg, i) => {
    lines.push(`[${i + 1}] ${seg.startTime} --> ${seg.endTime}`);
    lines.push(seg.text);
    lines.push('');
  });

  // 変更サマリー
  lines.push('--- 変更サマリー ---');
  lines.push(`セグメント数: ${autoSegs.length} → ${editedSegs.length} (${editedSegs.length - autoSegs.length >= 0 ? '+' : ''}${editedSegs.length - autoSegs.length})`);

  // テキスト差分を検出（時間ベースで対応付け）
  let changeCount = 0;
  const autoTexts = autoSegs.map(s => ({ time: s.startTime, text: s.text.trim() }));
  const editTexts = editedSegs.map(s => ({ time: s.startTime, text: s.text.trim() }));

  // 単純比較: 同じインデックスで違うテキストがあれば差分
  const maxLen = Math.max(autoTexts.length, editTexts.length);
  for (let i = 0; i < maxLen; i++) {
    const a = autoTexts[i];
    const e = editTexts[i];
    if (!a && e) {
      changeCount++;
      lines.push(`[+${i + 1}] 追加: ${e.text}`);
    } else if (a && !e) {
      changeCount++;
      lines.push(`[-${i + 1}] 削除: ${a.text}`);
    } else if (a.text !== e.text) {
      changeCount++;
      lines.push(`[${i + 1}] 変更:`);
      lines.push(`  自動: ${a.text}`);
      lines.push(`  修正: ${e.text}`);
    }
  }

  lines.push(`\n合計 ${changeCount} 箇所の変更`);

  return lines.join('\n');
}

// ============================================================
// ダウンロード（編集後の内容を反映）
// ============================================================

downloadBtn.addEventListener('click', () => {
  syncEditsFromDOM();
  // インデックスを振り直し
  editSegments.forEach((seg, i) => { seg.index = i + 1; });
  const srt = getSegmentsToSRT()(editSegments);
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
