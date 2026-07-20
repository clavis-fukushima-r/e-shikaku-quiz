"use strict";

/* =========================================================
   状態
   ========================================================= */
const state = {
  allQuestions: [],
  chapters: [],
  quiz: null,
};

const HISTORY_KEY = "eShikaku_history_v1";
const BEST_KEY = "eShikaku_best_v1";
const SAVE_KEY = "eShikaku_save_v1";

/* 選択肢解説で「表示を省略する」ことを表すマーカー */
const EXPLANATION_OMITTED = "省略";

/* ランダム演習の出題対象（修了試験A-1〜B-4） */
const HUNDRED_CHAPTER_RE = /^修了試験[AB]-[1-4]$/;
const HUNDRED_RANGE_LABEL = "修了試験A-1〜B-4";
const HUNDRED_MIN_PER_CHAPTER = 10; // ランダム演習で各章から最低出題する問題数（出題数が少ない場合は自動調整）
const DEFAULT_RANDOM_COUNT = 100;

/* 前問を参照している問題の判定（この問題は直前の問題とセットで出題する） */
const CONT_RE = /前問|前の設問|前設問|上の設問|前の問題/;

/* 模擬試験100問の章別配分（出題傾向を加味。合計100。ここを編集すれば配分を変更できる） */
const MOCK_PLAN = {
  "修了試験A-1": 8,             // 応用数学・機械学習基礎
  "修了試験A-2": 10,            // 深層学習基礎（順伝播・逆伝播・最適化）
  "修了試験A-3": 8,             // 正則化・CNN基礎
  "修了試験A-4": 8,             // RNN・自然言語処理
  "修了試験B-1": 8,             // 画像認識
  "修了試験B-2": 6,             // 生成モデル・応用
  "修了試験B-3": 5,             // 強化学習ほか
  "修了試験B-4": 5,             // 開発・運用環境
  "E資格例題2024": 20,          // 最新の例題を厚めに
  "E資格例題2021": 8,
  "E資格例題2021(PyTorch)": 3,
  "E資格例題2020": 5,
  "E資格例題2018": 6,
};
const MOCK_RANGE_LABEL = "模擬試験（全章・傾向配分）";

function getHundredPool() {
  return state.allQuestions.filter(q => HUNDRED_CHAPTER_RE.test(q.chapter));
}

/* 読み込んだ問題に「前問参照グループ」のIDを振る（CSVの並び順で判定） */
function assignGroupIds(questions) {
  let gid = -1;
  questions.forEach((q, i) => {
    const prev = questions[i - 1];
    const isCont = i > 0 && prev.chapter === q.chapter && CONT_RE.test(q.question);
    if (!isCont) gid += 1;
    q.groupId = gid;
  });
}

/* 問題配列を前問参照グループの配列（各要素はCSV順の問題配列）に変換 */
function toGroups(pool) {
  const map = new Map();
  pool.forEach(q => {
    if (!map.has(q.groupId)) map.set(q.groupId, []);
    map.get(q.groupId).push(q);
  });
  return [...map.values()];
}

/**
 * グループ単位で target 問に達するまで抽選する。
 * 残り枠に収まるグループを優先し、無ければ最小のグループで最小限だけ超過する。
 * usedGroupIds に選択済みグループを記録し、重複選択を防ぐ。
 */
function drawGroups(groups, target, usedGroupIds, out) {
  let count = 0;
  const candidates = shuffle(groups.filter(g => !usedGroupIds.has(g[0].groupId)));
  while (count < target && candidates.length > 0) {
    const remain = target - count;
    let idx = candidates.findIndex(g => g.length <= remain);
    if (idx === -1) {
      // 残り枠に収まるグループが無い場合は、超過が最小になるグループを選ぶ
      idx = candidates.reduce((best, g, i) =>
        g.length < candidates[best].length ? i : best, 0);
    }
    const g = candidates.splice(idx, 1)[0];
    usedGroupIds.add(g[0].groupId);
    out.push(g);
    count += g.length;
  }
  return count;
}

/* ランダム演習：各章から均等に出題し、残りを全体から補充（前問参照はセットで出題） */
function buildHundredSet(target) {
  const total_target = Math.max(1, target || DEFAULT_RANDOM_COUNT);
  const pool = getHundredPool();
  const used = new Set();
  const selected = [];
  let total = 0;
  const chapters = [...new Set(pool.map(q => q.chapter))];
  // 出題数が少ない場合は各章の最低出題数を自動で縮小する
  const minPerChapter = Math.min(
    HUNDRED_MIN_PER_CHAPTER,
    Math.floor(total_target / Math.max(1, chapters.length))
  );
  if (minPerChapter > 0) {
    chapters.forEach(ch => {
      const groups = toGroups(pool.filter(q => q.chapter === ch));
      total += drawGroups(groups, minPerChapter, used, selected);
    });
  }
  if (total < total_target) {
    drawGroups(toGroups(pool), total_target - total, used, selected);
  }
  return shuffle(selected).flat();
}

/* 模擬試験100問：MOCK_PLANの章別配分で抽選し、不足分は全章から補充 */
function buildMockSet() {
  const used = new Set();
  const selected = [];
  let total = 0;
  Object.entries(MOCK_PLAN).forEach(([ch, quota]) => {
    const chPool = state.allQuestions.filter(q => q.chapter === ch);
    if (chPool.length === 0) return; // CSVに存在しない章はスキップ（後で補充される）
    total += drawGroups(toGroups(chPool), Math.min(quota, chPool.length), used, selected);
  });
  if (total < 100) {
    drawGroups(toGroups(state.allQuestions), 100 - total, used, selected);
  }
  return shuffle(selected).flat();
}

