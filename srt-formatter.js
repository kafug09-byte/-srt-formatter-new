/**
 * SRT整形エンジン v3 - 候補生成 + スコアリング方式
 *
 * アーキテクチャ:
 *   1. 全テキスト結合 + 文字→時間マッピング
 *   2. 文境界で大分割（接続詞・文末・時間ギャップ）
 *   3. 各文に対して複数の分割候補を生成
 *   4. 各候補をスコアリングして最良を選択
 *   5. 各セグメントに最適な改行を挿入（これもスコアリング）
 *   6. タイムコード逆引き
 *   7. 短すぎるセグメントの結合
 */

// ============================================================
// 定数
// ============================================================

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

const PARTICLES = [
  'からは', 'までは', 'っていう', 'という', 'ような', 'ように',
  'みたいな', 'みたいに', 'として', 'ので', 'のに', 'けど', 'けれど',
  'ては', 'では', 'には', 'とは', 'よりも', 'から', 'まで', 'より', 'って',
  'は', 'が', 'を', 'に', 'で', 'も', 'へ', 'と',
];

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

// 強い文末パターン（文境界の検出に使用）
const SENTENCE_ENDINGS = [
  'のでしょうか', 'でしょうか', 'でしょう',
  'ませんでした', 'ませんか',
  'いきました', 'いきます',
  'てきました',
  'ではありません',
  'だそうです',
  'ました', 'ません',
  'ています', 'ていた', 'ている', 'てきた',
  'ください',
  'ことです', 'ものです', 'わけです', 'のです',
  'でした', 'です', 'ます',
  'のか',
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
// 分割位置の検出
// ============================================================

// 接続詞を含むが分割してはいけない複合語
const CONJUNCTION_FALSE_POSITIVES = [
  'とんでもない', 'とんでもなく', 'とんでもなかった',
  'なんでもない', 'なんでもなく', 'なんでも',
  'いつでも', 'どこでも', 'だれでも', 'なにでも', 'どれでも',
  'それでも', // これは接続詞リストにもあるが、文中で副詞的に使われる場合がある
];

/**
 * 指定位置がfalse positive（複合語の内部）かチェック
 */
function isInsideCompoundWord(text, matchIdx, matchLen, compounds) {
  for (const compound of compounds) {
    const compIdx = text.indexOf(compound);
    if (compIdx !== -1 && matchIdx >= compIdx && matchIdx + matchLen <= compIdx + compound.length) {
      return true;
    }
  }
  return false;
}

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
      const pos = idx + p.length;

      let valid = true;

      // 数字の途中では切らない
      if (/\d/.test(text[idx - 1] || '') && /\d/.test(text[pos] || '')) valid = false;

      // 「っと」パターン除外（擬態語: ぱっと、ちょっと、きっと、もっと等）
      if (p === 'と' && idx > 0 && text[idx - 1] === 'っ') valid = false;

      // 「んで」「んに」パターン除外（動詞の活用: 飲んで、選んで等）
      if (p.length === 1 && idx > 0 && text[idx - 1] === 'ん' && 'でに'.includes(p)) valid = false;

      // 複合語内の助詞を除外（「とんでもない」の「で」「も」等）
      if (valid && p.length <= 2) {
        if (isInsideCompoundWord(text, idx, p.length, CONJUNCTION_FALSE_POSITIVES)) valid = false;
      }

      if (valid) positions.add(pos);
      from = idx + 1;
    }
  }

  // 数字+単位の後に新しい数字が来る = 自然な境界
  // 例: "100万円2年で" → "100万円" | "2年で..."
  // 例: "50万円まで" の "まで" は助詞で別途検出済み
  const unitChars = '万億円%年月日人名件回倍歳';
  for (let i = 0; i < text.length - 1; i++) {
    if (unitChars.includes(text[i]) && /\d/.test(text[i + 1])) {
      positions.add(i + 1);
    }
  }

  return [...positions].sort((a, b) => a - b);
}

/**
 * テキスト内の接続詞位置を列挙（接続詞の「前」で切る）
 * 複合語内のfalse positive を排除
 */
function findConjunctionPositions(text) {
  const positions = new Set();
  const sorted = [...CONJUNCTIONS].sort((a, b) => b.length - a.length);

  for (const conj of sorted) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(conj, from);
      if (idx === -1) break;

      // 複合語内の偽陽性を排除
      if (idx >= 3 && !isInsideCompoundWord(text, idx, conj.length, CONJUNCTION_FALSE_POSITIVES)) {
        positions.add(idx);
      }
      from = idx + 1;
    }
  }

  return [...positions].sort((a, b) => a - b);
}

