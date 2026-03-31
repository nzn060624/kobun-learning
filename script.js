const STORAGE_KEY = 'tachibana-kobun-state-v1';
const QUESTIONS_CSV_PATH = 'questions.csv';
const ICON_PATH = 'アイコンイラスト.png';
const TROPHY_PATH = '優勝カップ 9.png';
const CORRECT_SOUND_PATH = 'クイズ正解2.mp3';
const QUIZ_LENGTH = 10;
const FEEDBACK_MS = 3000;

const CATEGORY_ORDER = ['動詞', '形容詞/形容動詞', '助動詞', '助詞', '識別', '演習'];
const SECTION_ORDER = {
  '動詞': ['動詞①', '動詞②'],
  '形容詞/形容動詞': ['形容詞', '形容動詞'],
  '助動詞': ['助動詞①', '助動詞②'],
  '助詞': ['助詞①', '助詞②'],
  '識別': ['識別①', '識別②'],
  '演習': ['演習①', '演習②'],
};

const app = document.getElementById('app');

const state = {
  loading: true,
  questions: [],
  questionMap: new Map(),
  storage: createDefaultStorage(),
  history: [],
  currentScreen: 'loading',
  currentView: null,
  countdownTimer: null,
  autoNextTimer: null,
  correctAudio: null,
};

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', clearTimers);

async function init() {
  renderLoading();
  loadStorage();
  setupAudio();

  try {
    const questions = await loadQuestions();
    state.questions = questions;
    state.questionMap = new Map(questions.map(q => [q.id, q]));
    ensureQuestionStateKeys();
    state.loading = false;
    navigate('home', { resetHistory: true });
  } catch (error) {
    console.error(error);
    state.loading = false;
    renderEmpty('問題がありません');
  }

  window.tachibanaDebug = {
    getState: () => structuredClone(state.storage),
    resetStorage: () => {
      resetStorage();
      navigate('home', { resetHistory: true });
    },
    getQuestions: () => state.questions,
  };
}

function setupAudio() {
  try {
    state.correctAudio = new Audio(CORRECT_SOUND_PATH);
    state.correctAudio.preload = 'auto';
  } catch (error) {
    state.correctAudio = null;
  }
}

async function loadQuestions() {
  const response = await fetch(QUESTIONS_CSV_PATH, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load CSV');
  const csvText = await response.text();
  const rows = parseCSV(csvText);
  const [header, ...dataRows] = rows;
  if (!header || dataRows.length === 0) return [];

  return dataRows
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map(row => {
      const item = Object.fromEntries(header.map((key, index) => [key, (row[index] || '').trim()]));
      const category = normalizeCategory(item.category);
      return {
        id: item.id,
        category,
        section: item.section,
        question: item.question,
        choices: [item.choice1, item.choice2, item.choice3, item.choice4],
        answer: item.answer,
      };
    });
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const normalized = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeCategory(category) {
  if (category === '形容詞 / 形容動詞') return '形容詞/形容動詞';
  return category;
}

function createDefaultStorage() {
  return {
    questionStates: {},
    totalCorrectAnswers: 0,
    playLogs: [],
  };
}

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.storage = {
      ...createDefaultStorage(),
      ...parsed,
      questionStates: parsed.questionStates || {},
      playLogs: Array.isArray(parsed.playLogs) ? parsed.playLogs : [],
    };
  } catch (error) {
    console.warn('storage load failed', error);
    state.storage = createDefaultStorage();
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.storage));
}

function resetStorage() {
  state.storage = createDefaultStorage();
  ensureQuestionStateKeys();
  saveStorage();
}

function ensureQuestionStateKeys() {
  for (const q of state.questions) {
    if (!state.storage.questionStates[q.id]) {
      state.storage.questionStates[q.id] = {
        seen: false,
        everCorrect: false,
        weak: false,
      };
    }
  }
  saveStorage();
}

function getQuestionState(id) {
  return state.storage.questionStates[id] || { seen: false, everCorrect: false, weak: false };
}

function getScopeQuestions({ mode, category, section }) {
  if (mode === 'random') return [...state.questions];
  if (mode === 'weak') return state.questions.filter(q => getQuestionState(q.id).weak);
  return state.questions.filter(q => q.category === category && q.section === section);
}

