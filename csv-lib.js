"use strict";

/* =========================================================
   CSVパーサ（引用符・カンマ・改行を含むフィールドに対応）
   ========================================================= */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

/**
 * CSVテキストを問題オブジェクトの配列に変換する。
 * 戻り値の配列には非表示プロパティ skippedRows（読み飛ばした行番号の配列）が付与される。
 */
function questionsFromCSVText(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("データ行が見つかりませんでした。");

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    id: header.indexOf("id"),
    chapter: header.indexOf("chapter"),
    question: header.indexOf("question"),
    question_image: header.indexOf("question_image"),
    c1: header.indexOf("choice1"),
    c2: header.indexOf("choice2"),
    c3: header.indexOf("choice3"),
    c4: header.indexOf("choice4"),
    c5: header.indexOf("choice5"),
    answer: header.indexOf("answer"),
    explanation: header.indexOf("explanation"),
  };
  const required = ["chapter", "question", "c1", "c2", "answer", "explanation"];
  for (const key of required) {
    if (idx[key] === -1) {
      const label = key === "c1" ? "choice1" : key === "c2" ? "choice2" : key;
      throw new Error("CSVヘッダーに必要な列が見つかりません: " + label);
    }
  }

  const questions = [];
  const skippedRows = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c.trim() === "")) continue;

    const rawChoices = [idx.c1, idx.c2, idx.c3, idx.c4, idx.c5].map(ci =>
      ci >= 0 && row[ci] !== undefined ? row[ci].trim() : ""
    );
    const choices = rawChoices.filter(c => c !== "");
    const answerNum = parseInt(row[idx.answer], 10);

    const hasQuestion = !!row[idx.question];
    const validChoiceCount = choices.length >= 2;
    const validAnswer = !isNaN(answerNum) && answerNum >= 1 && answerNum <= choices.length;

    if (!hasQuestion || !validChoiceCount || !validAnswer) {
      skippedRows.push(r + 1); // CSV上の行番号（1行目=ヘッダー）
      continue;
    }

    questions.push({
      id: idx.id >= 0 ? row[idx.id] : String(r),
      chapter: (row[idx.chapter] || "未分類").trim(),
      question: row[idx.question].trim(),
      questionImage: idx.question_image >= 0 ? (row[idx.question_image] || "").trim() : "",
      choices,
      answer: answerNum - 1,
      explanation: idx.explanation >= 0 ? (row[idx.explanation] || "").trim() : "",
    });
  }

  questions.skippedRows = skippedRows;
  return questions;
}
