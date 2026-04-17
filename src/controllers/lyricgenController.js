/**
 * Lyrics Generator Controller — Groq + Whisper-large-v3 (v2.0)
 *
 * ─── Improvements over v1 ────────────────────────────────────────────
 * 1. Smart gap detection — instrumental gaps > 3s get "♪ Music ♪" markers
 * 2. Intelligent line grouping — splits on natural pauses & punctuation,
 *    not fixed word counts
 * 3. Hallucination filter — removes repeated/looping segments that
 *    Whisper hallucinates on music
 * 4. Whisper artifact cleanup — strips [Music], (applause), etc.
 * 5. Better LRC formatting — proper centisecond timestamps
 * 6. Compression ratio check — detects and flags bad transcriptions
 */

const Groq = require("groq-sdk");
const pool = require("../models/User");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const FormData = require("form-data");

require("dotenv").config();

// ─── Groq client ──────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  MUSIC_GAP_THRESHOLD: 3.0,     // seconds — gaps longer than this → "♪ Music ♪"
  INTRO_THRESHOLD: 2.0,         // seconds — if first vocal starts after this → intro music
  OUTRO_THRESHOLD: 5.0,         // seconds — gap at end → outro music
  MAX_LINE_WORDS: 4,           // max words per lyric line
  MIN_LINE_WORDS: 2,            // avoid single-word lines unless forced
  PAUSE_THRESHOLD: 0.8,         // seconds — word gap that suggests line break
  SENTENCE_PAUSE: 1.2,          // seconds — strong pause = definite line break
  HALLUCINATION_RATIO: 0.75,    // similarity threshold to detect repeated segments
  MIN_SEGMENT_CONFIDENCE: 0.15, // avg_logprob threshold for garbage segments
};

// ─── Drive helpers ────────────────────────────────────────────────────────────
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

// ─── Text helpers ─────────────────────────────────────────────────────────────

const TAG_RE = /[\(\[].*?[\)\]]/g;
const PUNCT_RE = /[^\w\s]/g;

// Whisper hallucination patterns — these get produced on instrumental/silent sections
const WHISPER_ARTIFACTS = [
  /^\[.*?\]$/,                          // [Music], [Applause], [Laughter]
  /^\(.*?\)$/,                          // (Music), (instrumental)
  /^♪+$/,                               // Just music symbols
  /^(music|instrumental|applause|laughter|silence|background noise)$/i,
  /^(thank you|thanks for watching|subscribe|like and subscribe)\.?$/i,
  /^\.+$/,                              // Just dots (hallucination)
  /^(\w{1,3}\s?){20,}$/,               // Repeated short syllables (hallucination loop)
];

function isWhisperArtifact(text) {
  const trimmed = text.trim();
  return WHISPER_ARTIFACTS.some((re) => re.test(trimmed));
}

function cleanSegmentText(text) {
  if (!text) return "";
  // Remove Whisper's own bracketed annotations
  let cleaned = text.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "");
  // Remove leading/trailing music symbols
  cleaned = cleaned.replace(/^[♪♫🎵🎶\s]+|[♪♫🎵🎶\s]+$/g, "");
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

