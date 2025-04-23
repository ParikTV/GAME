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
app.use(express.static(path.join(__dirname, 'public'))); // Servir archivos estáticos (para la versión web anterior)

// --- Constantes del Juego (ACTUALIZADAS) ---
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'];
const MINERALS_PER_PLAYER_PER_TYPE = 2;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;
const INITIAL_PRIZE_POT = 10000000;
const PHASE2_REWARD_PER_CORRECT_GUESS = 2000000;
const PHASE2_TARGET_CORRECT_GUESSES = 3;
const PHASE2_TOTAL_ROUNDS = 3;
const PHASE2_GUESS_ATTEMPTS_PER_TURN = 2;
const GUESSABLE_MINERALS_COUNT = 4; // Rojo, Verde, Azul, Purpura
const MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1 = 2;

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

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

function createPlayerInventory(actualWeights) {
    const inventory = []; MINERAL_TYPES.forEach(type => { const weight = actualWeights[type]; if (typeof weight !== 'number') { console.error(`Error: Peso no hallado para ${type}.`); return; } for (let i = 0; i < MINERALS_PER_PLAYER_PER_TYPE; i++) { inventory.push({ instanceId: uuidv4(), type: type, weight: weight }); } }); return inventory;
}

async function findNextActivePlayer(game) {
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
    const activePlayers = populatedGame.players.filter(p => p != null && p.isActive).sort((a, b) => a.turnOrder - b.turnOrder);
    if (activePlayers.length === 0) { console.log("findNextActivePlayer: No hay jugadores activos."); return null; }
    const currentPlayerIndex = activePlayers.findIndex(p => game.currentPlayerId && p._id.equals(game.currentPlayerId));
    let searchStartIndex = (currentPlayerIndex === -1) ? -1 : currentPlayerIndex;
    let attempts = 0; let nextPlayerIndex = searchStartIndex;
    while (attempts < activePlayers.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
        const nextPlayer = activePlayers[nextPlayerIndex];
        if (populatedGame.status === 'playing' || populatedGame.status === 'guessing_phase') {
             console.log(`findNextActivePlayer: Siguiente turno para ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`); return nextPlayer;
        }
        attempts++; if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break; // Evitar bucle infinito si solo queda 1
    }
    console.log("findNextActivePlayer: No se encontró un siguiente jugador activo válido para el estado actual."); return null;
}

async function checkIfAllActivePlayersPlacedMinerals(gameId) {
    try {
        const activePlayers = await Player.find({ gameId: gameId, isActive: true }).select('name inventory');
        if (!activePlayers || activePlayers.length === 0) {
            console.log(`checkIfAllActivePlayersPlacedMinerals: No se encontraron jugadores activos para ${gameId}.`);
            return true;
        }
        for (const player of activePlayers) {
            if (player.inventory && player.inventory.length > 0) {
                console.log(`checkIfAllActivePlayersPlacedMinerals: ${player.name} aún tiene ${player.inventory.length} minerales.`);
                return false;
            }
        }
        console.log(`checkIfAllActivePlayersPlacedMinerals: Todos activos en ${gameId} colocaron.`);
        return true;
    } catch (error) {
        console.error(`Error en checkIfAllActivePlayersPlacedMinerals para ${gameId}:`, error);
        return false;
    }
}

