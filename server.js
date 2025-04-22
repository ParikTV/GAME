// server.js
require('dotenv').config(); // Cargar variables de entorno primero
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const connectDB = require('./config/db'); // Conexión a DB
const Player = require('./models/Player'); // Modelo Player
const Game = require('./models/Game');     // Modelo Game

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*", // Configura según tus necesidades de seguridad
        methods: ["GET", "POST"]
    }
});

// --- Conexión a Base de Datos ---
connectDB();

// --- Middleware ---
app.use(cors()); // Habilitar CORS
app.use(express.json()); // Para parsear JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // Servir archivos estáticos

// --- Constantes del Juego (ACTUALIZADAS) ---
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'];
const MINERALS_PER_PLAYER_PER_TYPE = 2;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;
const INITIAL_PRIZE_POT = 10000000;
const PHASE2_REWARD_PER_CORRECT_GUESS = 2000000;
const PHASE2_TARGET_CORRECT_GUESSES = 3; // Objetivo de aciertos en Fase 2
const PHASE2_TOTAL_ROUNDS = 3;
const PHASE2_GUESS_ATTEMPTS_PER_TURN = 2;
const GUESSABLE_MINERALS_COUNT = 4; // Rojo, Verde, Azul, Purpura
const MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1 = 2; // <<< NUEVA CONSTANTE

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Genera los pesos secretos y la info inicial
function generateGameSetup() {
    const weights = {}; let generatedWeights = [];
    const availableWeights = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => i + MIN_WEIGHT);
    weights['Amarillo'] = 10; const yellowIndex = availableWeights.indexOf(10); if (yellowIndex > -1) availableWeights.splice(yellowIndex, 1); generatedWeights.push(10);
    const remainingTypes = MINERAL_TYPES.filter(t => t !== 'Amarillo');
    remainingTypes.forEach(type => {
        if (availableWeights.length === 0) { const randomIndex = Math.floor(Math.random() * generatedWeights.length); weights[type] = generatedWeights[randomIndex]; }
        else { const randomIndex = Math.floor(Math.random() * availableWeights.length); const assignedWeight = availableWeights.splice(randomIndex, 1)[0]; weights[type] = assignedWeight; generatedWeights.push(assignedWeight); }
    });
    const sortedUniqueWeights = [...new Set(Object.values(weights))].sort((a, b) => b - a); const rankOfYellow = sortedUniqueWeights.indexOf(10) + 1;
    const rankSuffix = (rank) => { if (rank === 1) return '1º'; if (rank === 2) return '2º'; if (rank === 3) return '3º'; return `${rank}º`; };
    const knownInfo = { type: 'Amarillo', weight: 10, description: `El mineral Amarillo pesa 10g (es el ${rankSuffix(rankOfYellow)} más pesado).` };
    console.log("Pesos Secretos:", weights); console.log("Info Conocida:", knownInfo); return { weights, knownInfo };
}

// Crea el inventario para un jugador
function createPlayerInventory(actualWeights) {
    const inventory = []; MINERAL_TYPES.forEach(type => { const weight = actualWeights[type]; if (typeof weight !== 'number') { console.error(`Error: Peso no hallado para ${type}.`); return; } for (let i = 0; i < MINERALS_PER_PLAYER_PER_TYPE; i++) { inventory.push({ instanceId: uuidv4(), type: type, weight: weight }); } }); return inventory;
}

// Determina el siguiente jugador ACTIVO
async function findNextActivePlayer(game) {
    // ... (Sin cambios en esta función) ...
    if (!game || !game.players || game.players.length === 0 || !game.status) {
        console.error("findNextActivePlayer: Juego inválido o sin jugadores/estado."); return null;
    }
    let populatedGame = game;
    if (!game.populated('players')) {
        try {
            populatedGame = await Game.findById(game._id).populate({ path: 'players', match: { isActive: true }, select: '_id name turnOrder isActive' });
            if (!populatedGame) throw new Error("Juego no encontrado al repopular");
        } catch (err) { console.error("findNextActivePlayer ERROR: Falló al repopular jugadores activos:", err); return null; }
    }
    const activePlayers = populatedGame.players.filter(p => p != null).sort((a, b) => a.turnOrder - b.turnOrder);
    if (activePlayers.length === 0) { console.log("findNextActivePlayer: No hay jugadores activos."); return null; }
    const currentPlayerIndex = activePlayers.findIndex(p => p._id.equals(populatedGame.currentPlayerId));
    let searchStartIndex = (currentPlayerIndex === -1) ? -1 : currentPlayerIndex;
    let attempts = 0; let nextPlayerIndex = searchStartIndex;
    while (attempts < activePlayers.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
        const nextPlayer = activePlayers[nextPlayerIndex];
        if (populatedGame.status === 'playing' || populatedGame.status === 'guessing_phase') {
             console.log(`findNextActivePlayer: Siguiente turno para ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`); return nextPlayer;
        }
        attempts++; if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break;
    }
    console.log("findNextActivePlayer: No se encontró un siguiente jugador activo."); return null;
}