function modeLabelOf(mode) {
  if (mode === "hundred") return "ランダム演習";
  if (mode === "mock") return "模擬試験100問";
  return "1問1答";
}

/* CSVパーサ（parseCSV / questionsFromCSVText）は csv-lib.js で定義 */

/* =========================================================
   localStorage ヘルパー
   ========================================================= */
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveHistoryEntry(entry) {
  const h = getHistory();
  h.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
}
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
function getBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY)); }
  catch { return null; }
}
function saveBestIfHigher(entry) {
  const best = getBest();
  if (!best || entry.percent > best.percent) {
    localStorage.setItem(BEST_KEY, JSON.stringify(entry));
    return true;
  }
  return false;
}
function resetBest() {
  localStorage.removeItem(BEST_KEY);
}

/* ---- 途中セーブ ---- */
function getSavedQuiz() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s || !Array.isArray(s.questions) || s.questions.length === 0) return null;
    return s;
  } catch { return null; }
}
function saveQuizProgress() {
  const q = state.quiz;
  if (!q || q.finished) return;
  const data = {
    savedAt: new Date().toISOString(),
    questions: q.questions,
    mode: q.mode,
    rangeLabel: q.rangeLabel,
    timeMode: q.timeMode,
    timeLimitSec: q.timeLimitSec,
    remainingSec: q.remainingSec,
    elapsedSec: q.elapsedSec,
    index: q.index,
    records: q.records,
    randomCount: q.randomCount,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("途中経過の保存に失敗しました:", e);
  }
}
function clearSavedQuiz() {
  localStorage.removeItem(SAVE_KEY);
}
// タブを閉じる・アプリを切り替える際にも途中経過を保存（スマホ対策）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveQuizProgress();
});

/* =========================================================
   DOM参照
   ========================================================= */