function buildQuizQuestions(scope, length = QUIZ_LENGTH) {
  const unseen = scope.filter(q => !getQuestionState(q.id).seen);
  const seen = scope.filter(q => getQuestionState(q.id).seen);
  const first = shuffle(unseen).slice(0, length);
  const remain = Math.max(0, length - first.length);
  const second = shuffle(seen).slice(0, remain);
  return shuffle([...first, ...second]);
}

function getSummaryForQuestions(questions) {
  const total = questions.length;
  let clear = 0;
  let weak = 0;
  let untried = 0;

  for (const q of questions) {
    const qs = getQuestionState(q.id);
    if (!qs.seen) {
      untried += 1;
    } else if (qs.weak) {
      weak += 1;
    } else if (qs.everCorrect) {
      clear += 1;
    }
  }

  return {
    total,
    clear,
    weak,
    untried,
    rate: total ? Math.round((countEverCorrect(questions) / total) * 100) : 0,
  };
}

function countEverCorrect(questions) {
  return questions.filter(q => getQuestionState(q.id).everCorrect).length;
}

function getOverallSummary() {
  return getSummaryForQuestions(state.questions);
}

function getRounds() {
  const total = state.questions.length || 1;
  return Math.min(5, Math.floor((state.storage.totalCorrectAnswers || 0) / total));
}

function navigate(screen, params = {}) {
  clearTimers();
  const { resetHistory = false, replace = false, ...view } = params;

  if (resetHistory) {
    state.history = [];
  } else if (!replace && state.currentScreen) {
    state.history.push({ screen: state.currentScreen, view: state.currentView });
  }

  state.currentScreen = screen;
  state.currentView = view;

  switch (screen) {
    case 'home':
      renderHome();
      break;
    case 'about':
      renderAbout();
      break;
    case 'category':
      renderCategorySelect();
      break;
    case 'section':
      renderSectionSelect(view.category);
      break;
    case 'countdown':
      renderCountdown(view);
      break;
    case 'quiz':
      renderQuiz(view);
      break;
    case 'result':
      renderResult(view);
      break;
    case 'empty':
      renderEmpty(view.message || '問題がありません', view.backTo || 'home');
      break;
    default:
      renderHome();
  }
}

function goBack() {
  clearTimers();
  const prev = state.history.pop();
  if (!prev) {
    navigate('home', { resetHistory: true });
    return;
  }
  state.currentScreen = prev.screen;
  state.currentView = prev.view;

  switch (prev.screen) {
    case 'home': renderHome(); break;
    case 'about': renderAbout(); break;
    case 'category': renderCategorySelect(); break;
    case 'section': renderSectionSelect(prev.view.category); break;
    case 'countdown': renderCountdown(prev.view); break;
    case 'quiz': renderQuiz(prev.view); break;
    case 'result': renderResult(prev.view); break;
    case 'empty': renderEmpty(prev.view.message, prev.view.backTo); break;
    default: renderHome();
  }
}

function clearTimers() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  if (state.autoNextTimer) {
    clearTimeout(state.autoNextTimer);
    state.autoNextTimer = null;
  }
}

function startNormalFlow(category, section) {
  const scope = getScopeQuestions({ mode: 'normal', category, section });
  if (!scope.length) {
    navigate('empty', { message: '問題がありません', backTo: 'home' });
    return;
  }
  const questions = buildQuizQuestions(scope);
  navigate('countdown', {
    mode: 'normal',
    category,
    section,
    label: `${category} / ${section}`,
    questions,
  });
}

function startMode(mode) {
  const scope = getScopeQuestions({ mode });
  if (!scope.length) {
    const message = mode === 'weak' ? '苦手問題はありません' : '問題がありません';
    navigate('empty', { message, backTo: 'home' });
    return;
  }
  const questions = buildQuizQuestions(scope);
  navigate('countdown', {
    mode,
    label: mode === 'random' ? 'ランダム10問' : '苦手問題',
    questions,
  });
}

function renderLoading() {
  app.innerHTML = document.getElementById('loading-template').innerHTML;
}