// Construye el objeto gameState para enviar a UN jugador específico (ACTUALIZADO)
async function getGameStateForPlayer(gameId, playerId) {
    try {
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id')
            .populate('balancerPlayerId', 'name _id');

        // Obtener todos los jugadores de una vez con los campos necesarios (incluido el nuevo)
        const playersInGame = await Player.find({ gameId: gameId }).select(
            'name turnOrder isActive canPlaceMinerals inventory hackerBytes guessedColorsPhase2 phase2GuessAttemptsThisTurn phase1IncorrectGuessAttempts _id socketId' // <<< Añadido phase1IncorrectGuessAttempts
        );

        if (!game || !playersInGame || playersInGame.length === 0) { console.error(`getGameStateForPlayer ERROR: No se encontró Game ${gameId} o jugadores.`); return null; }
        const player = playersInGame.find(p => p._id.equals(playerId));
        if (!player) { console.error(`getGameStateForPlayer ERROR: Jugador ${playerId} no encontrado en juego ${gameId}`); return null; }

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id);
        const mainScaleBalanced = game.isMainScaleBalanced();
        const playersPublicInfo = playersInGame.map(p => ({
             id: p._id, name: p.name, turnOrder: p.turnOrder, mineralCount: p.inventory?.length ?? 0, isActive: p.isActive, canPlaceMinerals: p.canPlaceMinerals, hasVoted: game.status === 'voting' && game.votingState?.votes?.has(p._id.toString()) && game.votingState.votes.get(p._id.toString()) !== null
        }));
        let clientVotingState = null;
        if (game.status === 'voting' && game.votingState) { clientVotingState = { requiredVotes: game.votingState.requiredVotes, receivedVotes: game.votingState.receivedVotes, myVote: game.votingState.votes.get(player._id.toString()), }; }
        const phase1GuessedWeightsObject = game.phase1CorrectlyGuessedWeights ? Object.fromEntries(game.phase1CorrectlyGuessedWeights) : {};

        // Convertir el Map de intentos incorrectos a Objeto para el cliente
        const phase1IncorrectGuessAttemptsObject = player.phase1IncorrectGuessAttempts ? Object.fromEntries(player.phase1IncorrectGuessAttempts) : {};

        const gameStateToSend = {
            gameId: game._id, gameCode: game.gameCode, hostId: game.hostId, status: game.status, isMainScaleBalanced: mainScaleBalanced, knownMineralInfo: game.knownMineralInfo,
            mainScale: { leftWeight: game.mainScale.leftWeight || 0, rightWeight: game.mainScale.rightWeight || 0, leftMaterials: game.mainScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], rightMaterials: game.mainScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], },
            secondaryScale: { leftWeight: game.secondaryScale.leftWeight || 0, rightWeight: game.secondaryScale.rightWeight || 0, leftMaterials: game.secondaryScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], rightMaterials: game.secondaryScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], },
            currentTurnOrder: game.currentTurnOrder, currentPlayer: game.currentPlayerId ? { id: game.currentPlayerId._id, name: game.currentPlayerId.name, turnOrder: game.currentPlayerId.turnOrder } : null,
            myTurn: isPlayerTurn, myPlayerId: player._id, myInventory: player.inventory ? player.inventory.map(({ instanceId, type }) => ({ instanceId, type })) : [], myHackerBytes: player.hackerBytes, iCanPlaceMinerals: player.canPlaceMinerals, myPhase2AttemptsLeft: player.phase2GuessAttemptsThisTurn, myGuessedColorsPhase2: player.guessedColorsPhase2,
            phase1CorrectlyGuessedWeights: phase1GuessedWeightsObject,
            myPhase1IncorrectGuessAttempts: phase1IncorrectGuessAttemptsObject, // <<< Enviar intentos incorrectos al cliente
            playersPublicInfo: playersPublicInfo, currentPrizePot: game.currentPrizePot, balancerPlayer: game.balancerPlayerId ? { id: game.balancerPlayerId._id, name: game.balancerPlayerId.name } : null, votingState: clientVotingState, phase2RoundsPlayed: game.phase2RoundsPlayed, phase2CorrectGuessesTotal: game.phase2CorrectGuessesTotal, successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
        };
        return gameStateToSend;
    } catch (error) { console.error(`getGameStateForPlayer ERROR para game ${gameId}, player ${playerId}:`, error); return null; }
}