const el = {
  csvFile: document.getElementById("csvFile"),
  csvStatus: document.getElementById("csvStatus"),
  toggleAdvancedBtn: document.getElementById("toggleAdvancedBtn"),
  advancedLoader: document.getElementById("advancedLoader"),
  setupCard: document.getElementById("setupCard"),
  modeCard: document.getElementById("modeCard"),
  timeCard: document.getElementById("timeCard"),
  startRow: document.getElementById("startRow"),
  rangeSelect: document.getElementById("rangeSelect"),
  rangeNote: document.getElementById("rangeNote"),
  resumeCard: document.getElementById("resumeCard"),
  resumeMeta: document.getElementById("resumeMeta"),
  resumeBtn: document.getElementById("resumeBtn"),
  discardSaveBtn: document.getElementById("discardSaveBtn"),
  exportSaveBtn: document.getElementById("exportSaveBtn"),
  importSaveBtn: document.getElementById("importSaveBtn"),
  importSaveFile: document.getElementById("importSaveFile"),
  randomCountInput: document.getElementById("randomCountInput"),
  timeLimitInput: document.getElementById("timeLimitInput"),
  startBtn: document.getElementById("startBtn"),
  historyBtn: document.getElementById("historyBtn"),

  screens: {
    home: document.getElementById("screen-home"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result"),
    history: document.getElementById("screen-history"),
  },

  quitBtn: document.getElementById("quitBtn"),
  progressLabel: document.getElementById("progressLabel"),
  dotTrack: document.getElementById("dotTrack"),
  timerLabel: document.getElementById("timerLabel"),
  pauseBtn: document.getElementById("pauseBtn"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  resumeQuizBtn: document.getElementById("resumeQuizBtn"),
  quizChapterTag: document.getElementById("quizChapterTag"),
  questionImageBox: document.getElementById("questionImageBox"),
  questionText: document.getElementById("questionText"),
  choiceList: document.getElementById("choiceList"),
  feedbackBox: document.getElementById("feedbackBox"),
  feedbackResult: document.getElementById("feedbackResult"),
  feedbackExplanation: document.getElementById("feedbackExplanation"),
  submitBtn: document.getElementById("submitBtn"),
  nextBtn: document.getElementById("nextBtn"),
  prevBtn: document.getElementById("prevBtn"),
  fwdBtn: document.getElementById("fwdBtn"),
  reviewingNote: document.getElementById("reviewingNote"),

  resultScoreBig: document.getElementById("resultScoreBig"),
  resultPercent: document.getElementById("resultPercent"),
  resultTime: document.getElementById("resultTime"),
  resultRange: document.getElementById("resultRange"),
  resultMode: document.getElementById("resultMode"),
  resultBestNote: document.getElementById("resultBestNote"),
  backHomeBtn: document.getElementById("backHomeBtn"),
  retryBtn: document.getElementById("retryBtn"),
  reviewList: document.getElementById("reviewList"),

  historyBackBtn: document.getElementById("historyBackBtn"),
  bestScoreBox: document.getElementById("bestScoreBox"),
  resetBestBtn: document.getElementById("resetBestBtn"),
  historyList: document.getElementById("historyList"),
  exportHistoryBtn: document.getElementById("exportHistoryBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
};

function showScreen(name) {
  Object.entries(el.screens).forEach(([key, node]) => {
    node.classList.toggle("active", key === name);
  });
  if (name === "home") renderResumeCard();
  window.scrollTo(0, 0);
}

/* =========================================================
   ホーム画面：途中セーブの再開
   ========================================================= */
function renderResumeCard() {
  const s = getSavedQuiz();
  if (!s) {
    el.resumeCard.hidden = true;
    return;
  }
  const answered = s.records.filter(Boolean).length;
  const modeLabel = modeLabelOf(s.mode);
  const timeLabel = s.timeMode === "limited"
    ? "残り " + formatTime(s.remainingSec)
    : "経過 " + formatTime(s.elapsedSec);
  el.resumeMeta.textContent =
    modeLabel + " / " + s.rangeLabel + " ／ " +
    answered + "/" + s.questions.length + "問回答済み ／ " + timeLabel +
    "（" + formatDate(s.savedAt) + " 保存）";
  // CSV書き出しは1問1答モードのみ対応（ランダム系は問題セットを復元できないため）
  el.exportSaveBtn.hidden = s.mode !== "single";
  el.resumeCard.hidden = false;
}

el.resumeBtn.addEventListener("click", () => {
  const s = getSavedQuiz();
  if (!s) {
    renderResumeCard();
    return;
  }
  let index = s.index;
  // 現在の問題が回答済みなら次の問題から再開する
  if (s.records[index] && index < s.questions.length - 1) index += 1;
  startQuiz({
    questions: s.questions,
    mode: s.mode,
    rangeLabel: s.rangeLabel,
    timeMode: s.timeMode,
    timeLimitSec: s.timeLimitSec,
    remainingSec: s.remainingSec,
    elapsedSec: s.elapsedSec,
    index: index,
    records: s.records,
    randomCount: s.randomCount,
  });
});

el.discardSaveBtn.addEventListener("click", () => {
  if (confirm("保存された途中経過を破棄しますか？この操作は元に戻せません。")) {
    clearSavedQuiz();
    renderResumeCard();
  }
});

/* =========================================================
   途中セーブのCSV書き出し・読み込み（1問1答モードのみ）
   ========================================================= */
function downloadCSV(csvText, filename) {
  const blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  return '"' + String(v === undefined || v === null ? "" : v).replace(/"/g, '""') + '"';
}

el.exportSaveBtn.addEventListener("click", () => {
  const s = getSavedQuiz();
  if (!s) {
    alert("保存された途中経過がありません。");
    renderResumeCard();
    return;
  }
  if (s.mode !== "single") {
    alert("途中経過のCSV書き出しは「1問1答」モードのみ対応しています。");
    return;
  }
  const lines = [["type", "key", "value"]];
  ["savedAt", "mode", "rangeLabel", "timeMode", "timeLimitSec", "remainingSec", "elapsedSec", "index"]
    .forEach(k => lines.push(["meta", k, s[k]]));
  s.records.forEach((r, i) => {
    if (r) lines.push(["record", i, r.selected === null ? "" : r.selected]);
  });
  const csv = lines.map(row => row.map(csvEscape).join(",")).join("\n");
  downloadCSV(csv, "e_shikaku_save_" + Date.now() + ".csv");
});

el.importSaveBtn.addEventListener("click", () => el.importSaveFile.click());

el.importSaveFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      importSaveCSV(String(reader.result));
    } catch (err) {
      alert("保存CSVの読み込みに失敗しました: " + err.message);
    }
    e.target.value = ""; // 同じファイルを再選択できるようにリセット
  };
  reader.onerror = () => { alert("ファイルの読み込みに失敗しました。"); };
  reader.readAsText(file, "UTF-8");
});

function importSaveCSV(text) {
  if (state.allQuestions.length === 0) {
    alert("先に問題データ（questions.csv）を読み込んでください。");
    return;
  }
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  const meta = {};
  const recs = [];
  rows.forEach((row, i) => {
    if (i === 0) return; // ヘッダー
    if (row[0] === "meta") meta[row[1]] = row[2];
    else if (row[0] === "record") recs.push([parseInt(row[1], 10), row[2] === "" ? null : parseInt(row[2], 10)]);
  });
  if (meta.mode !== "single") {
    alert("このCSVは途中経過の保存形式ではないか、対応していないモードです（1問1答のみ対応）。");
    return;
  }
  const rangeLabel = meta.rangeLabel || "すべての範囲";
  const pool = rangeLabel === "すべての範囲"
    ? state.allQuestions
    : state.allQuestions.filter(q => q.chapter === rangeLabel);
  if (pool.length === 0) {
    alert("範囲「" + rangeLabel + "」の問題が現在の問題データに見つかりません。");
    return;
  }

  const records = [];
  recs.forEach(([i, sel]) => {
    const item = pool[i];
    if (!item || sel === null || isNaN(i) || isNaN(sel)) return;
    records[i] = makeRecord(item, sel);
  });

  let index = parseInt(meta.index, 10);
  if (isNaN(index)) index = 0;
  index = Math.max(0, Math.min(index, pool.length - 1));
  if (records[index] && index < pool.length - 1) index += 1;

  const timeLimitSec = parseInt(meta.timeLimitSec, 10);
  const remainingSec = parseInt(meta.remainingSec, 10);
  const elapsedSec = parseInt(meta.elapsedSec, 10);

  if (getSavedQuiz()) {
    if (!confirm("保存された途中経過があります。CSVから再開すると上書きされますが、よろしいですか？")) {
      return;
    }
    clearSavedQuiz();
  }

  startQuiz({
    questions: pool.slice(),
    mode: "single",
    rangeLabel: rangeLabel,
    timeMode: meta.timeMode === "unlimited" ? "unlimited" : "limited",
    timeLimitSec: isNaN(timeLimitSec) ? 90 * 60 : timeLimitSec,
    remainingSec: isNaN(remainingSec) ? undefined : remainingSec,
    elapsedSec: isNaN(elapsedSec) ? 0 : elapsedSec,
    index: index,
    records: records,
  });
}