function normalizeText(text) {
  if (!text) return "";
  text = text.toLowerCase();
  text = text.replace(TAG_RE, "");
  text = text.replace(PUNCT_RE, "");
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Dice coefficient similarity — fast bigram approach.
 */
function getSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bg = s1.substring(i, i + 2);
    bigrams1.set(bg, (bigrams1.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bg = s2.substring(i, i + 2);
    const count = bigrams1.get(bg) || 0;
    if (count > 0) {
      bigrams1.set(bg, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (s1.length + s2.length - 2);
}

function formatTimestamp(ts) {
  const minutes = Math.floor(ts / 60);
  const seconds = ts % 60;
  return `[${String(minutes).padStart(2, "0")}:${seconds
    .toFixed(2)
    .padStart(5, "0")}]`;
}

// ─── Hallucination detection ──────────────────────────────────────────────────

/**
 * Detect and remove hallucinated/looping segments.
 * Whisper commonly hallucinates on instrumental sections by repeating
 * the same phrase or producing nonsense with high compression ratios.
 */
function filterHallucinatedSegments(segments) {
  if (segments.length < 2) return segments;

  const filtered = [];
  let lastText = "";
  let repeatCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = cleanSegmentText(seg.text || "");

    // Skip empty segments
    if (!text) continue;

    // Skip Whisper artifacts
    if (isWhisperArtifact(text)) {
      console.log(`[LyricGen] Filtered artifact: "${text}"`);
      continue;
    }

    // Check for exact or near-exact repetition
    const similarity = getSimilarity(
      normalizeText(text),
      normalizeText(lastText)
    );

    if (similarity > CONFIG.HALLUCINATION_RATIO && lastText.length > 5) {
      repeatCount++;
      if (repeatCount >= 2) {
        console.log(`[LyricGen] Filtered hallucinated repeat (${repeatCount}x): "${text}"`);
        continue; // Skip after 2+ consecutive repeats
      }
    } else {
      repeatCount = 0;
    }

    // Check for abnormal compression ratio (hallucination indicator)
    if (seg.compression_ratio && seg.compression_ratio > 2.8) {
      console.log(`[LyricGen] Suspicious compression ratio (${seg.compression_ratio.toFixed(1)}): "${text}"`);
      // Don't skip entirely — just flag it, as high ratio can be valid for choruses
    }

    // Check for very low confidence
    if (seg.avg_logprob && seg.avg_logprob < -1.5) {
      console.log(`[LyricGen] Low confidence segment (logprob=${seg.avg_logprob.toFixed(2)}): "${text}"`);
      // Skip extremely low confidence
      if (seg.avg_logprob < -2.5) continue;
    }

    filtered.push({ ...seg, text: text });
    lastText = text;
  }

  return filtered;
}

// ─── Smart line builder from words ────────────────────────────────────────────

/**
 * Build natural lyric lines from word timestamps.
 * Groups words based on:
 *   - Natural pauses between words (> PAUSE_THRESHOLD)
 *   - Sentence-ending punctuation (., !, ?)
 *   - Maximum line length (MAX_LINE_WORDS)
 *   - Instrumental gaps (> MUSIC_GAP_THRESHOLD → "♪ Music ♪")
 */
function buildSmartLrc(words, totalDuration) {
  if (!words || words.length === 0) return "";

  const lines = [];
  let currentLine = [];
  let lineStart = null;

  // Check for intro music (silence before first word)
  if (words[0].start > CONFIG.INTRO_THRESHOLD) {
    lines.push(`${formatTimestamp(0)} ♪ Music ♪`);
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wordText = cleanWordText(w.word);
    if (!wordText) continue;

    const nextWord = i + 1 < words.length ? words[i + 1] : null;

    // Start new line if needed
    if (currentLine.length === 0) {
      lineStart = w.start;
    }

    currentLine.push(wordText);

    // Determine if we should break the line here
    let shouldBreak = false;
    let isGap = false;

    if (!nextWord) {
      // Last word — flush
      shouldBreak = true;
    } else {
      const gap = nextWord.start - w.end;

      // Large gap → instrumental section
      if (gap > CONFIG.MUSIC_GAP_THRESHOLD) {
        shouldBreak = true;
        isGap = true;
      }
      // Sentence-ending punctuation + pause
      else if (
        /[.!?।。？！]$/.test(wordText) &&
        gap > CONFIG.PAUSE_THRESHOLD * 0.5
      ) {
        shouldBreak = true;
      }
      // Strong pause (natural breath/phrasing)
      else if (gap > CONFIG.SENTENCE_PAUSE) {
        shouldBreak = true;
      }
      // Medium pause + line already has enough words
      else if (gap > CONFIG.PAUSE_THRESHOLD && currentLine.length >= CONFIG.MIN_LINE_WORDS) {
        shouldBreak = true;
      }
      // Line too long — force break
      else if (currentLine.length >= CONFIG.MAX_LINE_WORDS) {
        shouldBreak = true;
      }
      // Comma with a pause → good break point
      else if (/,$/.test(wordText) && gap > 0.3 && currentLine.length >= 3) {
        shouldBreak = true;
      }
    }

    if (shouldBreak && currentLine.length > 0) {
      const lineText = currentLine.join(" ");
      // Only add non-empty, non-artifact lines
      if (lineText && !isWhisperArtifact(lineText)) {
        lines.push(`${formatTimestamp(lineStart)} ${lineText}`);
      }

      // Add music marker for gaps
      if (isGap && nextWord) {
        const musicStart = w.end;
        lines.push(`${formatTimestamp(musicStart)} ♪ Music ♪`);
      }

      currentLine = [];
      lineStart = null;
    }
  }

  // Flush remaining words
  if (currentLine.length > 0 && lineStart !== null) {
    const lineText = currentLine.join(" ");
    if (lineText && !isWhisperArtifact(lineText)) {
      lines.push(`${formatTimestamp(lineStart)} ${lineText}`);
    }
  }

  // Check for outro music
  if (words.length > 0 && totalDuration) {
    const lastWordEnd = words[words.length - 1].end;
    if (totalDuration - lastWordEnd > CONFIG.OUTRO_THRESHOLD) {
      lines.push(`${formatTimestamp(lastWordEnd)} ♪ Music ♪`);
    }
  }

  return lines.join("\n");
}

/**
 * Build LRC from segments (with gap detection).
 * Used when word-level timestamps aren't available.
 */
function buildLrcFromSegments(segments, totalDuration) {
  if (!segments || segments.length === 0) return "";

  const lines = [];

  // Intro music check
  if (segments[0].start > CONFIG.INTRO_THRESHOLD) {
    lines.push(`${formatTimestamp(0)} ♪ Music ♪`);
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = cleanSegmentText(seg.text || "");
    if (!text || isWhisperArtifact(text)) continue;

    lines.push(`${formatTimestamp(seg.start)} ${text}`);

    // Check gap to next segment
    const nextSeg = i + 1 < segments.length ? segments[i + 1] : null;
    if (nextSeg) {
      const gap = nextSeg.start - seg.end;
      if (gap > CONFIG.MUSIC_GAP_THRESHOLD) {
        lines.push(`${formatTimestamp(seg.end)} ♪ Music ♪`);
      }
    }
  }

  // Outro check
  if (segments.length > 0 && totalDuration) {
    const lastEnd = segments[segments.length - 1].end;
    if (totalDuration - lastEnd > CONFIG.OUTRO_THRESHOLD) {
      lines.push(`${formatTimestamp(lastEnd)} ♪ Music ♪`);
    }
  }

  return lines.join("\n");
}

function cleanWordText(word) {
  if (!word) return "";
  // Trim whitespace
  let text = word.trim();
  // Remove surrounding brackets/parens that Whisper adds
  text = text.replace(/^\[|\]$/g, "").replace(/^\(|\)$/g, "");
  return text;
}

// ─── Lyric alignment (ported from lyric-sync Python) ──────────────────────────

function matchLyricsToWords(
  lyricsLines,
  wordTimestamps,
  { searchWindow = 50, matchThreshold = 0.55, strongMatch = 0.85 } = {}
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

    // Wider search window for better matching
    const upper = Math.min(currentWordIdx + searchWindow, totalWords);
    for (let i = currentWordIdx; i < upper; i++) {
      // Try matching with slight variations in word count
      for (let lenVar = 0; lenVar <= 2; lenVar++) {
        const tryLen = lineLen + lenVar;
        const candidateWords = wordTimestamps
          .slice(i, i + tryLen)
          .map((w) => w.word);
        const candidateText = normalizeText(candidateWords.join(" "));
        const score = getSimilarity(normLine, candidateText);

        if (score > bestScore && score >= matchThreshold) {
          bestScore = score;
          bestTs = wordTimestamps[i].start;
          bestEndIdx = Math.min(i + tryLen, totalWords);
          if (score >= strongMatch) break;
        }
      }
      if (bestScore >= strongMatch) break;
    }

    if (bestTs !== null) {
      if (bestScore >= strongMatch) {
        currentWordIdx = bestEndIdx;
      } else {
        currentWordIdx = Math.min(
          currentWordIdx + Math.max(1, Math.floor(lineLen / 2)),
          totalWords
        );
      }
    }

    matched.push({ line, ts: bestTs });
  }

  return matched;
}

// ─── Initial prompt builder ───────────────────────────────────────────────────

const INITIAL_PROMPTS = {
  ta: "பாடல் வரிகள். Song lyrics. Naan unnai love pannren.",
  hi: "गाने के बोल. Song lyrics. Main tujhse pyaar karta hoon.",
  te: "పాట సాహిత్యం. Song lyrics. Nenu ninnu premistunnanu.",
  ml: "പാട്ടിന്റെ വരികൾ. Song lyrics. Njan ninne sthehikkunu.",
  kn: "ಹಾಡಿನ ಸಾಹಿತ್ಯ. Song lyrics. Nanu ninna preetisuttene.",
  bn: "গানের কথা. Song lyrics. Ami tomake bhalobashi.",
  ko: "노래 가사. Song lyrics. Nae maeum sok gipeun gose.",
  ja: "歌詞。Song lyrics. Kimi no koto ga suki da yo.",
  zh: "歌词。Song lyrics. Wo ai ni.",
  es: "Letra de la canción. Song lyrics. Te quiero mucho.",
  pt: "Letra da música. Song lyrics. Eu te amo.",
  fr: "Paroles de la chanson. Song lyrics. Je t'aime.",
  de: "Liedtext. Song lyrics. Ich liebe dich.",
  ar: "كلمات الأغنية. Song lyrics. Ana bahibbak.",
  tr: "Şarkı sözleri. Song lyrics. Seni seviyorum.",
  ru: "Слова песни. Song lyrics. Ya tebya lyublyu.",
};

function buildInitialPrompt(language) {
  return INITIAL_PROMPTS[language] || "Song lyrics.";
}

// ─── Download audio to temp file ──────────────────────────────────────────────

async function downloadAudioToTemp(audiourl) {
  let sourceUrl = audiourl;

  const driveId = extractDriveId(audiourl);
  if (driveId) {
    sourceUrl = await resolveDriveUrl(driveId);
  }

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `lyricgen_${Date.now()}.mp3`);

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
    throw new Error(
      `Audio file too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Groq API limit is 25 MB.`
    );
  }

  if (stats.size < 1000) {
    fs.unlinkSync(tmpFile);
    throw new Error(
      "Downloaded file is too small — audio may not be accessible. Check the audio URL."
    );
  }

  return tmpFile;
}

