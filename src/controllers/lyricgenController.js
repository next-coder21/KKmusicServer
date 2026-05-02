const Groq = require("groq-sdk");
const pool = require("../models/User");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const FormData = require("form-data");

require("dotenv").config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CONFIG = {
  // ── Section / timing thresholds ────────────────────────────────────────────
  MUSIC_GAP_THRESHOLD: 3.0,
  INTRO_THRESHOLD: 2.0,
  OUTRO_THRESHOLD: 5.0,
  PAUSE_THRESHOLD: 0.7,
  SENTENCE_PAUSE: 1.0,

  // ── Hallucination filtering ────────────────────────────────────────────────
  HALLUCINATION_RATIO: 0.82,
  CONSECUTIVE_REPEAT_LIMIT: 2,
  MAX_NO_SPEECH_PROB: 0.65,
  MAX_COMPRESSION_RATIO: 2.3,
  MIN_AVG_LOGPROB: -2.1,

  // ── Word-level filtering ───────────────────────────────────────────────────
  MIN_WORD_PROBABILITY: 0.25,         // baseline (Demucs / Latin)
  MIN_WORD_PROBABILITY_STRICT: 0.32,  // non-Latin script (Demucs)
  MIN_WORD_PROBABILITY_NO_DEMUCS: 0.4,   // raw audio, Latin
  MIN_WORD_PROBABILITY_STRICT_NO_DEMUCS: 0.5, // raw audio, non-Latin
  MIN_WORD_DURATION: 0.04,
  MAX_WORD_DURATION: 2.5,
  MAX_WORD_DURATION_CJK: 1.5,

  // ── Script handling ────────────────────────────────────────────────────────
  MAX_SCRIPT_MIX_RATIO: 0.6,
  CODE_MIX_LATIN_THRESHOLD: 0.18,

  // ── Vocal region detection (density-based VAD) ─────────────────────────────
  VAD_BIN_SECONDS: 2.0,             // window size for density bins
  VAD_MIN_WORDS_PER_BIN: 1,         // bins with fewer words = silent/instrumental
  VAD_MIN_REGION_WORDS: 3,          // a region must have at least this many words
  VAD_MIN_REGION_DURATION: 1.5,     // and span at least this duration
  VAD_MERGE_GAP_SECONDS: 1.5,       // close regions get merged

  // ── Stuck-loop detection (different from chorus repetition) ────────────────
  STUCK_LOOP_WINDOW: 8.0,           // look at ~8-second windows
  STUCK_LOOP_MAX_REPEATS: 4,        // same word repeating > this in window = stuck

  // ── Two-pass refinement triggers ───────────────────────────────────────────
  PASS2_MIN_CONFIDENCE_FOR_DEMUCS: 0.45,
  PASS2_MIN_CONFIDENCE_NO_DEMUCS: 0.60,
  PASS2_MAX_FILTER_DROP_RATIO: 0.5, // if > 50% of words got filtered, redo
};

const NON_LATIN_LANGS = new Set(["ta", "hi", "te", "ml", "kn", "bn", "ko", "ja", "zh", "ar", "ru", "ur", "mr", "pa"]);
const CJK_LANGS = new Set(["ko", "ja", "zh"]);

// ─── Drive helpers ─────────────────────────────────────────────────────────────