// ============================================================
// STEP 2: 文の境界検出（大分割）
// ============================================================

/**
 * 結合テキストを「文」単位に分割する
 * @param {string} text - 結合済みテキスト
 * @param {Set<number>} gapPositions - 時間ギャップ位置
 */
function splitIntoSentences(text, gapPositions) {
  const boundaries = new Set();

  // 1. 時間ギャップ位置（Premiereセグメント間に300ms以上の空白）
  for (const pos of gapPositions) {
    if (pos > 0 && pos < text.length) boundaries.add(pos);
  }

  // 2. 接続詞の前で分割
  const conjPositions = findConjunctionPositions(text);
  for (const pos of conjPositions) {
    if (pos >= 5) boundaries.add(pos);
  }

  // 3. 文末パターンの後で分割
  //    ただし文末の直後に接続語（ので、のに、が、けど等）が来る場合は
  //    接続語も含めてから分割する
  const POST_ENDING_CONNECTORS = ['ので', 'のに', 'けど', 'けれど', 'から', 'が', 'し'];
  const sortedEndings = [...SENTENCE_ENDINGS].sort((a, b) => b.length - a.length);
  for (const ending of sortedEndings) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(ending, from);
      if (idx === -1) break;
      let splitAt = idx + ending.length;

      // 文末の直後に接続語があれば、接続語の後ろまで含める
      const remaining = text.substring(splitAt);
      for (const conn of POST_ENDING_CONNECTORS) {
        if (remaining.startsWith(conn)) {
          splitAt += conn.length;
          break;
        }
      }

      if (splitAt >= 5 && text.length - splitAt >= 3) {
        boundaries.add(splitAt);
      }
      from = idx + 1;
    }
  }

  // 4. 数字+単位の後に新しい数字 = 文構造の変わり目
  // 例: "100万円2年で" → "100万円" | "2年で..."（並列構造の切り替わり）
  const unitCharsForBoundary = '万億円%';
  for (let i = 0; i < text.length - 1; i++) {
    if (unitCharsForBoundary.includes(text[i]) && /\d/.test(text[i + 1])) {
      const pos = i + 1;
      if (pos >= 5 && text.length - pos >= 5) {
        boundaries.add(pos);
      }
    }
  }

  // ソートしてフィルタ（境界間は最低5文字）
  const sorted = [...boundaries].sort((a, b) => a - b);
  const filtered = [];
  let lastBound = 0;
  for (const b of sorted) {
    if (b - lastBound >= 5 && text.length - b >= 3) {
      filtered.push(b);
      lastBound = b;
    }
  }

  // 文を生成
  const sentences = [];
  let lastIdx = 0;
  for (const b of filtered) {
    const part = text.substring(lastIdx, b).trim();
    if (part.length > 0) sentences.push(part);
    lastIdx = b;
  }
  const remainder = text.substring(lastIdx).trim();
  if (remainder.length > 0) sentences.push(remainder);

  return sentences;
}

// ============================================================
// STEP 3: 候補生成
// ============================================================

/**
 * テキストに対して、全ての妥当な分割候補を生成する
 * 各候補は文字列の配列 例: ["前半", "後半"]
 */
function generateCandidates(text) {
  const particlePositions = findAllParticlePositions(text);
  const conjPositions = findConjunctionPositions(text);

  // 全分割候補位置をマージ
  const allPositions = [...new Set([...particlePositions, ...conjPositions])].sort((a, b) => a - b);

  // 有効な位置のみ（前後に最低5文字）
  const valid = allPositions.filter(p => p >= 5 && text.length - p >= 5);

  const candidates = [];

  // 分割なし
  candidates.push([text]);

  // 1分割
  for (const p of valid) {
    candidates.push([text.slice(0, p), text.slice(p)]);
  }

  // 2分割（テキストが20文字以上の場合）
  if (text.length > 20) {
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const p1 = valid[i], p2 = valid[j];
        if (p2 - p1 >= 5 && text.length - p2 >= 5) {
          candidates.push([text.slice(0, p1), text.slice(p1, p2), text.slice(p2)]);
        }
      }
    }
  }

  // 3分割（テキストが40文字以上の場合）
  if (text.length > 40) {
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        for (let k = j + 1; k < valid.length; k++) {
          const p1 = valid[i], p2 = valid[j], p3 = valid[k];
          if (p2 - p1 >= 5 && p3 - p2 >= 5 && text.length - p3 >= 5) {
            candidates.push([
              text.slice(0, p1), text.slice(p1, p2),
              text.slice(p2, p3), text.slice(p3),
            ]);
          }
        }
      }
    }
  }

  return candidates;
}

