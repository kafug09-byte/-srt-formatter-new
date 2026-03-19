/**
 * SRT整形エンジン
 * - 句読点除去（。、）
 * - フィラー除去（えー、あのー等）
 * - 言い切り+接続詞パターンでセグメント分割（時間は文字数按分）
 * - 自然な位置で改行（目安N文字、最大M行）
 */

// ============================================================
// 定数
// ============================================================

// 節末接続詞リスト（この語の「後ろ」で分割 — "〜けどXXX" → "〜けど" | "XXX"）
// 十分な前後テキストがある場合のみ適用
const TRAILING_CONJUNCTIONS = [
  'けど', 'けれど', 'けども',
  'ので', 'のに',
  'から',
];

// 接続詞リスト（この語の「前」で分割 — "XXXそしてYYY" → "XXX" | "そしてYYY"）
const CONJUNCTIONS = [
  'しかし', 'しかも',
  'でも', 'でもね', 'でもさ',
  'だから', 'だからこそ', 'だからね',
  'なので', 'なのでね',
  'ただ', 'ただね', 'ただし',
  'そして', 'そしたら', 'そこで', 'そこから',
  'それで', 'それでね', 'それから', 'それと', 'それに', 'それでも', 'それなのに',
  'あと', 'あとは', 'あとね',
  'で、', 'で ',
  'つまり', 'つまりね',
  'ところが', 'ところで',
  'むしろ',
  'ちなみに', 'ちなみにね',
  '逆に', '逆にね',
  'じゃあ', 'じゃあね',
  'まあ', 'まぁ',
  'あとね',
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
];

// 言い切りパターン（文末表現）
const SENTENCE_END_PATTERNS = [
  // です・ます系
  /ます/, /ました/, /ません/, /ましょう/,
  /です/, /でした/, /でしょう/,
  // だ・である系
  /だ$/, /だよ/, /だね/, /だよね/, /だけど/, /だった/, /だから/,
  /である/,
  // る・た系（動詞終止形）
  /した/, /った/, /んだ/, /なんだ/,
  /する/, /してる/, /してた/,
  /いる/, /いた/,
  /ある/, /あった/,
  /なる/, /なった/,
  /思う/, /思った/, /思います/,
  /ない/, /なかった/, /ないんだ/,
  // カジュアル
  /よね/, /よな/, /かな/, /のね/, /わけ/,
  /じゃん/, /でしょ/, /っしょ/,
  /んですよ/, /んですね/, /んだよね/, /んだよ/,
  /んですけど/, /けどね/, /けども/, /けど$/,
  /ですね/, /ますね/, /ますよ/, /ますよね/,
  /てね/, /てさ/,
  /わけで/, /わけだ/,
  /ってこと/, /ということ/,
];

// フィラーパターン（セグメント先頭のフィラーを除去）
const FILLER_PATTERNS = [
  /^えーっと\s*/,
  /^えーと\s*/,
  /^えー\s*/,
  /^あーっと\s*/,
  /^あーと\s*/,
  /^あー\s*/,
  /^うーんと\s*/,
  /^うーん\s*/,
  /^うー\s*/,
  /^まあ\s+/,
  /^まぁ\s+/,
  /^あのー\s*/,
  /^あの\s+/,
  /^そのー\s*/,
  /^えっと\s*/,
  /^なんか\s+/,
  /^ほら\s+/,
];

// 助詞リスト（改行の候補位置：助詞の後ろ）
// 単体の1文字助詞は単語内に出やすいので長い助詞を優先
const PARTICLES = [
  'からは', 'までは', 'っていう', 'という', 'ような', 'ように',
  'みたいな', 'みたいに', 'として', 'ので', 'のに', 'けど', 'けれど',
  'ては', 'では', 'には', 'とは', 'から', 'まで', 'より', 'って',
  'は', 'が', 'を', 'に', 'で', 'も', 'へ',
  // 'と' と 'の' は単語内に出やすいので除外
];

// ============================================================
// SRT パーサー
// ============================================================

function parseSRT(text) {
  const segments = [];
  // BOM除去 & 正規化
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

    const startTime = tsMatch[1];
    const endTime = tsMatch[2];
    const text_content = lines.slice(2).join('\n');

    segments.push({
      index,
      startTime,
      endTime,
      text: text_content,
    });
  }

  return segments;
}

// ============================================================
// タイムスタンプ変換ユーティリティ
// ============================================================

function timeToMs(ts) {
  // 00:01:23,456 or 00:01:23.456
  const m = ts.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})/);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600000 +
    parseInt(m[2]) * 60000 +
    parseInt(m[3]) * 1000 +
    parseInt(m[4])
  );
}