// Emite el estado actualizado a todos los jugadores ACTIVOS en la sala
async function broadcastGameState(gameId, gameCode) {
    // ... (Sin cambios en esta función) ...
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive');
    if (!game) { console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado.`); return; }
    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);
    for (const playerRef of game.players) {
        if (playerRef && playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) { io.to(playerRef.socketId).emit('gameStateUpdated', { gameState }); }
            else { console.warn(`broadcastGameState WARN: No se pudo generar gameState para jugador activo ${playerRef._id} en ${gameCode}`); }
        }
    }
}

// Emite el evento de fin de juego a todos
async function broadcastGameOver(game) {
    // ... (Sin cambios en esta función) ...
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id)
                                    .populate('players', 'socketId _id isActive name')
                                    .populate('successfulGuesser', '_id name')
                                    .populate('balancerPlayerId', '_id name');
    if (!populatedGame) { console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado.`); return; }
    let finalPrizePerPlayer = 0; let playersToReward = [];
    if (populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') { playersToReward = populatedGame.players.filter(p => p.isActive); }
    else if (populatedGame.status === 'finished_phase1_knowledge_win') { const winner = populatedGame.players.find(p => p._id.equals(populatedGame.successfulGuesser?._id)); if (winner && winner.isActive) { playersToReward.push(winner); finalPrizePerPlayer = populatedGame.currentPrizePot; console.log(`Juego ganado por ${winner.name} (Fase 1 Conocimiento) con ${finalPrizePerPlayer} HB.`); } else { console.log("Ganador Conocimiento F1 desconectado."); populatedGame.currentPrizePot = 0; await populatedGame.save(); } }
    if ((populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') && playersToReward.length > 0) {
        finalPrizePerPlayer = Math.floor(populatedGame.currentPrizePot / playersToReward.length); console.log(`Repartiendo ${populatedGame.currentPrizePot} entre ${playersToReward.length}. ${finalPrizePerPlayer} c/u.`);
        for (const player of playersToReward) { try { await Player.findByIdAndUpdate(player._id, { $inc: { hackerBytes: finalPrizePerPlayer } }); } catch (updateError) { console.error(`Error actualizando premio ${player._id}:`, updateError); } }
    } else if (!['finished_phase1_knowledge_win'].includes(populatedGame.status)) { console.log("Nadie activo/ganador, premio perdido."); populatedGame.currentPrizePot = 0; await populatedGame.save(); }
    if (['finished_phase2_loss', 'finished_disconnect_vote', 'finished_disconnect_game', 'finished_failure'].includes(populatedGame.status)) { populatedGame.currentPrizePot = 0; await populatedGame.save(); }
     for (const playerRef of populatedGame.players) {
        if (playerRef.socketId) {
             try {
                 const finalPlayerState = await Player.findById(playerRef._id); const finalGameState = await getGameStateForPlayer(populatedGame._id, playerRef._id);
                 if (finalGameState && finalPlayerState) { finalGameState.myHackerBytes = finalPlayerState.hackerBytes; io.to(playerRef.socketId).emit('gameOver', { gameState: finalGameState, actualWeights: populatedGame.actualMineralWeights }); }
                 else { console.warn(`broadcastGameOver WARN: No se pudo generar estado final para ${playerRef._id}`); }
             } catch (fetchError) { console.error(`Error obteniendo estado final para ${playerRef._id} en broadcastGameOver:`, fetchError); }
        }
     }
}


// --- Lógica de Socket.IO ---
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Crear Juego
    socket.on('createGame', async ({ hostName }, callback) => {
        // ... (Sin cambios en esta función) ...
        try {
            const gameCode = generateGameCode(); const { weights, knownInfo } = generateGameSetup();
            const host = new Player({ socketId: socket.id, name: hostName, turnOrder: 1, inventory: createPlayerInventory(weights), hackerBytes: 0, phase1IncorrectGuessAttempts: new Map() }); // Inicializar mapa
            const game = new Game({ gameCode, hostId: host._id, players: [host._id], actualMineralWeights: weights, knownMineralInfo: knownInfo, mainScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }, secondaryScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }, votingState: { votes: new Map(), requiredVotes: 0, receivedVotes: 0 }, phase1CorrectlyGuessedWeights: new Map(), phase2CorrectGuessesMap: new Map(), status: 'waiting', currentPrizePot: INITIAL_PRIZE_POT });
            await game.save(); host.gameId = game._id; await host.save(); socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}).`);
            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) { socket.emit('gameStateUpdated', { gameState: hostGameState }); }
            else { socket.emit('error', { message: 'Error al generar estado inicial.' }); }
        } catch (error) {
            console.error("Error creando juego:", error); let errorMessage = "Error interno."; if (error.name === 'ValidationError') errorMessage = `Validación: ${error.message}`; else if (error.code === 11000) errorMessage = "Error código único."; callback({ success: false, message: errorMessage });
        }
    });

    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        // ... (Sin cambios en esta función, excepto inicializar mapa en Player) ...
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name');
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó." });
            if (game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) return callback({ success: false, message: "Nombre en uso." });
            const turnOrder = game.players.length + 1;
            const player = new Player({ socketId: socket.id, name: playerName, gameId: game._id, turnOrder: turnOrder, inventory: createPlayerInventory(game.actualMineralWeights), hackerBytes: 0, phase1IncorrectGuessAttempts: new Map() }); // Inicializar mapa
            await player.save(); game.players.push(player._id); await game.save(); socket.join(gameCode);
            console.log(`${playerName} (T${turnOrder}) se unió a ${gameCode}`);
             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
             const playersPublicInfoPromises = updatedGame.players.map(async p => { const pData = await Player.findById(p._id).select('inventory'); return { id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive, mineralCount: pData?.inventory?.length ?? 0 }; });
             const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
             io.to(gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
             callback({ success: true, gameId: game._id, playerId: player._id });
             const playerGameState = await getGameStateForPlayer(game._id, player._id);
              if (playerGameState) { socket.emit('gameStateUpdated', { gameState: playerGameState }); }
        } catch (error) { console.error("Error uniéndose:", error); callback({ success: false, message: "Error interno al unirse." }); }
    });

    // Iniciar Juego (Host)
    socket.on('startGame', async ({ gameId }) => {
        // ... (Sin cambios en esta función) ...
         try {
            const game = await Game.findById(gameId).populate('players', '_id turnOrder isActive socketId');
            if (!game) return socket.emit('error', { message: "Juego no encontrado." });
            const hostPlayer = game.players.find(p => p._id.equals(game.hostId));
            if (!hostPlayer || hostPlayer.socketId !== socket.id) return socket.emit('error', { message: "Solo el host inicia." });
            if (game.status !== 'waiting') return socket.emit('error', { message: `El juego ya está ${game.status}.` });
            const activePlayers = game.players.filter(p => p.isActive);
             if (activePlayers.length < 2) return socket.emit('error', { message: "Mínimo 2 activos." });
            const firstPlayer = activePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
            if (!firstPlayer) { console.error(`startGame CRITICAL: ¡No se encontró 1er jugador! ${game._id}.`); return socket.emit('error', { message: "Error interno: Jugador inicial." }); }
            game.status = 'playing'; game.currentTurnOrder = firstPlayer.turnOrder; game.currentPlayerId = firstPlayer._id; game.balancerPlayerId = null; game.votingState = { votes: new Map(), requiredVotes: 0, receivedVotes: 0 }; game.phase1CorrectlyGuessedWeights = new Map(); game.phase2RoundsPlayed = 0; game.phase2CorrectGuessesTotal = 0; game.phase2CorrectGuessesMap = new Map(); game.successfulGuesser = null; game.currentPrizePot = INITIAL_PRIZE_POT;
            // Resetear intentos incorrectos de todos al iniciar
            await Player.updateMany({ gameId: game._id }, { $set: { phase1IncorrectGuessAttempts: new Map() } });
            await game.save();
            console.log(`startGame: ${game.gameCode} iniciado. Turno ${firstPlayer.turnOrder}.`);
            await broadcastGameState(game._id, game.gameCode);
        } catch (error) { console.error(`Error iniciando ${gameId}:`, error); socket.emit('error', { message: `Error al iniciar: ${error.message}` }); }
    });

    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
         // ... (Sin cambios en esta función) ...
         try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+inventory'); // Necesitamos inventario con pesos
            if (!game || !player) return socket.emit('error', { message: "Juego/jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "No en fase de colocación." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
             player.canPlaceMinerals = player.isActive && player.inventory && player.inventory.length >= 2;
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales." });
            if (!Array.isArray(placements) || placements.length < 2 || placements.length % 2 !== 0) { console.warn(`placeMinerals (${player.name}): Intento inválido (${placements?.length || 0}).`); return socket.emit('error', { message: 'Cantidad PAR (2, 4...).' }); }
            const currentInventory = [...player.inventory]; const mineralsToPlaceDetails = []; const placedInstanceIds = new Set();
            for (const placement of placements) {
                if (!placement || !placement.mineralInstanceId || !placement.targetScale || !placement.targetSide) throw new Error("Datos inválidos.");
                if (placedInstanceIds.has(placement.mineralInstanceId)) throw new Error("No puedes colocar el mismo dos veces.");
                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado.`);
                const mineral = currentInventory.splice(mineralIndex, 1)[0]; mineralsToPlaceDetails.push({ mineral, placement }); placedInstanceIds.add(placement.mineralInstanceId);
            }
             mineralsToPlaceDetails.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 scale.leftMaterials = scale.leftMaterials || []; scale.rightMaterials = scale.rightMaterials || []; scale.leftWeight = scale.leftWeight || 0; scale.rightWeight = scale.rightWeight || 0;
                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials; const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';
                 sideArray.push(mineral); scale[weightProp] += mineral.weight;
             });
            game.markModified('mainScale'); game.markModified('secondaryScale');
            player.inventory = currentInventory; await player.save();
            if (game.isMainScaleBalanced()) {
                console.log(`¡Balanza equilibrada por ${player.name} en ${game.gameCode}! Votación.`);
                game.status = 'voting'; game.balancerPlayerId = player._id; game.currentPrizePot = INITIAL_PRIZE_POT;
                const activePlayers = await Player.find({ gameId: game._id, isActive: true });
                game.votingState = { votes: new Map(activePlayers.map(p => [p._id.toString(), null])), requiredVotes: activePlayers.length, receivedVotes: 0 }; game.markModified('votingState');
                await game.save(); await broadcastGameState(game._id, game.gameCode);
            } else { await advanceTurn(game, io); }
        } catch (error) {
            console.error(`Error en placeMinerals para ${playerId}:`, error); socket.emit('error', { message: `Error al colocar: ${error.message || '?'}` });
             try { const currentState = await getGameStateForPlayer(gameId, playerId); if (currentState) socket.emit('gameStateUpdated', { gameState: currentState }); } catch (e) { console.error("Error retransmitiendo estado:", e); }
        }
    });

    // Adivinar Peso Individual en Fase 1 (ACTUALIZADO CON LÍMITE)
    socket.on('guessSingleWeightPhase1', async ({ gameId, playerId, guessedColor, guessedWeight }) => {
        try {
            const game = await Game.findById(gameId);
            // Poblar el campo nuevo
            const player = await Player.findById(playerId).select('+phase1IncorrectGuessAttempts'); // Asegurar que cargue el mapa

            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "Solo puedes adivinar en Fase 1." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (!MINERAL_TYPES.includes(guessedColor)) return socket.emit('error', { message: "Color inválido." });
            if (guessedColor === 'Amarillo') return socket.emit('error', { message: "No puedes adivinar Amarillo." });

            const guessNum = parseInt(guessedWeight);
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Peso inválido (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (game.phase1CorrectlyGuessedWeights?.has(guessedColor)) return socket.emit('error', { message: `Peso de ${guessedColor} ya adivinado.` });

            // --- NUEVA COMPROBACIÓN DE LÍMITE DE INTENTOS ---
            const incorrectAttemptsMap = player.phase1IncorrectGuessAttempts || new Map(); // Asegurar que sea un Map
            const currentIncorrectAttempts = incorrectAttemptsMap.get(guessedColor) || 0;

            if (currentIncorrectAttempts >= MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1) {
                console.log(`Fase 1: ${player.name} intentó adivinar ${guessedColor} pero ya agotó sus ${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1} intentos.`);
                socket.emit('singleGuessPhase1Result', {
                    success: false, // Indica fallo del intento, no si el peso era correcto
                    message: `Ya agotaste tus ${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1} intentos para adivinar ${guessedColor}.`
                });
                return; // Detener ejecución, no se procesa la adivinanza
            }
            // --- FIN COMPROBACIÓN DE LÍMITE ---

            console.log(`Fase 1: ${player.name} adivina ${guessedColor} = ${guessNum} (Intento incorrecto #${currentIncorrectAttempts + 1} si falla)`);
            const actualWeight = game.actualMineralWeights[guessedColor];

            if (guessNum === actualWeight) {
                // --- INTENTO CORRECTO ---
                console.log(`Fase 1: ¡Correcto! ${player.name} adivinó ${guessedColor}.`);
                if (!game.phase1CorrectlyGuessedWeights) game.phase1CorrectlyGuessedWeights = new Map();
                game.phase1CorrectlyGuessedWeights.set(guessedColor, actualWeight);
                game.markModified('phase1CorrectlyGuessedWeights');
                // Guardar el juego aquí para registrar el acierto antes de la posible victoria
                await game.save();

                // Comprobación de Victoria Instantánea
                const knownCountPhase1 = Object.keys(Object.fromEntries(game.phase1CorrectlyGuessedWeights)).length;
                if (knownCountPhase1 === GUESSABLE_MINERALS_COUNT) {
                     console.log(`¡VICTORIA INSTANTÁNEA! ${player.name} adivinó el último peso en Fase 1.`);
                     game.status = 'finished_phase1_knowledge_win';
                     game.successfulGuesser = player._id;
                     player.hackerBytes += game.currentPrizePot; // Asigna todo el bote
                     await player.save(); // Guardar jugador con premio
                     await game.save(); // Guardar estado final del juego
                     await broadcastGameOver(game);
                     return;
                }

                // Si no hubo victoria, enviar resultado parcial y estado
                socket.emit('singleGuessPhase1Result', { success: true, color: guessedColor, weight: actualWeight, message: `¡Correcto! ${guessedColor} pesa ${actualWeight}g.` });
                await broadcastGameState(game._id, game.gameCode);

            } else {
                // --- INTENTO INCORRECTO ---
                console.log(`Fase 1: Incorrecto. ${player.name} falló ${guessedColor}.`);

                // Incrementar contador de intentos incorrectos para este color
                 if (!player.phase1IncorrectGuessAttempts) { player.phase1IncorrectGuessAttempts = new Map(); }
                const newCount = currentIncorrectAttempts + 1;
                player.phase1IncorrectGuessAttempts.set(guessedColor, newCount);
                player.markModified('phase1IncorrectGuessAttempts'); // Marcar como modificado
                await player.save(); // Guardar el jugador con el intento actualizado

                // Enviar resultado incorrecto al jugador
                socket.emit('singleGuessPhase1Result', {
                    success: false, // Indica fallo del intento
                    message: `Incorrecto. ${guessedColor} no pesa ${guessNum}g. (Intento ${newCount}/${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1})`
                });
                // No se transmite estado global, solo el jugador actualizó su contador
            }
            // El turno NO avanza aquí.

        } catch (error) {
             console.error(`Error en guessSingleWeightPhase1 para ${playerId}:`, error);
             socket.emit('error', { message: `Error procesando adivinanza F1: ${error.message || '?'}` });
             try { const playerStillConnected = await Player.findById(playerId).select('socketId'); if(playerStillConnected?.socketId) { const currentState = await getGameStateForPlayer(gameId, playerId); if (currentState) io.to(playerStillConnected.socketId).emit('gameStateUpdated', { gameState: currentState }); } } catch (e) { console.error("Error retransmitiendo estado:", e); }
        }
    });

    // Votar para Fase 2
    socket.on('castVote', async ({ gameId, playerId, vote }) => {
        // ... (Lógica interna con comprobación de viabilidad sin cambios) ...
        try {
            const game = await Game.findById(gameId).populate('players', '_id isActive turnOrder name');
            const player = game.players.find(p => p._id.equals(playerId));
            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Inválido." });
            if (game.status !== 'voting') return socket.emit('error', { message: "No en votación." });
            if (!game.votingState?.votes) { console.error("Error crítico: votingState nulo."); return socket.emit('error', { message: "Error interno (vote state)." }); }
            if (!game.votingState.votes.has(playerId.toString())) return socket.emit('error', { message: "No habilitado para votar." });
            if (game.votingState.votes.get(playerId.toString()) !== null) return socket.emit('error', { message: "Ya votaste." });
            if (vote !== 'yes' && vote !== 'no') return socket.emit('error', { message: "Voto inválido (yes/no)." });

            console.log(`Voto de ${player.name}: ${vote}`);
            game.votingState.votes.set(playerId.toString(), vote); game.votingState.receivedVotes += 1; game.markModified('votingState');
            io.to(game.gameCode).emit('voteReceived', { playerId: playerId, playerName: player.name });
            const currentActivePlayers = game.players.filter(p => p.isActive); const requiredNow = currentActivePlayers.length; game.votingState.requiredVotes = requiredNow;

            if (game.votingState.receivedVotes >= requiredNow && requiredNow > 0) {
                console.log(`Todos (${requiredNow}) votaron en ${game.gameCode}. Contando...`);
                let yesVotes = 0; let noVotes = 0;
                currentActivePlayers.forEach(p => { const pv = game.votingState.votes.get(p._id.toString()); if (pv === 'yes') yesVotes++; else if (pv === 'no') noVotes++; });
                console.log(`Resultados: SI=${yesVotes}, NO=${noVotes}`);

                if (yesVotes > noVotes) {
                    console.log(`Votación APROBADA para Fase 2 en ${game.gameCode}.`);
                    const knownCountPhase1 = Object.keys(Object.fromEntries(game.phase1CorrectlyGuessedWeights || new Map())).length;
                    const unknownGuessableCount = GUESSABLE_MINERALS_COUNT - knownCountPhase1;
                    console.log(`Check viabilidad: Quedan ${unknownGuessableCount} pesos. Objetivo: ${PHASE2_TARGET_CORRECT_GUESSES}`);
                    if (unknownGuessableCount < PHASE2_TARGET_CORRECT_GUESSES) {
                        console.log(`¡Fase 2 NO VIABLE! Terminando.`); game.status = 'finished_balance_win'; game.successfulGuesser = game.balancerPlayerId; await game.save(); await broadcastGameOver(game); return;
                    }
                    game.status = 'guessing_phase'; game.phase2RoundsPlayed = 0; game.phase2CorrectGuessesTotal = 0; game.phase2CorrectGuessesMap = new Map();
                    let firstTurnPlayer = currentActivePlayers.find(p => p._id.equals(game.hostId)) || currentActivePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
                    if (firstTurnPlayer) {
                         game.currentPlayerId = firstTurnPlayer._id; game.currentTurnOrder = firstTurnPlayer.turnOrder;
                         await Player.updateMany({ gameId: game._id, isActive: true }, { $set: { guessedColorsPhase2: [], phase2GuessAttemptsThisTurn: 0 } });
                         await Player.findByIdAndUpdate(firstTurnPlayer._id, { phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN });
                         await game.save(); console.log(`Fase 2 iniciada. Turno ${firstTurnPlayer.name}`); await broadcastGameState(game._id, game.gameCode);
                    } else { console.error("Error crítico: No activos F2."); game.status = 'finished_disconnect_game'; game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game); return; }
                } else { console.log(`Votación RECHAZADA/Empate. Fin.`); game.status = 'finished_balance_win'; game.successfulGuesser = game.balancerPlayerId; await game.save(); await broadcastGameOver(game); }
            } else if (requiredNow === 0) { console.log("Voto completado pero 0 activos."); game.status = 'finished_disconnect_vote'; game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game); }
            else { await game.save(); await broadcastGameState(game._id, game.gameCode); }
        } catch (error) { console.error(`Error en castVote para ${playerId}:`, error); socket.emit('error', { message: `Error al votar: ${error.message || '?'}` }); }
    });

    // Adivinar Peso Individual (Fase 2)
    socket.on('guessSingleWeight', async ({ gameId, playerId, color, weightGuess }) => {
        // ... (Lógica con validaciones de Amarillo y Fase 1 sin cambios) ...
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);
            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Inválido." });
            if (game.status !== 'guessing_phase') return socket.emit('error', { message: "No en fase adivinanza." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (player.phase2GuessAttemptsThisTurn <= 0) return socket.emit('error', { message: "No te quedan intentos." });
            if (!MINERAL_TYPES.includes(color)) return socket.emit('error', { message: "Color inválido." });
            const guessNum = parseInt(weightGuess);
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Peso inválido (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (color === 'Amarillo') { socket.emit('singleGuessResult', { playerId, playerName: player.name, color, correct: false, message: 'Amarillo ya se conoce.', justGuessed: false }); return; }
            if (game.phase1CorrectlyGuessedWeights?.has(color)) { socket.emit('singleGuessResult', { playerId, playerName: player.name, color, correct: false, message: `${color} se descubrió en Fase 1.`, justGuessed: false }); return; }
            if (player.guessedColorsPhase2.includes(color)) return socket.emit('error', { message: `Ya intentaste ${color}.` });
            console.log(`Fase 2: ${player.name} adivina ${color} = ${guessNum}`);
            player.phase2GuessAttemptsThisTurn -= 1; player.guessedColorsPhase2.push(color);
            const actualWeight = game.actualMineralWeights[color]; const alreadyGuessedCorrectly = game.phase2CorrectGuessesMap.has(color);
            if (guessNum === actualWeight) {
                 if (!alreadyGuessedCorrectly) { console.log(`Fase 2: ¡CORRECTO! ${player.name} adivinó ${color}.`); game.phase2CorrectGuessesTotal += 1; game.phase2CorrectGuessesMap.set(color, player._id); game.currentPrizePot += PHASE2_REWARD_PER_CORRECT_GUESS; game.markModified('phase2CorrectGuessesMap'); await game.save(); await player.save(); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: true, message: `¡${player.name} adivinó ${color}!`, newTotalGuesses: game.phase2CorrectGuessesTotal }); io.to(game.gameCode).emit('prizePotUpdated', { newPrizePot: game.currentPrizePot }); }
                 else { await player.save(); console.log(`Fase 2: ${player.name} adivinó ${color} (correcto), pero ya conocido.`); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: false, message: `${player.name} adivinó ${color} (ya encontrado).` }); }
            } else { await player.save(); console.log(`Fase 2: INCORRECTO. ${player.name} falló ${color}.`); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: false, justGuessed: false, message: `${player.name} falló al adivinar ${color}.` }); }
             await broadcastGameState(game._id, game.gameCode);
        } catch (error) { console.error(`Error en guessSingleWeight para ${playerId}:`, error); socket.emit('error', { message: `Error al adivinar: ${error.message || '?'}` }); }
    });

    // Pasar Turno
    socket.on('passTurn', async ({ gameId, playerId }) => {
        // ... (Sin cambios en esta función) ...
        try {
            const game = await Game.findById(gameId); const player = await Player.findById(playerId);
            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Inválido." });
            if (game.status !== 'playing' && game.status !== 'guessing_phase') return socket.emit('error', { message: "No ahora." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            console.log(`${player.name} pasa turno en ${game.gameCode} (${game.status})`);
            await advanceTurn(game, io);
        } catch (error) { console.error(`Error en passTurn para ${playerId}:`, error); socket.emit('error', { message: `Error al pasar: ${error.message || '?'}` }); }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        // ... (Sin cambios en esta función) ...
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });
        if (player?.gameId) {
             const game = await Game.findById(player.gameId).populate('players', '_id isActive turnOrder name');
             if (!game) { console.log(`disconnect: Juego ${player.gameId} no hallado. Limpiando socketId.`); player.socketId = null; await player.save(); return; }
             if (game.status.startsWith('finished')) { console.log(`disconnect: Juego ${game.gameCode} terminado. Limpiando socketId.`); player.socketId = null; await player.save(); return; }
             console.log(`Jugador ${player.name} desconectado de ${game.gameCode} (Status: ${game.status}).`);
             const wasCurrentPlayer = game.currentPlayerId?.equals(player._id); player.isActive = false; player.socketId = null; await player.save();
             io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });
              const updatedPlayers = await Player.find({ gameId: game._id }).select('_id name turnOrder isActive inventory');
              const playersPublicInfo = updatedPlayers.map(p => ({ id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive, mineralCount: p.inventory?.length ?? 0 }));
              io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
             if (game.status === 'voting') { console.log(`Desconexión DURANTE VOTACIÓN. Terminando.`); io.to(game.gameCode).emit('gameEndedDueToVoteDisconnect', { playerName: player.name }); game.status = 'finished_disconnect_vote'; game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game); return; }
             let needsTurnAdvance = false; if ((game.status === 'playing' || game.status === 'guessing_phase') && wasCurrentPlayer) { console.log(`disconnect: Era turno de ${player.name}. Avanzando...`); needsTurnAdvance = true; }
             const remainingActivePlayersCount = updatedPlayers.filter(p => p.isActive).length;
             if (remainingActivePlayersCount === 0) { console.log(`¡Último jugador desconectado! Fin.`); if (game.status === 'guessing_phase') { game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss'; } else { game.status = 'finished_disconnect_game'; } game.currentPlayerId = null; await game.save(); await broadcastGameOver(game); }
             else if (needsTurnAdvance) { await advanceTurn(game, io); }
             else { await broadcastGameState(game._id, game.gameCode); }
        }
    });
});

