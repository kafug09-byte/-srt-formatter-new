/**
 * SRT整形エンジン v2
 * お手本（カット_テロップ_final.txt）に基づく整形ルール:
 * - 1セグメント = 最大2行、1行あたり~13文字
 * - 長いセグメントは助詞の後ろで積極的に分割
 * - 短すぎるセグメント（5文字未満）は次のセグメントと結合
 * - 句読点・フィラー除去
 */

// ============================================================
// 定数
// ============================================================

// 接続詞リスト（この語の「前」で分割）
const CONJUNCTIONS = [
  'しかし', 'しかも',
  'でも', 'でもね', 'でもさ',
  'だから', 'だからこそ', 'だからね',
  'なので', 'なのでね',
  'ただ', 'ただね', 'ただし',
  'そして', 'そしたら', 'そこで', 'そこから',
  'それで', 'それでね', 'それから', 'それと', 'それに', 'それでも', 'それなのに',
  'あと', 'あとは', 'あとね',
  'つまり', 'つまりね',
  'ところが', 'ところで',
  'むしろ',
  'ちなみに', 'ちなみにね',
  '逆に', '逆にね',
  'じゃあ',
  'というか', 'っていうか',
  'そもそも',
  'もちろん',
  'だって',
  'なぜなら',
  '要は', '要するに',
  'とりあえず',
  'まず', 'まずね', 'まずは',
  '次に', '次はね',
  '最後に',
  'やっぱり', 'やっぱ', 'やはり',
  '結局', '結局ね',
  '実は', '実はね',
  '正直', '正直ね',
  '本当に', 'ほんとに',
  'さらに', 'さらには',
  'ですが',
];

// 助詞リスト（分割・改行の候補位置：助詞の後ろで切る）
const PARTICLES = [
  'からは', 'までは', 'っていう', 'という', 'ような', 'ように',
  'みたいな', 'みたいに', 'として', 'ので', 'のに', 'けど', 'けれど',
  'ては', 'では', 'には', 'とは', 'から', 'まで', 'より', 'って',
  'は', 'が', 'を', 'に', 'で', 'も', 'へ',
];

// フィラーパターン
const FILLER_PATTERNS = [
  /^えーっと\s*/, /^えーと\s*/, /^えー\s*/,
  /^あーっと\s*/, /^あーと\s*/, /^あー\s*/,
  /^うーんと\s*/, /^うーん\s*/, /^うー\s*/,
  /^まあ\s+/, /^まぁ\s+/,
  /^あのー\s*/, /^あの\s+/,
  /^そのー\s*/,
  /^えっと\s*/,
  /^なんか\s+/, /^ほら\s+/,
];

// ============================================================
// SRT パーサー
// ============================================================

function parseSRT(text) {
  const segments = [];
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const index = parseInt(lines[0], 10);
    if (isNaN(index)) continue;
    const tsMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    );
    if (!tsMatch) continue;
    segments.push({
      index,
      startTime: tsMatch[1],
      endTime: tsMatch[2],
      text: lines.slice(2).join('\n'),
    });
  }
  return segments;
}

// ============================================================
// タイムスタンプ変換
// ============================================================

function timeToMs(ts) {
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})/);
  if (!m) return 0;
  return parseInt(m[1]) * 3600000 + parseInt(m[2]) * 60000 + parseInt(m[3]) * 1000 + parseInt(m[4]);
}

function msToTime(ms) {
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000);
  const mil = ms % 1000;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' + String(mil).padStart(3, '0');
}

// ============================================================
// テキスト整形
// ============================================================

function removePunctuation(text) {
  return text.replace(/[。、，．,.？！?!]/g, '');
}

function removeFillers(text) {
  let result = text;
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

// ============================================================
// 助詞位置の検索（分割・改行両方で使用）
// ============================================================

/**
 * テキスト内の全助詞位置を列挙
 * 返り値: 助詞の「後ろ」の文字位置の配列（ソート済み）
 */
function findAllParticlePositions(text) {
  const positions = new Set();
  const sorted = [...PARTICLES].sort((a, b) => b.length - a.length);

  for (const p of sorted) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(p, from);
      if (idx === -1) break;
      positions.add(idx + p.length);
      from = idx + 1;
    }
  }

  return [...positions].sort((a, b) => a - b);
}

/**
 * target付近で最適な助詞位置を見つける
 */
function findBestParticleNear(text, target, margin = 6) {
  const positions = findAllParticlePositions(text);
  let bestPos = -1;
  let bestDist = Infinity;

  for (const pos of positions) {
    if (pos < 4 || pos > text.length - 3) continue;
    const dist = Math.abs(pos - target);
    if (dist <= margin && dist < bestDist) {
      bestDist = dist;
      bestPos = pos;
    }
  }
  return bestPos;
}

// ============================================================
// セグメント分割（メインロジック）
// ============================================================

/**
 * テキストをテロップ表示単位に分割する
 * 各単位: 最大 maxChars 文字（それ以下は1行、超えたら2行）
 */