function renderHome() {
  const overall = getOverallSummary();
  const rounds = getRounds();

  app.innerHTML = `
    <section class="screen hero">
      <div class="hero-title-wrap">
        <img class="hero-icon" src="${ICON_PATH}" alt="花橘のアイコン" />
        <div class="hero-title-text">
          <h1 class="hero-title">たちばな</h1>
          <p class="hero-subtitle">ぜんぶやる古典文法</p>
        </div>
      </div>

      <div class="button-stack">
        <button class="btn btn-primary" data-action="to-category">問題を解く</button>
        <button class="btn btn-secondary" data-action="random">ランダム10問</button>
        <button class="btn btn-tertiary" data-action="weak">苦手問題</button>
      </div>

      <section class="card progress-card">
        <div class="progress-header">
          <h2 class="section-title">学習進捗</h2>
          <span class="progress-rate">${overall.rate}%</span>
        </div>
        ${renderTrophies(rounds)}
        ${renderProgressBar(overall)}
        <div class="progress-meta">
          <span>総問題数 ${overall.total}問</span>
          <span class="pink">苦手 ${overall.weak}問</span>
          <span>未挑戦 ${overall.untried}問</span>
        </div>
      </section>

      <div class="footer-links">
        <button class="footer-link" data-action="about">このサイトについて</button>
        <span class="footer-link" aria-disabled="true">問題報告</span>
      </div>
    </section>
  `;

  app.querySelector('[data-action="to-category"]').addEventListener('click', () => navigate('category'));
  app.querySelector('[data-action="random"]').addEventListener('click', () => startMode('random'));
  app.querySelector('[data-action="weak"]').addEventListener('click', () => startMode('weak'));
  app.querySelector('[data-action="about"]').addEventListener('click', () => navigate('about'));
}

function renderAbout() {
  app.innerHTML = `
    <section class="screen">
      <div class="topbar topbar-center">
        <button class="back-button topbar-left" aria-label="戻る"></button>
        <h1 class="topbar-title">このサイトについて</h1>
      </div>
      <section class="card">
        <p class="about-body">ここにサイトの解説文が入ります</p>
      </section>
    </section>
  `;
  bindBack();
}

function renderCategorySelect() {
  const items = CATEGORY_ORDER.map(category => `
    <button class="card-button" data-category="${escapeAttr(category)}">
      <div class="card-button-head">
        <h2 class="card-button-title">${escapeHtml(category === '形容詞/形容動詞' ? '形容詞 / 形容動詞' : category)}</h2>
        <span class="card-arrow" aria-hidden="true"></span>
      </div>
    </button>
  `).join('');

  app.innerHTML = `
    <section class="screen">
      <div class="topbar topbar-center">
        <button class="back-button topbar-left" aria-label="戻る"></button>
        <h1 class="topbar-title">カテゴリ選択</h1>
      </div>
      <div class="card-list">${items}</div>
    </section>
  `;

  bindBack();
  app.querySelectorAll('[data-category]').forEach(button => {
    button.addEventListener('click', () => navigate('section', { category: button.dataset.category }));
  });
}