// --- Función Helper: advanceTurn ---
async function advanceTurn(game, ioInstance) {
    // ... (Sin cambios en esta función) ...
    if (!game || !game.status || game.status.startsWith('finished')) return;
    const previousPlayerId = game.currentPlayerId; let nextPlayer = null; let roundEnded = false;
    nextPlayer = await findNextActivePlayer(game);
    if (game.status === 'guessing_phase' && previousPlayerId && nextPlayer) {
        const previousPlayer = await Player.findById(previousPlayerId).select('turnOrder');
        if (previousPlayer && (nextPlayer.turnOrder <= previousPlayer.turnOrder)) {
            roundEnded = true; game.phase2RoundsPlayed += 1; console.log(`Fin Ronda ${game.phase2RoundsPlayed} Fase 2.`);
            if (game.phase2RoundsPlayed >= PHASE2_TOTAL_ROUNDS) { console.log("3 rondas F2 completas. Evaluando..."); game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss'; console.log(`Resultado F2: ${game.status}`); game.currentPlayerId = null; await game.save(); await broadcastGameOver(game); return; }
        }
        if (nextPlayer && !game.status.startsWith('finished')) { await Player.findByIdAndUpdate(nextPlayer._id, { phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN }); console.log(`advanceTurn: Reseteando intentos F2 para ${nextPlayer.name}`); }
    }
    if (nextPlayer) { game.currentPlayerId = nextPlayer._id; game.currentTurnOrder = nextPlayer.turnOrder; console.log(`advanceTurn: Turno ${nextPlayer.name} (T${nextPlayer.turnOrder})`); await game.save(); await broadcastGameState(game._id, game.gameCode); }
    else { console.log("advanceTurn: No siguiente jugador. Fin."); if (game.status === 'guessing_phase') game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss'; else if (game.status === 'playing') game.status = 'finished_failure'; else game.status = 'finished_disconnect_game'; console.log(`advanceTurn: Juego termina ${game.status}`); game.currentPlayerId = null; await game.save(); await broadcastGameOver(game); }
}

// --- Rutas API (Opcional) ---
// const apiRoutes = require('./routes/api');
// app.use('/api', apiRoutes);

// --- Servir Frontend ---
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor 'Juego de Escala v2' en puerto ${PORT}`); });