function splitIntoTelopUnits(text, charsPerLine, maxLines) {
  const maxChars = charsPerLine * maxLines;
  const units = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 短いテキスト → そのまま（ただしまだ助詞で切れる余地があるなら続行）
    if (remaining.length < charsPerLine - 2) {
      units.push(remaining);
      break;
    }

    // charsPerLine付近で助詞による分割を試みる
    const target = Math.min(charsPerLine, Math.ceil(remaining.length / 2));
    let splitPos = findBestParticleNear(remaining, target, 6);

    // 接続詞もチェック
    const sortedConj = [...CONJUNCTIONS].sort((a, b) => b.length - a.length);
    for (const conj of sortedConj) {
      const idx = remaining.indexOf(conj);
      if (idx >= 5 && idx <= target + 7 && remaining.length - idx >= 5) {
        const dist = Math.abs(idx - target);
        const currentDist = splitPos === -1 ? Infinity : Math.abs(splitPos - target);
        if (dist < currentDist) {
          splitPos = idx;
        }
      }
    }

    if (splitPos > 3 && remaining.length - splitPos >= 1) {
      units.push(remaining.substring(0, splitPos).trim());
      remaining = remaining.substring(splitPos).trim();
    } else if (remaining.length <= maxChars) {
      // 助詞が見つからないが2行に収まる → そのままで終了
      units.push(remaining);
      break;
    } else {
      // 強制分割（助詞なし + 2行に収まらない）
      units.push(remaining.substring(0, target).trim());
      remaining = remaining.substring(target).trim();
    }
  }

  return units;
}

// ============================================================
// 改行挿入
// ============================================================

function addLineBreaks(text, charsPerLine, maxLines) {
  const flat = text.replace(/\n/g, '').trim();

  // 1行に収まる
  if (flat.length <= charsPerLine) {
    return flat;
  }

  if (maxLines < 2) return flat;

  // 半分付近の助詞位置で改行
  const target = Math.ceil(flat.length / 2);
  let breakPos = findBestParticleNear(flat, target, 7);

  if (breakPos === -1 || breakPos < 4 || breakPos > flat.length - 3) {
    breakPos = target;
  }

  const line1 = flat.substring(0, breakPos).trim();
  const line2 = flat.substring(breakPos).trim();

  if (line1.length < 3 || line2.length < 3) {
    return flat;
  }

  return line1 + '\n' + line2;
}

// ============================================================
// メインの整形関数
// ============================================================

function formatSegments(segments, options = {}) {
  const {
    charsPerLine = 13,
    maxLines = 2,
    shouldRemovePunctuation = true,
    shouldRemoveFillers = true,
    shouldSplitSegments = true,
  } = options;

  const MAX_SEG_CHARS = charsPerLine + 2; // これを超えたら分割検討
  const MIN_SEG_CHARS = 5; // これ未満は結合

  let result = [];

  for (const seg of segments) {
    let text = seg.text.replace(/\n/g, ' ').trim();

    if (shouldRemovePunctuation) text = removePunctuation(text);
    if (shouldRemoveFillers) text = removeFillers(text);
    text = text.replace(/[\s\u3000]+/g, ' ').trim();

    if (text.length === 0) continue;

    const startMs = timeToMs(seg.startTime);
    const endMs = timeToMs(seg.endTime);

    if (shouldSplitSegments && text.length > MAX_SEG_CHARS) {
      // テロップ単位に分割
      const units = splitIntoTelopUnits(text, charsPerLine, maxLines);
      const totalChars = text.replace(/\s/g, '').length;
      const totalDuration = endMs - startMs;
      let currentMs = startMs;

      for (const unit of units) {
        const unitChars = unit.replace(/\s/g, '').length;
        const unitDuration = Math.round((unitChars / totalChars) * totalDuration);
        const unitEnd = Math.min(currentMs + unitDuration, endMs);

        result.push({
          startTime: msToTime(currentMs),
          endTime: msToTime(unitEnd),
          text: addLineBreaks(unit, charsPerLine, maxLines),
        });
        currentMs = unitEnd;
      }
    } else {
      // 短いセグメント: 改行のみ
      result.push({
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: addLineBreaks(text, charsPerLine, maxLines),
      });
    }
  }

  // 短すぎるセグメントを次のセグメントに結合
  const merged = [];
  for (let i = 0; i < result.length; i++) {
    const seg = result[i];
    const textLen = seg.text.replace(/\n/g, '').length;

    if (textLen < MIN_SEG_CHARS && i + 1 < result.length) {
      // 次のセグメントの先頭に結合
      const next = result[i + 1];
      const combined = seg.text.replace(/\n/g, '') + next.text.replace(/\n/g, '');
      next.text = addLineBreaks(combined, charsPerLine, maxLines);
      next.startTime = seg.startTime;
    } else if (textLen < MIN_SEG_CHARS && merged.length > 0) {
      // 前のセグメントに結合
      const prev = merged[merged.length - 1];
      const combined = prev.text.replace(/\n/g, '') + seg.text.replace(/\n/g, '');
      prev.text = addLineBreaks(combined, charsPerLine, maxLines);
      prev.endTime = seg.endTime;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((seg, i) => ({ ...seg, index: i + 1 }));
}

// ============================================================
// SRT出力
// ============================================================

function segmentsToSRT(segments) {
  return segments
    .map(seg => `${seg.index}\n${seg.startTime} --> ${seg.endTime}\n${seg.text}`)
    .join('\n\n') + '\n';
}

// ============================================================
// エクスポート
// ============================================================

if (typeof window !== 'undefined') {
  window.SRTFormatter = {
    parseSRT,
    formatSegments,
    segmentsToSRT,
    timeToMs,
    msToTime,
  };
}
