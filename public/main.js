// PROTEKSI DEVTOOLS & INSPECT ELEMENT
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
    if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (e.ctrlKey && (e.key === 'U' || e.key === 'u'))
    ) {
        e.preventDefault();
        alert('Inspect element dinonaktifkan demi keadilan permainan!');
    }
});

setInterval(() => {
    const startTime = performance.now();
    debugger;
    const endTime = performance.now();
    if (endTime - startTime > 100) {
        document.body.innerHTML = `
            <div style="color:white; text-align:center; margin-top:20vh;">
                <h1>Akses Ditolak!</h1>
                <p>Terdeteksi membuka Inspect Element/DevTools. Silakan refresh halaman.</p>
            </div>`;
    }
}, 1000);

// GAME LOGIC
const socket = io();
let isPeekingPhase = false;
let myCardCount = 0;
let hasPeekedCard = false;
let myHeldCard = null;
let currentTurnPlayerId = null;
let isGameOver = false;
let timerInterval = null;
let hasJoined = false;

function joinGame() {
    if (hasJoined) return;
    const nameInput = document.getElementById('playerName');
    const name = nameInput.value.trim();
    if (name) {
        socket.emit('joinRoom', name);
    }
}

socket.on('joinSuccess', ({ name }) => {
    hasJoined = true;
    const joinBtn = document.querySelector('.lobby-buttons .btn-primary');
    if (joinBtn) {
        joinBtn.disabled = true;
        joinBtn.innerText = "Sudah Masuk";
        joinBtn.style.opacity = "0.6";
        joinBtn.style.cursor = "not-allowed";
    }
    const nameInput = document.getElementById('playerName');
    if (nameInput) nameInput.disabled = true;
});

socket.on('joinError', (msg) => {
    alert(msg);
});

function startGame() {
    socket.emit('startGame');
}

function drawFromDeck() {
    if (currentTurnPlayerId === socket.id && !myHeldCard && !isPeekingPhase && !isGameOver) {
        socket.emit('drawFromDeck');
    }
}

function drawFromDiscard() {
    if (currentTurnPlayerId === socket.id && !myHeldCard && !isPeekingPhase && !isGameOver) {
        socket.emit('drawFromDiscard');
    }
}

function discardHeldCard() {
    if (myHeldCard) {
        socket.emit('discardHeldCard');
    }
}

function callKobu() {
    if (confirm("Yakin ingin memanggil KOBU? Permainan akan langsung berakhir!")) {
        socket.emit('callKobu');
    }
}

function startPeekingCountdown() {
    let timeLeft = 10;
    const countEl = document.getElementById('countdownSec');
    if (countEl) countEl.innerText = timeLeft;

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        timeLeft--;
        if (countEl) countEl.innerText = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
        }
    }, 1000);
}

socket.on('updateRoom', (state) => {
    const list = document.getElementById('playerList');
    if (list && state.players) {
        list.innerHTML = state.players.map(p => `<li>${p.name}</li>`).join('');
    }

    const countEl = document.getElementById('playerCount');
    if (countEl && state.players) {
        countEl.innerText = state.players.length;
    }

    if (state.gameStarted) {
        updateBoardState(state);
    }
});

socket.on('gameStarted', (state) => {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('gameBoard').classList.remove('hidden');
    document.getElementById('gameOverModal').classList.add('hidden');
    document.getElementById('timerNotice').classList.remove('hidden');
    document.getElementById('turnNotice').classList.add('hidden');

    isPeekingPhase = true;
    hasPeekedCard = false;
    myHeldCard = null;
    isGameOver = false;

    startPeekingCountdown();
    updateBoardState(state);
});

socket.on('initHand', ({ count }) => {
    myCardCount = count;
    renderMyHand();
});

socket.on('endPeekingPhase', (state) => {
    isPeekingPhase = false;
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('timerNotice').classList.add('hidden');
    document.getElementById('turnNotice').classList.remove('hidden');
    updateBoardState(state);
});

socket.on('turnChanged', (state) => {
    updateBoardState(state);
});

socket.on('boardUpdated', (state) => {
    updateBoardState(state);
});

socket.on('cardDrawn', ({ card }) => {
    myHeldCard = card;
    const heldArea = document.getElementById('heldCardArea');
    const heldEl = document.getElementById('heldCard');

    heldEl.className = `card ${card.color}`;
    heldEl.innerText = `${card.value} ${card.suit}`;
    heldArea.classList.remove('hidden');
});

socket.on('actionComplete', () => {
    myHeldCard = null;
    document.getElementById('heldCardArea').classList.add('hidden');
});