async function getGameStateForPlayer(gameId, playerId) {
    try {
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id')
            .populate('balancerPlayerId', 'name _id');

        if (!game) { console.error(`getGameStateForPlayer ERROR: Game ${gameId} no encontrado.`); return null; }

        const playersInGame = await Player.find({ gameId: gameId }).select(
            'name turnOrder isActive canPlaceMinerals inventory hackerBytes guessedColorsPhase2 phase2GuessAttemptsThisTurn phase1IncorrectGuessAttempts _id socketId'
        );

        if (!playersInGame || playersInGame.length === 0) { console.error(`getGameStateForPlayer ERROR: Jugadores no encontrados para ${gameId}.`); return null; }
        const player = playersInGame.find(p => p._id.equals(playerId));
        if (!player) { console.error(`getGameStateForPlayer ERROR: Jugador ${playerId} no encontrado en ${gameId}`); return null; }

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id);
        const mainScaleBalanced = game.isMainScaleBalanced();
        const allPlaced = await checkIfAllActivePlayersPlacedMinerals(game._id);

        const playersPublicInfo = playersInGame.map(p => ({
             id: p._id, name: p.name, turnOrder: p.turnOrder, mineralCount: p.inventory?.length ?? 0, isActive: p.isActive, canPlaceMinerals: p.canPlaceMinerals, hasVoted: game.status === 'voting' && game.votingState?.votes?.has(p._id.toString()) && game.votingState.votes.get(p._id.toString()) !== null
        }));
        let clientVotingState = null;
        if (game.status === 'voting' && game.votingState) { clientVotingState = { requiredVotes: game.votingState.requiredVotes, receivedVotes: game.votingState.receivedVotes, myVote: game.votingState.votes.get(player._id.toString()), }; }
        const phase1GuessedWeightsObject = game.phase1CorrectlyGuessedWeights ? Object.fromEntries(game.phase1CorrectlyGuessedWeights) : {};
        const phase1IncorrectGuessAttemptsObject = player.phase1IncorrectGuessAttempts ? Object.fromEntries(player.phase1IncorrectGuessAttempts) : {};

        const gameStateToSend = {
            gameId: game._id, gameCode: game.gameCode, hostId: game.hostId, status: game.status, isMainScaleBalanced: mainScaleBalanced, knownMineralInfo: game.knownMineralInfo,
            mainScale: { leftWeight: game.mainScale.leftWeight || 0, rightWeight: game.mainScale.rightWeight || 0, leftMaterials: game.mainScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], rightMaterials: game.mainScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], },
            secondaryScale: { leftWeight: game.secondaryScale.leftWeight || 0, rightWeight: game.secondaryScale.rightWeight || 0, leftMaterials: game.secondaryScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], rightMaterials: game.secondaryScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [], },
            currentTurnOrder: game.currentTurnOrder, currentPlayer: game.currentPlayerId ? { id: game.currentPlayerId._id, name: game.currentPlayerId.name, turnOrder: game.currentPlayerId.turnOrder } : null,
            myTurn: isPlayerTurn, myPlayerId: player._id, myInventory: player.inventory ? player.inventory.map(({ instanceId, type }) => ({ instanceId, type })) : [], myHackerBytes: player.hackerBytes, iCanPlaceMinerals: player.canPlaceMinerals, myPhase2AttemptsLeft: player.phase2GuessAttemptsThisTurn, myGuessedColorsPhase2: player.guessedColorsPhase2,
            phase1CorrectlyGuessedWeights: phase1GuessedWeightsObject,
            myPhase1IncorrectGuessAttempts: phase1IncorrectGuessAttemptsObject,
            playersPublicInfo: playersPublicInfo, currentPrizePot: game.currentPrizePot, balancerPlayer: game.balancerPlayerId ? { id: game.balancerPlayerId._id, name: game.balancerPlayerId.name } : null, votingState: clientVotingState, phase2RoundsPlayed: game.phase2RoundsPlayed, phase2CorrectGuessesTotal: game.phase2CorrectGuessesTotal, successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
            allMineralsPlaced: allPlaced,
        };
        return gameStateToSend;
    } catch (error) { console.error(`getGameStateForPlayer ERROR para ${gameId}, ${playerId}:`, error); return null; }
}