function msToTime(ms) {
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  const mil = ms % 1000;
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + ',' +
    String(mil).padStart(3, '0')
  );
}

// ============================================================
// テキスト整形処理
// ============================================================

/**
 * 句読点を除去
 */
function removePunctuation(text) {
  return text.replace(/[。、，．,.]/g, '');
}

/**
 * フィラーを除去
 */
function removeFillers(text) {
  let result = text;
  for (const pattern of FILLER_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.trim();
}

/**
 * セグメントを分割する位置を見つける
 * 3段階で分割を試みる:
 *   1. 言い切り+接続詞パターン（最優先）
 *   2. 言い切りパターン単体（スペースの後ろ等）
 *   3. 長すぎるセグメントの強制分割（助詞の後ろで切る）
 * 返り値: 分割位置の配列（文字インデックス）
 */
function findSplitPoints(text, charsPerLine = 18, maxLines = 2) {
  const maxCharsPerSegment = charsPerLine * maxLines;
  const splitPoints = [];

  function addSplitPoint(idx) {
    if (idx <= 0 || idx >= text.length) return;
    const alreadySplit = splitPoints.some(p => Math.abs(p - idx) < 3);
    if (!alreadySplit) {
      splitPoints.push(idx);
    }
  }

  const MIN_BEFORE_CONJ = 8;
  const MIN_AFTER_CONJ = 6;

  // --- 0. 節末接続詞パターン（"〜けどXXX" → "〜けど" | "XXX"）---
  const sortedTrailing = [...TRAILING_CONJUNCTIONS].sort((a, b) => b.length - a.length);
  for (const conj of sortedTrailing) {
    let searchFrom = MIN_BEFORE_CONJ;
    while (true) {
      const idx = text.indexOf(conj, searchFrom);
      if (idx === -1) break;
      const splitAfter = idx + conj.length;
      // スペースをスキップ
      let actualSplit = splitAfter;
      while (actualSplit < text.length && /[\s\u3000]/.test(text[actualSplit])) actualSplit++;

      const before = text.substring(0, splitAfter).trim();
      const after = text.substring(actualSplit).trim();
      if (before.length >= MIN_BEFORE_CONJ && after.length >= MIN_AFTER_CONJ) {
        addSplitPoint(actualSplit);
      }
      searchFrom = splitAfter;
    }
  }

  // --- 1. 接続詞パターン（"XXXそしてYYY" → "XXX" | "そしてYYY"）---
  const sortedConj = [...CONJUNCTIONS].sort((a, b) => b.length - a.length);
  for (const conj of sortedConj) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(conj, searchFrom);
      if (idx === -1) break;
      if (idx < MIN_BEFORE_CONJ) {
        searchFrom = idx + conj.length;
        continue;
      }
      const before = text.substring(0, idx).trim();
      const after = text.substring(idx).trim();
      if (before.length >= MIN_BEFORE_CONJ && after.length >= MIN_AFTER_CONJ) {
        addSplitPoint(idx);
      }
      searchFrom = idx + conj.length;
    }
  }

  // --- 2. 言い切り+スペースパターン ---
  // スペースの前が明確な言い切りの場合のみ分割（テ形・連用形は除外）
  const spaceRegex = /[\s\u3000]+/g;
  let spMatch;
  while ((spMatch = spaceRegex.exec(text)) !== null) {
    const idx = spMatch.index;
    if (idx === 0) continue;
    const before = text.substring(0, idx).trim();
    const afterIdx = idx + spMatch[0].length;
    const after = text.substring(afterIdx).trim();

    // テ形・連用形など接続的な語尾は分割しない
    const continuativeEndings = /[てでもがをにはから]$|ていても$|ながら$|として$|として$/;
    if (continuativeEndings.test(before)) continue;

    if (before.length >= 8 && after.length >= 6 && isEndOfSentence(before)) {
      addSplitPoint(afterIdx);
    }
  }

  return splitPoints.sort((a, b) => a - b);
}


/**
 * テキストが言い切りで終わっているかチェック
 */