/* =========================================================
   ホーム画面：CSV読み込み
   ========================================================= */
function applyLoadedQuestions(questions, sourceLabel) {
  if (questions.length === 0) {
    el.csvStatus.textContent = "有効な問題データが見つかりませんでした。CSVの形式をご確認ください。";
    el.csvStatus.className = "status-line status-error";
    return;
  }
  state.allQuestions = questions;
  assignGroupIds(state.allQuestions);
  state.chapters = [...new Set(questions.map(q => q.chapter))];

  const skipped = questions.skippedRows || [];
  let msg = sourceLabel + "：" + questions.length + "問を読み込みました（章：" + state.chapters.join(" / ") + "）";
  if (skipped.length > 0) {
    msg += " ／ 形式不正のため" + skipped.length + "行を読み飛ばしました（CSV行番号: " + skipped.slice(0, 10).join(", ") + (skipped.length > 10 ? " 他" : "") + "）";
  }
  el.csvStatus.textContent = msg;
  el.csvStatus.className = skipped.length > 0 ? "status-line status-error" : "status-line status-ok";

  el.rangeSelect.innerHTML = '<option value="__ALL__">すべての範囲（' + questions.length + '問）</option>';
  state.chapters.forEach(ch => {
    const count = questions.filter(q => q.chapter === ch).length;
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = ch + "（" + count + "問）";
    el.rangeSelect.appendChild(opt);
  });

  el.setupCard.hidden = false;
  el.modeCard.hidden = false;
  el.timeCard.hidden = false;
  el.startRow.hidden = false;
}

el.csvFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const questions = questionsFromCSVText(reader.result);
      applyLoadedQuestions(questions, file.name);
    } catch (err) {
      el.csvStatus.textContent = "読み込みエラー: " + err.message;
      el.csvStatus.className = "status-line status-error";
    }
  };
  reader.onerror = () => {
    el.csvStatus.textContent = "ファイルの読み込みに失敗しました。";
    el.csvStatus.className = "status-line status-error";
  };
  reader.readAsText(file, "UTF-8");
});

el.toggleAdvancedBtn.addEventListener("click", () => {
  const willShow = el.advancedLoader.hidden;
  el.advancedLoader.hidden = !willShow;
  el.toggleAdvancedBtn.textContent = willShow
    ? "別のCSVを一時的に読み込む（上級者向け）を閉じる"
    : "別のCSVを一時的に読み込む（上級者向け）";
});

async function autoLoadQuestionsData() {
  try {
    const res = await fetch("questions.csv", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const questions = questionsFromCSVText(text);
    applyLoadedQuestions(questions, "questions.csv");
  } catch (err) {
    el.csvStatus.textContent = "questions.csv の読み込みに失敗しました: " + err.message + "（file://で直接開いている場合は読み込めません。GitHub Pages等のサーバー経由で開いてください）";
    el.csvStatus.className = "status-line status-error";
  }
}

/* =========================================================
   ユーティリティ
   ========================================================= */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
function formatTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}
function choiceLabel(i) {
  return ["A", "B", "C", "D", "E"][i] || String(i + 1);
}

/* 選択肢解説が表示対象かどうか（空・「省略」は表示しない） */
function choiceExplanationOf(source, i) {
  const exps = (source && source.choiceExplanations) || [];
  const exp = (exps[i] || "").trim();
  if (exp === "" || exp === EXPLANATION_OMITTED) return "";
  return exp;
}

/* 回答レコードを作成する（回答時・CSV再開時・未回答補完で共用） */
function makeRecord(item, selected) {
  return {
    question: item.question,
    chapter: item.chapter,
    questionImage: item.questionImage,
    choices: item.choices,
    choiceExplanations: item.choiceExplanations || [],
    answer: item.answer,
    selected: selected,
    isCorrect: selected === item.answer,
    explanation: item.explanation,
  };
}

/* =========================================================
   演習開始
   ========================================================= */