async function broadcastGameState(gameId, gameCode) {
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive');
    if (!game) { console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado.`); return; }
    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);
    for (const playerRef of game.players) {
        if (playerRef && playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) { io.to(playerRef.socketId).emit('gameStateUpdated', { gameState }); }
            else { console.warn(`broadcastGameState WARN: No se pudo generar gameState para ${playerRef._id} en ${gameCode}`); }
        }
    }
}

async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id)
                         .populate('players', 'socketId _id isActive name hackerBytes')
                         .populate('successfulGuesser', '_id name')
                         .populate('balancerPlayerId', '_id name');
    if (!populatedGame) { console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado.`); return; }

    let finalPrizePerPlayer = 0;
    let playersToRewardIds = [];

    if (populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') {
        playersToRewardIds = populatedGame.players.filter(p => p.isActive).map(p => p._id);
    } else if (populatedGame.status === 'finished_phase1_knowledge_win') {
        const winner = populatedGame.players.find(p => populatedGame.successfulGuesser && p._id.equals(populatedGame.successfulGuesser._id));
        if (winner && winner.isActive) { playersToRewardIds.push(winner._id); finalPrizePerPlayer = populatedGame.currentPrizePot; }
        else { console.log("Ganador F1 Conocimiento desconectado."); populatedGame.currentPrizePot = 0; await populatedGame.save(); }
    }

    if ((populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') && playersToRewardIds.length > 0) {
        finalPrizePerPlayer = Math.floor(populatedGame.currentPrizePot / playersToRewardIds.length);
        console.log(`Repartiendo ${populatedGame.currentPrizePot} a ${playersToRewardIds.length} jugadores: ${finalPrizePerPlayer} c/u.`);
        try { await Player.updateMany({ _id: { $in: playersToRewardIds } }, { $inc: { hackerBytes: finalPrizePerPlayer } }); }
        catch (updateError) { console.error(`Error actualizando premios:`, updateError); }
    } else if (!['finished_phase1_knowledge_win'].includes(populatedGame.status) && playersToRewardIds.length === 0) {
         console.log("Nadie activo/ganador o no F1 conocimiento. Premio perdido.");
         if(populatedGame.currentPrizePot !== 0) { populatedGame.currentPrizePot = 0; await populatedGame.save(); }
    }
    if (['finished_phase2_loss', 'finished_disconnect_vote', 'finished_disconnect_game', 'finished_failure'].includes(populatedGame.status)) {
         if(populatedGame.currentPrizePot !== 0) { populatedGame.currentPrizePot = 0; await populatedGame.save(); }
    }
     const allPlayersEver = await Player.find({gameId: populatedGame._id}).select('socketId _id');
     for (const playerRef of allPlayersEver) {
         if (playerRef.socketId) {
              try {
                   const finalPlayerState = await Player.findById(playerRef._id).select('hackerBytes');
                   const finalGameStateForPlayer = await getGameStateForPlayer(populatedGame._id, playerRef._id);
                   if (finalGameStateForPlayer && finalPlayerState) {
                       finalGameStateForPlayer.myHackerBytes = finalPlayerState.hackerBytes;
                       io.to(playerRef.socketId).emit('gameOver', { gameState: finalGameStateForPlayer, actualWeights: populatedGame.actualMineralWeights });
                   } else {
                       console.warn(`broadcastGameOver WARN: No se pudo generar estado final/playerstate para ${playerRef._id}`);
                       io.to(playerRef.socketId).emit('gameOver', { gameState: { status: populatedGame.status, gameCode: populatedGame.gameCode }, actualWeights: populatedGame.actualMineralWeights });
                   }
              } catch (fetchError) { console.error(`Error obteniendo estado final para ${playerRef._id} en broadcastGameOver:`, fetchError); }
         }
      }
}

async function advanceTurn(game, ioInstance) {
    if (!game || !game.status || game.status.startsWith('finished')) return;
    console.log(`advanceTurn: Iniciando (Estado: ${game.status}, Jugador: ${game.currentPlayerId})`);

    const previousPlayerId = game.currentPlayerId;
    let nextPlayer = await findNextActivePlayer(game);

    if (game.status === 'guessing_phase' && previousPlayerId && nextPlayer) {
        const previousPlayer = await Player.findById(previousPlayerId).select('turnOrder');
        if (previousPlayer && nextPlayer.turnOrder <= previousPlayer.turnOrder) { // Check if loop completed
            game.phase2RoundsPlayed += 1;
            console.log(`Fin Ronda ${game.phase2RoundsPlayed} Fase 2.`);
            if (game.phase2RoundsPlayed >= PHASE2_TOTAL_ROUNDS) {
                 console.log(`Máximo ${PHASE2_TOTAL_ROUNDS} rondas F2.`);
                 game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
                 console.log(`Resultado F2: ${game.status}`);
                 game.currentPlayerId = null; // No current player when game ends
                 await game.save();
                 await broadcastGameOver(game); // End the game
                 return; // Exit advanceTurn
            }
        }
        // Reset attempts for the next player if the game continues
        if (nextPlayer && !game.status.startsWith('finished')) {
            await Player.findByIdAndUpdate(nextPlayer._id, { phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN });
            console.log(`advanceTurn: Reseteando intentos F2 para ${nextPlayer.name}`);
        }
    }

    if (nextPlayer && !game.status.startsWith('finished')) {
        game.currentPlayerId = nextPlayer._id;
        game.currentTurnOrder = nextPlayer.turnOrder;
        console.log(`advanceTurn: Turno asignado a ${nextPlayer.name} (T${nextPlayer.turnOrder})`);
        await game.save();
        await broadcastGameState(game._id, game.gameCode); // Broadcast the new state
    } else if (!game.status.startsWith('finished')) {
        // No next active player found, and game didn't end due to Phase 2 rounds
        console.log("advanceTurn: No siguiente jugador activo. Fin del juego.");
        if (game.status === 'guessing_phase') {
             game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
        } else if (game.status === 'playing') {
             game.status = 'finished_failure'; // Nobody balanced or won via knowledge
        } else {
             game.status = 'finished_disconnect_game'; // Default if something unexpected happened
        }
        console.log(`advanceTurn: Juego termina con ${game.status}`);
        game.currentPlayerId = null;
        if (game.status !== 'finished_phase2_win') { game.currentPrizePot = 0; } // Lose pot if not Phase 2 win
        await game.save();
        await broadcastGameOver(game);
    }
    // If game status was already 'finished' by round logic, do nothing more.
}