function renderMyHand(openHand = null) {
    const myHandDiv = document.getElementById('myHand');
    myHandDiv.innerHTML = '';

    const count = openHand ? openHand.length : myCardCount;

    for (let i = 0; i < count; i++) {
        const cardEl = document.createElement('div');

        if (openHand) {
            const card = openHand[i];
            cardEl.className = `card ${card.color}`;
            cardEl.innerText = `${card.value} ${card.suit}`;
        } else {
            cardEl.className = 'card back';
            cardEl.innerText = '?';

            cardEl.onclick = () => {
                if (isGameOver) return;

                if (isPeekingPhase) {
                    if (!hasPeekedCard) socket.emit('peekCard', i);
                } else if (myHeldCard) {
                    if (confirm(`Tukar kartu ke-${i + 1} dengan kartu ${myHeldCard.value} ${myHeldCard.suit}?`)) {
                        socket.emit('swapCard', i);
                    }
                } else {
                    if (confirm("Tebak & Buang kartu ini karena nilainya sama dengan Buangan?")) {
                        socket.emit('matchAndDrop', i);
                    }
                }
            };
        }

        myHandDiv.appendChild(cardEl);
    }
}

socket.on('showPeekedCard', ({ index, card }) => {
    hasPeekedCard = true;
    const cards = document.querySelectorAll('#myHand .card');
    if (cards[index]) {
        cards[index].className = `card ${card.color}`;
        cards[index].innerText = `${card.value} ${card.suit}`;

        setTimeout(() => {
            cards[index].className = 'card back';
            cards[index].innerText = '?';
        }, 3000);
    }
});

socket.on('dropResult', ({ gameState }) => {
    updateBoardState(gameState);
});

socket.on('updateMyHandCount', ({ count }) => {
    myCardCount = count;
    renderMyHand();
});

socket.on('gameOverEvent', ({ kobuCalledBy, scores, gameState }) => {
    isGameOver = true;
    document.getElementById('heldCardArea').classList.add('hidden');
    document.getElementById('kobuBtn').classList.add('hidden');
    document.getElementById('kobuCallerText').innerText = `KOBU dipanggil oleh ${kobuCalledBy}!`;

    const scoreBoard = document.getElementById('scoreBoard');
    scoreBoard.innerHTML = scores.map((s, index) => `
        <div class="score-row ${index === 0 ? 'winner' : ''}">
            <span>${index === 0 ? '🏆 ' : ''}${s.name}</span>
            <span>Total Poin: <strong>${s.totalPoints}</strong></span>
        </div>
    `).join('');

    document.getElementById('gameOverModal').classList.remove('hidden');
    updateBoardState(gameState);
});

function renderOtherPlayers(players, currentTurnId) {
    const container = document.getElementById('otherPlayers');
    container.innerHTML = '';

    players.forEach(p => {
        if (p.id !== socket.id) {
            const playerDiv = document.createElement('div');
            const isActive = p.id === currentTurnId;
            playerDiv.className = `other-player-box ${isActive ? 'active-turn' : ''}`;

            let cardsHTML = '';
            if (isGameOver && p.hand) {
                cardsHTML = p.hand.map(c => `<div class="card mini ${c.color}">${c.value}</div>`).join('');
            } else {
                cardsHTML = Array(p.handCount).fill('<div class="card mini back">?</div>').join('');
            }

            playerDiv.innerHTML = `
                <h4>${p.name} ${isActive ? '(Bergiliran)' : ''}</h4>
                <div class="cards-mini">${cardsHTML}</div>
            `;
            container.appendChild(playerDiv);
        }
    });
}

function updateBoardState(state) {
    document.getElementById('deckCount').innerText = state.deck;
    currentTurnPlayerId = state.currentTurnPlayerId;

    document.getElementById('currentTurnName').innerText =
        state.currentTurnPlayerId === socket.id ? "KAMU" : state.currentTurnPlayerName;

    const kobuBtn = document.getElementById('kobuBtn');
    if (state.currentTurnPlayerId === socket.id && !isPeekingPhase && !isGameOver) {
        kobuBtn.classList.remove('hidden');
    } else {
        kobuBtn.classList.add('hidden');
    }

    renderOtherPlayers(state.players, state.currentTurnPlayerId);

    const me = state.players.find(p => p.id === socket.id);
    if (isGameOver && me && me.hand) {
        renderMyHand(me.hand);
    }

    const discardDiv = document.getElementById('discardPile');
    if (state.discardPile.length === 0) {
        discardDiv.className = 'card empty';
        discardDiv.innerText = 'Buangan Kosong';
    } else {
        const topDiscard = state.discardPile[state.discardPile.length - 1];
        discardDiv.className = `card ${topDiscard.color}`;
        discardDiv.innerText = `${topDiscard.value} ${topDiscard.suit}`;
    }
}