el.startBtn.addEventListener("click", () => {
  const rangeValue = el.rangeSelect.value;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const timeMode = document.querySelector('input[name="timeMode"]:checked').value;
  const timeLimitMin = Math.max(1, parseInt(el.timeLimitInput.value, 10) || 90);
  const randomCount = Math.min(500, Math.max(1, parseInt(el.randomCountInput.value, 10) || DEFAULT_RANDOM_COUNT));

  let questionSet;
  let rangeLabel;
  if (mode === "hundred") {
    if (getHundredPool().length === 0) {
      alert("修了試験A-1〜B-4の問題が見つかりません。CSVのchapter列をご確認ください。");
      return;
    }
    questionSet = buildHundredSet(randomCount);
    rangeLabel = HUNDRED_RANGE_LABEL;
  } else if (mode === "mock") {
    if (state.allQuestions.length === 0) {
      alert("問題データが読み込まれていません。");
      return;
    }
    questionSet = buildMockSet();
    rangeLabel = MOCK_RANGE_LABEL;
  } else {
    // 1問1答：CSVの並び順のまま出題
    const pool = rangeValue === "__ALL__"
      ? state.allQuestions
      : state.allQuestions.filter(q => q.chapter === rangeValue);
    if (pool.length === 0) {
      alert("この範囲には問題がありません。");
      return;
    }
    questionSet = pool.slice();
    rangeLabel = rangeValue === "__ALL__" ? "すべての範囲" : rangeValue;
  }

  if (getSavedQuiz()) {
    if (!confirm("保存された途中経過があります。新しく開始すると破棄されますが、よろしいですか？")) {
      return;
    }
    clearSavedQuiz();
  }

  startQuiz({
    questions: questionSet,
    mode: mode,
    rangeLabel: rangeLabel,
    timeMode: timeMode,
    timeLimitSec: timeLimitMin * 60,
    randomCount: randomCount,
  });
});

/* 回答形式の切替：100問系モードでは章選択を無効化して注意書きを表示 */
function updateRangeAvailability() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const isBatch = mode === "hundred" || mode === "mock";
  el.rangeSelect.disabled = isBatch;
  el.rangeNote.hidden = !isBatch;
  if (isBatch) {
    el.rangeNote.textContent = mode === "hundred"
      ? "※「ランダム演習」では章の選択は使われず、修了試験A-1〜B-4の各章から均等に出題し、指定した問題数まで全体から補充します。"
      : "※「模擬試験100問」では章の選択は使われず、出題傾向に合わせて全章から配分されます。";
  }
}
document.querySelectorAll('input[name="mode"]').forEach(r =>
  r.addEventListener("change", updateRangeAvailability)
);
updateRangeAvailability();

el.historyBtn.addEventListener("click", () => {
  renderHistoryScreen();
  showScreen("history");
});

/* =========================================================
   演習セッション
   ========================================================= */
function startQuiz(config) {
  state.quiz = {
    questions: config.questions,
    mode: config.mode,
    rangeLabel: config.rangeLabel,
    timeMode: config.timeMode,
    timeLimitSec: config.timeLimitSec,
    remainingSec: config.remainingSec !== undefined ? config.remainingSec : config.timeLimitSec,
    elapsedSec: config.elapsedSec !== undefined ? config.elapsedSec : 0,
    index: config.index !== undefined ? config.index : 0,
    viewIndex: config.index !== undefined ? config.index : 0,
    selected: null,
    answered: false,
    records: config.records !== undefined ? config.records : [],
    randomCount: config.randomCount,
    timerId: null,
    finished: false,
    paused: false,
  };
  setPaused(false);
  el.submitBtn.hidden = false;
  el.nextBtn.hidden = true;
  showScreen("quiz");
  renderQuestion();
  startTimer();
}

function startTimer() {
  const q = state.quiz;
  clearInterval(q.timerId);
  updateTimerLabel();
  q.timerId = setInterval(() => {
    if (q.paused) return; // 一時停止中はカウントしない
    if (q.timeMode === "limited") {
      q.remainingSec -= 1;
      if (q.remainingSec <= 0) {
        q.remainingSec = 0;
        updateTimerLabel();
        finishQuiz(true);
        return;
      }
    } else {
      q.elapsedSec += 1;
    }
    updateTimerLabel();
  }, 1000);
}

/* ---- タイマーの一時停止 ---- */
function setPaused(paused) {
  const q = state.quiz;
  if (q) q.paused = paused;
  el.pauseOverlay.hidden = !paused;
  el.pauseBtn.textContent = paused ? "▶" : "⏸";
  el.pauseBtn.title = paused ? "再開する" : "タイマーを一時停止";
}

el.pauseBtn.addEventListener("click", () => {
  const q = state.quiz;
  if (!q || q.finished) return;
  const next = !q.paused;
  setPaused(next);
  if (next) saveQuizProgress(); // 一時停止時に途中経過を保存
});

el.resumeQuizBtn.addEventListener("click", () => setPaused(false));

function updateTimerLabel() {
  const q = state.quiz;
  if (!q) return;
  if (q.timeMode === "limited") {
    el.timerLabel.textContent = formatTime(q.remainingSec);
    el.timerLabel.classList.toggle("is-warning", q.remainingSec <= 300 && q.remainingSec > 60);
    el.timerLabel.classList.toggle("is-danger", q.remainingSec <= 60);
  } else {
    el.timerLabel.textContent = formatTime(q.elapsedSec);
    el.timerLabel.classList.remove("is-warning", "is-danger");
  }
}

function renderDotTrack() {
  const q = state.quiz;
  el.dotTrack.innerHTML = "";
  q.questions.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "dot";
    if (i === q.viewIndex) dot.classList.add("is-current");
    const record = q.records[i];
    if (record) dot.classList.add(record.isCorrect ? "is-correct" : "is-incorrect");
    el.dotTrack.appendChild(dot);
  });
}

function isBatchMode(mode) {
  return mode === "hundred" || mode === "mock";
}