// --- Lógica de Socket.IO ---
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Crear Juego
    socket.on('createGame', async ({ hostName }, callback) => {
        try {
            const gameCode = generateGameCode(); const { weights, knownInfo } = generateGameSetup();
            const host = new Player({ socketId: socket.id, name: hostName, turnOrder: 1, inventory: createPlayerInventory(weights), hackerBytes: 0, phase1IncorrectGuessAttempts: new Map() });
            const game = new Game({ gameCode, hostId: host._id, players: [host._id], actualMineralWeights: weights, knownMineralInfo: knownInfo, mainScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }, secondaryScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }, votingState: { votes: new Map(), requiredVotes: 0, receivedVotes: 0 }, phase1CorrectlyGuessedWeights: new Map(), phase2CorrectGuessesMap: new Map(), status: 'waiting', currentPrizePot: INITIAL_PRIZE_POT });
            await game.save(); host.gameId = game._id; await host.save(); socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}).`);
            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });

            console.log(`>>> Intentando broadcast inicial para ${gameCode}`);
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            console.log(`--- Estado INICIAL a enviar en ${gameCode} (vía broadcast) ---`);
            console.log("playersPublicInfo en estado inicial:", hostGameState?.playersPublicInfo);

            await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error("Error creando juego:", error); let errorMessage = "Error interno."; if (error.name === 'ValidationError') errorMessage = `Validación: ${error.message}`; else if (error.code === 11000) errorMessage = "Error código único."; callback({ success: false, message: errorMessage });
        }
    });

    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name');
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó." });
            if (game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) return callback({ success: false, message: "Nombre en uso." });
            const turnOrder = game.players.length + 1;
            const player = new Player({ socketId: socket.id, name: playerName, gameId: game._id, turnOrder: turnOrder, inventory: createPlayerInventory(game.actualMineralWeights), hackerBytes: 0, phase1IncorrectGuessAttempts: new Map() });
            await player.save(); game.players.push(player._id); await game.save(); socket.join(gameCode);
            console.log(`${playerName} (T${turnOrder}) se unió a ${gameCode}`);
             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
             const playersPublicInfoPromises = updatedGame.players.map(async p => { const pData = await Player.findById(p._id).select('inventory'); return { id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive, mineralCount: pData?.inventory?.length ?? 0 }; });
             const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
             io.to(gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
             callback({ success: true, gameId: game._id, playerId: player._id });
             await broadcastGameState(game._id, game.gameCode); // Broadcast state after join
        } catch (error) { console.error("Error uniéndose:", error); callback({ success: false, message: "Error interno al unirse." }); }
    });

    // Iniciar Juego (Host)
    socket.on('startGame', async ({ gameId }) => {
        try {
            const game = await Game.findById(gameId).populate('players', '_id turnOrder isActive socketId');
            if (!game || game.status !== 'waiting') return socket.emit('error', { message: "Juego inválido o ya iniciado." });
            const hostPlayer = game.players.find(p => p._id.equals(game.hostId));
            if (!hostPlayer || hostPlayer.socketId !== socket.id) return socket.emit('error', { message: "Solo el host inicia." });
            const activePlayers = game.players.filter(p => p.isActive);
             if (activePlayers.length < 2) return socket.emit('error', { message: "Mínimo 2 activos." });
            const firstPlayer = activePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
            if (!firstPlayer) { console.error(`startGame CRITICAL: No 1er jugador ${game._id}.`); return socket.emit('error', { message: "Error interno." }); }
            game.status = 'playing'; game.currentTurnOrder = firstPlayer.turnOrder; game.currentPlayerId = firstPlayer._id;
            // Resetear campos relevantes
            game.balancerPlayerId = null; game.votingState = { votes: new Map(), requiredVotes: 0, receivedVotes: 0 }; game.phase1CorrectlyGuessedWeights = new Map(); game.phase2RoundsPlayed = 0; game.phase2CorrectGuessesTotal = 0; game.phase2CorrectGuessesMap = new Map(); game.successfulGuesser = null; game.currentPrizePot = INITIAL_PRIZE_POT;
            await Player.updateMany({ gameId: game._id }, { $set: { phase1IncorrectGuessAttempts: new Map() } }); // Resetear intentos F1
            await game.save();
            console.log(`startGame: ${game.gameCode} iniciado. Turno ${firstPlayer.turnOrder}.`);
            await broadcastGameState(game._id, game.gameCode);
        } catch (error) { console.error(`Error iniciando ${gameId}:`, error); socket.emit('error', { message: `Error al iniciar: ${error.message}` }); }
    });

    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+inventory');
            if (!game || !player || !player.isActive || game.status !== 'playing' || !game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "Inválido/No tu turno." });
            if (!player.inventory || player.inventory.length < 2) return socket.emit('error', { message: "No minerales suficientes." });
            if (!Array.isArray(placements) || placements.length < 2 || placements.length % 2 !== 0) { console.warn(`placeMinerals (${player.name}): Inválido (${placements?.length || 0}).`); return socket.emit('error', { message: 'Cantidad PAR (2, 4...).' }); }
            const currentInventory = [...player.inventory]; const mineralsToPlaceDetails = []; const placedInstanceIds = new Set();
            for (const placement of placements) {
                if (!placement?.mineralInstanceId || !placement.targetScale || !placement.targetSide) throw new Error("Colocación inválida.");
                if (placedInstanceIds.has(placement.mineralInstanceId)) throw new Error("Mismo mineral 2 veces.");
                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) throw new Error(`Mineral ${placement.mineralInstanceId} no en inventario.`);
                mineralsToPlaceDetails.push({ mineral: currentInventory.splice(mineralIndex, 1)[0], placement }); placedInstanceIds.add(placement.mineralInstanceId);
            }
             mineralsToPlaceDetails.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 scale.leftMaterials = scale.leftMaterials || []; scale.rightMaterials = scale.rightMaterials || []; scale.leftWeight = scale.leftWeight || 0; scale.rightWeight = scale.rightWeight || 0;
                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials; const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';
                 sideArray.push(mineral); scale[weightProp] = (scale[weightProp] || 0) + mineral.weight; // Asegurar que suma correctamente
             });
            game.markModified('mainScale'); game.markModified('secondaryScale');
            player.inventory = currentInventory; await player.save();
            const balanced = game.isMainScaleBalanced(); const allPlaced = await checkIfAllActivePlayersPlacedMinerals(game._id);
            if (balanced && allPlaced) {
                console.log(`¡Balanza eq. Y TODOS colocados por ${player.name}! Votación.`);
                game.status = 'voting'; game.balancerPlayerId = player._id; game.currentPrizePot = INITIAL_PRIZE_POT;
                const activePlayers = await Player.find({ gameId: game._id, isActive: true });
                game.votingState = { votes: new Map(activePlayers.map(p => [p._id.toString(), null])), requiredVotes: activePlayers.length, receivedVotes: 0 };
                game.markModified('votingState'); await game.save(); await broadcastGameState(game._id, game.gameCode);
            } else {
                 if (balanced) console.log(`Balanza eq. ${player.name}, faltan otros. Avanzando.`);
                 else if (allPlaced) console.log(`Todos colocados, balanza NO eq. ${player.name}. Avanzando.`);
                 else console.log(`Jugada ${player.name} OK. Ni balanza ni todos. Avanzando.`);
                await advanceTurn(game, io);
            }
        } catch (error) { console.error(`Error placeMinerals ${playerId}:`, error); socket.emit('error', { message: `Error al colocar: ${error.message || '?'}` }); try{const cs=await getGameStateForPlayer(gameId, playerId);if(cs) socket.emit('gameStateUpdated',{gameState:cs});}catch(e){} }
    });

    // Adivinar Peso Individual en Fase 1
    socket.on('guessSingleWeightPhase1', async ({ gameId, playerId, guessedColor, guessedWeight }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+phase1IncorrectGuessAttempts');
            if (!game || !player || !player.isActive || game.status !== 'playing' || !game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "Inválido." });
            if (!MINERAL_TYPES.includes(guessedColor) || guessedColor === 'Amarillo') return socket.emit('error', { message: "Color inválido." });
            const guessNum = parseInt(guessedWeight); if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Peso (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (game.phase1CorrectlyGuessedWeights?.has(guessedColor)) return socket.emit('error', { message: `${guessedColor} ya conocido.` });
            const incorrectAttemptsMap = player.phase1IncorrectGuessAttempts || new Map(); const currentIncorrectAttempts = incorrectAttemptsMap.get(guessedColor) || 0;
            if (currentIncorrectAttempts >= MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1) { socket.emit('singleGuessPhase1Result', { success: false, message: `Agotaste intentos ${guessedColor}.` }); return; }
            console.log(`F1: ${player.name} adivina ${guessedColor}=${guessNum}`);
            const actualWeight = game.actualMineralWeights[guessedColor];
            if (guessNum === actualWeight) {
                console.log(`F1: ¡Correcto! ${player.name} ${guessedColor}.`);
                if (!game.phase1CorrectlyGuessedWeights) game.phase1CorrectlyGuessedWeights = new Map();
                game.phase1CorrectlyGuessedWeights.set(guessedColor, actualWeight); game.markModified('phase1CorrectlyGuessedWeights'); await game.save();
                const knownCountPhase1 = Object.keys(Object.fromEntries(game.phase1CorrectlyGuessedWeights)).length;
                if (knownCountPhase1 === GUESSABLE_MINERALS_COUNT) {
                     console.log(`¡VICTORIA F1! ${player.name}`); game.status = 'finished_phase1_knowledge_win'; game.successfulGuesser = player._id;
                     await Player.findByIdAndUpdate(player._id, { $inc: { hackerBytes: game.currentPrizePot }}); await game.save(); await broadcastGameOver(game); return;
                }
                socket.emit('singleGuessPhase1Result', { success: true, color: guessedColor, weight: actualWeight, message: `¡Correcto! ${guessedColor}=${actualWeight}g.` });
                await broadcastGameState(game._id, game.gameCode);
            } else {
                console.log(`F1: Incorrecto. ${player.name} ${guessedColor}.`);
                 if (!player.phase1IncorrectGuessAttempts) player.phase1IncorrectGuessAttempts = new Map();
                const newCount = currentIncorrectAttempts + 1; player.phase1IncorrectGuessAttempts.set(guessedColor, newCount); player.markModified('phase1IncorrectGuessAttempts'); await player.save();
                socket.emit('singleGuessPhase1Result', { success: false, message: `Incorrecto. ${guessedColor}!= ${guessNum}g. (Intento ${newCount}/${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1})` });
            }
        } catch (error) { console.error(`Error guessF1 ${playerId}:`, error); socket.emit('error', { message: `Error F1: ${error.message || '?'}` }); try{const p=await Player.findById(playerId).select('socketId');if(p?.socketId){const cs=await getGameStateForPlayer(gameId,playerId);if(cs) io.to(p.socketId).emit('gameStateUpdated',{gameState:cs});}}catch(e){} }
    });

    // Votar para Fase 2
    socket.on('castVote', async ({ gameId, playerId, vote }) => {
        try {
            const game = await Game.findById(gameId).populate('players', '_id isActive turnOrder name');
            const player = game.players.find(p => p._id.equals(playerId));
            if (!game || !player || !player.isActive || game.status !== 'voting' || !game.votingState?.votes) return socket.emit('error', { message: "Inválido." });
            if (!game.votingState.votes.has(playerId.toString()) || game.votingState.votes.get(playerId.toString()) !== null) return socket.emit('error', { message: "No votar." });
            if (vote !== 'yes' && vote !== 'no') return socket.emit('error', { message: "Voto yes/no." });
            console.log(`Voto ${player.name}: ${vote}`);
            game.votingState.votes.set(playerId.toString(), vote); game.votingState.receivedVotes += 1; game.markModified('votingState');
            io.to(game.gameCode).emit('voteReceived', { playerId: playerId, playerName: player.name });
            const currentActivePlayers = game.players.filter(p => p.isActive); const requiredNow = currentActivePlayers.length; game.votingState.requiredVotes = requiredNow;
            if (game.votingState.receivedVotes >= requiredNow && requiredNow > 0) {
                console.log(`Todos (${requiredNow}) votaron ${game.gameCode}. Contando...`);
                let yes=0, no=0; currentActivePlayers.forEach(p=>{const v=game.votingState.votes.get(p._id.toString()); if(v==='yes')yes++; else if(v==='no')no++;}); console.log(`Resultados: SI=${yes}, NO=${no}`);
                if (yes > no) {
                    console.log(`Voto OK F2 ${game.gameCode}.`); const knownF1 = Object.keys(Object.fromEntries(game.phase1CorrectlyGuessedWeights||new Map())).length; const unknown = GUESSABLE_MINERALS_COUNT-knownF1; console.log(`Viabilidad: ${unknown}/${PHASE2_TARGET_CORRECT_GUESSES}`);
                    if (unknown < PHASE2_TARGET_CORRECT_GUESSES) { console.log(`¡F2 NO VIABLE! Fin (balance).`); game.status='finished_balance_win'; game.successfulGuesser=game.balancerPlayerId; await game.save(); await broadcastGameOver(game); return; }
                    game.status='guessing_phase'; game.phase2RoundsPlayed=0; game.phase2CorrectGuessesTotal=0; game.phase2CorrectGuessesMap=new Map();
                    let first = currentActivePlayers.find(p=>p._id.equals(game.hostId)) || currentActivePlayers.sort((a,b)=>a.turnOrder-b.turnOrder)[0];
                    if(first){ game.currentPlayerId=first._id; game.currentTurnOrder=first.turnOrder; await Player.updateMany({gameId:game._id,isActive:true},{$set:{guessedColorsPhase2:[],phase2GuessAttemptsThisTurn:0}}); await Player.findByIdAndUpdate(first._id,{phase2GuessAttemptsThisTurn:PHASE2_GUESS_ATTEMPTS_PER_TURN}); await game.save(); console.log(`F2 iniciada. Turno ${first.name}`); await broadcastGameState(game._id, game.gameCode); }
                    else { console.error("Error F2: No activos."); game.status='finished_disconnect_game'; game.currentPrizePot=0; await game.save(); await broadcastGameOver(game); return; }
                } else { console.log(`Voto NO/Empate. Fin (balance).`); game.status='finished_balance_win'; game.successfulGuesser=game.balancerPlayerId; await game.save(); await broadcastGameOver(game); }
            } else if (requiredNow === 0) { console.log("Voto OK pero 0 activos. Fin."); game.status='finished_disconnect_vote'; game.currentPrizePot=0; await game.save(); await broadcastGameOver(game); }
            else { await game.save(); await broadcastGameState(game._id, game.gameCode); }
        } catch (error) { console.error(`Error castVote ${playerId}:`, error); socket.emit('error', { message: `Error votar: ${error.message || '?'}` }); }
    });

    // Adivinar Peso Individual (Fase 2)
    socket.on('guessSingleWeight', async ({ gameId, playerId, color, weightGuess }) => {
        try {
            const game = await Game.findById(gameId); const player = await Player.findById(playerId);
            if (!game || !player || !player.isActive || game.status !== 'guessing_phase' || !game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "Inválido." });
            if (player.phase2GuessAttemptsThisTurn <= 0) return socket.emit('error', { message: "No intentos." });
            if (!MINERAL_TYPES.includes(color) || color === 'Amarillo') return socket.emit('error', { message: "Color inválido." });
            const guessNum = parseInt(weightGuess); if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Peso (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (game.phase1CorrectlyGuessedWeights?.has(color)) { socket.emit('singleGuessResult', { playerId, playerName: player.name, color, correct: false, message: `${color} (F1).`, justGuessed: false }); return; }
            if (player.guessedColorsPhase2.includes(color)) return socket.emit('error', { message: `Ya intentaste ${color}.` });
            console.log(`F2: ${player.name} adivina ${color}=${guessNum}`); player.phase2GuessAttemptsThisTurn -= 1; player.guessedColorsPhase2.push(color);
            const actualWeight = game.actualMineralWeights[color]; const alreadyGuessed = game.phase2CorrectGuessesMap.has(color);
            if (guessNum === actualWeight) {
                 if (!alreadyGuessed) { console.log(`F2: ¡CORRECTO! ${player.name} ${color}.`); game.phase2CorrectGuessesTotal++; game.phase2CorrectGuessesMap.set(color, player._id); game.currentPrizePot += PHASE2_REWARD_PER_CORRECT_GUESS; game.markModified('phase2CorrectGuessesMap'); await game.save(); await player.save(); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: true, message: `¡${player.name} adivinó ${color}!`, newTotalGuesses: game.phase2CorrectGuessesTotal }); io.to(game.gameCode).emit('prizePotUpdated', { newPrizePot: game.currentPrizePot }); }
                 else { await player.save(); console.log(`F2: ${player.name} ${color} (ya conocido).`); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: false, message: `${player.name} ${color} (ya encontrado).` }); }
            } else { await player.save(); console.log(`F2: INCORRECTO. ${player.name} ${color}.`); io.to(game.gameCode).emit('singleGuessResult', { playerId, playerName: player.name, color, weightGuess: guessNum, correct: false, justGuessed: false, message: `${player.name} falló ${color}.` }); }
            await broadcastGameState(game._id, game.gameCode);
        } catch (error) { console.error(`Error guessF2 ${playerId}:`, error); socket.emit('error', { message: `Error adivinar: ${error.message || '?'}` }); }
    });

    // Pasar Turno
    socket.on('passTurn', async ({ gameId, playerId }) => {
        try {
            const game = await Game.findById(gameId); const player = await Player.findById(playerId);
            if (!game || !player || !player.isActive || (game.status !== 'playing' && game.status !== 'guessing_phase') || !game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "Inválido/No tu turno." });
            console.log(`${player.name} pasa turno ${game.gameCode} (${game.status})`); await advanceTurn(game, io);
        } catch (error) { console.error(`Error passTurn ${playerId}:`, error); socket.emit('error', { message: `Error pasar: ${error.message || '?'}` }); }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });
        if (player?.gameId) {
             const game = await Game.findById(player.gameId).populate('players', '_id isActive turnOrder name');
             if (!game || game.status.startsWith('finished')) { if(player) {player.socketId = null; await player.save();} return; } // Clean socketId if game finished or not found
             console.log(`Jugador ${player.name} desconectado de ${game.gameCode}.`);
             const wasCurrentPlayer = game.currentPlayerId?.equals(player._id); player.isActive = false; player.socketId = null; await player.save();
             io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });
             const updatedPlayers = await Player.find({ gameId: game._id }).select('_id name turnOrder isActive inventory');
             const playersPublicInfo = updatedPlayers.map(p => ({ id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive, mineralCount: p.inventory?.length ?? 0 }));
             io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
             if (game.status === 'voting') { console.log(`Desc. DURANTE VOTO ${player.name}. Fin.`); io.to(game.gameCode).emit('gameEndedDueToVoteDisconnect', { playerName: player.name }); game.status='finished_disconnect_vote'; game.currentPrizePot=0; await game.save(); await broadcastGameOver(game); return; }
             let needsTurnAdvance = false; if ((game.status === 'playing' || game.status === 'guessing_phase') && wasCurrentPlayer) { console.log(`disconnect: Era turno ${player.name}. Avanzando...`); needsTurnAdvance = true; }
             const remainingActive = updatedPlayers.filter(p => p.isActive).length;
             if (remainingActive === 0) {
                 console.log(`¡Último desconectado! Fin.`);
                 if(game.status==='guessing_phase') game.status = game.phase2CorrectGuessesTotal>=PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win':'finished_phase2_loss';
                 else game.status = 'finished_disconnect_game';
                 game.currentPlayerId = null; if (game.status !== 'finished_phase2_win') game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game);
             } else if (needsTurnAdvance) { await advanceTurn(game, io); }
             else { await broadcastGameState(game._id, game.gameCode); } // Solo actualizar estado si no era turno del desconectado
        }
    });
});

// --- Servir Frontend ---
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor 'Juego de Escala v2' en puerto ${PORT}`); });