// ============================================================
// STEP 4: スコアリング
// ============================================================

/**
 * 分割候補全体をスコアリングする
 * 高いスコア = より良い候補
 */
function scoreCandidate(segments) {
  let total = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // 1. 長さスコア
    total += scoreLength(seg.length);

    // 2. 末尾の質
    total += scoreEnding(seg);

    // 3. 先頭の質（2番目以降のセグメント）
    if (i > 0) total += scoreStart(seg);

    // 4. 改行のしやすさ
    total += scoreLineBreakability(seg);
  }

  // 5. セグメント間の意味的整合性
  total += scoreCoherence(segments);

  // 6. 分割コスト（少ないセグメントを好む）
  // 各セグメントが追加のスコアを稼ぐため、コストが低いと何でも分割した方が得になる
  // コストは「分割しない方がデフォルトで、明確に良い分割のみ実行」になる程度に設定
  total -= (segments.length - 1) * 20;

  return total;
}

/**
 * 長さスコア: セグメントの文字数に基づく評価
 * テロップとして快適に読める長さを高く評価
 */
function scoreLength(len) {
  // 長さスコアはフラットに: テロップとして許容できる範囲内は同じスコア
  // 分割の質は長さではなく「どこで切るか」で判断すべき
  if (len >= 6 && len <= 28) return 8;    // テロップとして許容範囲（全て同スコア）
  if (len >= 29 && len <= 35) return 3;   // 長いが表示可能
  if (len === 5) return -10;              // かなり短い
  if (len < 5) return -30;               // 表示の意味がない
  return -10;                             // 長すぎる
}

/**
 * 末尾の質: セグメントの終わり方を評価
 * 意味が完結している終わり方を高く評価
 */
function scoreEnding(text) {
  // 完全な文末（最高評価 - 意味が完結している）
  const strongEndings = [
    'のでしょうか', 'でしょうか', 'でしょう',
    'ませんでした', 'ではありません',
    'ました', 'ません',
    'ています', 'ていた', 'てきた', 'てきました',
    'ください',
    'でした', 'です', 'ます',
    'のか',
  ];
  for (const e of strongEndings) {
    if (text.endsWith(e)) return 12;
  }

  // 主題マーカー「は」= 自然なセグメント境界（主題提示）
  // 例: 「なぜこの男は」「最も着目すべき点は」
  if (text.endsWith('は') && text.length >= 5) return 8;

  // 主語マーカー「が」= 動詞との結びつきが強いので、はほど良い区切りではない
  if (text.endsWith('が') && text.length >= 5) return 5;

  // 目的語マーカー（を）= 名詞句の完結
  if (text.endsWith('を') && text.length >= 5) return 7;

  // その他の助詞（良い終わり方 - フレーズが完結している）
  const sortedParticles = [...PARTICLES].sort((a, b) => b.length - a.length);
  for (const p of sortedParticles) {
    if (text.endsWith(p) && text.length > p.length + 3) {
      return 5;
    }
  }

  // 数字+単位で終わる（OK）
  if (/[万億円%年月日人名件回倍]$/.test(text)) return 4;

  // 単位なしの数字で終わる（悪い - 中途半端）
  if (/\d$/.test(text)) return -5;

  return 0;
}

/**
 * 先頭の質: セグメントの始まり方を評価
 * 前のセグメントからの継続ではなく、新しい始まりを高く評価
 */
