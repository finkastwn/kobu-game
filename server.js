const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let roomState = {
    players: [],
    deck: [],
    discardPile: [],
    currentTurnIndex: 0,
    gameStarted: false,
    peekingActive: false,
    gameOver: false,
    kobuCalledBy: null,
    scores: []
};

function generateDeck() {
    const suits = ['♠', '♣', '♥', '♦'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let deck = [];

    deck.push({ suit: 'JOKER', value: 'JOKER', points: -1, color: 'black' });
    deck.push({ suit: 'JOKER', value: 'JOKER', points: -1, color: 'red' });

    for (let s of suits) {
        for (let v of values) {
            let pts = 0;
            if (v === 'A') pts = 1;
            else if (['J', 'Q'].includes(v)) pts = 10;
            else if (v === 'K') pts = (s === '♥' || s === '♦') ? 13 : 0;
            else pts = parseInt(v);

            deck.push({ suit: s, value: v, points: pts, color: (s === '♥' || s === '♦') ? 'red' : 'black' });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function calculateScores() {
    return roomState.players.map(p => {
        const total = p.hand.reduce((sum, card) => sum + card.points, 0);
        return {
            id: p.id,
            name: p.name,
            hand: p.hand,
            totalPoints: total
        };
    }).sort((a, b) => a.totalPoints - b.totalPoints);
}

function getSanitizedState() {
    return {
        ...roomState,
        deck: roomState.deck.length,
        players: roomState.players.map(p => ({
            id: p.id,
            name: p.name,
            handCount: p.hand.length,
            hand: roomState.gameOver ? p.hand : null,
            hasPeeked: p.hasPeeked,
            hasHeldCard: !!p.heldCard
        })),
        currentTurnPlayerId: roomState.players[roomState.currentTurnIndex]?.id || null,
        currentTurnPlayerName: roomState.players[roomState.currentTurnIndex]?.name || ''
    };
}

function nextTurn() {
    if (roomState.gameOver) return;
    roomState.currentTurnIndex = (roomState.currentTurnIndex + 1) % roomState.players.length;
    io.emit('turnChanged', getSanitizedState());
}

io.on('connection', (socket) => {
    socket.on('joinRoom', (playerName) => {
        const cleanName = playerName ? playerName.trim() : '';
        if (!cleanName) return;

        const existingPlayerBySocket = roomState.players.find(p => p.id === socket.id);
        if (existingPlayerBySocket) {
            socket.emit('joinError', 'Kamu sudah bergabung dalam room!');
            return;
        }

        const existingPlayerByName = roomState.players.find(p => p.name.toLowerCase() === cleanName.toLowerCase());
        if (existingPlayerByName) {
            socket.emit('joinError', 'Nama tersebut sudah digunakan pemain lain di room ini!');
            return;
        }

        if (roomState.players.length < 6 && !roomState.gameStarted) {
            roomState.players.push({
                id: socket.id,
                name: cleanName,
                hand: [],
                hasPeeked: false,
                heldCard: null
            });

            socket.emit('joinSuccess', { name: cleanName });
            io.emit('updateRoom', getSanitizedState());
        } else if (roomState.gameStarted) {
            socket.emit('joinError', 'Permainan sudah dimulai, tidak bisa bergabung lagi!');
        } else {
            socket.emit('joinError', 'Room sudah penuh (Maksimal 6 pemain)!');
        }
    });

    socket.on('startGame', () => {
        if (roomState.players.length >= 2 && !roomState.gameStarted) {
            roomState.gameStarted = true;
            roomState.peekingActive = true;
            roomState.gameOver = false;
            roomState.kobuCalledBy = null;
            roomState.scores = [];
            roomState.deck = generateDeck();
            roomState.discardPile = [];
            roomState.currentTurnIndex = 0;

            roomState.players.forEach(p => {
                p.hand = roomState.deck.splice(0, 4);
                p.hasPeeked = false;
                p.heldCard = null;
            });

            io.emit('gameStarted', getSanitizedState());

            roomState.players.forEach(p => {
                io.to(p.id).emit('initHand', { count: p.hand.length });
            });

            setTimeout(() => {
                roomState.peekingActive = false;
                io.emit('endPeekingPhase', getSanitizedState());
            }, 10000);
        }
    });

    socket.on('peekCard', (cardIndex) => {
        const player = roomState.players.find(p => p.id === socket.id);
        if (roomState.peekingActive && player && !player.hasPeeked) {
            if (cardIndex >= 0 && cardIndex < player.hand.length) {
                player.hasPeeked = true;
                socket.emit('showPeekedCard', {
                    index: cardIndex,
                    card: player.hand[cardIndex]
                });
            }
        }
    });

    socket.on('drawFromDeck', () => {
        const player = roomState.players[roomState.currentTurnIndex];
        if (!roomState.peekingActive && !roomState.gameOver && player && player.id === socket.id && !player.heldCard) {
            if (roomState.deck.length > 0) {
                const drawnCard = roomState.deck.pop();
                player.heldCard = drawnCard;
                socket.emit('cardDrawn', { card: drawnCard });
                io.emit('boardUpdated', getSanitizedState());
            }
        }
    });

    socket.on('drawFromDiscard', () => {
        const player = roomState.players[roomState.currentTurnIndex];
        if (!roomState.peekingActive && !roomState.gameOver && player && player.id === socket.id && !player.heldCard) {
            if (roomState.discardPile.length > 0) {
                const drawnCard = roomState.discardPile.pop();
                player.heldCard = drawnCard;
                socket.emit('cardDrawn', { card: drawnCard });
                io.emit('boardUpdated', getSanitizedState());
            }
        }
    });

    socket.on('swapCard', (handIndex) => {
        const player = roomState.players[roomState.currentTurnIndex];
        if (player && player.id === socket.id && player.heldCard) {
            if (handIndex >= 0 && handIndex < player.hand.length) {
                const oldCard = player.hand[handIndex];
                player.hand[handIndex] = player.heldCard;
                player.heldCard = null;
                roomState.discardPile.push(oldCard);

                socket.emit('actionComplete');
                io.emit('boardUpdated', getSanitizedState());
                nextTurn();
            }
        }
    });

    socket.on('discardHeldCard', () => {
        const player = roomState.players[roomState.currentTurnIndex];
        if (player && player.id === socket.id && player.heldCard) {
            roomState.discardPile.push(player.heldCard);
            player.heldCard = null;

            socket.emit('actionComplete');
            io.emit('boardUpdated', getSanitizedState());
            nextTurn();
        }
    });

    socket.on('matchAndDrop', (handIndex) => {
        const player = roomState.players.find(p => p.id === socket.id);
        const topDiscard = roomState.discardPile[roomState.discardPile.length - 1];

        if (!roomState.peekingActive && !roomState.gameOver && player && player.hand[handIndex] && topDiscard) {
            const targetCard = player.hand[handIndex];

            if (targetCard.value === topDiscard.value) {
                roomState.discardPile.push(targetCard);
                player.hand.splice(handIndex, 1);
                io.emit('dropResult', {
                    success: true,
                    playerId: socket.id,
                    gameState: getSanitizedState()
                });
                socket.emit('updateMyHandCount', { count: player.hand.length });
            } else {
                if (roomState.deck.length > 0) {
                    const penaltyCard = roomState.deck.pop();
                    player.hand.push(penaltyCard);
                }
                io.emit('dropResult', {
                    success: false,
                    playerId: socket.id,
                    gameState: getSanitizedState()
                });
                socket.emit('updateMyHandCount', { count: player.hand.length });
            }
        }
    });

    socket.on('callKobu', () => {
        const player = roomState.players[roomState.currentTurnIndex];
        if (!roomState.peekingActive && !roomState.gameOver && player && player.id === socket.id) {
            roomState.gameOver = true;
            roomState.kobuCalledBy = player.name;
            const scores = calculateScores();
            roomState.scores = scores;

            io.emit('gameOverEvent', {
                kobuCalledBy: player.name,
                scores: scores,
                gameState: getSanitizedState()
            });
        }
    });

    socket.on('disconnect', () => {
        roomState.players = roomState.players.filter(p => p.id !== socket.id);
        if (roomState.players.length < 2) {
            roomState.gameStarted = false;
        }
        io.emit('updateRoom', getSanitizedState());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Kobu berjalan di port ${PORT}`);
});