function isEndOfSentence(text) {
  const trimmed = text.trim();
  for (const pattern of SENTENCE_END_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * テキストに自然な位置で改行を入れる
 * @param {string} text - 改行なしのテキスト
 * @param {number} charsPerLine - 1行あたりの目安文字数
 * @param {number} maxLines - 最大行数
 * @returns {string} 改行入りテキスト
 */
function addLineBreaks(text, charsPerLine = 15, maxLines = 2) {
  const flat = text.replace(/\n/g, '').trim();

  // 1行に収まるならそのまま
  if (flat.length <= charsPerLine) {
    return flat;
  }

  // 均等に2分割する目標位置：文字数の半分を基準に
  // 「charsPerLine」は参考にしない（均等優先）
  const target = Math.ceil(flat.length / 2);
  const breakPoint = findNaturalBreak(flat, target);

  const line1 = flat.substring(0, breakPoint).trim();
  const line2 = flat.substring(breakPoint).trim();

  // 短すぎる行・バランスが悪い行は作らない（1行目が全体の30%未満ならNG）
  const minLen = Math.max(4, Math.floor(flat.length * 0.3));
  if (line1.length < minLen || line2.length < minLen) {
    return flat;
  }

  // 2行以内なら改行して返す
  if (maxLines >= 2) {
    return line1 + '\n' + line2;
  }

  return flat;
}

/**
 * 自然な改行位置を見つける
 */
function findNaturalBreak(text, target) {
  // target付近（前後5文字）で助詞の後ろを探す
  const searchStart = Math.max(0, target - 7);
  const searchEnd = Math.min(text.length, target + 5);

  let bestPos = -1;
  let bestDist = Infinity;

  // 助詞を長い順にチェック
  const sortedParticles = [...PARTICLES].sort((a, b) => b.length - a.length);

  for (let i = searchStart; i < searchEnd; i++) {
    for (const p of sortedParticles) {
      if (text.substring(i).startsWith(p)) {
        const pos = i + p.length;
        const dist = Math.abs(pos - target);
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = pos;
        }
      }
    }
  }

  // 助詞が見つからなければ目安文字数で切る
  if (bestPos === -1) {
    return target;
  }

  return bestPos;
}

// ============================================================
// メインの整形関数
// ============================================================

/**
 * SRTセグメント配列を整形する
 * @param {Array} segments - parseSRTの結果
 * @param {Object} options - 整形オプション
 * @returns {Array} 整形後のセグメント配列
 */
function formatSegments(segments, options = {}) {
  const {
    charsPerLine = 18,
    maxLines = 2,
    shouldRemovePunctuation = true,
    shouldRemoveFillers = true,
    shouldSplitSegments = true,
  } = options;

  let result = [];

  for (const seg of segments) {
    let text = seg.text;

    // 既存の改行を除去
    text = text.replace(/\n/g, ' ').trim();

    // 句読点除去
    if (shouldRemovePunctuation) {
      text = removePunctuation(text);
    }

    // フィラー除去
    if (shouldRemoveFillers) {
      text = removeFillers(text);
    }

    // 全角・半角スペースの正規化（連続スペースを1つに）
    text = text.replace(/[\s\u3000]+/g, ' ').trim();

    // 空になったらスキップ
    if (text.length === 0) continue;

    // セグメント分割
    if (shouldSplitSegments) {
      const splitPoints = findSplitPoints(text, charsPerLine, maxLines);

      if (splitPoints.length > 0) {
        const startMs = timeToMs(seg.startTime);
        const endMs = timeToMs(seg.endTime);
        const totalDuration = endMs - startMs;
        const totalChars = text.replace(/\s/g, '').length;

        const parts = [];
        let lastIdx = 0;

        for (const sp of splitPoints) {
          const part = text.substring(lastIdx, sp).trim();
          if (part.length > 0) parts.push(part);
          lastIdx = sp;
        }
        const lastPart = text.substring(lastIdx).trim();
        if (lastPart.length > 0) parts.push(lastPart);

        // 時間を文字数比率で按分
        let currentMs = startMs;
        for (const part of parts) {
          const partChars = part.replace(/\s/g, '').length;
          const partDuration = Math.round((partChars / totalChars) * totalDuration);
          const partEnd = Math.min(currentMs + partDuration, endMs);

          const formattedText = addLineBreaks(part, charsPerLine, maxLines);
          result.push({
            startTime: msToTime(currentMs),
            endTime: msToTime(partEnd),
            text: formattedText,
          });
          currentMs = partEnd;
        }
        continue;
      }
    }

    // 分割なしの場合、改行だけ入れる
    const formattedText = addLineBreaks(text, charsPerLine, maxLines);
    result.push({
      startTime: seg.startTime,
      endTime: seg.endTime,
      text: formattedText,
    });
  }

  // 短すぎるセグメント（6文字未満）を前のセグメントに結合
  const MIN_SEG_CHARS = 6;
  const merged = [];
  for (const seg of result) {
    const textLen = seg.text.replace(/\n/g, '').trim().length;
    if (textLen < MIN_SEG_CHARS && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const combinedText = prev.text.replace(/\n/g, '') + seg.text.replace(/\n/g, '');
      prev.text = addLineBreaks(combinedText, charsPerLine, maxLines);
      prev.endTime = seg.endTime;
    } else {
      merged.push({ ...seg });
    }
  }

  // インデックス振り直し
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
// エクスポート（ブラウザ用）
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