function scoreStart(text) {
  // 動詞の継続形で始まる（非常に悪い - 前のセグメントの続きに見える）
  const badStarts = [
    'なかった', 'ないで', 'ない',
    'ません',
    'ている', 'ていた', 'てきた', 'ていく',
    'すよ', 'すね', 'すか', 'すが', 'すので',
    'ことが', 'ことを', 'ことに', 'ことは',
    'った', 'れた', 'れる',
  ];
  for (const bad of badStarts) {
    if (text.startsWith(bad)) return -12;
  }

  // 単独助詞で始まる（悪い - 前のセグメントの助詞が取り残されている）
  // 例: 「も10倍」「が必要です」「を使って」
  const singleParticleStarts = ['も', 'が', 'を', 'に', 'で', 'は', 'へ', 'の'];
  for (const p of singleParticleStarts) {
    if (text.startsWith(p) && text.length > 1 && !/^[もがをにではへの][、。]/.test(text)) {
      return -8;
    }
  }

  // 動詞連用形で始まる（悪い - 前のフレーズの動詞部分が切り離されている）
  // 例: 「加え5000名」「変えてきた」「使いこなす」
  const verbContinuations = [
    '加え', '変え', '使い', '使って', '取り', '受け', '出し', '持ち',
    '作り', '見て', '聞い', '書い', '読ん', '行っ', '来て',
  ];
  for (const vc of verbContinuations) {
    if (text.startsWith(vc)) return -8;
  }

  // 接続詞で始まる（良い - 明確な区切り）
  const sortedConj = [...CONJUNCTIONS].sort((a, b) => b.length - a.length);
  for (const conj of sortedConj) {
    if (text.startsWith(conj)) return 3;
  }

  return 0;
}

/**
 * セグメント間の意味的整合性を評価
 * 意味のまとまりが壊れていないかチェック
 */
function scoreCoherence(segments) {
  let score = 0;

  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    // 不完全な否定パターン（「何もなかった」が分断される）
    if (/(?:何も|全く|一度も|少しも|一切|決して)$/.test(current)) score -= 15;

    // 形容詞/動詞の途中で分断（「ぱっとし」+「ない」）
    if (/[しく]$/.test(current) && /^ない/.test(next)) score -= 12;

    // 数字と単位の分断（「100」+「万円」）
    if (/\d$/.test(current) && /^[万億円%ヶ個人名件回倍年月日時分秒]/.test(next)) score -= 20;

    // 「の」で終わって名詞が続く（「起業の」+「本質」）
    if (current.endsWith('の') && current.length < 8) score -= 8;

    // 極端に短いセグメントが連続
    if (current.length < 6 && next.length < 6) score -= 10;

    // 前のセグメントが短すぎる（視聴者が処理できない）
    if (current.length < 5) score -= 5;
  }

  return score;
}

/**
 * セグメントの改行のしやすさを評価
 * 2行に分けた時にバランス良く分割できるかを評価
 */
function scoreLineBreakability(text) {
  const len = text.length;

  // 1行に収まる（理想的）
  if (len <= 15) return 5;

  // 2行必要
  if (len <= 30) {
    const mid = Math.ceil(len / 2);
    const positions = findAllParticlePositions(text);

    // 中間付近で助詞による改行ができるか
    let bestRatio = 0;
    for (const pos of positions) {
      if (pos < 3 || len - pos < 3) continue;
      const dist = Math.abs(pos - mid);
      if (dist <= 7) {
        const ratio = Math.min(pos, len - pos) / Math.max(pos, len - pos);
        if (ratio > bestRatio) bestRatio = ratio;
      }
    }

    if (bestRatio >= 0.5) return 4;   // 良いバランス
    if (bestRatio >= 0.3) return 1;   // まあまあ
    return -3;                        // バランスが悪い
  }

  // 2行に収まらない
  return -10;
}

// ============================================================
// 最良候補の選択
// ============================================================

/**
 * テキストに対して最良の分割を見つける
 */