function renderQuestion() {
  const q = state.quiz;
  const vi = q.viewIndex;
  const item = q.questions[vi];
  const record = q.records[vi];
  const isCurrent = vi === q.index;
  const isAnswering = isCurrent && !record;

  if (isAnswering) {
    q.selected = null;
    q.answered = false;
  }

  el.progressLabel.textContent = "問 " + (vi + 1) + "/" + q.questions.length;
  renderDotTrack();
  el.quizChapterTag.textContent = item.chapter;
  el.questionText.textContent = item.question;
  el.reviewingNote.hidden = isAnswering;
  if (!isAnswering) {
    el.reviewingNote.textContent = isBatchMode(q.mode)
      ? "回答済みの問題を表示中（正解は結果画面で表示されます）"
      : "回答済みの問題を表示中";
  }

  if (item.questionImage) {
    el.questionImageBox.hidden = false;
    el.questionImageBox.innerHTML = "";
    const img = document.createElement("img");
    img.src = item.questionImage;
    img.alt = "問題の図";
    img.className = "question-image";
    img.onerror = () => {
      el.questionImageBox.innerHTML = '<p class="image-missing">⚠ 画像が見つかりません: ' + escapeForInnerText(item.questionImage) + '</p>';
    };
    makeImageZoomable(img);
    el.questionImageBox.appendChild(img);
  } else {
    el.questionImageBox.hidden = true;
    el.questionImageBox.innerHTML = "";
  }

  el.choiceList.innerHTML = "";
  item.choices.forEach((choiceText, i) => {
    const div = document.createElement("div");
    div.className = "choice-item";
    div.dataset.index = i;
    div.innerHTML = '<span class="choice-marker">' + choiceLabel(i) + '</span><span></span>';
    div.querySelector("span:last-child").textContent = choiceText;
    if (isAnswering) div.addEventListener("click", () => onSelectChoice(i));
    el.choiceList.appendChild(div);
  });

  el.feedbackBox.hidden = true;
  el.feedbackBox.className = "feedback-box";

  if (isAnswering) {
    el.submitBtn.hidden = false;
    el.submitBtn.disabled = true;
    el.submitBtn.textContent = isBatchMode(q.mode) ? "次へ" : "回答する";
    el.nextBtn.hidden = true;
  } else if (record) {
    // 回答済みの問題（読み取り専用表示）
    applyAnsweredView(item, record, !isBatchMode(q.mode));
    el.submitBtn.hidden = true;
    if (isCurrent) {
      // 1問1答で回答直後（まだ進んでいない）状態の復元
      el.nextBtn.hidden = false;
      el.nextBtn.textContent = (q.index === q.questions.length - 1) ? "結果を見る" : "次の問題へ";
    } else {
      el.nextBtn.hidden = true;
    }
  }

  updateNavButtons();
}

/* 回答済み問題の表示を適用する。reveal=true なら正解・解説も表示（1問1答） */
function applyAnsweredView(item, record, reveal) {
  [...el.choiceList.children].forEach(node => {
    const idx = Number(node.dataset.index);
    node.classList.add("is-disabled");
    if (idx === record.selected) node.classList.add("is-selected");
    if (reveal) {
      if (idx === item.answer) node.classList.add("is-correct");
      else if (idx === record.selected) node.classList.add("is-incorrect");
      // 選択肢ごとの解説（「省略」または空の場合は表示しない）
      const exp = choiceExplanationOf(item, idx) || choiceExplanationOf(record, idx);
      if (exp) {
        const p = document.createElement("p");
        p.className = "choice-explanation " + (idx === item.answer ? "is-correct-exp" : "is-incorrect-exp");
        p.textContent = exp;
        node.appendChild(p);
      }
    }
  });
  if (reveal) {
    el.feedbackBox.hidden = false;
    el.feedbackBox.classList.add(record.isCorrect ? "is-correct" : "is-incorrect");
    el.feedbackResult.textContent = record.isCorrect ? "○ 正解！" : "✕ 不正解";
    el.feedbackExplanation.textContent = record.explanation || "（解説はありません）";
  }
}

/* 前の問題／次の問題へのナビゲーション */
function updateNavButtons() {
  const q = state.quiz;
  el.prevBtn.hidden = q.viewIndex === 0;
  el.fwdBtn.hidden = q.viewIndex >= q.index;
}

el.prevBtn.addEventListener("click", () => {
  const q = state.quiz;
  if (!q || q.viewIndex === 0) return;
  q.viewIndex -= 1;
  renderQuestion();
});

el.fwdBtn.addEventListener("click", () => {
  const q = state.quiz;
  if (!q || q.viewIndex >= q.index) return;
  q.viewIndex += 1;
  renderQuestion();
});

function onSelectChoice(i) {
  const q = state.quiz;
  if (q.answered || q.viewIndex !== q.index || q.records[q.index]) return;
  q.selected = i;
  [...el.choiceList.children].forEach(node => {
    node.classList.toggle("is-selected", Number(node.dataset.index) === i);
  });
  el.submitBtn.disabled = false;
}

el.submitBtn.addEventListener("click", () => {
  const q = state.quiz;
  if (q.selected === null || q.viewIndex !== q.index) return;

  if (isBatchMode(q.mode)) {
    recordAnswer(false);
    advanceOrFinish();
  } else {
    recordAnswer(true);
  }
});

el.nextBtn.addEventListener("click", () => {
  advanceOrFinish();
});