function extractDriveId(url) {
  const pats = [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/];
  for (const re of pats) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

async function resolveDriveUrl(fileId) {
  const base = `https://drive.google.com/uc?export=download&id=${fileId}`;
  try {
    const check = await axios.get(base, {
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (typeof check.data === "string" && check.data.includes("confirm=")) {
      const token = (check.data.match(/confirm=([0-9A-Za-z_-]+)/) || [])[1];
      if (token)
        return `https://drive.google.com/uc?export=download&confirm=${token}&id=${fileId}`;
    }
  } catch {}
  return base;
}

// ─── Text helpers ──────────────────────────────────────────────────────────────

const TAG_RE = /[\(\[].*?[\)\]]/g;
const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;

// Expanded hallucination patterns — common Whisper artifacts across languages.
// These are content-level checks (full-line matches), not word-level.
const WHISPER_ARTIFACTS = [
  /^\[.*?\]$/,
  /^\(.*?\)$/,
  /^♪+$/,
  /^(music|instrumental|applause|laughter|silence|background\s*noise|sound\s*effect)$/i,
  /^(thank\s*you[\.,!]*|thanks\s*for\s*watching[\.,!]*|please\s*subscribe[\.,!]*|like\s*and\s*subscribe[\.,!]*|don'?t\s*forget\s*to\s*subscribe[\.,!]*)$/i,
  /^(see\s*you\s*next\s*time[\.,!]*|see\s*you\s*later[\.,!]*|bye\s*bye[\.,!]*|goodbye[\.,!]*)$/i,
  /^(subtitles?\s*(by|from)?.*|translated\s*by.*|captions?\s*by.*)$/i,
  /^(www\.|http|@|#).*$/i,
  /^\.+$/,
  /^[\s,\.!?]+$/,
  // Stuck word pattern: the same short word repeated 5+ times
  /^(\b\w{1,4}\b\s*){5,}$/,
  // YouTube/streaming caption artifacts
  /^(end\s*of\s*video|video\s*ends?)$/i,
  // Translation/paraphrase markers
  /^(translation|translated|in\s*english|english\s*translation):/i,
];

function isWhisperArtifact(text) {
  return WHISPER_ARTIFACTS.some((re) => re.test(text.trim()));
}

function cleanSegmentText(text) {
  if (!text) return "";
  let cleaned = text.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "");
  cleaned = cleaned.replace(/^[♪♫🎵🎶\s]+|[♪♫🎵🎶\s]+$/g, "");
  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeText(text) {
  if (!text) return "";
  return text.toLowerCase().replace(TAG_RE, "").replace(PUNCT_RE, "").split(/\s+/).filter(Boolean).join(" ");
}

function getSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  const c1 = Array.from(s1);
  const c2 = Array.from(s2);
  if (c1.length < 2 || c2.length < 2) return 0.0;
  const bigrams1 = new Map();
  for (let i = 0; i < c1.length - 1; i++) {
    const bg = c1[i] + c1[i + 1];
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < c2.length - 1; i++) {
    const bg = c2[i] + c2[i + 1];
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }
  return (2.0 * intersection) / (c1.length + c2.length - 2);
}

const WHISPER_LANG_NAMES = {
  tamil: "ta", hindi: "hi", telugu: "te", malayalam: "ml", kannada: "kn",
  bengali: "bn", korean: "ko", japanese: "ja", chinese: "zh", arabic: "ar",
  russian: "ru", spanish: "es", french: "fr", portuguese: "pt", german: "de",
  turkish: "tr", english: "en", urdu: "ur", marathi: "mr", punjabi: "pa",
};

function normalizeLang(raw) {
  if (!raw) return "";
  const lower = raw.toLowerCase().trim();
  return WHISPER_LANG_NAMES[lower] || lower;
}

function formatTimestamp(ts) {
  const minutes = Math.floor(ts / 60);
  const seconds = ts % 60;
  return `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;
}

function cleanWordText(word) {
  if (!word) return "";
  return word.trim().replace(/^\[|\]$/g, "").replace(/^\(|\)$/g, "");
}

// ─── Code-mix detection ────────────────────────────────────────────────────────

function detectCodeMixed(segments) {
  const allText = segments.map((s) => s.text || "").join(" ");
  const nonLatinChars = (allText.match(/[^\x00-\x7F]/g) || []).length;
  if (nonLatinChars < 10) return false;
  const latinWordChars = (allText.match(/[a-zA-Z]/g) || []).length;
  const ratio = latinWordChars / (latinWordChars + nonLatinChars);
  return ratio > CONFIG.CODE_MIX_LATIN_THRESHOLD;
}

// ─── Word-timing sanity ────────────────────────────────────────────────────────
// Drops words with implausible durations or overlap — classic Whisper artifact.

function filterWordsByTiming(words, lang) {
  const isCJK = CJK_LANGS.has(lang);
  const maxDur = isCJK ? CONFIG.MAX_WORD_DURATION_CJK : CONFIG.MAX_WORD_DURATION;
  const filtered = [];
  let lastEnd = -Infinity;

  for (const w of words) {
    if (w.start == null || w.end == null) continue;
    if (w.end <= w.start) continue;
    const dur = w.end - w.start;
    if (dur < CONFIG.MIN_WORD_DURATION) continue;
    if (dur > maxDur) continue;
    // Heavy overlap with previous word = timing artifact
    if (w.start < lastEnd - 0.2) continue;
    filtered.push(w);
    lastEnd = w.end;
  }
  return filtered;
}

// ─── Density-based vocal region detection ──────────────────────────────────────
// Bins the timeline; finds spans with consistent word density. Anything outside
// is treated as instrumental/silent. This is the single biggest hallucination
// killer — isolated hallucinated words in long quiet stretches get dropped.

function findVocalRegions(words, totalDuration) {
  if (!words.length) return [];
  const binSize = CONFIG.VAD_BIN_SECONDS;
  const start = Math.max(0, words[0].start - 1);
  const end = totalDuration || words[words.length - 1].end + 1;
  const numBins = Math.ceil((end - start) / binSize);
  if (numBins <= 0) return [];

  const bins = new Array(numBins).fill(0);
  for (const w of words) {
    const idx = Math.floor((w.start - start) / binSize);
    if (idx >= 0 && idx < numBins) bins[idx]++;
  }

  // Walk bins → regions of consecutive "active" bins
  const rawRegions = [];
  let regionStart = -1;
  for (let i = 0; i < numBins; i++) {
    const active = bins[i] >= CONFIG.VAD_MIN_WORDS_PER_BIN;
    if (active && regionStart === -1) regionStart = i;
    else if (!active && regionStart !== -1) {
      rawRegions.push([regionStart, i]);
      regionStart = -1;
    }
  }
  if (regionStart !== -1) rawRegions.push([regionStart, numBins]);

  // Merge regions separated by short gaps
  const merged = [];
  for (const [a, b] of rawRegions) {
    const tStart = start + a * binSize;
    const tEnd = start + b * binSize;
    if (merged.length && tStart - merged[merged.length - 1].end < CONFIG.VAD_MERGE_GAP_SECONDS) {
      merged[merged.length - 1].end = tEnd;
    } else {
      merged.push({ start: tStart, end: tEnd });
    }
  }

  // Validate regions: must have enough words AND duration
  return merged.filter((r) => {
    const wordsInRegion = words.filter((w) => w.start >= r.start - 0.5 && w.start < r.end + 0.5);
    return (
      wordsInRegion.length >= CONFIG.VAD_MIN_REGION_WORDS &&
      r.end - r.start >= CONFIG.VAD_MIN_REGION_DURATION
    );
  });
}

function isWordInRegions(word, regions) {
  for (const r of regions) {
    if (word.start >= r.start - 0.5 && word.start < r.end + 0.5) return true;
  }
  return false;
}

// ─── Stuck-loop detector ───────────────────────────────────────────────────────
// Catches "you you you you you you you" — same word firing rapidly in a window.
// Different from chorus repetition: looks at sub-line word-level windows.

function removeStuckLoops(words) {
  if (words.length < 5) return words;
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Look back: how many of the same word in the past STUCK_LOOP_WINDOW seconds?
    const wKey = normalizeText(w.word);
    if (!wKey || wKey.length < 2) {
      result.push(w);
      continue;
    }
    let sameInWindow = 0;
    for (let j = result.length - 1; j >= 0; j--) {
      if (w.start - result[j].start > CONFIG.STUCK_LOOP_WINDOW) break;
      if (normalizeText(result[j].word) === wKey) sameInWindow++;
    }
    if (sameInWindow >= CONFIG.STUCK_LOOP_MAX_REPEATS) continue; // skip this loop iteration
    result.push(w);
  }
  return result;
}

// ─── Hallucination filter (segment-level) ──────────────────────────────────────

function filterHallucinatedSegments(segments, detectedLang = "", isCodeMixed = false) {
  if (segments.length < 2) return segments;
  const applyScriptFilter = NON_LATIN_LANGS.has(detectedLang) && !isCodeMixed;
  const filtered = [];
  let consecutiveRepeats = 0;
  let lastText = "";

  for (const seg of segments) {
    const text = cleanSegmentText(seg.text || "");
    if (!text) continue;
    if (isWhisperArtifact(text)) continue;

    if (seg.no_speech_prob != null && seg.no_speech_prob > CONFIG.MAX_NO_SPEECH_PROB) continue;
    if (seg.compression_ratio && seg.compression_ratio > CONFIG.MAX_COMPRESSION_RATIO) continue;
    if (seg.avg_logprob && seg.avg_logprob < CONFIG.MIN_AVG_LOGPROB) continue;

    const sim = getSimilarity(normalizeText(text), normalizeText(lastText));
    if (sim > CONFIG.HALLUCINATION_RATIO && lastText.length > 5) {
      consecutiveRepeats++;
      if (consecutiveRepeats >= CONFIG.CONSECUTIVE_REPEAT_LIMIT) continue;
    } else {
      consecutiveRepeats = 0;
    }

    if (applyScriptFilter) {
      const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
      if (latinChars / text.length > CONFIG.MAX_SCRIPT_MIX_RATIO && text.length > 5) continue;
    }

    filtered.push({ ...seg, text });
    lastText = text;
  }
  return filtered;
}

// ─── Word-level filter pipeline ────────────────────────────────────────────────

function filterWords(rawWords, opts) {
  const { detectedLang, isCodeMixed, demucsUsed, totalDuration } = opts;
  const applyScriptFilter = NON_LATIN_LANGS.has(detectedLang) && !isCodeMixed;

  // Pick probability threshold based on Demucs availability and script
  let minProb;
  if (applyScriptFilter) {
    minProb = demucsUsed
      ? CONFIG.MIN_WORD_PROBABILITY_STRICT
      : CONFIG.MIN_WORD_PROBABILITY_STRICT_NO_DEMUCS;
  } else {
    minProb = demucsUsed
      ? CONFIG.MIN_WORD_PROBABILITY
      : CONFIG.MIN_WORD_PROBABILITY_NO_DEMUCS;
  }

  // 1. Map and basic cleanup
  let words = rawWords
    .map((w) => ({
      word: cleanWordText(w.word),
      start: w.start,
      end: w.end,
      probability: w.probability,
    }))
    .filter((w) => w.word && !isWhisperArtifact(w.word));

  // 2. Probability filter
  words = words.filter((w) => w.probability == null || w.probability >= minProb);

  // 3. Script filter (drop words in wrong script for the detected language)
  if (applyScriptFilter) {
    words = words.filter((w) => {
      const latinRatio = (w.word.match(/[a-zA-Z]/g) || []).length / w.word.length;
      if (latinRatio > CONFIG.MAX_SCRIPT_MIX_RATIO && w.word.length > 2) return false;
      // Foreign script (Korean/CJK/Arabic) leaking into Tamil/Indic
      if (detectedLang === "ta" || detectedLang === "hi" || detectedLang === "te" || detectedLang === "ml") {
        if (/[ᄀ-ᇿ぀-ゟ゠-ヿ一-鿿가-힣]/.test(w.word)) return false;
      }
      return true;
    });
  }

  // 4. Timing sanity
  words = filterWordsByTiming(words, detectedLang);

  // 5. Stuck-loop removal
  words = removeStuckLoops(words);

  // 6. Vocal region detection — drop isolated hallucinations in instrumental sections
  const regions = findVocalRegions(words, totalDuration);
  if (regions.length > 0) {
    words = words.filter((w) => isWordInRegions(w, regions));
  }

  return { words, regions };
}

// ─── Quality scoring (decides if Pass 2 is needed) ─────────────────────────────

function scoreTranscriptionQuality(transcription, filteredWords, rawSegments, cleanedSegments) {
  const rawWords = transcription.words || [];
  if (rawWords.length === 0) return 0;

  // Average word probability
  const probs = rawWords.map((w) => w.probability ?? 0.5).filter((p) => p > 0);
  const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;

  // Average segment confidence (logprob → 0-1)
  const segScores = (rawSegments || [])
    .map((s) => Math.exp(s.avg_logprob ?? -1.0))
    .filter((v) => !isNaN(v));
  const avgSegScore = segScores.length ? segScores.reduce((a, b) => a + b, 0) / segScores.length : 0;

  // Drop ratios
  const wordDropRatio = 1 - filteredWords.length / Math.max(rawWords.length, 1);
  const segDropRatio = 1 - cleanedSegments.length / Math.max(rawSegments.length, 1);

  // Combined score: high probabilities + low drop ratios → high quality
  const score =
    avgProb * 0.45 +
    avgSegScore * 0.25 +
    (1 - wordDropRatio) * 0.2 +
    (1 - segDropRatio) * 0.1;

  return Math.max(0, Math.min(1, score));
}

// ─── Auto line-length from content ─────────────────────────────────────────────

function computeLineLimits(segments, words) {
  if (segments && segments.length >= 3) {
    const counts = segments
      .map((s) => (s.text || "").trim().split(/\s+/).filter(Boolean).length)
      .filter((c) => c >= 1 && c <= 20);
    if (counts.length >= 3) {
      counts.sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)];
      const max = Math.max(3, Math.min(9, median + 1));
      const min = Math.max(1, median - 2);
      return { MAX_LINE_WORDS: max, MIN_LINE_WORDS: min };
    }
  }
  if (words && words.length >= 6) {
    const gaps = [];
    for (let i = 1; i < words.length; i++) {
      const g = words[i].start - words[i - 1].end;
      if (g >= 0 && g < 5) gaps.push(g);
    }
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      const p75 = gaps[Math.floor(gaps.length * 0.75)];
      if (p75 < 0.2) return { MAX_LINE_WORDS: 8, MIN_LINE_WORDS: 3 };
      if (p75 < 0.4) return { MAX_LINE_WORDS: 6, MIN_LINE_WORDS: 2 };
      if (p75 < 0.7) return { MAX_LINE_WORDS: 5, MIN_LINE_WORDS: 2 };
      return { MAX_LINE_WORDS: 4, MIN_LINE_WORDS: 1 };
    }
  }
  return { MAX_LINE_WORDS: 5, MIN_LINE_WORDS: 2 };
}

// ─── Repetition tracker ────────────────────────────────────────────────────────

function makeRepeatTracker() {
  const seen = new Map();
  function labelRepeat(text) {
    const key = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) return text;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count > 1 ? `${text} (${count})` : text;
  }
  labelRepeat.reset = () => seen.clear();
  return labelRepeat;
}

// ─── LRC builders ──────────────────────────────────────────────────────────────

function buildSmartLrc(words, totalDuration, lineLimits) {
  if (!words || words.length === 0) return "";
  const { MAX_LINE_WORDS, MIN_LINE_WORDS } = lineLimits;
  const labelRepeat = makeRepeatTracker();
  const lines = [];
  let currentLine = [];
  let lineStart = null;

  // Intro music
  if (words[0].start > CONFIG.INTRO_THRESHOLD) {
    lines.push(`${formatTimestamp(0)} ♪ Music ♪`);
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wordText = cleanWordText(w.word);
    if (!wordText) continue;

    const nextWord = i + 1 < words.length ? words[i + 1] : null;
    if (currentLine.length === 0) lineStart = w.start;
    currentLine.push(wordText);

    let shouldBreak = false;
    let isGap = false;

    if (!nextWord) {
      shouldBreak = true;
    } else {
      const gap = nextWord.start - w.end;
      if (gap > CONFIG.MUSIC_GAP_THRESHOLD) {
        shouldBreak = true;
        isGap = true;
      } else if (/[.!?।。？！؟]$/.test(wordText) && gap > CONFIG.PAUSE_THRESHOLD * 0.5) {
        shouldBreak = true;
      } else if (gap > CONFIG.SENTENCE_PAUSE) {
        shouldBreak = true;
      } else if (gap > CONFIG.PAUSE_THRESHOLD && currentLine.length >= MIN_LINE_WORDS) {
        shouldBreak = true;
      } else if (currentLine.length >= MAX_LINE_WORDS) {
        shouldBreak = true;
      } else if (/,$/.test(wordText) && gap > 0.3 && currentLine.length >= 3) {
        shouldBreak = true;
      }
    }

    if (shouldBreak && currentLine.length > 0) {
      const lineText = currentLine.join(" ");
      if (lineText && !isWhisperArtifact(lineText)) {
        lines.push(`${formatTimestamp(lineStart)} ${labelRepeat(lineText)}`);
      }
      if (isGap && nextWord) {
        lines.push(`${formatTimestamp(w.end)} ♪ Music ♪`);
        labelRepeat.reset();
      }
      currentLine = [];
      lineStart = null;
    }
  }

  if (currentLine.length > 0 && lineStart !== null) {
    const lineText = currentLine.join(" ");
    if (lineText && !isWhisperArtifact(lineText)) {
      lines.push(`${formatTimestamp(lineStart)} ${labelRepeat(lineText)}`);
    }
  }

  if (words.length > 0 && totalDuration) {
    const lastWordEnd = words[words.length - 1].end;
    if (totalDuration - lastWordEnd > CONFIG.OUTRO_THRESHOLD) {
      lines.push(`${formatTimestamp(lastWordEnd)} ♪ Music ♪`);
    }
  }

  return lines.join("\n");
}

function buildLrcFromSegments(segments, totalDuration) {
  if (!segments || segments.length === 0) return "";
  const labelRepeat = makeRepeatTracker();
  const lines = [];

  if (segments[0].start > CONFIG.INTRO_THRESHOLD) {
    lines.push(`${formatTimestamp(0)} ♪ Music ♪`);
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = cleanSegmentText(seg.text || "");
    if (!text || isWhisperArtifact(text)) continue;
    lines.push(`${formatTimestamp(seg.start)} ${labelRepeat(text)}`);
    const nextSeg = segments[i + 1];
    if (nextSeg && nextSeg.start - seg.end > CONFIG.MUSIC_GAP_THRESHOLD) {
      lines.push(`${formatTimestamp(seg.end)} ♪ Music ♪`);
      labelRepeat.reset();
    }
  }

  if (segments.length > 0 && totalDuration) {
    const lastEnd = segments[segments.length - 1].end;
    if (totalDuration - lastEnd > CONFIG.OUTRO_THRESHOLD) {
      lines.push(`${formatTimestamp(lastEnd)} ♪ Music ♪`);
    }
  }

  return lines.join("\n");
}

// ─── Lyric alignment ───────────────────────────────────────────────────────────

function matchLyricsToWords(
  lyricsLines,
  wordTimestamps,
  { searchWindow = 60, matchThreshold = 0.5, strongMatch = 0.82 } = {}
) {
  const matched = [];
  let currentWordIdx = 0;
  const totalWords = wordTimestamps.length;

  for (const line of lyricsLines) {
    const normLine = normalizeText(line);
    if (!normLine) {
      matched.push({ line, ts: null });
      continue;
    }

    const lineLen = normLine.split(/\s+/).length;
    let bestTs = null;
    let bestScore = 0.0;
    let bestEndIdx = currentWordIdx;
    const upper = Math.min(currentWordIdx + searchWindow, totalWords);

    for (let i = currentWordIdx; i < upper; i++) {
      for (let lenVar = -1; lenVar <= 3; lenVar++) {
        const sliceLen = lineLen + lenVar;
        if (sliceLen < 1) continue;
        const candidateText = normalizeText(
          wordTimestamps.slice(i, i + sliceLen).map((w) => w.word).join(" ")
        );
        const score = getSimilarity(normLine, candidateText);
        if (score > bestScore && score >= matchThreshold) {
          bestScore = score;
          bestTs = wordTimestamps[i].start;
          bestEndIdx = Math.min(i + sliceLen, totalWords);
          if (score >= strongMatch) break;
        }
      }
      if (bestScore >= strongMatch) break;
    }

    if (bestTs !== null) {
      currentWordIdx =
        bestScore >= strongMatch
          ? bestEndIdx
          : Math.min(currentWordIdx + Math.max(1, Math.floor(lineLen / 2)), totalWords);
    }
    matched.push({ line, ts: bestTs });
  }
  return matched;
}

// ─── Language prompts ──────────────────────────────────────────────────────────

const LANGUAGE_PROMPTS = {
  ta: "பாட்டு வரிகள். Song lyrics in Tamil. Naan unnai kaadhalikkiren. En life-la nee matter. Oru naal kaanom. யாரோ யாரோ. Idhuvum kadandhu pogum. Un mela aasai.",
  "ta-en":
    "Tanglish song lyrics. Tamil mixed with English. Naan unnai love pannren. En heart la only you. Oru chance kudu da. Life is beautiful. Kadhal enbadhu en song.",
  hi: "गाने के बोल. Song lyrics in Hindi. Main tujhse pyaar karta hoon. Dil mera dhadakta hai. Aaja mere paas. Teri yaad aati hai.",
  "hi-en":
    "Hinglish song lyrics. Hindi mixed with English. Main tujhse love karta hoon. Dil mera crazy hai. Baby tu meri life hai.",
  te: "పాట సాహిత్యం. Song lyrics in Telugu. Nee kosam nenu vachanu. Premalo padipoya. Manasulo nee chintha.",
  ml: "പാട്ടിന്റെ വരികൾ. Song lyrics in Malayalam. Njan ninne snehichunn. Ente manasil nee.",
  kn: "ಹಾಡಿನ ಸಾಹಿತ್ಯ. Song lyrics in Kannada. Ninna nenu preetisuttene. Mana tumba hadithu.",
  bn: "গানের কথা. Song lyrics in Bengali. Amar shonar bangla. Tumi amar moner katha.",
  ko: "노래 가사. Song lyrics in Korean. 사랑해 나는 너를. 보고 싶어 보고 싶어.",
  ja: "歌詞。Song lyrics in Japanese. 君のことが好きだよ。夜空の下で二人で。",
  zh: "歌词。Song lyrics in Chinese. 我爱你。你是我的一切。",
  es: "Letra de la canción. Song lyrics in Spanish. Te quiero mucho amor.",
  fr: "Paroles de la chanson. Song lyrics in French. Je t'aime ma chérie.",
  ar: "كلمات الأغنية. Song lyrics in Arabic. أحبك يا حبيبي.",
  pt: "Letra da música. Song lyrics in Portuguese. Eu te amo tanto.",
  de: "Liedtext. Song lyrics in German. Ich liebe dich sehr.",
  ru: "Слова песни. Song lyrics in Russian. Я тебя люблю.",
  tr: "Şarkı sözleri. Song lyrics in Turkish. Seni seviyorum.",
};

function buildContextPrompt(language, songTitle, artistName) {
  const langPrompt =
    LANGUAGE_PROMPTS[language] || LANGUAGE_PROMPTS[(language || "").split("-")[0]] || "Song lyrics.";

  const meta = [];
  if (songTitle) meta.push(`Title: ${songTitle}`);
  if (artistName) meta.push(`Artist: ${artistName}`);

  // Negative anchors: explicitly tell Whisper this is not a YouTube subtitle stream.
  // This noticeably reduces "thanks for watching"-class hallucinations.
  const antiArtifact = "Transcribe only sung lyrics. No subtitles, no translations, no captions.";

  return [meta.join(". "), langPrompt, antiArtifact].filter(Boolean).join(" ");
}

// Pass-2 prompt: anchor the model with cleaned Pass-1 text so it stops hallucinating
function buildRefinementPrompt(language, songTitle, cleanedText) {
  const base = buildContextPrompt(language, songTitle, null);
  // Truncate to keep prompt under ~224 tokens (Whisper limit)
  const snippet = (cleanedText || "").trim().slice(0, 600);
  if (!snippet) return base;
  return `${base} ${snippet}`;
}

// ─── Download audio ────────────────────────────────────────────────────────────

async function downloadAudioToTemp(audiourl) {
  let sourceUrl = audiourl;
  const driveId = extractDriveId(audiourl);
  if (driveId) sourceUrl = await resolveDriveUrl(driveId);

  const tmpFile = path.join(os.tmpdir(), `lyricgen_${Date.now()}.mp3`);
  const response = await axios({
    method: "GET",
    url: sourceUrl,
    responseType: "stream",
    headers: { "User-Agent": "Mozilla/5.0" },
    maxRedirects: 5,
    timeout: 120000,
  });

  const writer = fs.createWriteStream(tmpFile);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const stats = fs.statSync(tmpFile);
  if (stats.size > 25 * 1024 * 1024) {
    fs.unlinkSync(tmpFile);
    throw new Error(`Audio file too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Groq limit is 25 MB.`);
  }
  if (stats.size < 1000) {
    fs.unlinkSync(tmpFile);
    throw new Error("Downloaded file too small — check the audio URL.");
  }
  return tmpFile;
}

// ─── Whisper call wrapper ──────────────────────────────────────────────────────

async function callWhisper(filePath, { language, prompt }) {
  const params = {
    file: fs.createReadStream(filePath),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    temperature: 0.0,
  };
  if (language) params.language = language;
  if (prompt) params.prompt = prompt;
  return groq.audio.transcriptions.create(params);
}

// Build cleaned text snippet from filtered words (used as Pass-2 prompt anchor)
function buildCleanedTextFromWords(words) {
  if (!words.length) return "";
  // Group into ~5-word chunks separated by gaps for natural-feeling text
  const out = [];
  let current = [];
  for (let i = 0; i < words.length; i++) {
    current.push(words[i].word);
    const next = words[i + 1];
    if (!next || next.start - words[i].end > 1.0 || current.length >= 7) {
      out.push(current.join(" "));
      current = [];
    }
  }
  return out.join(" ").trim();
}

// ─── Main endpoint ─────────────────────────────────────────────────────────────

exports.generateLyrics = async (req, res) => {
  const { songId, language, lyrics: userLyrics } = req.body;
  if (!songId) return res.status(400).json({ error: "songId is required" });

  let tmpFile = null;
  let vocalsTmpFile = null;
  const steps = [];

  try {
    // 1. Fetch song with metadata for prompt context
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.audiourl, s.duration_seconds, a.name AS artist_name
       FROM songs s
       LEFT JOIN artists a ON s.artist_id = a.id
       WHERE s.id = $1`,
      [songId]
    );
    if (!rows.length) return res.status(404).json({ error: "Song not found" });

    const song = rows[0];
    if (!song.audiourl) return res.status(400).json({ error: "Song has no audio URL" });

    const totalDuration = song.duration_seconds || null;
    console.log(`[LyricGen] "${song.title}" by ${song.artist_name || "?"} (id=${songId})`);
    steps.push("Fetched song metadata");

    // 2. Download audio
    tmpFile = await downloadAudioToTemp(song.audiourl);
    console.log(`[LyricGen] Downloaded: ${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1)} MB`);
    steps.push("Audio downloaded");

    // 3. Demucs vocal isolation (optional)
    let fileForWhisper = tmpFile;
    let demucsUsed = false;
    try {
      await axios.get("http://127.0.0.1:8005/health", { timeout: 2000 });
      console.log(`[LyricGen] Demucs online — isolating vocals...`);
      steps.push("Isolating vocals with Demucs");

      const formData = new FormData();
      formData.append("audio_file", fs.createReadStream(tmpFile));
      const demucsRes = await axios.post("http://127.0.0.1:8005/isolate-vocals", formData, {
        headers: formData.getHeaders(),
        responseType: "stream",
        timeout: 300000,
      });

      vocalsTmpFile = path.join(os.tmpdir(), `vocals_${Date.now()}.mp3`);
      const writer = fs.createWriteStream(vocalsTmpFile);
      demucsRes.data.pipe(writer);
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log(`[LyricGen] Demucs done — using isolated vocals`);
      steps.push("Vocal isolation complete");
      fileForWhisper = vocalsTmpFile;
      demucsUsed = true;
    } catch {
      console.log(`[LyricGen] Demucs offline — using original audio (stricter filters active)`);
      steps.push("Demucs offline — using raw audio");
    }

    // 4. Build initial prompt with song metadata
    const rawLang = (language || "").trim();
    const whisperLang = rawLang.includes("-") ? rawLang.split("-")[0] : rawLang;
    const initialPrompt = buildContextPrompt(rawLang, song.title, song.artist_name);

    console.log(`[LyricGen] Pass 1 — lang=${whisperLang || "auto"}, demucs=${demucsUsed}`);
    steps.push(`Pass 1 transcription (lang: ${whisperLang || "auto"})`);

    // 5. PASS 1
    let transcription = await callWhisper(fileForWhisper, {
      language: whisperLang,
      prompt: initialPrompt,
    });
    let detectedLang = normalizeLang(transcription.language) || whisperLang || "";
    console.log(
      `[LyricGen] Pass 1 done — detected: ${detectedLang}, segments: ${(transcription.segments || []).length}, words: ${(transcription.words || []).length}`
    );

    // 6. Filter Pass 1 results
    const userChosePureLang = whisperLang && !rawLang.includes("-en");
    let isCodeMixed =
      rawLang.includes("-en") ||
      (!userChosePureLang && NON_LATIN_LANGS.has(detectedLang) && detectCodeMixed(transcription.segments || []));

    if (isCodeMixed) console.log(`[LyricGen] Code-mixed (${detectedLang}+en) — relaxing script filter`);
    else if (userChosePureLang) console.log(`[LyricGen] Strict ${whisperLang} mode active`);

    let cleanedSegments = filterHallucinatedSegments(transcription.segments || [], detectedLang, isCodeMixed);
    let { words: filteredWords, regions } = filterWords(transcription.words || [], {
      detectedLang,
      isCodeMixed,
      demucsUsed,
      totalDuration,
    });

    let quality = scoreTranscriptionQuality(transcription, filteredWords, transcription.segments || [], cleanedSegments);
    console.log(
      `[LyricGen] Pass 1 quality score: ${quality.toFixed(2)} ` +
      `(words: ${filteredWords.length}/${(transcription.words || []).length}, ` +
      `segments: ${cleanedSegments.length}/${(transcription.segments || []).length}, ` +
      `regions: ${regions.length})`
    );

    // 7. PASS 2 (conditional — only if quality is poor)
    const qualityThreshold = demucsUsed
      ? CONFIG.PASS2_MIN_CONFIDENCE_FOR_DEMUCS
      : CONFIG.PASS2_MIN_CONFIDENCE_NO_DEMUCS;
    const wordDropRatio = 1 - filteredWords.length / Math.max((transcription.words || []).length, 1);
    const shouldRunPass2 =
      filteredWords.length > 5 && // need something to anchor the prompt
      (quality < qualityThreshold || wordDropRatio > CONFIG.PASS2_MAX_FILTER_DROP_RATIO);

    if (shouldRunPass2) {
      const cleanedText = buildCleanedTextFromWords(filteredWords);
      console.log(`[LyricGen] Pass 2 triggered (quality ${quality.toFixed(2)} < ${qualityThreshold}) — refining with anchored prompt`);
      steps.push(`Pass 2 refinement (quality was ${(quality * 100).toFixed(0)}%)`);

      try {
        const refinementPrompt = buildRefinementPrompt(rawLang, song.title, cleanedText);
        const transcription2 = await callWhisper(fileForWhisper, {
          language: whisperLang,
          prompt: refinementPrompt,
        });

        const detectedLang2 = normalizeLang(transcription2.language) || whisperLang || "";
        const cleanedSegments2 = filterHallucinatedSegments(transcription2.segments || [], detectedLang2, isCodeMixed);
        const { words: filteredWords2, regions: regions2 } = filterWords(transcription2.words || [], {
          detectedLang: detectedLang2,
          isCodeMixed,
          demucsUsed,
          totalDuration,
        });
        const quality2 = scoreTranscriptionQuality(
          transcription2,
          filteredWords2,
          transcription2.segments || [],
          cleanedSegments2
        );

        console.log(`[LyricGen] Pass 2 quality: ${quality2.toFixed(2)} (was ${quality.toFixed(2)})`);

        // Adopt Pass 2 only if it's actually better
        if (quality2 > quality) {
          transcription = transcription2;
          detectedLang = detectedLang2;
          cleanedSegments = cleanedSegments2;
          filteredWords = filteredWords2;
          regions = regions2;
          quality = quality2;
          steps.push(`Pass 2 improved quality to ${(quality2 * 100).toFixed(0)}%`);
        } else {
          console.log(`[LyricGen] Pass 2 not better — keeping Pass 1`);
          steps.push(`Pass 2 didn't improve — kept Pass 1`);
        }
      } catch (err) {
        console.warn(`[LyricGen] Pass 2 failed: ${err.message} — keeping Pass 1`);
      }
    }

    if (filteredWords.length === 0 && cleanedSegments.length === 0) {
      return res.status(422).json({
        error: "No usable audio detected. The track may be instrumental, too quiet, or distorted.",
      });
    }

    console.log(`[LyricGen] Final words: ${filteredWords.length}, vocal regions: ${regions.length}`);
    steps.push(`Final word list: ${filteredWords.length} words across ${regions.length} regions`);

    // 8. Compute dynamic line limits
    const lineLimits = computeLineLimits(cleanedSegments, filteredWords);
    console.log(`[LyricGen] Line limits — max: ${lineLimits.MAX_LINE_WORDS}, min: ${lineLimits.MIN_LINE_WORDS}`);

    // 9. Build LRC
    let resultLrc;
    let unmatched = 0;

    if (userLyrics && userLyrics.trim()) {
      steps.push("Aligning provided lyrics");

      const MUSIC_MARKER_RE =
        /^\(?\s*(instrumental\s*(?:music)?|music|intro|outro|bridge|interlude|prelude)\s*\)?$/i;

      const lyricLines = userLyrics
        .split("\n")
        .map((l) => l.replace(/^\[.*?\]\s*/, "").trim())
        .filter(Boolean)
        .map((l) => {
          if (MUSIC_MARKER_RE.test(l)) return "__MUSIC__";
          const stripped = l.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim();
          if (!stripped) return "__SKIP__";
          return l;
        })
        .filter((l) => l !== "__SKIP__");

      const matchLines = lyricLines.map((l) => {
        if (l === "__MUSIC__") return "__MUSIC__";
        return l.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").trim() || l;
      });

      const matched = matchLyricsToWords(
        matchLines.filter((l) => l !== "__MUSIC__"),
        filteredWords
      );

      const mergedMatches = [];
      let matchIdx = 0;
      for (let i = 0; i < lyricLines.length; i++) {
        if (lyricLines[i] === "__MUSIC__") {
          mergedMatches.push({ line: "__MUSIC__", ts: null });
        } else {
          mergedMatches.push({
            line: lyricLines[i],
            ts: matched[matchIdx]?.ts ?? null,
          });
          matchIdx++;
        }
      }

      const lrcLines = [];
      let lastTs = null;
      for (const { line, ts } of mergedMatches) {
        if (line === "__MUSIC__") {
          lrcLines.push(`${formatTimestamp(lastTs != null ? lastTs + 0.5 : 0)} ♪ Music ♪`);
          continue;
        }
        if (ts !== null) {
          if (lastTs !== null && ts - lastTs > CONFIG.MUSIC_GAP_THRESHOLD) {
            lrcLines.push(`${formatTimestamp(lastTs + 0.5)} ♪ Music ♪`);
          }
          lastTs = ts;
          lrcLines.push(`${formatTimestamp(ts)} ${line}`);
        } else {
          unmatched++;
          if (lastTs !== null) lrcLines.push(`${formatTimestamp(lastTs)} ${line}`);
        }
      }
      resultLrc = lrcLines.join("\n");
    } else {
      steps.push("Building LRC from transcription");
      if (filteredWords.length > 0) {
        resultLrc = buildSmartLrc(filteredWords, totalDuration, lineLimits);
      } else if (cleanedSegments.length > 0) {
        resultLrc = buildLrcFromSegments(cleanedSegments, totalDuration);
      } else {
        resultLrc = "[00:00.00] ♪ Music ♪";
      }
    }

    const lineCount = resultLrc.split("\n").length;
    console.log(`[LyricGen] ✅ Done — ${lineCount} lines, quality ${quality.toFixed(2)}, ${unmatched} unmatched`);

    res.json({
      lrc: resultLrc,
      language: detectedLang || "auto",
      isCodeMixed,
      demucsUsed,
      quality: Number(quality.toFixed(2)),
      passes: shouldRunPass2 ? 2 : 1,
      vocalRegions: regions.length,
      rawText: transcription.text || "",
      wordCount: filteredWords.length,
      segmentCount: cleanedSegments.length,
      filteredSegments: (transcription.segments || []).length - cleanedSegments.length,
      lineLimits,
      unmatched,
      steps,
    });
  } catch (error) {
    console.error("[LyricGen] Error:", error.message);
    if (error.message?.includes("API key")) {
      return res.status(401).json({ error: "Invalid or missing Groq API key. Set GROQ_API_KEY in .env" });
    }
    res.status(500).json({ error: `Transcription failed: ${error.message}` });
  } finally {
    if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    if (vocalsTmpFile) try { fs.unlinkSync(vocalsTmpFile); } catch {}
  }
};
