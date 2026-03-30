(() => {
  "use strict";

  const APP_TITLE = "たちばな ─ ぜんぶやる古典文法クイズ";
  const STORAGE_KEY = "tachibana-kobun-quiz-state-v1";
  const QUESTION_COUNT = 10;
  const FEEDBACK_DELAY = 3000;
  const COUNTDOWN_SECONDS = 3;
  const LAP_DISPLAY_MAX = 5;

  const CATEGORY_ORDER = ["動詞", "形容詞/形容動詞", "助動詞", "助詞", "識別", "演習"];
  const CATEGORY_LABELS = {
    動詞: "動詞",
    "形容詞/形容動詞": "形容詞 / 形容動詞",
    助動詞: "助動詞",
    助詞: "助詞",
    識別: "識別",
    演習: "演習",
  };

  const SECTION_ORDER = {
    動詞: ["動詞①", "動詞②"],
    "形容詞/形容動詞": ["形容詞", "形容動詞"],
    助動詞: ["助動詞①", "助動詞②"],
    助詞: ["助詞①", "助詞②"],
    識別: ["識別①", "識別②"],
    演習: ["演習①", "演習②"],
  };

  const MODE_LABELS = {
    normal: "通常モード",
    random: "ランダム10問",
    weak: "苦手問題",
  };

  const app = {
    root: null,
    questions: [],
    grouped: {
      byCategory: new Map(),
      bySection: new Map(),
    },
    storage: null,
    currentScreen: null,
    currentParams: {},
    historyStack: [],
    timers: {
      countdown: null,
      feedback: null,
    },
    countdownValue: COUNTDOWN_SECONDS,
    audio: null,
    quiz: null,
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    app.root = document.getElementById("app");
    safeSetDocumentTitle(APP_TITLE);
    renderLoading();
    app.storage = loadStorage();
    app.audio = prepareAudio("クイズ正解2.mp3");

    try {
      app.questions = await loadQuestions("questions.csv");
      initializeQuestionState(app.questions);
      buildQuestionIndexes();
      renderScreen("home", {}, { resetHistory: true });
    } catch (error) {
      console.error("問題データの読み込みに失敗しました", error);
      renderEmptyState("問題がありません", { showBack: false });
    }

    window.tachibanaQuizDebug = createDebugHelpers();
  }

  function safeSetDocumentTitle(title) {
    document.title = title;
  }

  function prepareAudio(src) {
    try {
      return new Audio(src);
    } catch (error) {
      console.warn("音声を準備できませんでした", error);
      return null;
    }
  }

  async function loadQuestions(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CSVの取得に失敗しました: ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCSV(csvText)
      .filter((row) => row.id && row.question)
      .map((row) => normalizeQuestionRow(row));

    return rows;
  }

  function parseCSV(text) {
    const rows = [];
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let current = "";
    let row = [];
    let insideQuotes = false;

    for (let i = 0; i < normalized.length; i += 1) {
      const char = normalized[i];
      const next = normalized[i + 1];

      if (char === '"') {
        if (insideQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (char === "," && !insideQuotes) {
        row.push(current);
        current = "";
        continue;
      }

      if (char === "\n" && !insideQuotes) {
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
        continue;
      }

      current += char;
    }

    if (current.length > 0 || row.length > 0) {
      row.push(current);
      rows.push(row);
    }

    if (!rows.length) {
      return [];
    }

    const headers = rows[0].map((item) => item.trim());
    return rows.slice(1).map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] != null ? values[index].trim() : "";
      });
      return record;
    });
  }

  function normalizeQuestionRow(row) {
    return {
      id: String(row.id).trim(),
      category: String(row.category).trim(),
      section: String(row.section).trim(),
      question: String(row.question).replace(/\\n/g, "\n").trim(),
      choices: [row.choice1, row.choice2, row.choice3, row.choice4].map((choice) => String(choice || "").replace(/\\n/g, "\n").trim()),
      answer: String(row.answer).replace(/\\n/g, "\n").trim(),
    };
  }

  function buildQuestionIndexes() {
    const byCategory = new Map();
    const bySection = new Map();

    app.questions.forEach((question) => {
      if (!byCategory.has(question.category)) {
        byCategory.set(question.category, []);
      }
      byCategory.get(question.category).push(question);

      const sectionKey = makeSectionKey(question.category, question.section);
      if (!bySection.has(sectionKey)) {
        bySection.set(sectionKey, []);
      }
      bySection.get(sectionKey).push(question);
    });

    app.grouped.byCategory = byCategory;
    app.grouped.bySection = bySection;
  }

  function makeSectionKey(category, section) {
    return `${category}__${section}`;
  }

  function loadStorage() {
    const fallback = createEmptyStorage();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return fallback;
      }
      const parsed = JSON.parse(raw);
      return {
        rounds: Number.isFinite(parsed.rounds) ? parsed.rounds : 0,
        questionStates: parsed.questionStates && typeof parsed.questionStates === "object" ? parsed.questionStates : {},
      };
    } catch (error) {
      console.warn("localStorageの読み込みに失敗したため初期化します", error);
      return fallback;
    }
  }

  function createEmptyStorage() {
    return {
      rounds: 0,
      questionStates: {},
    };
  }

  function saveStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app.storage));
  }

  function initializeStorage() {
    app.storage = createEmptyStorage();
    initializeQuestionState(app.questions);
    saveStorage();
  }

  function initializeQuestionState(questions) {
    questions.forEach((question) => {
      if (!app.storage.questionStates[question.id]) {
        app.storage.questionStates[question.id] = createDefaultQuestionState();
      } else {
        app.storage.questionStates[question.id] = {
          seen: Boolean(app.storage.questionStates[question.id].seen),
          weak: Boolean(app.storage.questionStates[question.id].weak),
          correctOnce: Boolean(app.storage.questionStates[question.id].correctOnce),
        };
      }
    });

    saveStorage();
  }

  function createDefaultQuestionState() {
    return {
      seen: false,
      weak: false,
      correctOnce: false,
    };
  }

  function getQuestionState(id) {
    if (!app.storage.questionStates[id]) {
      app.storage.questionStates[id] = createDefaultQuestionState();
      saveStorage();
    }
    return app.storage.questionStates[id];
  }

  function updateQuestionState(id, patch) {
    const next = { ...getQuestionState(id), ...patch };
    app.storage.questionStates[id] = next;
    saveStorage();
    return next;
  }

  function clearTimers() {
    if (app.timers.countdown) {
      clearInterval(app.timers.countdown);
      app.timers.countdown = null;
    }
    if (app.timers.feedback) {
      clearTimeout(app.timers.feedback);
      app.timers.feedback = null;
    }
  }

  function renderScreen(screen, params = {}, options = {}) {
    const { pushHistory = true, resetHistory = false } = options;
    clearTimers();

    if (resetHistory) {
      app.historyStack = [];
    } else if (pushHistory && app.currentScreen) {
      app.historyStack.push({
        screen: app.currentScreen,
        params: structuredCloneSafe(app.currentParams),
      });
    }

    app.currentScreen = screen;
    app.currentParams = params;

    switch (screen) {
      case "home":
        renderHome();
        break;
      case "about":
        renderAbout();
        break;
      case "categories":
        renderCategories();
        break;
      case "sections":
        renderSections(params.category);
        break;
      case "countdown":
        renderCountdown(params);
        break;
      case "quiz":
        renderQuiz();
        break;
      case "result":
        renderResult();
        break;
      case "empty":
        renderEmptyState(params.message, params);
        break;
      default:
        renderHome();
        break;
    }
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function goBack() {
    clearTimers();
    const previous = app.historyStack.pop();
    if (!previous) {
      renderScreen("home", {}, { resetHistory: true, pushHistory: false });
      return;
    }

    app.currentScreen = previous.screen;
    app.currentParams = previous.params;
    renderScreen(previous.screen, previous.params, { pushHistory: false });
  }

  function renderLoading() {
    app.root.innerHTML = `
      <section class="screen loading-state">
        <div class="spinner" aria-hidden="true"></div>
        <div class="loading-state__message">読み込み中…</div>
      </section>
    `;
  }

  function renderEmptyState(message, options = {}) {
    const { showBack = true, topOnly = true } = options;

    app.root.innerHTML = `
      <section class="screen">
        ${showBack ? renderTopBar({ back: true }) : "<div class=\"top-bar\"></div>"}
        <div class="empty-state">
          <div class="empty-state__message">${escapeHTML(message)}</div>
          <button class="button js-top-home">TOPへ</button>
          ${!topOnly ? '<button class="outline-button js-go-back">戻る</button>' : ""}
        </div>
      </section>
    `;

    app.root.querySelector(".js-top-home")?.addEventListener("click", () => {
      renderScreen("home", {}, { resetHistory: true, pushHistory: false });
    });
    app.root.querySelector(".js-go-back")?.addEventListener("click", goBack);
    bindBackButtons();
  }

  function renderTopBar({ back = false, title = "", right = "" } = {}) {
    return `
      <div class="top-bar ${title && !back && !right ? "top-bar--title-only" : ""}">
        <div>
          ${back ? renderBackButton() : ""}
        </div>
        ${title ? `<h1 class="screen-heading">${escapeHTML(title)}</h1>` : "<div></div>"}
        <div>${right}</div>
      </div>
    `;
  }

  function renderBackButton() {
    return `
      <button class="back-button js-back" type="button" aria-label="戻る">
        <span class="back-button__icon" aria-hidden="true"></span>
        <span class="back-button__label">戻る</span>
      </button>
    `;
  }

  function bindBackButtons() {
    app.root.querySelectorAll(".js-back").forEach((button) => {
      button.addEventListener("click", goBack);
    });
  }

  function renderHome() {
    const progress = getOverallProgress();

    app.root.innerHTML = `
      <section class="screen home-screen">
        <div class="home-main">
          <div class="brand-block">
            <img class="brand-icon" src="アイコンイラスト.png" alt="橘のアイコン" />
            <div class="brand-copy">
              <h1 class="brand-title">たちばな</h1>
              <div class="brand-subtitle">ぜんぶやる古典文法</div>
            </div>
          </div>

          <div class="home-actions">
            <button class="button js-open-categories" type="button">問題を解く</button>
            <button class="button button--secondary js-start-random" type="button">ランダム10問</button>
            <button class="button button--weak js-start-weak" type="button">苦手問題</button>
          </div>

          <section class="card home-progress-card" aria-label="学習進捗">
            <h2 class="card-title">学習進捗</h2>
            ${renderLapDots(progress.rounds)}
            <div class="lap-label">周回数 ${escapeHTML(String(Math.min(progress.rounds, LAP_DISPLAY_MAX)))} / 5</div>
            ${renderProgressBar(progress)}
            <div class="progress-meta">
              <span>総${progress.total}問</span>
              <span class="progress-meta__weak">苦手${progress.weak}問</span>
              <span>未挑戦${progress.unseen}問</span>
            </div>
          </section>
        </div>

        <footer class="footer-links">
          <button class="footer-link js-open-about" type="button">このサイトについて</button>
          <button class="footer-link is-disabled" type="button">問題報告</button>
        </footer>
      </section>
    `;

    app.root.querySelector(".js-open-categories")?.addEventListener("click", () => {
      renderScreen("categories");
    });

    app.root.querySelector(".js-open-about")?.addEventListener("click", () => {
      renderScreen("about");
    });

    app.root.querySelector(".js-start-random")?.addEventListener("click", () => {
      startQuizFlow({ mode: "random" });
    });

    app.root.querySelector(".js-start-weak")?.addEventListener("click", () => {
      startQuizFlow({ mode: "weak" });
    });
  }

  function renderLapDots(rounds) {
    const activeCount = Math.min(rounds, LAP_DISPLAY_MAX);
    const dots = Array.from({ length: LAP_DISPLAY_MAX }, (_, index) => {
      const active = index < activeCount ? " is-on" : "";
      return `<span class="lap-dot${active}" aria-hidden="true"></span>`;
    }).join("");

    return `<div class="lap-dots" aria-label="周回インジケーター">${dots}</div>`;
  }

  function renderProgressBar(progress) {
    const clearPercent = progress.total ? (progress.clear / progress.total) * 100 : 0;
    const weakPercent = progress.total ? (progress.weak / progress.total) * 100 : 0;
    const unseenPercent = progress.total ? (progress.unseen / progress.total) * 100 : 0;

    return `
      <div class="progress-rate">
        <span class="progress-rate__label">進捗率</span>
        <span class="progress-rate__value">${progress.rate}%</span>
      </div>
      <div class="progress-bar" aria-hidden="true">
        <span class="progress-bar__segment progress-bar__segment--clear" style="width:${clearPercent}%"></span>
        <span class="progress-bar__segment progress-bar__segment--weak" style="width:${weakPercent}%"></span>
        <span class="progress-bar__segment progress-bar__segment--unseen" style="width:${unseenPercent}%"></span>
      </div>
    `;
  }

  function renderAbout() {
    app.root.innerHTML = `
      <section class="screen info-screen">
        ${renderTopBar({ back: true, title: "このサイトについて" })}
        <section class="card">
          <p class="info-body">ここにサイトの解説文が入ります</p>
        </section>
      </section>
    `;

    bindBackButtons();
  }

  function renderCategories() {
    const categories = CATEGORY_ORDER.filter((category) => app.grouped.byCategory.has(category));

    app.root.innerHTML = `
      <section class="screen">
        ${renderTopBar({ back: true, title: "カテゴリ選択" })}
        <div class="list-stack">
          ${categories
            .map((category) => {
              return `
                <button class="category-card js-category" data-category="${escapeAttribute(category)}" type="button">
                  <span class="category-card__label">${escapeHTML(CATEGORY_LABELS[category] || category)}</span>
                  <span class="card-arrow" aria-hidden="true">›</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>
    `;

    bindBackButtons();

    app.root.querySelectorAll(".js-category").forEach((button) => {
      button.addEventListener("click", () => {
        const category = button.dataset.category;
        renderScreen("sections", { category });
      });
    });
  }

  function renderSections(category) {
    const sections = getSectionsForCategory(category);
    const categoryLabel = CATEGORY_LABELS[category] || category;

    app.root.innerHTML = `
      <section class="screen">
        ${renderTopBar({ back: true, title: categoryLabel })}
        <div class="list-stack">
          ${sections
            .map((section) => {
              const stats = getSectionProgress(category, section);
              return `
                <button class="section-card js-section" data-category="${escapeAttribute(category)}" data-section="${escapeAttribute(section)}" type="button">
                  <div class="section-card__head">
                    <span class="section-card__title">${escapeHTML(section)}</span>
                    <span class="card-arrow" aria-hidden="true">›</span>
                  </div>
                  ${renderProgressBar(stats)}
                  <div class="section-card__meta">
                    <span>全${stats.total}問</span>
                    ${stats.weak > 0 ? `<span class="section-card__weak">苦手${stats.weak}問</span>` : ""}
                    ${stats.complete ? `<span class="section-card__complete">COMPLETE！</span>` : `<span>未挑戦${stats.unseen}問</span>`}
                  </div>
                </button>
              `;
            })
            .join("")}
        </div>
      </section>
    `;

    bindBackButtons();

    app.root.querySelectorAll(".js-section").forEach((button) => {
      button.addEventListener("click", () => {
        startQuizFlow({
          mode: "normal",
          category: button.dataset.category,
          section: button.dataset.section,
        });
      });
    });
  }

  function renderCountdown(params) {
    app.countdownValue = COUNTDOWN_SECONDS;
    const label = getCountdownLabel(params);

    app.root.innerHTML = `
      <section class="screen countdown-screen">
        ${renderTopBar({ back: true })}
        <div class="screen--center" style="flex:1; gap:12px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
          <div class="countdown-label">${escapeHTML(label)}</div>
          <div class="countdown-number js-countdown-number">${app.countdownValue}</div>
        </div>
      </section>
    `;

    bindBackButtons();

    app.timers.countdown = setInterval(() => {
      app.countdownValue -= 1;
      const target = app.root.querySelector(".js-countdown-number");
      if (!target) {
        clearTimers();
        return;
      }

      if (app.countdownValue <= 0) {
        clearInterval(app.timers.countdown);
        app.timers.countdown = null;
        renderScreen("quiz", {}, { pushHistory: false });
        return;
      }

      target.textContent = String(app.countdownValue);
    }, 1000);
  }

  function getCountdownLabel(params) {
    if (params.mode === "normal") {
      return `${CATEGORY_LABELS[params.category] || params.category} / ${params.section}`;
    }
    return MODE_LABELS[params.mode] || "クイズ";
  }

  function startQuizFlow(config) {
    const session = buildQuizSession(config);

    if (!session.questions.length) {
      const message = config.mode === "weak" ? "苦手問題はありません" : "問題がありません";
      renderScreen(
        "empty",
        { message, showBack: config.mode === "normal", topOnly: true },
        { pushHistory: true }
      );
      return;
    }

    app.quiz = session;
    renderScreen("countdown", config);
  }

  function buildQuizSession(config) {
    const sourceQuestions = resolveSourceQuestions(config);
    const sessionQuestions = pickQuestionsForSession(sourceQuestions, QUESTION_COUNT);

    return {
      mode: config.mode,
      category: config.category || null,
      section: config.section || null,
      questions: sessionQuestions.map((question, index) => createSessionQuestion(question, index)),
      currentIndex: 0,
      correctCount: 0,
      mistakes: [],
      answered: false,
    };
  }

  function createSessionQuestion(question, index) {
    const choices = shuffleArray(question.choices.map((choice) => ({ value: choice })));
    return {
      sessionIndex: index,
      question,
      choices,
      selectedValue: null,
      answerState: null,
      weakRemoved: false,
    };
  }

  function resolveSourceQuestions(config) {
    if (config.mode === "random") {
      return [...app.questions];
    }

    if (config.mode === "weak") {
      return app.questions.filter((question) => getQuestionState(question.id).weak);
    }

    if (config.mode === "normal") {
      const key = makeSectionKey(config.category, config.section);
      return app.grouped.bySection.get(key) ? [...app.grouped.bySection.get(key)] : [];
    }

    return [];
  }

  function pickQuestionsForSession(sourceQuestions, desiredCount) {
    if (!sourceQuestions.length) {
      return [];
    }

    const unseen = shuffleArray(sourceQuestions.filter((question) => !getQuestionState(question.id).seen));
    const seen = shuffleArray(sourceQuestions.filter((question) => getQuestionState(question.id).seen));
    const result = [];
    const usedIds = new Set();

    unseen.forEach((question) => {
      if (result.length < desiredCount && !usedIds.has(question.id)) {
        result.push(question);
        usedIds.add(question.id);
      }
    });

    seen.forEach((question) => {
      if (result.length < desiredCount && !usedIds.has(question.id)) {
        result.push(question);
        usedIds.add(question.id);
      }
    });

    if (result.length >= desiredCount) {
      return result;
    }

    const reusablePool = shuffleArray([...sourceQuestions]);
    let poolIndex = 0;
    while (result.length < desiredCount) {
      result.push(reusablePool[poolIndex % reusablePool.length]);
      poolIndex += 1;
    }

    return result;
  }

  function renderQuiz() {
    if (!app.quiz || !app.quiz.questions.length) {
      renderScreen("home", {}, { resetHistory: true, pushHistory: false });
      return;
    }

    const item = app.quiz.questions[app.quiz.currentIndex];
    const isAnswered = Boolean(item.answerState);
    const currentQuestion = item.question;
    const categoryLabel = app.quiz.mode === "normal" ? CATEGORY_LABELS[app.quiz.category] || app.quiz.category : MODE_LABELS[app.quiz.mode];
    const overlaySymbol = item.answerState === "correct" ? "○" : item.answerState === "wrong" ? "×" : "";

    app.root.innerHTML = `
      <section class="screen quiz-screen">
        <div class="quiz-top">
          ${renderBackButton()}
          <div class="quiz-category">${escapeHTML(categoryLabel)}</div>
          <div class="quiz-counter">${app.quiz.currentIndex + 1}/${app.quiz.questions.length}</div>
        </div>

        <section class="card quiz-question-card">
          <div class="answer-overlay ${isAnswered ? "is-visible" : ""}" aria-hidden="true">${overlaySymbol}</div>
          <p class="quiz-question">${escapeHTML(currentQuestion.question)}</p>
        </section>

        <div class="choice-list">
          ${item.choices
            .map((choice, index) => renderChoiceButton(item, choice, index))
            .join("")}
        </div>

        <div class="unknown-link-wrap">
          ${!isAnswered ? '<button class="ghost-button js-unknown" type="button">わからない</button>' : ""}
        </div>

        <div class="remove-weak-wrap">
          ${renderRemoveWeakButton(item)}
        </div>
      </section>
    `;

    bindBackButtons();
    bindQuizInteractions(item);
  }

  function renderChoiceButton(item, choice, index) {
    const classNames = ["choice-button"];
    let icon = "";

    if (item.selectedValue === choice.value && !item.answerState) {
      classNames.push("is-selected");
    }

    if (item.answerState) {
      if (choice.value === item.question.answer) {
        classNames.push("is-correct");
        icon = "✓";
      } else if (item.selectedValue === choice.value && item.answerState === "wrong") {
        classNames.push("is-wrong");
        icon = "×";
      } else {
        classNames.push("is-dimmed");
      }
    }

    return `
      <button
        class="${classNames.join(" ")} js-choice"
        data-index="${index}"
        data-value="${escapeAttribute(choice.value)}"
        type="button"
        ${item.answerState ? "disabled" : ""}
      >
        <span class="choice-button__label">${escapeHTML(choice.value)}</span>
        <span class="choice-button__icon" aria-hidden="true">${icon}</span>
      </button>
    `;
  }

  function renderRemoveWeakButton(item) {
    const state = getQuestionState(item.question.id);
    const canShow = app.quiz.mode === "weak" && item.answerState === "correct";
    if (!canShow) {
      return "";
    }

    const doneClass = item.weakRemoved || !state.weak ? " is-done" : "";
    const label = item.weakRemoved || !state.weak ? "OK" : "苦手からはずす";

    return `
      <button class="remove-weak-button${doneClass} js-remove-weak" type="button">
        ${escapeHTML(label)}
      </button>
    `;
  }

  function bindQuizInteractions(item) {
    app.root.querySelectorAll(".js-choice").forEach((button) => {
      button.addEventListener("click", () => {
        const selectedValue = button.dataset.value;
        handleAnswer(selectedValue);
      });
    });

    app.root.querySelector(".js-unknown")?.addEventListener("click", () => {
      handleAnswer(null);
    });

    app.root.querySelector(".js-remove-weak")?.addEventListener("click", () => {
      if (item.weakRemoved) {
        return;
      }
      updateQuestionState(item.question.id, { weak: false });
      item.weakRemoved = true;
      renderQuiz();
    });
  }

  function handleAnswer(selectedValue) {
    const item = app.quiz.questions[app.quiz.currentIndex];
    if (item.answerState) {
      return;
    }

    item.selectedValue = selectedValue;
    const isCorrect = selectedValue === item.question.answer;
    item.answerState = isCorrect ? "correct" : "wrong";

    markQuestionAsSeen(item.question.id);

    if (isCorrect) {
      markQuestionCorrect(item.question.id);
      app.quiz.correctCount += 1;
      playCorrectSound();
    } else {
      updateQuestionState(item.question.id, { weak: true });
      app.quiz.mistakes.push({
        question: item.question.question,
        answer: item.question.answer,
      });
    }

    renderQuiz();

    app.timers.feedback = setTimeout(() => {
      moveToNextQuestion();
    }, FEEDBACK_DELAY);
  }

  function playCorrectSound() {
    if (!app.audio) {
      return;
    }

    try {
      app.audio.currentTime = 0;
      app.audio.play().catch(() => {});
    } catch (error) {
      console.warn("正解音を再生できませんでした", error);
    }
  }

  function moveToNextQuestion() {
    if (!app.quiz) {
      return;
    }

    if (app.quiz.currentIndex >= app.quiz.questions.length - 1) {
      renderScreen("result", {}, { pushHistory: false });
      return;
    }

    app.quiz.currentIndex += 1;
    renderQuiz();
  }

  function renderResult() {
    if (!app.quiz) {
      renderScreen("home", {}, { resetHistory: true, pushHistory: false });
      return;
    }

    const total = app.quiz.questions.length;
    const perfect = app.quiz.correctCount === total;
    const showCategoryButton = app.quiz.mode === "normal";

    app.root.innerHTML = `
      <section class="screen result-screen">
        ${renderTopBar({ back: true })}

        <div class="score-block">
          <div class="score-main">
            <span class="score-main__current">${app.quiz.correctCount}</span><span class="score-main__total">/${total}</span>
          </div>
          <div class="score-message">${perfect ? "すばらしい！" : "お疲れさまでした"}</div>
        </div>

        ${
          perfect
            ? ""
            : `
          <section>
            <h2 class="result-section-title">間違えた問題</h2>
            <div class="list-stack">
              ${app.quiz.mistakes
                .map(
                  (mistake) => `
                    <article class="card mistake-card">
                      <p class="mistake-question">${escapeHTML(mistake.question)}</p>
                      <p class="mistake-answer">
                        <span class="mistake-answer__label">正解：</span>
                        <span class="mistake-answer__value">${escapeHTML(mistake.answer)}</span>
                      </p>
                    </article>
                  `
                )
                .join("")}
            </div>
          </section>
        `
        }

        <div class="result-actions">
          <button class="button js-retry" type="button">もう一度</button>
          ${showCategoryButton ? '<button class="outline-button js-categories" type="button">カテゴリ選択へ</button>' : ""}
          <button class="outline-button js-home" type="button">TOPへ</button>
        </div>
      </section>
    `;

    bindBackButtons();

    app.root.querySelector(".js-retry")?.addEventListener("click", () => {
      startQuizFlow({
        mode: app.quiz.mode,
        category: app.quiz.category,
        section: app.quiz.section,
      });
    });

    app.root.querySelector(".js-categories")?.addEventListener("click", () => {
      renderScreen("categories");
    });

    app.root.querySelector(".js-home")?.addEventListener("click", () => {
      renderScreen("home", {}, { resetHistory: true, pushHistory: false });
    });
  }

  function markQuestionAsSeen(questionId) {
    updateQuestionState(questionId, { seen: true });
  }

  function markQuestionCorrect(questionId) {
    updateQuestionState(questionId, { correctOnce: true });
    processRoundIfCompleted();
  }

  function processRoundIfCompleted() {
    const allCorrectInRound = app.questions.every((question) => getQuestionState(question.id).correctOnce);
    if (!allCorrectInRound) {
      return;
    }

    app.questions.forEach((question) => {
      const state = getQuestionState(question.id);
      app.storage.questionStates[question.id] = {
        ...state,
        seen: false,
        correctOnce: false,
      };
    });

    app.storage.rounds += 1;
    saveStorage();
  }

  function getOverallProgress() {
    const total = app.questions.length;
    let clear = 0;
    let weak = 0;
    let unseen = 0;

    app.questions.forEach((question) => {
      const state = getQuestionState(question.id);
      if (state.correctOnce) {
        clear += 1;
      }
      if (state.weak) {
        weak += 1;
      }
      if (!state.seen) {
        unseen += 1;
      }
    });

    const rate = total ? Math.round((clear / total) * 100) : 0;

    return {
      total,
      clear,
      weak,
      unseen,
      rate,
      rounds: app.storage.rounds,
      complete: unseen === 0 && weak === 0,
    };
  }

  function getSectionProgress(category, section) {
    const key = makeSectionKey(category, section);
    const questions = app.grouped.bySection.get(key) || [];
    const total = questions.length;
    let clear = 0;
    let weak = 0;
    let unseen = 0;

    questions.forEach((question) => {
      const state = getQuestionState(question.id);
      if (state.correctOnce) {
        clear += 1;
      }
      if (state.weak) {
        weak += 1;
      }
      if (!state.seen) {
        unseen += 1;
      }
    });

    return {
      total,
      clear,
      weak,
      unseen,
      rate: total ? Math.round((clear / total) * 100) : 0,
      complete: weak === 0 && unseen === 0,
    };
  }

  function getSectionsForCategory(category) {
    const configured = SECTION_ORDER[category] || [];
    const existing = [...(app.grouped.byCategory.get(category) || [])].map((item) => item.section);
    const merged = [...configured];

    existing.forEach((section) => {
      if (!merged.includes(section)) {
        merged.push(section);
      }
    });

    return merged.filter((section) => (app.grouped.bySection.get(makeSectionKey(category, section)) || []).length > 0);
  }

  function shuffleArray(items) {
    const array = [...items];
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/\n/g, "&#10;");
  }

  function createDebugHelpers() {
    return {
      getStorage: () => structuredCloneSafe(app.storage),
      getQuestions: () => structuredCloneSafe(app.questions),
      resetStorage: () => {
        initializeStorage();
        renderScreen("home", {}, { resetHistory: true, pushHistory: false });
      },
      getProgress: () => getOverallProgress(),
    };
  }
})();
