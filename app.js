/**
 * SRT整形ツール - UIコントローラー
 */

const { parseSRT, formatSegments, segmentsToSRT } = window.SRTFormatter;

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
const tabs = document.querySelectorAll('.tab');

// 設定
const charsPerLineInput = document.getElementById('charsPerLine');
const maxLinesSelect = document.getElementById('maxLines');
const removePunctuationCb = document.getElementById('removePunctuation');
const removeFillersCb = document.getElementById('removeFillers');
const splitSegmentsCb = document.getElementById('splitSegments');

// ============================================================
// 状態
// ============================================================
let originalSegments = null;
let formattedSegments = null;
let originalSRT = '';
let formattedSRT = '';
let currentFileName = '';

// ============================================================
// ファイル読み込み
// ============================================================

uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.srt')) {
    loadFile(file);
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
    originalSegments = parseSRT(originalSRT);

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
    charsPerLine: parseInt(charsPerLineInput.value, 10) || 18,
    maxLines: parseInt(maxLinesSelect.value, 10) || 2,
    shouldRemovePunctuation: removePunctuationCb.checked,
    shouldRemoveFillers: removeFillersCb.checked,
    shouldSplitSegments: splitSegmentsCb.checked,
  };

  formattedSegments = formatSegments(originalSegments, options);
  formattedSRT = segmentsToSRT(formattedSegments);

  // 統計
  const splitCount = formattedSegments.length - originalSegments.length;
  statsEl.innerHTML = `
    <div class="stat-item">元セグメント数: <span class="stat-value">${originalSegments.length}</span></div>
    <div class="stat-item">整形後セグメント数: <span class="stat-value">${formattedSegments.length}</span></div>
    ${splitCount > 0 ? `<div class="stat-item">分割されたセグメント: <span class="stat-value">+${splitCount}</span></div>` : ''}
  `;

  // プレビュー表示
  previewSection.style.display = '';
  showTab('after');
});

// ============================================================
// タブ切り替え
// ============================================================

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    showTab(tab.dataset.tab);
  });
});

function showTab(tabName) {
  if (tabName === 'after') {
    renderSegments(formattedSegments, previewContent);
  } else if (tabName === 'before') {
    renderSegments(originalSegments, previewContent);
  } else if (tabName === 'diff') {
    renderDiff(originalSegments, formattedSegments, previewContent);
  }
}

function renderSegments(segments, container) {
  container.innerHTML = segments.map(seg =>
    `<div class="segment">` +
    `<span class="index">${seg.index}</span>\n` +
    `<span class="timestamp">${seg.startTime} --> ${seg.endTime}</span>\n` +
    `<span class="text">${escapeHtml(seg.text)}</span>` +
    `</div>`
  ).join('');
}

function renderDiff(before, after, container) {
  let html = '';

  // 元セグメントと整形後を並べて表示
  let afterIdx = 0;

  for (let i = 0; i < before.length; i++) {
    const orig = before[i];
    const origText = orig.text.replace(/\n/g, ' ').trim();

    html += `<div class="segment">`;
    html += `<div class="removed"><span class="index">${orig.index}</span> ${escapeHtml(orig.text)}</div>`;

    // 対応する整形後セグメントを探す
    while (afterIdx < after.length) {
      const fmt = after[afterIdx];
      const fmtStartMs = window.SRTFormatter.timeToMs(fmt.startTime);
      const origEndMs = window.SRTFormatter.timeToMs(orig.endTime);

      if (fmtStartMs >= origEndMs && afterIdx > 0) break;

      html += `<div class="added"><span class="index">${fmt.index}</span> <span class="timestamp">${fmt.startTime} --> ${fmt.endTime}</span>\n${escapeHtml(fmt.text)}</div>`;
      afterIdx++;

      const nextOrigStartMs = (i + 1 < before.length) ? window.SRTFormatter.timeToMs(before[i + 1].startTime) : Infinity;
      if (afterIdx < after.length) {
        const nextFmtStartMs = window.SRTFormatter.timeToMs(after[afterIdx].startTime);
        if (nextFmtStartMs >= nextOrigStartMs) break;
      }
    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// ダウンロード
// ============================================================

downloadBtn.addEventListener('click', () => {
  if (!formattedSRT) return;

  const outputName = currentFileName.replace(/\.srt$/i, '_formatted.srt');
  const blob = new Blob([formattedSRT], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