function renderSectionSelect(category) {
  const sections = SECTION_ORDER[category] || [];
  const cards = sections.map(section => {
    const questions = state.questions.filter(q => q.category === category && q.section === section);
    const summary = getSummaryForQuestions(questions);
    const showWeak = summary.weak > 0;
    const complete = summary.weak === 0 && summary.untried === 0 && summary.total > 0;
    return `
      <button class="card-button section-card" data-section="${escapeAttr(section)}">
        <div class="card-button-head">
          <h2 class="card-button-title">${escapeHtml(section)}</h2>
          <span class="card-arrow" aria-hidden="true"></span>
        </div>
        ${renderProgressBar(summary)}
        <div class="section-meta">
          <span>全${summary.total}問</span>
          ${showWeak ? `<span class="pink">苦手${summary.weak}問</span>` : ''}
          <span>未挑戦${summary.untried}問</span>
        </div>
        ${complete ? '<span class="complete-badge">COMPLETE！</span>' : ''}
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <section class="screen">
      <div class="topbar topbar-center">
        <button class="back-button topbar-left" aria-label="戻る"></button>
        <h1 class="topbar-title">セクション選択</h1>
      </div>
      <h2 class="list-screen-title">${escapeHtml(category === '形容詞/形容動詞' ? '形容詞 / 形容動詞' : category)}</h2>
      <div class="card-list">${cards}</div>
    </section>
  `;

  bindBack();
  app.querySelectorAll('[data-section]').forEach(button => {
    button.addEventListener('click', () => startNormalFlow(category, button.dataset.section));
  });
}

function renderCountdown(view) {
  let count = 3;
  app.innerHTML = `
    <section class="screen screen-center">
      <p class="countdown-label">${escapeHtml(view.label || '')}</p>
      <div class="countdown-number" id="countdown-number">${count}</div>
    </section>
  `;

  state.countdownTimer = setInterval(() => {
    count -= 1;
    const target = document.getElementById('countdown-number');
    if (target) target.textContent = count > 0 ? String(count) : '1';

    if (count <= 0) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      const quizSession = {
        ...view,
        currentIndex: 0,
        answers: [],
        wrongItems: [],
        questions: view.questions,
      };
      navigate('quiz', { ...quizSession, replace: true });
    }
  }, 1000);
}

function renderQuiz(view) {
  const question = view.questions[view.currentIndex];
  if (!question) {
    finishQuiz(view);
    return;
  }

  const shuffledChoices = question._shuffledChoices || shuffle([...question.choices]);
  question._shuffledChoices = shuffledChoices;

  app.innerHTML = `
    <section class="screen">
      <div class="quiz-top">
        <button class="back-button" aria-label="戻る"></button>
        <div class="quiz-category">${escapeHtml(getQuizHeaderLabel(view))}</div>
        <div class="quiz-progress">${view.currentIndex + 1}/${view.questions.length}</div>
      </div>

      <section class="card question-card">
        <p class="question-text">${escapeHtml(question.question)}</p>
      </section>

      <div class="choice-list">
        ${shuffledChoices.map(choice => `
          <button class="choice-button" data-choice="${escapeAttr(choice)}">
            <span class="choice-label">${escapeHtml(choice)}</span>
            <span class="choice-mark"></span>
          </button>
        `).join('')}
      </div>

      <button class="text-link" data-unknown>わからない</button>
      ${view.mode === 'weak' && getQuestionState(question.id).weak ? '<button class="remove-weak-button" data-remove-weak>苦手からはずす</button>' : ''}
    </section>
  `;

  bindBack();
  const choiceButtons = [...app.querySelectorAll('[data-choice]')];
  choiceButtons.forEach(button => {
    button.addEventListener('click', () => handleAnswer(view, question, button.dataset.choice));
  });
  app.querySelector('[data-unknown]').addEventListener('click', () => handleAnswer(view, question, null));

  const removeWeakBtn = app.querySelector('[data-remove-weak]');
  if (removeWeakBtn) {
    removeWeakBtn.addEventListener('click', () => {
      const qs = getQuestionState(question.id);
      qs.weak = false;
      saveStorage();
      renderQuiz({ ...view });
    });
  }
}

function handleAnswer(view, question, selectedChoice) {
  const buttons = [...app.querySelectorAll('.choice-button')];
  buttons.forEach(btn => btn.disabled = true);
  const isCorrect = selectedChoice === question.answer;
  const qs = getQuestionState(question.id);
  qs.seen = true;

  if (isCorrect) {
    if (!qs.everCorrect) qs.everCorrect = true;
    state.storage.totalCorrectAnswers += 1;
    playCorrectSound();
  } else {
    qs.weak = true;
  }
  saveStorage();

  buttons.forEach(btn => {
    const choice = btn.dataset.choice;
    const mark = btn.querySelector('.choice-mark');
    if (choice === question.answer) {
      btn.classList.add('is-correct');
      mark.textContent = '✓';
      mark.classList.add('correct');
    } else if (selectedChoice && choice === selectedChoice && !isCorrect) {
      btn.classList.add('is-wrong');
      mark.textContent = '×';
      mark.classList.add('wrong');
    } else {
      btn.classList.add('is-dim');
    }
  });

  if (selectedChoice) {
    const selectedButton = buttons.find(btn => btn.dataset.choice === selectedChoice);
    if (selectedButton && isCorrect) selectedButton.classList.add('is-selected');
  }

  view.answers.push({ questionId: question.id, selectedChoice, isCorrect });
  if (!isCorrect) {
    view.wrongItems.push({ question, answer: question.answer });
  }

  showAnswerOverlay(isCorrect);
  state.autoNextTimer = setTimeout(() => {
    view.currentIndex += 1;
    if (view.currentIndex >= view.questions.length) {
      finishQuiz(view);
    } else {
      renderQuiz({ ...view });
    }
  }, FEEDBACK_MS);
}

function finishQuiz(view) {
  const result = {
    ...view,
    score: view.answers.filter(item => item.isCorrect).length,
  };
  state.storage.playLogs.push({
    mode: view.mode,
    category: view.category || null,
    section: view.section || null,
    score: result.score,
    total: view.questions.length,
    playedAt: new Date().toISOString(),
  });
  saveStorage();
  navigate('result', result);
}

function renderResult(view) {
  const perfect = view.score === view.questions.length;
  app.innerHTML = `
    <section class="screen">
      <div class="topbar topbar-center">
        <button class="back-button topbar-left" aria-label="戻る"></button>
        <div class="topbar-spacer"></div>
      </div>

      <section class="score-wrap">
        <div class="score-line">
          <span class="score-main">${view.score}</span><span class="score-rest">/${view.questions.length}</span>
        </div>
        <p class="score-message">${perfect ? 'すばらしい！' : 'お疲れさまでした'}</p>
      </section>

      ${!perfect ? `
        <section class="result-errors">
          <h2 class="section-title">間違えた問題</h2>
          ${view.wrongItems.map(item => `
            <article class="error-card">
              <p class="error-question">${escapeHtml(item.question.question)}</p>
              <div class="error-answer-row">
                <span class="error-label">正解：</span>
                <span class="green">${escapeHtml(item.answer)}</span>
              </div>
            </article>
          `).join('')}
        </section>
      ` : ''}

      <div class="button-stack">
        <button class="btn btn-primary" data-action="retry">もう一度</button>
        <button class="btn btn-secondary" data-action="category">カテゴリ選択へ</button>
        <button class="btn btn-outline btn-compact" data-action="home">TOPへ</button>
      </div>
    </section>
  `;

  bindBack();
  app.querySelector('[data-action="retry"]').addEventListener('click', () => retryQuiz(view));
  app.querySelector('[data-action="category"]').addEventListener('click', () => navigate('category', { resetHistory: true }));
  app.querySelector('[data-action="home"]').addEventListener('click', () => navigate('home', { resetHistory: true }));
}

function retryQuiz(view) {
  if (view.mode === 'normal') {
    startNormalFlow(view.category, view.section);
    return;
  }
  startMode(view.mode);
}

function renderEmpty(message, backTo = 'home') {
  app.innerHTML = `
    <section class="screen screen-center">
      <p class="empty-message">${escapeHtml(message)}</p>
      <button class="btn btn-primary btn-compact" data-top>TOPへ</button>
    </section>
  `;
  app.querySelector('[data-top]').addEventListener('click', () => navigate(backTo, { resetHistory: true }));
}

function renderTrophies(rounds) {
  const items = Array.from({ length: 5 }, (_, index) => `
    <img class="trophy ${index < rounds ? 'is-on' : ''}" src="${TROPHY_PATH}" alt="トロフィー" />
  `).join('');
  return `<div class="trophy-row">${items}</div>`;
}

function renderProgressBar(summary) {
  const total = summary.total || 1;
  const clearWidth = (summary.clear / total) * 100;
  const weakWidth = (summary.weak / total) * 100;
  const untriedWidth = (summary.untried / total) * 100;

  return `
    <div class="progress-bar" aria-label="学習進捗">
      <span class="progress-segment progress-clear" style="width:${clearWidth}%"></span>
      <span class="progress-segment progress-weak" style="width:${weakWidth}%"></span>
      <span class="progress-segment progress-untried" style="width:${untriedWidth}%"></span>
    </div>
  `;
}

function bindBack() {
  const backButton = app.querySelector('.back-button');
  if (backButton) backButton.addEventListener('click', goBack);
}

function showAnswerOverlay(isCorrect) {
  const overlay = document.createElement('div');
  overlay.className = 'answer-overlay';
  overlay.innerHTML = `<div class="answer-symbol ${isCorrect ? 'correct' : 'wrong'}">${isCorrect ? '○' : '×'}</div>`;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), FEEDBACK_MS - 120);
}

function playCorrectSound() {
  if (!state.correctAudio) return;
  try {
    state.correctAudio.currentTime = 0;
    state.correctAudio.play().catch(() => {});
  } catch (error) {
    console.warn('audio play failed', error);
  }
}

function getQuizHeaderLabel(view) {
  if (view.mode === 'random') return 'ランダム10問';
  if (view.mode === 'weak') return '苦手問題';
  return view.category || '';
}

function shuffle(array) {
  const cloned = [...array];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