function recordAnswer(showFeedback) {
  const q = state.quiz;
  const item = q.questions[q.index];

  q.records[q.index] = makeRecord(item, q.selected);
  q.answered = true;
  saveQuizProgress(); // 回答のたびに途中経過を自動保存

  if (showFeedback) {
    applyAnsweredView(item, q.records[q.index], true);
    el.submitBtn.hidden = true;
    el.nextBtn.hidden = false;
    el.nextBtn.textContent = (q.index === q.questions.length - 1) ? "結果を見る" : "次の問題へ";
    renderDotTrack();
  }
}

function advanceOrFinish() {
  const q = state.quiz;
  if (q.index < q.questions.length - 1) {
    q.index += 1;
    q.viewIndex = q.index;
    saveQuizProgress();
    renderQuestion();
  } else {
    finishQuiz(false);
  }
}

el.quitBtn.addEventListener("click", () => {
  if (confirm("演習を中断してホームに戻りますか？（途中経過は保存され、ホームの「保存された演習」から再開できます）")) {
    saveQuizProgress();
    stopTimer();
    setPaused(false);
    state.quiz = null;
    showScreen("home");
  }
});

function stopTimer() {
  if (state.quiz && state.quiz.timerId) clearInterval(state.quiz.timerId);
}

/* =========================================================
   結果画面
   ========================================================= */
function finishQuiz(timeUp) {
  const q = state.quiz;
  stopTimer();
  q.finished = true;
  setPaused(false);
  clearSavedQuiz(); // 完了したので途中セーブは消去

  q.questions.forEach((item, i) => {
    if (!q.records[i]) {
      q.records[i] = makeRecord(item, null);
    }
  });

  const total = q.records.length;
  const correct = q.records.filter(r => r.isCorrect).length;
  const percent = Math.round((correct / total) * 1000) / 10;
  const timeSpentSec = q.timeMode === "limited" ? (q.timeLimitSec - q.remainingSec) : q.elapsedSec;

  const modeLabel = modeLabelOf(q.mode);

  const entry = {
    date: new Date().toISOString(),
    mode: modeLabel,
    range: q.rangeLabel,
    total: total,
    correct: correct,
    percent: percent,
    timeSpentSec: timeSpentSec,
    timeUp: !!timeUp,
  };

  saveHistoryEntry(entry);
  const isNewBest = saveBestIfHigher(entry);

  el.resultScoreBig.textContent = correct + " / " + total;
  el.resultPercent.textContent = percent + "%";
  el.resultTime.textContent = "所要時間 " + formatTime(timeSpentSec) + (timeUp ? "（時間切れ）" : "");
  el.resultRange.textContent = "範囲: " + q.rangeLabel;
  el.resultMode.textContent = "形式: " + modeLabel;
  el.resultBestNote.textContent = isNewBest ? "🎉 最高得点を更新しました！" : "";

  el.reviewList.innerHTML = "";
  q.records.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "review-item";
    const selectedText = r.selected === null ? "未回答" : (choiceLabel(r.selected) + ": " + r.choices[r.selected]);
    const correctText = choiceLabel(r.answer) + ": " + r.choices[r.answer];

    const head = document.createElement("div");
    head.className = "review-item-head";
    head.innerHTML = '<span class="review-item-title"></span><span class="review-badge"></span>';
    head.querySelector(".review-item-title").textContent = "問" + (i + 1) + "（" + r.chapter + "）";
    const badge = head.querySelector(".review-badge");
    badge.textContent = r.isCorrect ? "正解" : "不正解";
    badge.classList.add(r.isCorrect ? "is-correct" : "is-incorrect");

    const qp = document.createElement("p");
    qp.className = "review-q";
    qp.textContent = r.question;

    const ap = document.createElement("p");
    ap.className = "review-answers";
    ap.innerHTML = "あなたの回答: " + escapeForInnerText(selectedText) + "<br><b>正解: " + escapeForInnerText(correctText) + "</b>";

    // 選択肢ごとの表示（正解・不正解の色分け＋個別解説。「省略」は解説を出さない）
    const choicesBox = document.createElement("div");
    choicesBox.className = "review-choices";
    r.choices.forEach((choiceText, ci) => {
      const line = document.createElement("div");
      line.className = "review-choice";
      if (ci === r.answer) line.classList.add("is-correct");
      else if (ci === r.selected) line.classList.add("is-incorrect");

      const t = document.createElement("p");
      t.className = "review-choice-text";
      let label = choiceLabel(ci) + ": " + choiceText;
      if (ci === r.selected) label += "（あなたの回答）";
      t.textContent = label;
      line.appendChild(t);

      const exp = choiceExplanationOf(r, ci);
      if (exp) {
        const e = document.createElement("p");
        e.className = "review-choice-exp " + (ci === r.answer ? "is-correct-exp" : "is-incorrect-exp");
        e.textContent = exp;
        line.appendChild(e);
      }
      choicesBox.appendChild(line);
    });

    const ep = document.createElement("p");
    ep.className = "review-explanation";
    ep.textContent = r.explanation || "（解説はありません）";

    div.appendChild(head);
    if (r.questionImage) {
      const imgBox = document.createElement("div");
      imgBox.className = "question-image-box review-image-box";
      const img = document.createElement("img");
      img.src = r.questionImage;
      img.alt = "問題の図";
      img.className = "question-image";
      img.onerror = () => { imgBox.style.display = "none"; };
      makeImageZoomable(img);
      imgBox.appendChild(img);
      div.appendChild(imgBox);
    }
    div.appendChild(qp);
    div.appendChild(ap);
    div.appendChild(choicesBox);
    div.appendChild(ep);
    el.reviewList.appendChild(div);
  });

  showScreen("result");
}

