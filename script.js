document.addEventListener('DOMContentLoaded', () => {
    // --- Persistence & State ---
    const SaveSystem = {
        save: (data) => localStorage.setItem('mathGardenSave', JSON.stringify(data)),
        load: () => JSON.parse(localStorage.getItem('mathGardenSave'))
    };

    const defaultState = {
        stars: 0,
        unlockedThemes: ['default'],
        currentTheme: 'default',
        unlockedAvatars: ['default'],
        currentAvatar: 'default',
        streak: 0,
        soundEnabled: true,
        // Phase 4: Gamification Data
        lastLogin: null,
        dailyQuest: {
            target: 20, // default target
            progress: 0,
            claimed: false,
            date: null
        },
        achievements: [], // IDs of unlocked achievements
        garden: {
            level: 1,
            xp: 0,
            treeStage: 1, // 1: Sprout, 2: Sapling, 3: Small Tree, 4: Big Tree
            lastWatered: Date.now()
        },
        stats: {
            totalQuestions: 0,
            totalCorrect: 0,
            timeAttackHighScore: 0
        }
    };

    let savedData = SaveSystem.load() || defaultState;
    // Deep merge for nested objects like garden/stats if they don't exist in old save
    const userData = { ...defaultState, ...savedData };
    // Migration: Ensure garden data exists and is valid
    if (!userData.garden || typeof userData.garden.level === 'undefined') {
        userData.garden = JSON.parse(JSON.stringify(defaultState.garden)); // Clone to avoid ref issues
    }
    if (!userData.stats) userData.stats = defaultState.stats;
    if (!userData.dailyQuest) userData.dailyQuest = defaultState.dailyQuest;
    if (!userData.achievements) userData.achievements = [];

    // cleanup old pet data
    if (userData.pet) delete userData.pet;

    const sessionState = {
        selectedOp: null,
        selectedDiff: null,
        currentQuestion: null,
        progress: 0,
        maxProgress: 10,
        sessionStreak: 0 // Current game streak
    };

    // --- Audio System ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();

    // Unlock Audio for Mobile (iOS/Android)
    const unlockAudio = () => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(() => {
                // Remove listeners once unlocked
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('touchstart', unlockAudio);
            });
        }
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    const calculateSemiprimes = (baseFreq, count) => {
        // Just a helper for generative sound
        return baseFreq * (1 + (count * 0.2));
    };

    function playSound(type) {
        if (!userData.soundEnabled) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (type === 'correct') {
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major
            notes.forEach((freq, i) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g);
                g.connect(audioCtx.destination);
                o.frequency.value = freq;
                g.gain.setValueAtTime(0.1, now + i * 0.1);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
                o.start(now + i * 0.1);
                o.stop(now + i * 0.1 + 0.3);
            });
        } else if (type === 'wrong') {
            osc.type = 'sawtooth'; // Corrected from osc.index
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.3);
            gainNode.gain.setValueAtTime(0.2, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'click') {
            osc.frequency.setValueAtTime(800, now);
            gainNode.gain.setValueAtTime(0.05, now);
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === 'win') {
            // Fanfare
            [523, 659, 783, 1046, 783, 1046].forEach((f, i) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.connect(g);
                g.connect(audioCtx.destination);
                o.type = 'triangle';
                o.frequency.value = f;
                g.gain.setValueAtTime(0.2, now + i * 0.15);
                g.gain.linearRampToValueAtTime(0, now + i * 0.15 + 0.4);
                o.start(now + i * 0.15);
                o.stop(now + i * 0.15 + 0.4);
            });
        } else if (type === 'water') {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            osc.connect(g);
            g.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
            g.gain.setValueAtTime(0.3, now);
            g.gain.linearRampToValueAtTime(0, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
        }
    }

    // --- Theme Manager ---
    function applyTheme(themeName) {
        document.body.className = ''; // Reset
        if (themeName !== 'default') {
            document.body.classList.add(`theme-${themeName}`);
        }
    }
    // Apply initial theme
    applyTheme(userData.currentTheme);

    // --- Daily Quest & Gamification Logic ---
    function checkDailyQuest() {
        const today = new Date().toDateString();
        // Reset if date changed OR if it's the first time (null date)
        if (userData.dailyQuest.date !== today) {
            userData.dailyQuest = {
                target: 10 + Math.floor(Math.random() * 6), // 10-15 questions
                progress: 0,
                claimed: false,
                date: today
            };
            userData.lastLogin = today;
            SaveSystem.save(userData);
        }
        updateDailyQuestUI();
    }

    function updateDailyQuestUI() {
        const q = userData.dailyQuest;
        const fill = document.getElementById('quest-fill');
        const text = document.getElementById('quest-text');

        if (fill && text) {
            const pct = Math.min(100, (q.progress / q.target) * 100);
            fill.style.width = `${pct}%`;

            if (q.claimed) {
                text.textContent = `Quest Complete! 🎉`;
                fill.style.backgroundColor = 'var(--secondary-color)';
            } else if (q.progress >= q.target) {
                text.textContent = `Claim Reward! (Tap)`;
                fill.style.backgroundColor = 'var(--accent-color)';
                // Make the card clickable to claim
                document.getElementById('daily-quest-card').onclick = claimDailyReward;
            } else {
                text.textContent = `Solve ${q.progress}/${q.target} Questions`;
            }
        }
    }

    function claimDailyReward() {
        if (userData.dailyQuest.progress >= userData.dailyQuest.target && !userData.dailyQuest.claimed) {
            userData.dailyQuest.claimed = true;
            const reward = 50; // Big star reward
            userData.stars += reward;
            SaveSystem.save(userData);
            playSound('win');
            alert(`Daily Quest Complete!\nYou earned ${reward} Stars! ⭐`);
            updateDailyQuestUI();
            updateUI();
            document.getElementById('daily-quest-card').onclick = null; // Remove listener
        }
    }

    // Call on init
    checkDailyQuest();

    // --- DOM Elements ---
    const menuScreen = document.getElementById('menu-screen');
    const opSelect = document.getElementById('operation-select');
    const diffSelect = document.getElementById('difficulty-select');
    const gameScreen = document.getElementById('game-screen');
    const customizationScreen = document.getElementById('customization-screen'); // WIP

    const questionContainer = document.getElementById('question-container');
    const visualHelper = document.getElementById('visual-helper');
    const optionsContainer = document.getElementById('options-container');
    const progressBar = document.getElementById('game-progress-fill');
    const starCount = document.getElementById('star-count');
    const soundToggle = document.getElementById('sound-toggle');
    const feedbackOverlay = document.getElementById('feedback-overlay');
    const feedbackIcon = document.getElementById('feedback-icon');

    // --- Game Logic ---
    function getRange() {
        switch (sessionState.selectedDiff) {
            case 'easy': return 10;
            case 'medium': return 50;
            case 'hard': return 100;
            default: return 10;
        }
    }

    function generateQuestion() {
        const max = getRange();
        let op = sessionState.selectedOp;

        if (op === 'mix') {
            const ops = ['add', 'sub', 'mul', 'div'];
            op = ops[Math.floor(Math.random() * ops.length)];
        }

        let a, b, answer, symbol;

        if (op === 'add') {
            a = Math.floor(Math.random() * (max - 1)) + 1;
            b = Math.floor(Math.random() * (max - a)) + 1;
            answer = a + b;
            symbol = '+';
        } else if (op === 'sub') {
            a = Math.floor(Math.random() * max) + 1;
            b = Math.floor(Math.random() * a);
            answer = a - b;
            symbol = '-';
        } else if (op === 'mul') {
            const limit = sessionState.selectedDiff === 'easy' ? 5 : (sessionState.selectedDiff === 'medium' ? 10 : 12); // Reverted to original logic for limit
            a = Math.floor(Math.random() * limit) + 1;
            b = Math.floor(Math.random() * limit) + 1;
            answer = a * b;
            symbol = '×';
        } else if (op === 'div') {
            const limit = sessionState.selectedDiff === 'easy' ? 5 : 10;
            b = Math.floor(Math.random() * limit) + 1;
            answer = Math.floor(Math.random() * limit) + 1;
            a = b * answer;
            symbol = '÷';
        }

        return { a, b, answer, symbol, op, options: generateOptions(answer, max) };
    }

    function generateOptions(correct, rangeMax) {
        const min = Math.max(0, correct - 5);
        const max = correct + 5;
        const options = new Set([correct]);
        while (options.size < 4) {
            let opt = Math.floor(Math.random() * (max - min + 1)) + min;
            if (Math.random() < 0.3) opt = Math.floor(Math.random() * rangeMax);
            if (opt !== correct && opt >= 0) options.add(opt);
        }
        return Array.from(options).sort(() => Math.random() - 0.5);
    }

    function startGame() {
        sessionState.score = 0; // Stars earned this session
        sessionState.progress = 0;
        sessionState.sessionStreak = 0;
        updateUI();

        menuScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        // Reset progress bar
        progressBar.style.width = '0%';

        nextQuestion();
    }

    function nextQuestion() {
        if (sessionState.progress >= sessionState.maxProgress) {
            playSound('win');
            // Save stars
            userData.stars += sessionState.score; // Add session stars to total
            SaveSystem.save(userData);

            showFeedback('Level Complete!');
            setTimeout(() => {
                alert(`Amazing! You earned ${sessionState.score} stars! Total Stars: ${userData.stars}`);
                goHome();
            }, 1000);
            return;
        }

        sessionState.currentQuestion = generateQuestion();
        renderQuestion();
    }

    function renderQuestion() {
        questionContainer.textContent = '';
        visualHelper.innerHTML = '';
        optionsContainer.innerHTML = '';

        const q = sessionState.currentQuestion;

        questionContainer.textContent = `${q.a} ${q.symbol} ${q.b} = ?`;

        if (sessionState.selectedDiff === 'easy') {
            if (q.op === 'add' || q.op === 'sub') {
                const emojis = ['🍎', '🍌', '🍇', '🍊', '🍓', '🍒', '🧁', '🎈'];
                const selectedEmoji = emojis[Math.floor(Math.random() * emojis.length)];

                const g1 = createObjectGroup(q.a, selectedEmoji);
                visualHelper.appendChild(g1);

                const sign = document.createElement('div');
                sign.style.fontSize = '2rem';
                sign.textContent = q.symbol;
                visualHelper.appendChild(sign);

                const g2 = createObjectGroup(q.b, selectedEmoji);
                visualHelper.appendChild(g2);
            } else if (q.op === 'mul') {
                visualHelper.textContent = `${q.a} groups of ${q.b}`;
            }
        }

        q.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = opt;
            btn.onclick = () => handleAnswer(opt, btn);
            optionsContainer.appendChild(btn);
        });
    }

    function createObjectGroup(count, emoji) {
        const group = document.createElement('div');
        group.className = 'object-group';
        for (let i = 0; i < count; i++) {
            const item = document.createElement('div');
            item.className = 'counter-object';
            item.textContent = emoji;
            group.appendChild(item);
        }
        return group;
    }

    function handleAnswer(selected, btnElement) {
        if (selected === sessionState.currentQuestion.answer) {
            playSound('correct');
            sessionState.score += 1; // 1 star per correct answer
            sessionState.progress++;
            sessionState.sessionStreak++;

            // Check streak for rewards (To be implemented visually later)
            if (sessionState.sessionStreak % 5 === 0) {
                // Trigger streak flair
            }

            if (!userData.dailyQuest.claimed) {
                userData.dailyQuest.progress++;
                SaveSystem.save(userData);
            }

            // Stats & Achievements
            trackStat('correct');
            checkAchievements();

            updateUI();
            updateDailyQuestUI(); // Update UI after correct answer

            btnElement.style.backgroundColor = 'var(--success)';
            btnElement.style.borderColor = 'var(--success)';
            showFeedback('Correct');

            setTimeout(nextQuestion, 1000);
        } else {
            playSound('wrong');
            sessionState.sessionStreak = 0;
            updateUI();

            btnElement.classList.add('shake');
            btnElement.style.borderColor = 'var(--accent-color)';
            setTimeout(() => {
                btnElement.classList.remove('shake');
                btnElement.style.borderColor = 'var(--primary-color)';
            }, 500);
        }
    }

    function showFeedback(text) {
        feedbackIcon.textContent = text === 'Correct' ? '🎉' : '⭐';
        if (text !== 'Correct') {
            // For level complete or other messages
        }
        feedbackOverlay.classList.remove('hidden');
        setTimeout(() => {
            feedbackOverlay.classList.add('hidden');
        }, 800);
    }

    function updateUI() {
        progressBar.style.width = `${(sessionState.progress / sessionState.maxProgress) * 100}%`;
        // Show total stars, not just session stars
        starCount.textContent = userData.stars + sessionState.score;
        soundToggle.textContent = userData.soundEnabled ? '🔊' : '🔇';
    }

    function goHome() {
        gameScreen.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        opSelect.classList.remove('hidden');
        diffSelect.classList.add('hidden');
        // Refresh star count from total
        starCount.textContent = userData.stars;
    }

    // --- Listeners ---
    document.querySelectorAll('.op-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
            sessionState.selectedOp = btn.dataset.op;
            opSelect.classList.add('hidden');
            diffSelect.classList.remove('hidden');
        });
    });

    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
            sessionState.selectedDiff = btn.dataset.diff;
            startGame();
        });
    });

    document.getElementById('back-to-ops').addEventListener('click', () => {
        playSound('click');
        diffSelect.classList.add('hidden');
        opSelect.classList.remove('hidden');
    });

    document.getElementById('back-home-btn').addEventListener('click', () => {
        playSound('click');
        goHome();
    });

    soundToggle.addEventListener('click', () => {
        userData.soundEnabled = !userData.soundEnabled;
        SaveSystem.save(userData);
        updateUI();
    });

    // --- Avatar System ---
    const avatars = [
        { id: 'default', icon: '🙂', cost: 0, name: 'Kid' },
        { id: 'cat', icon: '🐱', cost: 50, name: 'Cat' },
        { id: 'dog', icon: '🐶', cost: 50, name: 'Dog' },
        { id: 'astro', icon: '👩‍🚀', cost: 100, name: 'Astro' },
        { id: 'alien', icon: '👽', cost: 150, name: 'Alien' },
        { id: 'robot', icon: '🤖', cost: 150, name: 'Bot' },
        { id: 'lion', icon: '🦁', cost: 200, name: 'Lion' },
        { id: 'unicorn', icon: '🦄', cost: 300, name: 'Uni' }
    ];

    const avatarGrid = document.getElementById('avatar-grid');
    const shopStarCount = document.getElementById('shop-star-count');

    function renderShop() {
        avatarGrid.innerHTML = '';
        shopStarCount.textContent = userData.stars;

        avatars.forEach(av => {
            const isUnlocked = userData.unlockedAvatars.includes(av.id);
            const isSelected = userData.currentAvatar === av.id;

            const card = document.createElement('div');
            card.className = `avatar-card ${isUnlocked ? 'unlocked' : 'locked'} ${isSelected ? 'selected' : ''}`;

            card.innerHTML = `
                <div class="avatar-icon">${av.icon}</div>
                <div>${av.name}</div>
                ${!isUnlocked ? `<div class="avatar-cost">⭐ ${av.cost}</div>` : ''}
            `;

            card.onclick = () => handleAvatarClick(av);
            avatarGrid.appendChild(card);
        });
    }

    function handleAvatarClick(avatar) {
        if (userData.unlockedAvatars.includes(avatar.id)) {
            // Select
            userData.currentAvatar = avatar.id;
            playSound('click');
        } else {
            // Try to buy
            if (userData.stars >= avatar.cost) {
                if (confirm(`Unlock ${avatar.name} for ${avatar.cost} stars?`)) {
                    userData.stars -= avatar.cost;
                    userData.unlockedAvatars.push(avatar.id);
                    userData.currentAvatar = avatar.id;
                    playSound('win'); // Spending sound
                }
            } else {
                playSound('wrong'); // Not enough funds
                alert(`You need ${avatar.cost} stars!`);
                return;
            }
        }
        SaveSystem.save(userData);
        renderShop();
        updateUI(); // To update main star count if spent
    }

    function updateAvatarDisplay() {
        const av = avatars.find(a => a.id === userData.currentAvatar);
        if (av) {
            const display = document.getElementById('current-avatar-display');
            if (display) display.textContent = av.icon;
        }
    }
    // Initial call
    updateAvatarDisplay();

    // Settings Navigation
    document.getElementById('settings-btn').addEventListener('click', () => {
        playSound('click');
        menuScreen.classList.add('hidden');
        customizationScreen.classList.remove('hidden');
        renderShop(); // Refresh shop UI
    });

    document.getElementById('back-from-settings').addEventListener('click', () => {
        playSound('click');
        customizationScreen.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        // Refresh star count on home in case we spent some
        starCount.textContent = userData.stars;
        updateAvatarDisplay();
    });

    // Expose applyTheme globally
    window.applyTheme = (name) => {
        userData.currentTheme = name;
        SaveSystem.save(userData);
        applyTheme(name);
    };

    // --- Memory Game System ---
    const memoryScreen = document.getElementById('memory-screen');
    const memoryGrid = document.getElementById('memory-grid');
    const memoryMovesDisplay = document.getElementById('memory-moves');

    let memoryState = {
        cards: [],
        flippedCards: [],
        matchedPairs: 0,
        moves: 0,
        isLocked: false
    };

    function startMemoryGame() {
        memoryState = { cards: [], flippedCards: [], matchedPairs: 0, moves: 0, isLocked: false };
        memoryMovesDisplay.textContent = 0;

        menuScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        memoryScreen.classList.remove('hidden');

        generateMemoryCards();
    }

    function generateMemoryCards() {
        const pairsCount = 8; // 16 cards total
        const emojis = ['🍎', '🍌', '🍇', '🍊', '🍓', '🍒', '🧁', '🎈'];

        // Ensure unique numbers to avoid "visual match but wrong pair" confusion
        // Pool of numbers 1-10
        const numberPool = Array.from({ length: 10 }, (_, i) => i + 1);
        // Shuffle pool
        numberPool.sort(() => Math.random() - 0.5);

        const deck = [];

        // Create pairs: One number, One visual
        for (let i = 0; i < pairsCount; i++) {
            const num = numberPool[i]; // Unique number
            const emoji = emojis[i % emojis.length];

            // Card 1: The Number
            // Add a subtle hint color or icon to pair unique ID? No, unique numbers is enough.
            deck.push({ id: `p${i}_n`, content: num, type: 'number', pairId: i });
            // Card 2: The Visuals
            deck.push({ id: `p${i}_v`, content: createVisualString(num, emoji), type: 'visual', pairId: i });
        }

        deck.sort(() => Math.random() - 0.5);

        memoryGrid.innerHTML = '';
        deck.forEach((card, index) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'memory-card';
            cardEl.dataset.index = index;
            // Visual cards having multiple emojis need smaller font or wrapping
            const fontSize = card.type === 'visual' ? '1rem' : '3rem';
            const displayContent = card.type === 'visual' ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:2px;width:90%;">${card.content}</div>` : card.content;

            cardEl.innerHTML = `
                <div class="card-front" style="font-size: ${fontSize}">${displayContent}</div>
                <div class="card-back"></div>
            `;
            cardEl.onclick = () => flipCard(cardEl, card);
            memoryGrid.appendChild(cardEl);
        });
        memoryState.cards = deck;
    }

    // --- Time Attack Logic ---
    let timeAttackInterval = null;
    let timeAttackTime = 60;

    document.getElementById('btn-time-attack').addEventListener('click', () => {
        playSound('click');
        startTimeAttack();
    });

    function startTimeAttack() {
        sessionState.selectedOp = 'mix';
        sessionState.selectedDiff = 'medium'; // Default to medium for speed
        sessionState.mode = 'time-attack'; // Custom mode flag

        sessionState.score = 0;
        sessionState.progress = 0; // Acts as question count
        sessionState.sessionStreak = 0;

        timeAttackTime = 60;

        // UI Setup
        menuScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        opSelect.classList.remove('hidden'); // Reset for later
        diffSelect.classList.add('hidden');

        // Hide standard progress bar, show timer?
        // Reuse progress bar for timer
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#FF006E';

        nextQuestion();

        // Start Timer
        if (timeAttackInterval) clearInterval(timeAttackInterval);
        timeAttackInterval = setInterval(() => {
            timeAttackTime--;
            // Update Timer UI (using progress bar as timer bar)
            progressBar.style.width = `${(timeAttackTime / 60) * 100}%`;

            if (timeAttackTime <= 0) {
                endTimeAttack();
            }
        }, 1000);
    }

    function endTimeAttack() {
        clearInterval(timeAttackInterval);
        playSound('win');

        // Check High Score
        let message = `Time's Up!\nScore: ${sessionState.score}`;
        if (sessionState.score > userData.stats.timeAttackHighScore) {
            userData.stats.timeAttackHighScore = sessionState.score;
            message += `\n🔥 NEW HIGH SCORE! 🔥`;
        }

        userData.stars += sessionState.score; // 1 star per correct answer
        SaveSystem.save(userData);

        alert(message);

        // Cleanup
        progressBar.style.backgroundColor = 'var(--success)'; // Reset color
        sessionState.mode = 'standard';
        goHome();
    }

    // Modify goHome to clear interval
    const originalGoHome = goHome; // backup if needed, but I can't easily hook
    // Instead, I'll update the back-home listener to clear interval
    document.getElementById('back-home-btn').addEventListener('click', () => {
        if (timeAttackInterval) clearInterval(timeAttackInterval);
        progressBar.style.backgroundColor = 'var(--success)';
    });


    function createVisualString(count, emoji) {
        // Return array of spans/divs or just emoji string
        // Using emoji string with spaces
        let s = '';
        for (let k = 0; k < count; k++) s += `<span>${emoji}</span>`;
        return s;
    }

    function flipCard(cardEl, cardData) {
        if (memoryState.isLocked) return;
        if (cardEl.classList.contains('flipped')) return;

        playSound('click');
        cardEl.classList.add('flipped');
        memoryState.flippedCards.push({ el: cardEl, data: cardData });

        if (memoryState.flippedCards.length === 2) {
            checkMatch();
        }
    }

    function checkMatch() {
        memoryState.isLocked = true;
        memoryState.moves++;
        memoryMovesDisplay.textContent = memoryState.moves;

        const [c1, c2] = memoryState.flippedCards;

        if (c1.data.pairId === c2.data.pairId) {
            // Match
            playSound('correct');
            c1.el.classList.add('matched');
            c2.el.classList.add('matched');
            memoryState.matchedPairs++;
            memoryState.flippedCards = [];
            memoryState.isLocked = false;

            if (memoryState.matchedPairs === 8) {
                setTimeout(() => {
                    playSound('win');
                    const bonus = Math.max(5, 50 - memoryState.moves);
                    userData.stars += bonus;
                    SaveSystem.save(userData);
                    alert(`Memory Complete!\nMoves: ${memoryState.moves}\nBonus: ${bonus} Stars!`);
                    goHomeFromMemory();
                }, 500);
            }
        } else {
            // No Match
            playSound('wrong');
            setTimeout(() => {
                c1.el.classList.remove('flipped');
                c2.el.classList.remove('flipped');
                memoryState.flippedCards = [];
                memoryState.isLocked = false;
            }, 1000);
        }
    }

    // --- Achievements System ---
    const allAchievements = [
        { id: 'first_blood', title: 'First Steps', icon: '👶', condition: (d) => d.stats.totalCorrect >= 1 },
        { id: 'math_wiz', title: 'Math Wizard', icon: '🧙‍♂️', condition: (d) => d.stats.totalCorrect >= 50 },
        { id: 'streak_10', title: 'On Fire!', icon: '🔥', condition: (d) => d.streak >= 10 },
        { id: 'rich', title: 'Treasure Hunter', icon: '💎', condition: (d) => d.stars >= 500 },
        { id: 'garden_grower', title: 'Green Thumb', icon: '🌳', condition: (d) => d.garden.level >= 2 }
    ];

    function checkAchievements() {
        let newUnlock = false;
        allAchievements.forEach(ach => {
            if (!userData.achievements.includes(ach.id)) {
                if (ach.condition(userData)) {
                    userData.achievements.push(ach.id);
                    newUnlock = true;
                    // Show Notification
                    alert(`🏆 Achievement Unlocked: ${ach.icon} ${ach.title}!`);
                    playSound('win');
                }
            }
        });
        if (newUnlock) SaveSystem.save(userData);
    }

    // Helper to update stats
    function trackStat(type) {
        if (!userData.stats) userData.stats = {};
        if (type === 'correct') {
            userData.stats.totalCorrect = (userData.stats.totalCorrect || 0) + 1;
        }
    }

    // Call checkAchievements periodically or after events
    // We will inject calls in handleAnswer

    // Generate simplified Leaderboard
    function showLeaderboard() {
        const names = ["Alex", "Sam", "Jordan", "Taylor", "Riley", "You"];
        const scores = [1200, 950, 800, 600, 450, userData.stars];
        scores.sort((a, b) => b - a);

        let msg = "🏆 Leaderboard 🏆\n\n";
        scores.forEach((s, i) => {
            msg += `${i + 1}. ${s === userData.stars ? 'YOU' : names[i]} - ${s} ⭐\n`;
        });
        alert(msg);
    }

    // Inject Leaderboard Button
    const opGrid = document.querySelector('.grid-menu');
    if (opGrid && !document.getElementById('btn-leaderboard')) {
        const lbBtn = document.createElement('button');
        lbBtn.className = 'menu-btn full-width';
        lbBtn.id = 'btn-leaderboard';
        lbBtn.innerHTML = '🏆 Leaderboard';
        lbBtn.style.backgroundColor = '#FFD166';
        lbBtn.style.marginTop = '10px';
        lbBtn.onclick = () => { playSound('click'); showLeaderboard(); };
        opGrid.appendChild(lbBtn);
    }

    function goHomeFromMemory() {
        memoryScreen.classList.add('hidden');
        menuScreen.classList.remove('hidden');
        starCount.textContent = userData.stars;
    }

    document.getElementById('back-memory-btn').addEventListener('click', () => {
        playSound('click');
        goHomeFromMemory();
    });

    // Inject Memory Button
    // Inject Memory Button
    // opGrid already defined above (line 835 in original logic context, or ensure we select it)
    const opGridContainer = document.querySelector('.grid-menu');

    // Check if distinct valid check exists, else just append
    if (opGridContainer && !document.getElementById('btn-memory')) {
        const memBtn = document.createElement('button');
        memBtn.className = 'menu-btn full-width';
        memBtn.id = 'btn-memory';
        memBtn.innerHTML = '🧠 Memory Match';
        memBtn.style.backgroundColor = '#4CC9F0';
        memBtn.style.color = 'white';
        memBtn.style.marginTop = '10px';
        memBtn.onclick = () => { playSound('click'); startMemoryGame(); };
        opGridContainer.appendChild(memBtn);
    }

    // --- Garden System Logic ---
    const gardenScreen = document.getElementById('garden-screen');
    const gardenStarCount = document.getElementById('garden-star-count');
    const treeLevel = document.getElementById('tree-level');
    const treeXp = document.getElementById('tree-xp');
    const treeNextLevel = document.getElementById('tree-next-level');
    const treeXpFill = document.getElementById('tree-xp-fill');
    const gardenTree = document.getElementById('garden-tree');
    const treeName = document.getElementById('tree-name');

    const gardenBtn = document.getElementById('garden-btn');
    if (gardenBtn) {
        gardenBtn.addEventListener('click', () => {
            try {
                playSound('click');
                menuScreen.classList.add('hidden');
                gardenScreen.classList.remove('hidden');
                renderGarden();
            } catch (e) {
                console.error("Garden Error:", e);
                alert("Something went wrong loading the garden. Resetting garden data.");
                userData.garden = JSON.parse(JSON.stringify(defaultState.garden));
                SaveSystem.save(userData);
                renderGarden();
                // Force show
                gardenScreen.classList.remove('hidden');
            }
        });
    }

    const backGardenBtn = document.getElementById('back-garden-btn');
    if (backGardenBtn) {
        backGardenBtn.addEventListener('click', () => {
            playSound('click');
            gardenScreen.classList.add('hidden');
            menuScreen.classList.remove('hidden');
            starCount.textContent = userData.stars;
        });
    }

    const waterBtn = document.getElementById('water-btn');
    if (waterBtn) {
        waterBtn.addEventListener('click', () => {
            const cost = 10;
            if (userData.stars >= cost) {
                userData.stars -= cost;
                const xpGain = 20;
                userData.garden.xp += xpGain;
                userData.garden.lastWatered = Date.now();

                // Level Up Logic
                const nextLvl = userData.garden.level * 100;
                if (userData.garden.xp >= nextLvl) {
                    userData.garden.level++;
                    userData.garden.xp -= nextLvl;
                    userData.garden.treeStage = Math.min(5, Math.ceil(userData.garden.level / 2));
                    playSound('win');
                    alert(`Level Up! Your Tree grew stronger! 🌳`);
                } else {
                    playSound('water'); // Default to click if no water sound
                    // Growing animation
                    gardenTree.style.transform = "scale(1.2)";
                    setTimeout(() => gardenTree.style.transform = "scale(1)", 200);
                }

                SaveSystem.save(userData);
                renderGarden();
            } else {
                playSound('wrong');
                alert("Not enough stars! ⭐");
            }
        });
    }

    function renderGarden() {
        gardenStarCount.textContent = userData.stars;
        treeLevel.textContent = userData.garden.level;
        treeXp.textContent = userData.garden.xp;

        const nextLvl = userData.garden.level * 100;
        treeNextLevel.textContent = nextLvl;

        const pct = Math.min(100, (userData.garden.xp / nextLvl) * 100);
        treeXpFill.style.width = `${pct}%`;

        // Tree visuals based on level/stage
        const stages = ['🌱', '🌿', '🪴', '🌳', '🍎'];
        const stageIndex = Math.min(stages.length - 1, Math.floor((userData.garden.level - 1) / 2));
        gardenTree.textContent = stages[stageIndex];

        // Update Name based on stage
        const names = ['Sprout', 'Sapling', 'Small Tree', 'Big Tree', 'Apple Tree'];
        treeName.textContent = names[stageIndex];
    }
});
