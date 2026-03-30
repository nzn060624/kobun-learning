const app = {
    allQuestions: [],
    currentQueue: [],
    currentIndex: 0,
    wrongAnswers: [],
    currentScreen: 'home',
    history: ['home'],
    userData: {
        laps: 0,
        stats: {} // questionId: { status: 'unseen'|'seen'|'weak', correctOnce: false }
    },
    config: {
        LAP_MAX: 5,
        QUIZ_COUNT: 10
    },

    async init() {
        this.loadStorage();
        await this.loadCSV();
        this.renderHomeProgress();
        this.showScreen('home');
    },

    loadStorage() {
        const saved = localStorage.getItem('tachibana_data');
        if (saved) {
            this.userData = JSON.parse(saved);
        }
    },

    saveStorage() {
        localStorage.setItem('tachibana_data', JSON.stringify(this.userData));
    },

    async loadCSV() {
        try {
            const res = await fetch('./questions.csv');
            const text = await res.text();
            const lines = text.trim().split('\n');
            // ヘッダーを除外してパース
            this.allQuestions = lines.slice(1).map(line => {
                const cols = line.split(',');
                return {
                    id: cols[0],
                    category: cols[1],
                    section: cols[2],
                    question: cols[3].replace(/\\n/g, '\n'),
                    choices: [cols[4], cols[5], cols[6], cols[7]],
                    answer: cols[8].trim()
                };
            });
        } catch (e) {
            console.error("CSV Load Error:", e);
            document.getElementById('screen-loading').innerHTML = "データの読み込みに失敗しました。";
        }
    },

    // 画面遷移管理
    navTo(screenId, category = null) {
        if (screenId === 'home') this.history = ['home'];
        else this.history.push(screenId);

        if (screenId === 'category') this.renderCategories();
        if (screenId === 'section') this.renderSections(category);
        if (screenId === 'home') this.renderHomeProgress();

        this.showScreen(screenId);
    },

    back() {
        if (this.history.length > 1) {
            this.history.pop();
            const prev = this.history[this.history.length - 1];
            this.showScreen(prev);
        }
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`screen-${screenId}`).classList.add('active');
        this.currentScreen = screenId;
        window.scrollTo(0, 0);
    },

    // クイズ開始ロジック
    startMode(mode, filter = null) {
        let pool = [];
        let label = "";

        if (mode === 'normal') {
            pool = this.allQuestions.filter(q => q.category === filter.cat && q.section === filter.sec);
            label = filter.sec;
        } else if (mode === 'random') {
            pool = [...this.allQuestions];
            label = "ランダム10問";
        } else if (mode === 'weak') {
            pool = this.allQuestions.filter(q => {
                const s = this.userData.stats[q.id];
                return s && s.status === 'weak';
            });
            label = "苦手問題";
        }

        if (pool.length === 0) {
            this.showEmpty(mode === 'weak' ? "苦手問題はありません" : "問題がありません");
            return;
        }

        // 未出題優先でシャッフル
        pool.sort((a, b) => {
            const statA = this.userData.stats[a.id]?.status || 'unseen';
            const statB = this.userData.stats[b.id]?.status || 'unseen';
            if (statA === 'unseen' && statB !== 'unseen') return -1;
            if (statA !== 'unseen' && statB === 'unseen') return 1;
            return Math.random() - 0.5;
        });

        this.currentQueue = pool.slice(0, this.config.QUIZ_COUNT);
        this.currentIndex = 0;
        this.wrongAnswers = [];
        this.currentMode = mode;

        this.startCountdown(label);
    },

    startCountdown(label) {
        this.showScreen('countdown');
        document.getElementById('countdown-mode-name').textContent = label;
        let count = 3;
        const el = document.getElementById('countdown-number');
        el.textContent = count;

        const timer = setInterval(() => {
            count--;
            if (count <= 0) {
                clearInterval(timer);
                this.nextQuestion();
            } else {
                el.textContent = count;
            }
        }, 1000);
    },

    nextQuestion() {
        if (this.currentIndex >= this.currentQueue.length) {
            this.showResult();
            return;
        }

        const q = this.currentQueue[this.currentIndex];
        this.showScreen('quiz');
        
        // UI更新
        document.getElementById('quiz-cat-label').textContent = q.category;
        document.getElementById('quiz-progress-text').textContent = `${this.currentIndex + 1}/${this.currentQueue.length}`;
        document.getElementById('question-text').innerText = q.question;
        document.getElementById('btn-remove-weak').classList.add('hidden');
        document.getElementById('btn-dont-know').classList.remove('hidden');

        // 選択肢生成 (シャッフル)
        const choices = [...q.choices].sort(() => Math.random() - 0.5);
        const area = document.getElementById('choices-area');
        area.innerHTML = '';
        choices.forEach(text => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = text;
            btn.onclick = () => this.answer(text, btn);
            area.appendChild(btn);
        });

        this.isAnswering = false;
    },

    async answer(selectedText, btnEl) {
        if (this.isAnswering) return;
        this.isAnswering = true;

        const q = this.currentQueue[this.currentIndex];
        const isCorrect = selectedText === q.answer;
        const overlay = document.getElementById('feedback-overlay');
        const mark = document.getElementById('feedback-mark');

        // ボタン強調
        if (btnEl) btnEl.classList.add('selected');
        document.getElementById('btn-dont-know').classList.add('hidden');

        // 状態更新
        if (!this.userData.stats[q.id]) this.userData.stats[q.id] = { status: 'unseen', correctOnce: false };
        const stat = this.userData.stats[q.id];

        if (isCorrect) {
            mark.textContent = "○";
            mark.style.color = "var(--accent-green)";
            if (btnEl) btnEl.classList.add('correct');
            document.getElementById('snd-correct').play().catch(() => {});
            stat.status = 'seen';
            stat.correctOnce = true;
            
            // 苦手モード中のみ解除ボタン表示
            if (this.currentMode === 'weak') {
                const rw = document.getElementById('btn-remove-weak');
                rw.classList.remove('hidden');
                rw.classList.remove('removed');
                rw.textContent = "苦手からはずす";
            }
        } else {
            mark.textContent = "×";
            mark.style.color = "var(--accent-pink)";
            if (btnEl) btnEl.classList.add('wrong');
            stat.status = 'weak';
            this.wrongAnswers.push(q);
            
            // 正解を表示
            const buttons = document.querySelectorAll('.choice-btn');
            buttons.forEach(b => {
                if (b.textContent === q.answer) {
                    b.classList.add('correct');
                    b.innerHTML += '<span class="check-mark">✓</span>';
                }
            });
        }

        overlay.classList.remove('hidden');
        this.saveStorage();
        this.checkLapProgress();

        setTimeout(() => {
            overlay.classList.add('hidden');
            this.currentIndex++;
            this.nextQuestion();
        }, 3000);
    },

    removeFromWeak() {
        const q = this.currentQueue[this.currentIndex];
        if (this.userData.stats[q.id]) {
            this.userData.stats[q.id].status = 'seen';
            const btn = document.getElementById('btn-remove-weak');
            btn.textContent = "OK";
            btn.classList.add('removed');
            this.saveStorage();
        }
    },

    // 周回判定
    checkLapProgress() {
        const total = this.allQuestions.length;
        if (total === 0) return;

        const correctOnces = this.allQuestions.filter(q => this.userData.stats[q.id]?.correctOnce).length;
        
        if (correctOnces >= total) {
            this.userData.laps++;
            // リセット (一度正解フラグを倒す)
            this.allQuestions.forEach(q => {
                if (this.userData.stats[q.id]) {
                    this.userData.stats[q.id].correctOnce = false;
                    // status は seen のままにする
                }
            });
            this.saveStorage();
        }
    },

    // ホーム進捗描画
    renderHomeProgress() {
        const total = this.allQuestions.length || 1;
        let clear = 0, weak = 0, unseen = 0;

        this.allQuestions.forEach(q => {
            const s = this.userData.stats[q.id]?.status || 'unseen';
            if (s === 'seen') clear++;
            else if (s === 'weak') weak++;
            else unseen++;
        });

        const clearP = (clear / total) * 100;
        const weakP = (weak / total) * 100;

        document.getElementById('gauge-clear').style.width = `${clearP}%`;
        document.getElementById('gauge-weak').style.width = `${weakP}%`;
        document.getElementById('total-progress-percent').textContent = `${Math.floor(clearP)}%`;
        
        document.getElementById('stat-total').textContent = this.allQuestions.length;
        document.getElementById('stat-weak').textContent = weak;
        document.getElementById('stat-unseen').textContent = unseen;

        // 周回ドット
        const dots = document.getElementById('lap-dots');
        dots.innerHTML = '';
        const displayLaps = Math.min(this.userData.laps, this.config.LAP_MAX);
        for (let i = 1; i <= 5; i++) {
            const dot = document.createElement('div');
            dot.className = `dot ${i <= displayLaps ? 'active' : ''}`;
            dots.appendChild(dot);
        }
        document.getElementById('lap-count').textContent = displayLaps;
    },

    renderCategories() {
        const cats = ["動詞", "形容詞/形容動詞", "助動詞", "助詞", "識別", "演習"];
        const list = document.getElementById('category-list');
        list.innerHTML = '';
        cats.forEach(c => {
            const div = document.createElement('div');
            div.className = 'list-card';
            div.innerHTML = `<div class="row"><span style="color:var(--text-dark)">${c}</span><span class="arrow-right">＞</span></div>`;
            div.onclick = () => this.navTo('section', c);
            list.appendChild(div);
        });
    },

    renderSections(cat) {
        document.getElementById('current-category-name').textContent = cat;
        const sections = {
            "動詞": ["動詞①", "動詞②"],
            "形容詞/形容動詞": ["形容詞", "形容動詞"],
            "助動詞": ["助動詞①", "助動詞②"],
            "助詞": ["助詞①", "助詞②"],
            "識別": ["識別①", "識別②"],
            "演習": ["演習①", "演習②"]
        };

        const list = document.getElementById('section-list');
        list.innerHTML = '';
        (sections[cat] || []).forEach(sec => {
            const pool = this.allQuestions.filter(q => q.category === cat && q.section === sec);
            let c = 0, w = 0, u = 0;
            pool.forEach(q => {
                const s = this.userData.stats[q.id]?.status || 'unseen';
                if (s === 'seen') c++; else if (s === 'weak') w++; else u++;
            });

            const div = document.createElement('div');
            div.className = 'list-card';
            const isComplete = (u === 0 && w === 0 && pool.length > 0);
            
            div.innerHTML = `
                <div class="row">
                    <span style="color:var(--text-dark); font-weight:bold">${sec}</span>
                    <span class="arrow-right">＞</span>
                </div>
                <div class="gauge-container">
                    <div class="gauge-bar">
                        <div class="gauge-fill bg-clear" style="width:${(c/pool.length)*100}%"></div>
                        <div class="gauge-fill bg-weak" style="width:${(w/pool.length)*100}%"></div>
                    </div>
                </div>
                <div class="progress-stats">
                    ${isComplete ? '<span style="color:var(--accent-green); font-weight:bold">COMPLETE!</span>' : `
                        <span>全${pool.length}問</span>
                        ${w > 0 ? `<span class="text-weak">苦手${w}問</span>` : ''}
                        <span>未挑戦${u}問</span>
                    `}
                </div>
            `;
            div.onclick = () => this.startMode('normal', {cat, sec});
            list.appendChild(div);
        });
    },

    showResult() {
        this.showScreen('result');
        const score = this.currentQueue.length - this.wrongAnswers.length;
        document.getElementById('result-score').textContent = score;
        document.getElementById('result-msg').textContent = score === this.currentQueue.length ? "すばらしい！" : "お疲れさまでした";

        const area = document.getElementById('wrong-list-area');
        const list = document.getElementById('wrong-list');
        if (this.wrongAnswers.length > 0) {
            area.classList.remove('hidden');
            list.innerHTML = '';
            this.wrongAnswers.forEach(q => {
                const d = document.createElement('div');
                d.className = 'wrong-card';
                d.innerHTML = `<p>${q.question}</p><div><span class="correct-ans-label">正解:</span><span class="correct-ans-text">${q.answer}</span></div>`;
                list.appendChild(d);
            });
        } else {
            area.classList.add('hidden');
        }

        // ボタン制御
        document.getElementById('btn-go-category').classList.toggle('hidden', this.currentMode !== 'normal');
    },

    retry() {
        // 同じ条件でもう一度
        this.startCountdown(document.getElementById('countdown-mode-name').textContent);
    },

    showEmpty(msg) {
        this.showScreen('empty');
        document.getElementById('empty-msg').textContent = msg;
    },

    confirmExit() {
        if (confirm("クイズを中断して戻りますか？")) {
            this.back();
        }
    },

    // デバッグ用：初期化
    resetAllData() {
        if (confirm("すべての学習記録を消去しますか？")) {
            localStorage.removeItem('tachibana_data');
            location.reload();
        }
    }
};

window.onload = () => app.init();