/* =========================================================
   画像の拡大表示（ライトボックス）
   ========================================================= */
const imageLightbox = document.getElementById("imageLightbox");
const imageLightboxImg = document.getElementById("imageLightboxImg");

function openImageLightbox(src, alt) {
  imageLightboxImg.src = src;
  imageLightboxImg.alt = alt || "拡大画像";
  imageLightbox.showModal();
}

document.getElementById("imageLightboxClose").addEventListener("click", () => imageLightbox.close());
// 画像の外側（背景）をクリックしても閉じる
imageLightbox.addEventListener("click", (e) => {
  if (e.target === imageLightbox) imageLightbox.close();
});
imageLightbox.addEventListener("close", () => { imageLightboxImg.src = ""; });

/* 問題画像にクリックで拡大する挙動を付与する */
function makeImageZoomable(img) {
  img.classList.add("is-zoomable");
  img.title = "クリックで拡大表示";
  img.addEventListener("click", () => openImageLightbox(img.src, img.alt));
}

function escapeForInnerText(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

el.backHomeBtn.addEventListener("click", () => {
  state.quiz = null;
  showScreen("home");
});

el.retryBtn.addEventListener("click", () => {
  const prev = state.quiz;
  if (!prev) { showScreen("home"); return; }

  let questionSet;
  if (prev.mode === "hundred") {
    if (getHundredPool().length === 0) { showScreen("home"); return; }
    questionSet = buildHundredSet(prev.randomCount || DEFAULT_RANDOM_COUNT);
  } else if (prev.mode === "mock") {
    if (state.allQuestions.length === 0) { showScreen("home"); return; }
    questionSet = buildMockSet();
  } else {
    const rangeValue = prev.rangeLabel;
    const pool = rangeValue === "すべての範囲"
      ? state.allQuestions
      : state.allQuestions.filter(q => q.chapter === rangeValue);
    if (pool.length === 0) { showScreen("home"); return; }
    questionSet = pool.slice(); // CSVの並び順
  }

  startQuiz({
    questions: questionSet,
    mode: prev.mode,
    rangeLabel: prev.rangeLabel,
    timeMode: prev.timeMode,
    timeLimitSec: prev.timeLimitSec,
    randomCount: prev.randomCount,
  });
});

/* =========================================================
   履歴画面
   ========================================================= */
function renderHistoryScreen() {
  const best = getBest();
  if (best) {
    el.bestScoreBox.innerHTML = "";
    const v = document.createElement("span");
    v.className = "best-score-value mono";
    v.textContent = best.percent + "%";
    const m = document.createElement("span");
    m.className = "best-score-meta";
    m.innerHTML = best.correct + "/" + best.total + "問正解・" + best.mode + "・" + best.range + "<br>" + formatDate(best.date);
    el.bestScoreBox.appendChild(v);
    el.bestScoreBox.appendChild(m);
  } else {
    el.bestScoreBox.innerHTML = '<p class="best-score-empty">まだ記録がありません。</p>';
  }

  const history = getHistory();
  if (history.length === 0) {
    el.historyList.innerHTML = '<p class="best-score-empty">履歴はまだありません。</p>';
  } else {
    el.historyList.innerHTML = "";
    history.forEach(h => {
      const div = document.createElement("div");
      div.className = "history-item";

      const left = document.createElement("div");
      left.className = "history-item-left";
      const dateSpan = document.createElement("span");
      dateSpan.className = "history-date";
      dateSpan.textContent = formatDate(h.date);
      const tagSpan = document.createElement("span");
      tagSpan.className = "history-tags";
      tagSpan.textContent = h.mode + " / " + h.range + " / " + formatTime(h.timeSpentSec);
      left.appendChild(dateSpan);
      left.appendChild(tagSpan);

      const scoreSpan = document.createElement("span");
      scoreSpan.className = "history-score mono";
      scoreSpan.textContent = h.correct + "/" + h.total + "（" + h.percent + "%）";

      div.appendChild(left);
      div.appendChild(scoreSpan);
      el.historyList.appendChild(div);
    });
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

el.historyBackBtn.addEventListener("click", () => showScreen("home"));

el.resetBestBtn.addEventListener("click", () => {
  if (confirm("最高得点をリセットしますか？（回答履歴は削除されません）")) {
    resetBest();
    renderHistoryScreen();
  }
});

el.clearHistoryBtn.addEventListener("click", () => {
  if (confirm("回答履歴をすべて削除しますか？この操作は元に戻せません。")) {
    clearHistory();
    renderHistoryScreen();
  }
});

el.exportHistoryBtn.addEventListener("click", () => {
  const history = getHistory();
  if (history.length === 0) {
    alert("書き出す履歴がありません。");
    return;
  }
  const header = "date,mode,range,total,correct,percent,timeSpentSec,timeUp";
  const lines = history.map(h =>
    [h.date, h.mode, h.range, h.total, h.correct, h.percent, h.timeSpentSec, h.timeUp]
      .map(csvEscape)
      .join(",")
  );
  const csv = [header].concat(lines).join("\n");
  downloadCSV(csv, "e_shikaku_history_" + Date.now() + ".csv");
});

/* =========================================================
   初期表示
   ========================================================= */
showScreen("home");
autoLoadQuestionsData();