function findBestSegmentation(text) {
  // 短いテキストは分割不要
  if (text.length <= 15) return [text];

  const candidates = generateCandidates(text);

  let bestCandidate = [text];
  let bestScore = scoreCandidate([text]);

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

// ============================================================
// STEP 5: 改行挿入（スコアリングで最適位置を選択）
// ============================================================

/**
 * テキストに最適な改行を挿入する
 * 複数の改行候補をスコアリングして最良を選択
 */
function addLineBreaks(text) {
  const flat = text.replace(/\n/g, '').trim();
  const len = flat.length;

  // 1行に収まる
  if (len <= 15) return flat;

  // 改行候補を生成してスコアリング
  const positions = findAllParticlePositions(flat);

  let bestPos = -1;
  let bestScore = -Infinity;

  for (const pos of positions) {
    if (pos < 3 || len - pos < 3) continue;

    let score = 0;

    // バランス（中間に近いほど良い）
    const ratio = Math.min(pos, len - pos) / Math.max(pos, len - pos);
    score += ratio * 10;

    // 極端な偏りにペナルティ
    if (pos < len * 0.25 || pos > len * 0.75) score -= 5;

    // 各行が18文字以下を好む
    if (pos > 18) score -= (pos - 18) * 2;
    if (len - pos > 18) score -= (len - pos - 18) * 2;

    // 各行が3文字以上であること
    if (pos < 4) score -= 10;
    if (len - pos < 4) score -= 10;

    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  // 助詞が見つからない場合、中間で切る
  if (bestPos === -1) {
    bestPos = Math.ceil(len / 2);
  }

  const line1 = flat.slice(0, bestPos).trim();
  const line2 = flat.slice(bestPos).trim();

  // あまりに短い行ができる場合は改行しない
  if (line1.length < 3 || line2.length < 3) return flat;

  return line1 + '\n' + line2;
}

// ============================================================
// メインの整形関数
// ============================================================

function formatSegments(segments, options = {}) {
  const {
    shouldRemovePunctuation = true,
    shouldRemoveFillers = true,
  } = options;

  const MIN_SEG_CHARS = 5;
  const GAP_THRESHOLD_MS = 300;

  // ============================================================
  // STEP 1: 全セグメントのテキストを結合し、文字→時間のマッピングを作成
  // ============================================================
  let fullText = '';
  const charTimeMap = [];
  const gapPositions = new Set();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let text = seg.text.replace(/\n/g, ' ').trim();
    if (shouldRemovePunctuation) text = removePunctuation(text);
    if (shouldRemoveFillers) text = removeFillers(text);
    text = text.replace(/[\s\u3000]+/g, '').trim();

    if (text.length === 0) continue;

    // 時間ギャップの検出
    if (i > 0 && fullText.length > 0) {
      const prevEnd = timeToMs(segments[i - 1].endTime);
      const currStart = timeToMs(seg.startTime);
      if (currStart - prevEnd >= GAP_THRESHOLD_MS) {
        gapPositions.add(fullText.length);
      }
    }

    const startMs = timeToMs(seg.startTime);
    const endMs = timeToMs(seg.endTime);
    const duration = endMs - startMs;

    for (let j = 0; j < text.length; j++) {
      const charMs = startMs + Math.round((j / text.length) * duration);
      charTimeMap.push({ ms: charMs });
    }

    fullText += text;
  }

  if (fullText.length === 0) return [];

  const totalEndMs = timeToMs(segments[segments.length - 1].endTime);

  // ============================================================
  // STEP 2: 文の境界で大分割
  // ============================================================
  const sentences = splitIntoSentences(fullText, gapPositions);

  // ============================================================
  // STEP 3+4: 各文に対して候補生成 → スコアリング → 最良選択
  // ============================================================
  const allUnits = [];
  for (const sentence of sentences) {
    const bestSegmentation = findBestSegmentation(sentence);
    allUnits.push(...bestSegmentation);
  }

  // ============================================================
  // STEP 5+6: 改行挿入 + タイムコード割り当て
  // ============================================================
  const result = [];
  let charPos = 0;

  for (const unit of allUnits) {
    const unitLen = unit.length;
    if (unitLen === 0) continue;

    const startCharPos = charPos;
    const endCharPos = Math.min(charPos + unitLen - 1, charTimeMap.length - 1);

    const unitStartMs = charTimeMap[startCharPos] ? charTimeMap[startCharPos].ms : 0;
    const unitEndMs = (endCharPos + 1 < charTimeMap.length)
      ? charTimeMap[endCharPos + 1].ms
      : totalEndMs;

    result.push({
      startTime: msToTime(unitStartMs),
      endTime: msToTime(unitEndMs),
      text: addLineBreaks(unit),
    });

    charPos += unitLen;
  }

  // ============================================================
  // STEP 7: 短すぎるセグメントを結合
  // ============================================================
  const merged = [];
  for (let i = 0; i < result.length; i++) {
    const seg = result[i];
    const textLen = seg.text.replace(/\n/g, '').length;

    if (textLen < MIN_SEG_CHARS && i + 1 < result.length) {
      // 次のセグメントに結合
      const next = result[i + 1];
      const combined = seg.text.replace(/\n/g, '') + next.text.replace(/\n/g, '');
      next.text = addLineBreaks(combined);
      next.startTime = seg.startTime;
    } else if (textLen < MIN_SEG_CHARS && merged.length > 0) {
      // 前のセグメントに結合
      const prev = merged[merged.length - 1];
      const combined = prev.text.replace(/\n/g, '') + seg.text.replace(/\n/g, '');
      prev.text = addLineBreaks(combined);
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
