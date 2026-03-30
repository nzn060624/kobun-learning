const STORAGE_KEY = 'tachibana_quiz_state_v2';
const CSV_PATH = 'questions.csv';
const TITLE_ICON_PATH = 'アイコンイラスト.png';
const CORRECT_SOUND_PATH = 'クイズ正解2.mp3';
const TROPHY_YELLOW_PATH = '優勝カップ_イエロー.png';
const TROPHY_GRAY_PATH = '優勝カップ_グレー.png';
const MAX_LAPS = 5;
const QUIZ_COUNT = 10;
const QUESTION_DELAY = 3000;

const CATEGORY_SECTIONS = {
  '動詞': ['動詞①', '動詞②'],
  '形容詞 / 形容動詞': ['形容詞', '形容動詞'],
  '助動詞': ['助動詞①', '助動詞②'],
  '助詞': ['助詞①', '助詞②'],
  '識別': ['識別①', '識別②'],
  '演習': ['演習①', '演習②'],
};

const app = document.getElementById('app');

const state = {
  loading: true,
  questions: [],
  routeStack: [],
  currentView: { name: 'loading' },
  storage: loadStorage(),
  session: null,
  countdownTimer: null,
  questionTimer: null,
  audio: null,
};

init();

async function init() {
  try {
    state.audio = new Audio(CORRECT_SOUND_PATH);
  } catch (error) {
    state.audio = null;
  }

  render();
  try {
    state.questions = await loadQuestions();
    syncStorageWithQuestions();
    state.loading = false;
    navigate({ name: 'home' }, false);
  } catch (error) {
    console.error(error);
    state.loading = false;
    navigate({ name: 'empty', message: '問題がありません' }, false);
  }
}

function loadStorage() {
  const fallback = { perQuestion: {}, laps: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      perQuestion: parsed.perQuestion || {},
      laps: Math.min(MAX_LAPS, Number(parsed.laps) || 0),
    };
  } catch {
    return fallback;
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.storage));
}

function syncStorageWithQuestions() {
  const next = {};
  for (const q of state.questions) {
    const current = state.storage.perQuestion[q.id] || {};
    next[q.id] = {
      seen: Boolean(current.seen),
      mastered: Boolean(current.mastered),
      weak: Boolean(current.weak),
    };
  }
  state.storage.perQuestion = next;
  saveStorage();
}