// ─── Main endpoint ────────────────────────────────────────────────────────────

exports.generateLyrics = async (req, res) => {
  const { songId, language, lyrics } = req.body;

  if (!songId)
    return res.status(400).json({ error: "songId is required" });

  let tmpFile = null;
  let vocalsTmpFile = null;

  try {
    // 1. Fetch song from DB
    const { rows } = await pool.query(
      "SELECT id, title, audiourl, duration_seconds FROM songs WHERE id = $1",
      [songId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Song not found" });

    const song = rows[0];
    if (!song.audiourl)
      return res.status(400).json({ error: "Song has no audio URL" });

    const totalDuration = song.duration_seconds || null;

    console.log(
      `[LyricGen] Starting transcription for "${song.title}" (id=${songId}, duration=${totalDuration || '?'}s)`
    );

    // 2. Download audio to temp file
    tmpFile = await downloadAudioToTemp(song.audiourl);
    const fileSize = fs.statSync(tmpFile).size;
    console.log(`[LyricGen] Downloaded audio: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    // 2.5 Try to isolate vocals using Demucs Microservice
    let fileForWhisper = tmpFile;
    try {
      console.log(`[LyricGen] Checking Demucs API health...`);
      await axios.get("http://127.0.0.1:8005/health", { timeout: 2000 });
      console.log(`[LyricGen] Demucs Online. Uploading file for vocal isolation...`);
      
      const formData = new FormData();
      formData.append("audio_file", fs.createReadStream(tmpFile));
      
      const demucsRes = await axios.post("http://127.0.0.1:8005/isolate-vocals", formData, {
        headers: formData.getHeaders(),
        responseType: "stream",
        timeout: 300000 // 5-minute timeout for isolation
      });
      
      vocalsTmpFile = path.join(os.tmpdir(), `vocals_${Date.now()}.mp3`);
      const writer = fs.createWriteStream(vocalsTmpFile);
      demucsRes.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      
      console.log(`[LyricGen] Demucs isolation complete. Using vocals.mp3 for transcription.`);
      fileForWhisper = vocalsTmpFile;
    } catch (err) {
      console.log(`[LyricGen] Demucs offline or failed (${err.message}). Falling back to original audio.`);
    }

    // 3. Call Groq Whisper API
    const transcriptionParams = {
      file: fs.createReadStream(fileForWhisper),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      temperature: 0.0,
    };

    if (language && language.trim()) {
      transcriptionParams.language = language.trim();
      transcriptionParams.prompt = buildInitialPrompt(language.trim());
    } else {
      transcriptionParams.prompt = "Song lyrics.";
    }

    console.log(`[LyricGen] Calling Groq API (whisper-large-v3)...`);
    const transcription =
      await groq.audio.transcriptions.create(transcriptionParams);

    console.log(
      `[LyricGen] Transcription complete — language: ${transcription.language}, ` +
      `segments: ${(transcription.segments || []).length}, ` +
      `words: ${(transcription.words || []).length}`
    );

    // 4. Filter hallucinated segments
    const rawSegments = transcription.segments || [];
    const cleanedSegments = filterHallucinatedSegments(rawSegments);
    console.log(
      `[LyricGen] Segments after filtering: ${cleanedSegments.length}/${rawSegments.length}`
    );

    // 5. Extract word timestamps (cleaned)
    const rawWords = transcription.words || [];
    const wordTimestamps = rawWords
      .map((w) => ({
        word: cleanWordText(w.word),
        start: w.start,
        end: w.end,
      }))
      .filter((w) => w.word && !isWhisperArtifact(w.word));

    if (wordTimestamps.length === 0 && cleanedSegments.length === 0) {
      return res.status(422).json({
        error:
          "Whisper returned no usable words. The audio may be instrumental, too quiet, or distorted.",
      });
    }

    console.log(`[LyricGen] Usable words: ${wordTimestamps.length}`);

    // 6. Build LRC
    let resultLrc;
    let unmatched = 0;

    if (lyrics && lyrics.trim()) {
      // ── User provided lyrics → align them ──
      const lyricLines = lyrics
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const matched = matchLyricsToWords(lyricLines, wordTimestamps);

      const lrcLines = [];
      let lastTs = null;
      for (const { line, ts } of matched) {
        if (ts !== null) {
          // Check for gap since last timestamp → insert music marker
          if (lastTs !== null && ts - lastTs > CONFIG.MUSIC_GAP_THRESHOLD) {
            lrcLines.push(`${formatTimestamp(lastTs + 0.5)} ♪ Music ♪`);
          }
          lastTs = ts;
          lrcLines.push(`${formatTimestamp(ts)} ${line}`);
        } else {
          unmatched++;
          const tag = lastTs !== null ? formatTimestamp(lastTs) : "[00:00.00]";
          lrcLines.push(`${tag} ${line}`);
        }
      }
      resultLrc = lrcLines.join("\n");
    } else {
      // ── No lyrics provided — auto-generate from transcription ──
      if (wordTimestamps.length > 0) {
        // Prefer word-level timestamps for precise alignment
        resultLrc = buildSmartLrc(wordTimestamps, totalDuration);
      } else if (cleanedSegments.length > 0) {
        // Fallback to segment-level
        resultLrc = buildLrcFromSegments(cleanedSegments, totalDuration);
      } else {
        resultLrc = "[00:00.00] ♪ Music ♪";
      }
    }

    const lineCount = resultLrc.split("\n").length;
    console.log(`[LyricGen] ✅ LRC built — ${lineCount} lines, ${unmatched} unmatched`);

    res.json({
      lrc: resultLrc,
      language: transcription.language || "auto",
      rawText: transcription.text || "",
      wordCount: wordTimestamps.length,
      segmentCount: cleanedSegments.length,
      filteredSegments: rawSegments.length - cleanedSegments.length,
      unmatched,
    });
  } catch (error) {
    console.error("[LyricGen] Error:", error.message);

    if (error.message.includes("API key")) {
      return res.status(401).json({
        error:
          "Invalid or missing Groq API key. Set GROQ_API_KEY in your .env file.",
      });
    }

    res.status(500).json({
      error: `Transcription failed: ${error.message}`,
    });
  } finally {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    if (vocalsTmpFile) {
      try { fs.unlinkSync(vocalsTmpFile); } catch {}
    }
  }
};
