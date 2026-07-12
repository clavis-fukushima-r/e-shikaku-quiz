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

/* ランダム100問の出題対象（修了試験A-1〜B-4） */
const HUNDRED_CHAPTER_RE = /^修了試験[AB]-[1-4]$/;
const HUNDRED_RANGE_LABEL = "修了試験A-1〜B-4";

function getHundredPool() {
  return state.allQuestions.filter(q => HUNDRED_CHAPTER_RE.test(q.chapter));
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
  const modeLabel = s.mode === "hundred" ? "ランダム100問" : "1問1答";
  const timeLabel = s.timeMode === "limited"
    ? "残り " + formatTime(s.remainingSec)
    : "経過 " + formatTime(s.elapsedSec);
  el.resumeMeta.textContent =
    modeLabel + " / " + s.rangeLabel + " ／ " +
    answered + "/" + s.questions.length + "問回答済み ／ " + timeLabel +
    "（" + formatDate(s.savedAt) + " 保存）";
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
  });
});

el.discardSaveBtn.addEventListener("click", () => {
  if (confirm("保存された途中経過を破棄しますか？この操作は元に戻せません。")) {
    clearSavedQuiz();
    renderResumeCard();
  }
});

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

/* =========================================================
   演習開始
   ========================================================= */
el.startBtn.addEventListener("click", () => {
  const rangeValue = el.rangeSelect.value;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const timeMode = document.querySelector('input[name="timeMode"]:checked').value;
  const timeLimitMin = Math.max(1, parseInt(el.timeLimitInput.value, 10) || 90);

  let pool;
  let rangeLabel;
  if (mode === "hundred") {
    // ランダム100問は修了試験A-1〜B-4のみを対象とする
    pool = getHundredPool();
    rangeLabel = HUNDRED_RANGE_LABEL;
  } else {
    pool = rangeValue === "__ALL__"
      ? state.allQuestions
      : state.allQuestions.filter(q => q.chapter === rangeValue);
    rangeLabel = rangeValue === "__ALL__" ? "すべての範囲" : rangeValue;
  }

  if (pool.length === 0) {
    alert(mode === "hundred"
      ? "修了試験A-1〜B-4の問題が見つかりません。CSVのchapter列をご確認ください。"
      : "この範囲には問題がありません。");
    return;
  }

  if (getSavedQuiz()) {
    if (!confirm("保存された途中経過があります。新しく開始すると破棄されますが、よろしいですか？")) {
      return;
    }
    clearSavedQuiz();
  }

  let questionSet;
  if (mode === "hundred") {
    const n = Math.min(100, pool.length);
    questionSet = shuffle(pool).slice(0, n);
  } else {
    questionSet = shuffle(pool);
  }

  startQuiz({
    questions: questionSet,
    mode: mode,
    rangeLabel: rangeLabel,
    timeMode: timeMode,
    timeLimitSec: timeLimitMin * 60,
  });
});

/* 回答形式の切替：ランダム100問のときは章選択を無効化して注意書きを表示 */
function updateRangeAvailability() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const isHundred = mode === "hundred";
  el.rangeSelect.disabled = isHundred;
  el.rangeNote.hidden = !isHundred;
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
    selected: null,
    answered: false,
    records: config.records !== undefined ? config.records : [],
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
    if (i === q.index) dot.classList.add("is-current");
    const record = q.records[i];
    if (record) dot.classList.add(record.isCorrect ? "is-correct" : "is-incorrect");
    el.dotTrack.appendChild(dot);
  });
}

function renderQuestion() {
  const q = state.quiz;
  const item = q.questions[q.index];

  q.selected = null;
  q.answered = false;

  el.progressLabel.textContent = "問 " + (q.index + 1) + "/" + q.questions.length;
  renderDotTrack();
  el.quizChapterTag.textContent = item.chapter;
  el.questionText.textContent = item.question;

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
    div.addEventListener("click", () => onSelectChoice(i));
    el.choiceList.appendChild(div);
  });

  el.feedbackBox.hidden = true;
  el.feedbackBox.className = "feedback-box";
  el.submitBtn.hidden = false;
  el.submitBtn.disabled = true;
  el.submitBtn.textContent = q.mode === "hundred" ? "次へ" : "回答する";
  el.nextBtn.hidden = true;
}

function onSelectChoice(i) {
  const q = state.quiz;
  if (q.answered) return;
  q.selected = i;
  [...el.choiceList.children].forEach(node => {
    node.classList.toggle("is-selected", Number(node.dataset.index) === i);
  });
  el.submitBtn.disabled = false;
}

el.submitBtn.addEventListener("click", () => {
  const q = state.quiz;
  if (q.selected === null) return;

  if (q.mode === "hundred") {
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
  const isCorrect = q.selected === item.answer;

  q.records[q.index] = {
    question: item.question,
    chapter: item.chapter,
    questionImage: item.questionImage,
    choices: item.choices,
    answer: item.answer,
    selected: q.selected,
    isCorrect: isCorrect,
    explanation: item.explanation,
  };
  q.answered = true;
  saveQuizProgress(); // 回答のたびに途中経過を自動保存

  if (showFeedback) {
    [...el.choiceList.children].forEach(node => {
      const idx = Number(node.dataset.index);
      node.classList.add("is-disabled");
      if (idx === item.answer) node.classList.add("is-correct");
      else if (idx === q.selected) node.classList.add("is-incorrect");
    });
    el.feedbackBox.hidden = false;
    el.feedbackBox.classList.add(isCorrect ? "is-correct" : "is-incorrect");
    el.feedbackResult.textContent = isCorrect ? "○ 正解！" : "✕ 不正解";
    el.feedbackExplanation.textContent = item.explanation || "（解説はありません）";
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
      q.records[i] = {
        question: item.question,
        chapter: item.chapter,
        questionImage: item.questionImage,
        choices: item.choices,
        answer: item.answer,
        selected: null,
        isCorrect: false,
        explanation: item.explanation,
      };
    }
  });

  const total = q.records.length;
  const correct = q.records.filter(r => r.isCorrect).length;
  const percent = Math.round((correct / total) * 1000) / 10;
  const timeSpentSec = q.timeMode === "limited" ? (q.timeLimitSec - q.remainingSec) : q.elapsedSec;

  const modeLabel = q.mode === "hundred" ? "ランダム100問" : "1問1答";

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
      imgBox.appendChild(img);
      div.appendChild(imgBox);
    }
    div.appendChild(qp);
    div.appendChild(ap);
    div.appendChild(ep);
    el.reviewList.appendChild(div);
  });

  showScreen("result");
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

  let pool;
  if (prev.mode === "hundred") {
    pool = getHundredPool();
  } else {
    const rangeValue = prev.rangeLabel;
    pool = rangeValue === "すべての範囲"
      ? state.allQuestions
      : state.allQuestions.filter(q => q.chapter === rangeValue);
  }

  if (pool.length === 0) { showScreen("home"); return; }

  let questionSet;
  if (prev.mode === "hundred") {
    const n = Math.min(100, pool.length);
    questionSet = shuffle(pool).slice(0, n);
  } else {
    questionSet = shuffle(pool);
  }

  startQuiz({
    questions: questionSet,
    mode: prev.mode,
    rangeLabel: prev.rangeLabel,
    timeMode: prev.timeMode,
    timeLimitSec: prev.timeLimitSec,
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
      .map(v => '"' + String(v).replace(/"/g, '""') + '"')
      .join(",")
  );
  const csv = [header].concat(lines).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "e_shikaku_history_" + Date.now() + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

/* =========================================================
   初期表示
   ========================================================= */
showScreen("home");
autoLoadQuestionsData();
