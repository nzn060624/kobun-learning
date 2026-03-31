// ==============================
// たちばな ─ ぜんぶやる古典文法クイズ
// GitHub Pages向け / 依存なしSPA
// ==============================

(() => {
  "use strict";

  // ------------------------------
  // 定数
  // ------------------------------
  const STORAGE_KEY = "tachibana-kobun-quiz-state-v1";
  const QUESTIONS_CSV_PATH = "questions.csv";
  const ICON_IMAGE_PATH = "アイコンイラスト.png";
  const QUIZ_LENGTH = 10;

  const CATEGORY_ORDER = [
    "動詞",
    "形容詞/形容動詞",
    "助動詞",
    "助詞",
    "識別",
    "演習",
  ];

  const CATEGORY_TO_SECTIONS = {
    "動詞": ["動詞①", "動詞②"],
    "形容詞/形容動詞": ["形容詞", "形容動詞"],
    "助動詞": ["助動詞①", "助動詞②"],
    "助詞": ["助詞①", "助詞②"],
    "識別": ["識別①", "識別②"],
    "演習": ["演習①", "演習②"],
  };

  const appState = {
    isLoading: true,
    loadError: null,
    questions: [],
    history: [],
    currentView: { name: "loading", params: {} },
    session: null,
  };

  // ------------------------------
  // 初期化
  // ------------------------------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    renderLoading("読み込み中…");
    try {
      const questions = await loadQuestionsFromCSV(QUESTIONS_CSV_PATH);
      appState.questions = questions;

      ensureStorageInitialized(questions);
      exposeDebugHelpers();

      goTo("home");
    } catch (error) {
      console.error(error);
      appState.loadError = error;
      renderFatalError();
    }
  }

  // ------------------------------
  // データ読み込み
  // ------------------------------
  async function loadQuestionsFromCSV(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`questions.csv の読み込みに失敗しました: ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    const questions = rows.map((row, index) => {
      const q = {
        id: row.id?.trim() || String(index + 1),
        category: row.category?.trim() || "",
        section: row.section?.trim() || "",
        question: row.question?.trim() || "",
        choices: [
          row.choice1?.trim() || "",
          row.choice2?.trim() || "",
          row.choice3?.trim() || "",
          row.choice4?.trim() || "",
        ].filter(Boolean),
        answer: row.answer?.trim() || "",
      };

      validateQuestion(q, index);
      return q;
    });

    return questions;
  }

  function parseCSV(text) {
    const lines = [];
    let current = "";
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i++;
        row.push(current);
        if (row.some(cell => cell.trim() !== "")) {
          lines.push(row);
        }
        row = [];
        current = "";
      } else {
        current += char;
      }
    }

    if (current.length > 0 || row.length > 0) {
      row.push(current);
      if (row.some(cell => cell.trim() !== "")) {
        lines.push(row);
      }
    }

    if (lines.length === 0) return [];

    const headers = lines[0].map(h => h.trim());
    return lines.slice(1).map(cells => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = cells[index] ?? "";
      });
      return obj;
    });
  }

  function validateQuestion(question, index) {
    if (!question.id || !question.category || !question.section || !question.question || !question.answer) {
      throw new Error(`CSV ${index + 2}行目の必須項目が不足しています。`);
    }
    if (question.choices.length !== 4) {
      throw new Error(`CSV ${index + 2}行目の選択肢数が4つではありません。`);
    }
    if (!question.choices.includes(question.answer)) {
      throw new Error(`CSV ${index + 2}行目の answer が choice1〜4 に含まれていません。`);
    }
  }

  // ------------------------------
  // localStorage
  // ------------------------------
  function createDefaultStorageState(questions) {
    const questionStates = {};

    questions.forEach(q => {
      questionStates[q.id] = {
        seen: false,
        weak: false,
        solvedCorrectOnce: false,
        correctCount: 0,
        incorrectCount: 0,
        lastAnsweredAt: null,
      };
    });

    return {
      version: 1,
      questionStates,
      stats: {
        sessionsPlayed: 0,
        laps: 0,
        totalAnswers: 0,
        totalCorrectAnswers: 0,
      },
    };
  }

  function ensureStorageInitialized(questions) {
    const saved = getStorageState();
    if (!saved) {
      resetProgress();
      return;
    }

    let changed = false;

    questions.forEach(q => {
      if (!saved.questionStates[q.id]) {
        saved.questionStates[q.id] = {
          seen: false,
          weak: false,
          solvedCorrectOnce: false,
          correctCount: 0,
          incorrectCount: 0,
          lastAnsweredAt: null,
        };
        changed = true;
      }
    });

    Object.keys(saved.questionStates).forEach(id => {
      if (!questions.some(q => q.id === id)) {
        delete saved.questionStates[id];
        changed = true;
      }
    });

    if (!saved.stats) {
      saved.stats = {
        sessionsPlayed: 0,
        laps: 0,
        totalAnswers: 0,
        totalCorrectAnswers: 0,
      };
      changed = true;
    }

    if (changed) {
      setStorageState(saved);
    }
  }

  function getStorageState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error("localStorage 読み込み失敗", error);
      return null;
    }
  }

  function setStorageState(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function resetProgress() {
    const initial = createDefaultStorageState(appState.questions);
    setStorageState(initial);
    return initial;
  }

  function clearProgressStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("localStorage 削除失敗", error);
    }
    return resetProgress();
  }

  function getQuestionState(questionId) {
    const data = getStorageState();
    return data?.questionStates?.[questionId] || null;
  }

  function updateQuestionState(questionId, updater) {
    const data = getStorageState();
    if (!data || !data.questionStates[questionId]) return;

    updater(data.questionStates[questionId], data);
    data.questionStates[questionId].lastAnsweredAt = new Date().toISOString();

    recalculateLaps(data);
    setStorageState(data);
  }

  function recalculateLaps(data) {
    const total = appState.questions.length;
    const solvedCount = appState.questions.filter(q => data.questionStates[q.id]?.solvedCorrectOnce).length;
    data.stats.laps = total > 0 ? Math.floor(solvedCount / total) : 0;
  }

  function getProgressStats(questionsSubset = appState.questions) {
    const data = getStorageState();
    const states = data.questionStates;
    const total = questionsSubset.length;

    let solved = 0;
    let weak = 0;
    let unseen = 0;

    questionsSubset.forEach(q => {
      const st = states[q.id];
      if (!st.seen) unseen++;
      if (st.weak) weak++;
      if (st.solvedCorrectOnce) solved++;
    });

    const progressRate = total > 0 ? Math.round((solved / total) * 100) : 0;

    return {
      total,
      solved,
      weak,
      unseen,
      progressRate,
      laps: Math.min(data.stats.laps, 5),
      rawLaps: data.stats.laps,
    };
  }

  // ------------------------------
  // デバッグ用
  // ------------------------------
  function exposeDebugHelpers() {
    window.tachibanaDebug = {
      getState: () => getStorageState(),
      resetProgress: () => {
        const result = resetProgress();
        rerenderCurrentView();
        return result;
      },
      getQuestions: () => appState.questions,
      getSectionStats: (category, section) => {
        const list = filterQuestions({ category, section });
        return getProgressStats(list);
      },
    };
  }

  // ------------------------------
  // 画面遷移
  // ------------------------------
  function goTo(name, params = {}, pushHistory = true) {
    if (pushHistory && appState.currentView.name !== "loading") {
      appState.history.push(appState.currentView);
    }
    appState.currentView = { name, params };
    render();
  }

  function goBack(fallback = "home") {
    const prev = appState.history.pop();
    if (prev) {
      appState.currentView = prev;
      render();
    } else {
      goTo(fallback, {}, false);
    }
  }

  function rerenderCurrentView() {
    render();
  }

  // ------------------------------
  // 出題ロジック
  // ------------------------------
  function filterQuestions({ category = null, section = null, weakOnly = false } = {}) {
    const all = appState.questions;
    return all.filter(q => {
      if (category && q.category !== category) return false;
      if (section && q.section !== section) return false;
      if (weakOnly && !getQuestionState(q.id)?.weak) return false;
      return true;
    });
  }

  function buildQuizQuestions(mode, options = {}) {
    const storage = getStorageState();
    let pool = [];

    if (mode === "normal") {
      pool = filterQuestions({
        category: options.category,
        section: options.section,
      });
    } else if (mode === "random") {
      pool = [...appState.questions];
    } else if (mode === "weak") {
      pool = filterQuestions({ weakOnly: true });
    }

    if (pool.length === 0) return [];

    const unseen = shuffle(pool.filter(q => !storage.questionStates[q.id].seen));
    const seen = shuffle(pool.filter(q => storage.questionStates[q.id].seen));

    const prioritized = [...unseen, ...seen];
    return prioritized.slice(0, Math.min(QUIZ_LENGTH, prioritized.length));
  }

  function startQuiz(mode, options = {}) {
    const questions = buildQuizQuestions(mode, options);

    if (questions.length === 0) {
      if (mode === "weak") {
        goTo("empty", {
          message: "苦手問題はありません",
          buttonText: "TOPへ",
          onClick: "home",
        });
      } else {
        goTo("empty", {
          message: "問題がありません",
          buttonText: "TOPへ",
          onClick: "home",
        });
      }
      return;
    }

    appState.session = {
      mode,
      options,
      title: getModeLabel(mode, options),
      questions: questions.map(q => ({
        ...q,
        shuffledChoices: shuffle([...q.choices]),
      })),
      currentIndex: 0,
      answers: [],
      isAnsweringLocked: false,
      countdown: 3,
      timerId: null,
    };

    goTo("countdown", {
      label: getModeLabel(mode, options),
    });
  }

  function getModeLabel(mode, options) {
    if (mode === "normal") return options.category || "問題を解く";
    if (mode === "random") return "ランダム10問";
    if (mode === "weak") return "苦手問題";
    return "";
  }

  function answerCurrentQuestion(selectedChoice, viaUnknown = false) {
    const session = appState.session;
    if (!session || session.isAnsweringLocked) return;

    const current = session.questions[session.currentIndex];
    const isCorrect = selectedChoice === current.answer;
    session.isAnsweringLocked = true;

    updateQuestionState(current.id, (state, root) => {
      state.seen = true;
      root.stats.totalAnswers += 1;

      if (isCorrect) {
        state.correctCount += 1;
        state.solvedCorrectOnce = true;
        root.stats.totalCorrectAnswers += 1;
      } else {
        state.incorrectCount += 1;
        state.weak = true;
      }
    });

    session.answers.push({
      questionId: current.id,
      question: current.question,
      answer: current.answer,
      selectedChoice,
      isCorrect,
      viaUnknown,
    });

    if (isCorrect) {
      playCorrectSound();
    }

    renderQuizQuestion({ reveal: true, selectedChoice, isCorrect });

    window.setTimeout(() => {
      session.currentIndex += 1;
      session.isAnsweringLocked = false;

      if (session.currentIndex >= session.questions.length) {
        finalizeSession();
      } else {
        render();
      }
    }, 3000);
  }

  function removeWeakForCurrentQuestion() {
    const session = appState.session;
    const current = session?.questions?.[session.currentIndex];
    if (!current) return;

    updateQuestionState(current.id, (state) => {
      state.weak = false;
    });
  }

  function finalizeSession() {
    const storage = getStorageState();
    storage.stats.sessionsPlayed += 1;
    recalculateLaps(storage);
    setStorageState(storage);

    goTo("result");
  }

  // ------------------------------
  // 音
  // ------------------------------
  function playCorrectSound() {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.12);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
    } catch (error) {
      // 音が鳴らせない環境でもエラーにしない
      console.debug("効果音をスキップしました", error);
    }
  }

  // ------------------------------
  // レンダリング
  // ------------------------------
  function render() {
    const screen = document.getElementById("screen");
    if (!screen) return;

    const { name, params } = appState.currentView;

    if (name === "home") {
      screen.innerHTML = renderHome();
      bindHomeEvents();
      return;
    }

    if (name === "about") {
      screen.innerHTML = renderAbout();
      bindCommonBack();
      return;
    }

    if (name === "categories") {
      screen.innerHTML = renderCategories();
      bindCategoryEvents();
      bindCommonBack();
      return;
    }

    if (name === "sections") {
      screen.innerHTML = renderSections(params.category);
      bindSectionEvents();
      bindCommonBack();
      return;
    }

    if (name === "countdown") {
      renderCountdown(params.label);
      return;
    }

    if (name === "quiz") {
      renderQuizQuestion();
      return;
    }

    if (name === "result") {
      screen.innerHTML = renderResult();
      bindResultEvents();
      return;
    }

    if (name === "empty") {
      screen.innerHTML = renderEmpty(params.message, params.buttonText);
      bindEmptyEvents(params.onClick);
      return;
    }

    if (name === "loading") {
      renderLoading(params.message || "読み込み中…");
      return;
    }
  }

  function renderLoading(message = "読み込み中…") {
    const screen = document.getElementById("screen");
    screen.innerHTML = `
      <section class="screen loading-wrap">
        <div class="center-box">
          <div class="spinner" aria-hidden="true"></div>
          <div>${escapeHTML(message)}</div>
        </div>
      </section>
    `;
  }

  function renderFatalError() {
    const screen = document.getElementById("screen");
    screen.innerHTML = `
      <section class="screen empty-wrap">
        <div class="center-box card">
          <h2 class="section-title">読み込みに失敗しました</h2>
          <p class="section-subtitle">questions.csv の配置や内容をご確認ください。</p>
        </div>
      </section>
    `;
  }

  function renderHome() {
    const stats = getProgressStats();

    return `
      <section class="screen home-screen">
        <div class="title-block title-block-with-icon">
          <div class="title-icon-wrap" aria-hidden="true">
            <img
              class="title-icon"
              src="${escapeAttr(ICON_IMAGE_PATH)}"
              alt=""
              onerror="this.style.display='none'; this.parentElement.classList.add('is-empty');"
            />
          </div>
          <div class="title-copy">
            <h1 class="app-title">たちばな</h1>
            <div class="app-subtitle">ぜんぶやる古典文法</div>
          </div>
        </div>

        <div class="button-row home-button-row">
          <button class="primary-btn large" id="start-normal">問題を解く</button>
          <button class="secondary-btn" id="start-random">ランダム10問</button>
          <button class="secondary-btn alt weak-mode-btn" id="start-weak">苦手問題</button>
        </div>

        <section class="card progress-card">
          <div class="progress-card-header">
            <h2 class="progress-card-title">学習進捗</h2>
            <button class="utility-btn" id="reset-progress-btn" type="button">リセット</button>
          </div>

          <div class="progress-meta-top">
            <span>進捗率</span>
            <strong>${stats.progressRate}%</strong>
          </div>

          ${renderProgressBar(stats)}

          <div class="progress-meta-bottom">
            <span>総問題数 ${stats.total}問</span>
            <span class="meta-danger">苦手 ${stats.weak}問</span>
            <span>未挑戦 ${stats.unseen}問</span>
          </div>
        </section>

        <div class="footer-links">
          <button class="footer-link" id="go-about" type="button">このサイトについて</button>
          <button class="footer-link" id="dummy-report" type="button">問題報告</button>
        </div>

        <div class="dialog-overlay" id="reset-dialog" hidden>
          <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title">
            <div class="dialog-title" id="reset-dialog-title">学習記録を全てリセットしますか？</div>
            <div class="dialog-actions">
              <button class="dialog-btn dialog-btn-secondary" id="reset-cancel-btn" type="button">いいえ</button>
              <button class="dialog-btn dialog-btn-primary" id="reset-confirm-btn" type="button">はい</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderAbout() {
    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back>＜</button>
          <div class="topbar-center"></div>
          <div class="topbar-right"></div>
        </div>

        <section class="card">
          <h2 class="section-title">このサイトについて</h2>
          <p class="question-text">ここにサイトの解説文が入ります</p>
        </section>
      </section>
    `;
  }

  function renderCategories() {
    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back>＜</button>
          <div class="topbar-center">カテゴリ選択</div>
          <div class="topbar-right"></div>
        </div>

        <div class="stack categories-stack">
          ${CATEGORY_ORDER.map(category => `
            <button class="list-card category-card" data-category="${escapeAttr(category)}" type="button">
              <div class="list-card-main">
                <div class="list-card-title">${escapeHTML(category)}</div>
              </div>
              <span class="chevron chevron-right" aria-hidden="true"></span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderSections(category) {
    const sections = CATEGORY_TO_SECTIONS[category] || [];

    return `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" data-back>＜</button>
          <div class="topbar-center">${escapeHTML(category)}</div>
          <div class="topbar-right"></div>
        </div>

        <div class="stack section-stack">
          ${sections.map(section => {
            const questions = filterQuestions({ category, section });
            const stats = getProgressStats(questions);
            const complete = stats.unseen === 0 && stats.weak === 0 && stats.total > 0;

            return `
              <button class="section-card" data-section="${escapeAttr(section)}" data-category="${escapeAttr(category)}" type="button">
                <div class="section-card-main">
                  <div class="section-card-header">
                    <div class="section-card-title-row">
                      <div class="section-card-title">${escapeHTML(section)}</div>
                      ${complete ? `<div class="complete-label complete-label-inline">COMPLETE！</div>` : ""}
                    </div>
                    <span class="chevron chevron-right section-card-chevron" aria-hidden="true"></span>
                  </div>
                  ${renderProgressBar(stats)}
                  <div class="progress-meta-bottom section-progress-meta">
                    <span>全${stats.total}問</span>
                    ${stats.weak > 0 ? `<span class="meta-danger">苦手${stats.weak}問</span>` : ""}
                    <span>未挑戦${stats.unseen}問</span>
                  </div>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderProgressBar(stats) {
    const total = Math.max(stats.total, 1);
    const solvedWidth = (stats.solved / total) * 100;
    const weakWidth = (stats.weak / total) * 100;
    const unseenWidth = Math.max(0, 100 - solvedWidth - weakWidth);

    return `
      <div class="progress-bar" aria-label="進捗ゲージ">
        <div class="progress-segment done" style="width:${solvedWidth}%"></div>
        <div class="progress-segment weak" style="width:${weakWidth}%"></div>
        <div class="progress-segment unseen" style="width:${unseenWidth}%"></div>
      </div>
    `;
  }

  function renderCountdown(label) {
    const screen = document.getElementById("screen");
    const session = appState.session;
    if (!session) return;

    screen.innerHTML = `
      <section class="screen countdown-wrap countdown-plain">
        <div class="countdown-label">${escapeHTML(label)}</div>
        <div class="countdown-number">${session.countdown}</div>
      </section>
    `;

    clearTimeout(session.timerId);

    session.timerId = window.setTimeout(() => {
      session.countdown -= 1;
      if (session.countdown <= 0) {
        goTo("quiz", {}, false);
      } else {
        renderCountdown(label);
      }
    }, 1000);
  }

  function renderQuizQuestion(revealState = null) {
    const screen = document.getElementById("screen");
    const session = appState.session;
    if (!session) return;

    const current = session.questions[session.currentIndex];
    const displayIndex = session.currentIndex + 1;
    const isWeakMode = session.mode === "weak";

    let overlayClass = "";
    let overlayMarkup = "";
    let selectedChoice = null;
    let isCorrect = false;

    if (revealState) {
      selectedChoice = revealState.selectedChoice;
      isCorrect = revealState.isCorrect;
      overlayClass = isCorrect ? "correct" : "incorrect";
      overlayMarkup = renderFeedbackIcon(isCorrect ? "correct" : "incorrect");
    }

    screen.innerHTML = `
      <section class="screen">
        <div class="topbar">
          <button class="back-btn" id="quiz-back">＜</button>
          <div class="topbar-center">${escapeHTML(session.title)}</div>
          <div class="topbar-right">${displayIndex}/${session.questions.length}</div>
        </div>

        <section class="card question-card">
          <div class="question-text">${escapeHTML(current.question)}</div>
          <div class="feedback-overlay ${overlayClass} ${revealState ? "show" : ""}">
            ${overlayMarkup}
          </div>
        </section>

        <div class="choice-list">
          ${current.shuffledChoices.map(choice => {
            let classes = ["choice-btn"];
            let icon = "";

            if (revealState) {
              if (choice === current.answer) {
                classes.push("correct");
                icon = "✓";
              } else if (choice === selectedChoice && !isCorrect) {
                classes.push("incorrect");
                icon = "×";
              } else {
                classes.push("dimmed");
              }
            }

            return `
              <button
                class="${classes.join(" ")}"
                data-choice="${escapeAttr(choice)}"
                ${revealState ? "disabled" : ""}
                type="button"
              >
                ${escapeHTML(choice)}
                ${icon ? `<span class="choice-icon">${icon}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>

        <div class="helper-link">
          <button id="unknown-btn" ${revealState ? "disabled" : ""} type="button">わからない</button>
        </div>

        ${isWeakMode && revealState && isCorrect && getQuestionState(current.id)?.weak ? `
          <div class="weak-remove-wrap" style="text-align:center;">
            <button class="inline-btn" id="remove-weak-btn" type="button">苦手からはずす</button>
          </div>
        ` : ""}
      </section>
    `;

    bindQuizEvents(revealState);
  }

  function renderResult() {
    const session = appState.session;
    if (!session) return "";

    const total = session.questions.length;
    const correctCount = session.answers.filter(a => a.isCorrect).length;
    const wrongAnswers = session.answers.filter(a => !a.isCorrect);

    return `
      <section class="screen">
        <div class="score-wrap">
          <div class="score-line">
            <span class="score-main">${correctCount}</span>
            <span class="score-total">/${total}</span>
          </div>
          <div class="score-message">
            ${correctCount === total ? "すばらしい！" : "お疲れさまでした"}
          </div>
        </div>

        ${wrongAnswers.length > 0 ? `
          <section class="stack result-stack">
            <h2 class="result-list-title">間違えた問題</h2>
            <div class="result-list result-list-static">
              ${wrongAnswers.map(item => `
                <article class="card">
                  <div class="result-card-question">${escapeHTML(item.question)}</div>
                  <div class="result-card-answer">
                    <span class="result-answer-label">正解：</span>
                    <span class="result-answer-text">${escapeHTML(item.answer)}</span>
                  </div>
                </article>
              `).join("")}
            </div>
          </section>
        ` : ""}

        <div class="button-row result-button-row">
          <button class="primary-btn" id="retry-btn" type="button">もう一度</button>
          <button class="secondary-btn" id="back-category-btn" type="button">カテゴリ選択へ</button>
          <button class="ghost-btn" id="to-home-btn" type="button">TOPへ</button>
        </div>
      </section>
    `;
  }

  function renderEmpty(message, buttonText) {
    return `
      <section class="screen empty-wrap">
        <div class="center-box card">
          <h2 class="section-title">${escapeHTML(message)}</h2>
          <div style="margin-top:18px;">
            <button class="primary-btn" id="empty-btn">${escapeHTML(buttonText)}</button>
          </div>
        </div>
      </section>
    `;
  }

  // ------------------------------
  // イベント紐付け
  // ------------------------------
  function bindHomeEvents() {
    document.getElementById("start-normal")?.addEventListener("click", () => {
      goTo("categories");
    });

    document.getElementById("start-random")?.addEventListener("click", () => {
      startQuiz("random");
    });

    document.getElementById("start-weak")?.addEventListener("click", () => {
      startQuiz("weak");
    });

    document.getElementById("go-about")?.addEventListener("click", () => {
      goTo("about");
    });

    document.getElementById("dummy-report")?.addEventListener("click", () => {
      alert("問題報告は現在準備中です。");
    });

    const dialog = document.getElementById("reset-dialog");
    const openBtn = document.getElementById("reset-progress-btn");
    const cancelBtn = document.getElementById("reset-cancel-btn");
    const confirmBtn = document.getElementById("reset-confirm-btn");

    openBtn?.addEventListener("click", () => {
      dialog?.removeAttribute("hidden");
    });

    cancelBtn?.addEventListener("click", () => {
      dialog?.setAttribute("hidden", "");
    });

    confirmBtn?.addEventListener("click", () => {
      clearProgressStorage();
      dialog?.setAttribute("hidden", "");
      rerenderCurrentView();
    });

    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.setAttribute("hidden", "");
      }
    });
  }

  function bindCommonBack() {
    document.querySelector("[data-back]")?.addEventListener("click", () => goBack());
  }

  function bindCategoryEvents() {
    document.querySelectorAll("[data-category]").forEach(button => {
      button.addEventListener("click", () => {
        const category = button.dataset.category;
        goTo("sections", { category });
      });
    });
  }

  function bindSectionEvents() {
    document.querySelectorAll("[data-section]").forEach(button => {
      button.addEventListener("click", () => {
        const category = button.dataset.category;
        const section = button.dataset.section;
        startQuiz("normal", { category, section });
      });
    });
  }

  function bindQuizEvents(revealState) {
    document.getElementById("quiz-back")?.addEventListener("click", () => {
      if (confirm("このセッションを中断して戻りますか？")) {
        appState.session = null;
        goBack("home");
      }
    });

    if (!revealState) {
      document.querySelectorAll("[data-choice]").forEach(btn => {
        btn.addEventListener("click", () => {
          answerCurrentQuestion(btn.dataset.choice, false);
        });
      });

      document.getElementById("unknown-btn")?.addEventListener("click", () => {
        answerCurrentQuestion("<<UNKNOWN>>", true);
      });
    }

    document.getElementById("remove-weak-btn")?.addEventListener("click", (event) => {
      removeWeakForCurrentQuestion();
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "解除しました";
    });
  }

  function bindResultEvents() {
    document.getElementById("retry-btn")?.addEventListener("click", () => {
      const session = appState.session;
      if (!session) return;
      startQuiz(session.mode, session.options);
    });

    document.getElementById("back-category-btn")?.addEventListener("click", () => {
      const session = appState.session;
      if (session?.mode === "normal" && session.options.category) {
        goTo("sections", { category: session.options.category }, false);
      } else {
        goTo("categories", {}, false);
      }
    });

    document.getElementById("to-home-btn")?.addEventListener("click", () => {
      appState.session = null;
      appState.history = [];
      goTo("home", {}, false);
    });
  }

  function bindEmptyEvents(onClick) {
    document.getElementById("empty-btn")?.addEventListener("click", () => {
      if (onClick === "home") {
        goTo("home", {}, false);
      } else {
        goBack("home");
      }
    });
  }

  // ------------------------------
  // ユーティリティ
  // ------------------------------
  function renderFeedbackIcon(type) {
    if (type === "correct") {
      return `
        <svg class="feedback-icon" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
          <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" stroke-width="10"></circle>
        </svg>
      `;
    }

    return `
      <svg class="feedback-icon" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path d="M34 34 L86 86" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"></path>
        <path d="M86 34 L34 86" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"></path>
      </svg>
    `;
  }

  function shuffle(array) {
    const copied = [...array];
    for (let i = copied.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copied[i], copied[j]] = [copied[j], copied[i]];
    }
    return copied;
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHTML(value);
  }
})();