async function loadQuestions() {
  const response = await fetch(CSV_PATH, { cache: 'no-store' });
  if (!response.ok) throw new Error('CSVの読み込みに失敗しました');
  const text = await response.text();
  return parseCsv(text).map((row) => ({
    ...row,
    question: normalizeMultiline(row.question || ''),
    choices: shuffle([row.choice1, row.choice2, row.choice3, row.choice4].filter(Boolean)),
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((key, index) => [key, r[index] || ''])));
}

function normalizeMultiline(value) {
  return value.replace(/\\n/g, '\n');
}

function navigate(view, push = true) {
  clearTimers();
  if (push && state.currentView) {
    state.routeStack.push(state.currentView);
  }
  state.currentView = view;
  render();
}

function goBack() {
  clearTimers();
  const prev = state.routeStack.pop();
  if (prev) {
    state.currentView = prev;
    render();
  } else {
    navigate({ name: 'home' }, false);
  }
}

function clearTimers() {
  window.clearInterval(state.countdownTimer);
  window.clearTimeout(state.questionTimer);
  state.countdownTimer = null;
  state.questionTimer = null;
}

function getQuestionState(id) {
  return state.storage.perQuestion[id] || { seen: false, mastered: false, weak: false };
}

function setQuestionState(id, patch) {
  const current = getQuestionState(id);
  state.storage.perQuestion[id] = { ...current, ...patch };
  saveStorage();
}

function maybeAdvanceLap() {
  const allMastered = state.questions.length > 0 && state.questions.every((q) => getQuestionState(q.id).mastered);
  if (!allMastered) return;

  state.storage.laps = Math.min(MAX_LAPS, state.storage.laps + 1);
  const next = {};
  for (const q of state.questions) {
    next[q.id] = { seen: false, mastered: false, weak: false };
  }
  state.storage.perQuestion = next;
  saveStorage();
}

function getGlobalStats() {
  const total = state.questions.length;
  let clear = 0;
  let weak = 0;
  let unseen = 0;

  for (const q of state.questions) {
    const s = getQuestionState(q.id);
    if (s.mastered) clear += 1;
    if (s.weak) weak += 1;
    if (!s.seen) unseen += 1;
  }

  return {
    total,
    clear,
    weak,
    unseen,
    rate: total ? Math.round((clear / total) * 100) : 0,
    laps: state.storage.laps,
  };
}

function getSectionStats(sectionName) {
  const pool = state.questions.filter((q) => q.section === sectionName);
  const total = pool.length;
  let clear = 0;
  let weak = 0;
  let unseen = 0;
  for (const q of pool) {
    const s = getQuestionState(q.id);
    if (s.mastered) clear += 1;
    if (s.weak) weak += 1;
    if (!s.seen) unseen += 1;
  }
  return { total, clear, weak, unseen, complete: total > 0 && weak === 0 && unseen === 0 };
}

function buildQuizPool(mode, category = '', section = '') {
  if (mode === 'normal') {
    return state.questions.filter((q) => toDisplayCategory(q.category) === category && q.section === section);
  }
  if (mode === 'random') return [...state.questions];
  if (mode === 'weak') return state.questions.filter((q) => getQuestionState(q.id).weak);
  return [];
}

function selectQuestions(mode, category = '', section = '') {
  const pool = buildQuizPool(mode, category, section);
  if (mode === 'weak' && pool.length === 0) return [];

  const unseen = pool.filter((q) => !getQuestionState(q.id).seen);
  const seen = pool.filter((q) => getQuestionState(q.id).seen);
  const first = shuffle(unseen).slice(0, QUIZ_COUNT);
  const need = QUIZ_COUNT - first.length;
  const second = need > 0 ? shuffle(seen).slice(0, need) : [];
  return [...first, ...second].map((q) => ({
    ...q,
    choices: shuffle([q.choice1, q.choice2, q.choice3, q.choice4].filter(Boolean)),
  }));
}

function startQuiz(mode, category = '', section = '') {
  const items = selectQuestions(mode, category, section);
  if (items.length === 0) {
    navigate({ name: 'empty', message: mode === 'weak' ? '苦手問題はありません' : '問題がありません' });
    return;
  }

  state.session = {
    mode,
    category,
    section,
    label: mode === 'normal' ? category : (mode === 'random' ? 'ランダム10問' : '苦手問題'),
    questions: items,
    currentIndex: 0,
    answers: [],
    phase: 'countdown',
    countdown: 3,
    selectedChoice: null,
    currentResult: null,
    weakRemoved: false,
  };

  navigate({ name: 'countdown' });
  startCountdown();
}

function startCountdown() {
  state.session.phase = 'countdown';
  state.session.countdown = 3;
  render();
  state.countdownTimer = window.setInterval(() => {
    state.session.countdown -= 1;
    if (state.session.countdown <= 0) {
      window.clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      state.session.phase = 'question';
      render();
    } else {
      render();
    }
  }, 1000);
}

function currentQuestion() {
  return state.session.questions[state.session.currentIndex];
}

function answerQuestion(choiceText, isUnknown = false) {
  if (!state.session || state.session.currentResult) return;

  const question = currentQuestion();
  const correct = !isUnknown && choiceText === question.answer;
  const qState = getQuestionState(question.id);

  setQuestionState(question.id, {
    seen: true,
    mastered: qState.mastered || correct,
    weak: correct ? qState.weak : true,
  });

  maybeAdvanceLap();

  state.session.selectedChoice = choiceText;
  state.session.currentResult = {
    correct,
    answer: question.answer,
  };
  state.session.answers.push({
    id: question.id,
    question: question.question,
    correct,
    answer: question.answer,
    selectedChoice: choiceText,
  });
  state.session.weakRemoved = false;

  if (correct && state.audio) {
    state.audio.currentTime = 0;
    state.audio.play().catch(() => {});
  }

  render();

  state.questionTimer = window.setTimeout(() => {
    state.session.currentIndex += 1;
    state.session.selectedChoice = null;
    state.session.currentResult = null;
    state.session.weakRemoved = false;

    if (state.session.currentIndex >= state.session.questions.length) {
      navigate({ name: 'result' });
    } else {
      render();
    }
  }, QUESTION_DELAY);
}

function removeWeakCurrentQuestion() {
  const question = currentQuestion();
  if (!question || !state.session?.currentResult?.correct || state.session.mode !== 'weak' || state.session.weakRemoved) return;
  setQuestionState(question.id, { weak: false });
  state.session.weakRemoved = true;
  render();
}

function restartCurrentMode() {
  if (!state.session) return;
  startQuiz(state.session.mode, state.session.category, state.session.section);
}

function toDisplayCategory(raw) {
  if (raw === '形容詞/形容動詞') return '形容詞 / 形容動詞';
  return raw;
}

function shuffle(array) {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function progressSegments(stats) {
  const total = stats.total || 1;
  return `
    <div class="progress-segment progress-clear" style="width:${(stats.clear / total) * 100}%"></div>
    <div class="progress-segment progress-weak" style="width:${(stats.weak / total) * 100}%"></div>
    <div class="progress-segment progress-unseen" style="width:${(stats.unseen / total) * 100}%"></div>
  `;
}

function renderTrophies(laps) {
  return Array.from({ length: 5 }, (_, index) => {
    const src = index < laps ? TROPHY_YELLOW_PATH : TROPHY_GRAY_PATH;
    return `<img class="trophy" src="${src}" alt="トロフィー${index + 1}" />`;
  }).join('');
}

function render() {
  if (state.loading || state.currentView.name === 'loading') {
    app.innerHTML = `
      <section class="loading-state">
        <div class="spinner"></div>
        <p>読み込み中…</p>
      </section>
    `;
    return;
  }

  const view = state.currentView.name;
  if (view === 'home') return renderHome();
  if (view === 'about') return renderAbout();
  if (view === 'categories') return renderCategories();
  if (view === 'sections') return renderSections(state.currentView.category);
  if (view === 'countdown') return renderCountdown();
  if (view === 'question') return renderQuestion();
  if (view === 'result') return renderResult();
  if (view === 'empty') return renderEmpty(state.currentView.message);
}

function renderHome() {
  const stats = getGlobalStats();
  app.innerHTML = `
    <section class="screen">
      <div class="hero">
        <div class="title-row">
          <img class="title-icon" src="${TITLE_ICON_PATH}" alt="たちばなのアイコン" />
          <div class="title-copy">
            <h1 class="site-title">たちばな</h1>
            <p class="site-subtitle">ぜんぶやる古典文法</p>
          </div>
        </div>
      </div>

      <div class="button-stack">
        <button class="btn btn-primary" data-action="to-categories">問題を解く</button>
        <button class="btn btn-secondary" data-action="random">ランダム10問</button>
        <button class="btn btn-weak" data-action="weak">苦手問題</button>
      </div>

      <section class="progress-card">
        <div class="progress-header">
          <h2 class="progress-title">学習進捗</h2>
        </div>
        <div class="trophies">${renderTrophies(stats.laps)}</div>
        <div class="progress-bar">${progressSegments(stats)}</div>
        <div class="progress-rate">${stats.rate}%</div>
        <div class="progress-meta">
          <span>全${stats.total}問</span>
          <span class="weak">苦手${stats.weak}問</span>
          <span>未挑戦${stats.unseen}問</span>
        </div>
      </section>

      <div class="footer-links">
        <button data-action="about">このサイトについて</button>
        <button type="button" aria-disabled="true">問題報告</button>
      </div>
    </section>
  `;

  bindActions([
    ['[data-action="to-categories"]', () => navigate({ name: 'categories' })],
    ['[data-action="random"]', () => startQuiz('random')],
    ['[data-action="weak"]', () => startQuiz('weak')],
    ['[data-action="about"]', () => navigate({ name: 'about' })],
  ]);
}

function renderAbout() {
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="back-button" aria-label="戻る" data-action="back"></button>
        <div class="topbar-center"></div>
        <div class="topbar-right"></div>
      </div>
      <h2 class="screen-title">このサイトについて</h2>
      <section class="info-card">
        <p>ここにサイトの解説文が入ります</p>
      </section>
    </section>
  `;
  bindBack();
}

function renderCategories() {
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="back-button" aria-label="戻る" data-action="back"></button>
        <div class="topbar-center"></div>
        <div class="topbar-right"></div>
      </div>
      <h2 class="screen-title">カテゴリ選択</h2>
      <div class="cards-list">
        ${Object.keys(CATEGORY_SECTIONS).map((category) => `
          <button class="card select-card" data-category="${category}">
            <div class="section-header">
              <p class="select-card-title">${category}</p>
              <span class="arrow-right">＞</span>
            </div>
          </button>
        `).join('')}
      </div>
    </section>
  `;
  bindBack();
  document.querySelectorAll('[data-category]').forEach((btn) => {
    btn.addEventListener('click', () => navigate({ name: 'sections', category: btn.dataset.category }));
  });
}

function renderSections(category) {
  const sections = CATEGORY_SECTIONS[category] || [];
  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="back-button" aria-label="戻る" data-action="back"></button>
        <div class="topbar-center"></div>
        <div class="topbar-right"></div>
      </div>
      <h2 class="screen-title">セクション選択</h2>
      <div class="cards-list">
        ${sections.map((section) => {
          const stats = getSectionStats(section);
          return `
            <button class="card select-card" data-section="${section}">
              <div class="section-header">
                <p class="select-card-title">${section}</p>
                <span class="arrow-right">＞</span>
              </div>
              <div class="progress-bar">${progressSegments(stats)}</div>
              <div class="select-card-sub">
                全${stats.total}問
                ${stats.weak > 0 ? `<span class="weak">　苦手${stats.weak}問</span>` : ''}
                <span>　未挑戦${stats.unseen}問</span>
              </div>
              ${stats.complete ? '<div class="complete-badge">COMPLETE！</div>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
  bindBack();
  document.querySelectorAll('[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => startQuiz('normal', category, btn.dataset.section));
  });
}

function renderCountdown() {
  if (!state.session) return;
  app.innerHTML = `
    <section class="countdown-screen">
      <div class="countdown-label">${state.session.label}</div>
      <div class="countdown-number">${state.session.countdown}</div>
    </section>
  `;
}

function renderQuestion() {
  if (!state.session) return;
  state.currentView = { name: 'question' };
  const question = currentQuestion();
  const result = state.session.currentResult;
  const selected = state.session.selectedChoice;
  const qState = getQuestionState(question.id);
  const showWeakRemove = state.session.mode === 'weak' && result?.correct && qState.weak;

  app.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <button class="back-button" aria-label="戻る" data-action="back-home"></button>
        <div class="topbar-center">${state.session.mode === 'normal' ? state.session.category : state.session.label}</div>
        <div class="topbar-right">${state.session.currentIndex + 1}/${state.session.questions.length}</div>
      </div>

      <div class="question-area">
        <section class="question-card">
          <p class="question-text">${escapeHtml(question.question)}</p>
        </section>

        <div class="choices">
          ${question.choices.map((choice) => renderChoiceButton(choice, question.answer, selected, result)).join('')}
        </div>

        <button class="helper-link" data-action="unknown">わからない</button>

        <div class="weak-remove-wrap">
          ${showWeakRemove ? `
            <button class="btn ${state.session.weakRemoved ? 'btn-success' : 'btn-neutral'} weak-remove-btn" data-action="remove-weak">
              ${state.session.weakRemoved ? 'OK' : '苦手からはずす'}
            </button>
          ` : ''}
        </div>

        <div class="judge-overlay ${result ? 'visible' : ''}">${result ? (result.correct ? '○' : '×') : ''}</div>
      </div>
    </section>
  `;

  document.querySelector('[data-action="back-home"]').addEventListener('click', () => {
    clearTimers();
    state.session = null;
    navigate({ name: 'home' }, false);
  });

  if (!result) {
    document.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => answerQuestion(btn.dataset.choice));
    });
    document.querySelector('[data-action="unknown"]').addEventListener('click', () => answerQuestion('わからない', true));
  }

  const removeWeakBtn = document.querySelector('[data-action="remove-weak"]');
  if (removeWeakBtn) {
    removeWeakBtn.addEventListener('click', removeWeakCurrentQuestion);
  }
}

function renderChoiceButton(choice, answer, selected, result) {
  const classes = ['choice-btn'];
  let mark = '';

  if (!result && selected === choice) classes.push('selected');
  if (result) {
    if (choice === answer) {
      classes.push('correct');
      mark = '<span class="choice-mark correct">✓</span>';
    } else if (choice === selected && !result.correct) {
      classes.push('incorrect');
      mark = '<span class="choice-mark incorrect">×</span>';
    } else {
      classes.push('dimmed');
    }
  }

  return `
    <button class="${classes.join(' ')}" ${result ? 'disabled' : ''} data-choice="${escapeAttr(choice)}">
      <span>${escapeHtml(choice)}</span>
      ${mark}
    </button>
  `;
}

function renderResult() {
  if (!state.session) return;
  const total = state.session.questions.length;
  const correctCount = state.session.answers.filter((a) => a.correct).length;
  const wrongItems = state.session.answers.filter((a) => !a.correct);
  const isNormal = state.session.mode === 'normal';

  app.innerHTML = `
    <section class="screen">
      <div class="result-score-wrap">
        <div class="result-score"><span class="main">${correctCount}</span><span class="sub">/${total}</span></div>
        <div class="result-message">${correctCount === total ? 'すばらしい！' : 'お疲れさまでした'}</div>
      </div>

      ${wrongItems.length ? `
        <section>
          <h2 class="screen-title">間違えた問題</h2>
          <div class="result-list">
            ${wrongItems.map((item) => `
              <article class="result-card">
                <p class="result-question">${escapeHtml(item.question)}</p>
                <div><span class="result-answer-label">正解：</span><span class="result-answer">${escapeHtml(item.answer)}</span></div>
              </article>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <div class="result-actions">
        <button class="btn btn-primary" data-action="retry">もう一度</button>
        ${isNormal ? '<button class="btn btn-secondary" data-action="categories">カテゴリ選択へ</button>' : ''}
        <button class="btn btn-ghost" data-action="top">TOPへ</button>
      </div>
    </section>
  `;

  bindActions([
    ['[data-action="retry"]', restartCurrentMode],
    ['[data-action="categories"]', () => {
      state.session = null;
      navigate({ name: 'categories' }, false);
    }],
    ['[data-action="top"]', () => {
      state.session = null;
      navigate({ name: 'home' }, false);
    }],
  ]);
}

function renderEmpty(message) {
  app.innerHTML = `
    <section class="empty-state">
      <p>${message}</p>
      <button class="btn btn-primary" data-action="top">TOPへ</button>
    </section>
  `;
  bindActions([[ '[data-action="top"]', () => navigate({ name: 'home' }, false) ]]);
}

function bindBack() {
  const button = document.querySelector('[data-action="back"]');
  if (button) button.addEventListener('click', goBack);
}

function bindActions(pairs) {
  pairs.forEach(([selector, handler]) => {
    const node = document.querySelector(selector);
    if (node) node.addEventListener('click', handler);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\n', '<br>');
}

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

window.tachibanaDebug = {
  getState: () => JSON.parse(JSON.stringify(state.storage)),
  resetStorage: () => {
    localStorage.removeItem(STORAGE_KEY);
    state.storage = loadStorage();
    syncStorageWithQuestions();
    render();
  },
};
