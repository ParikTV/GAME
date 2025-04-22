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
const MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1 = 2;

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
    const activePlayers = populatedGame.players.filter(p => p != null && p.isActive).sort((a, b) => a.turnOrder - b.turnOrder); // <-- Asegurar que filtre activos aquí también
    if (activePlayers.length === 0) { console.log("findNextActivePlayer: No hay jugadores activos."); return null; }
    const currentPlayerIndex = activePlayers.findIndex(p => p._id.equals(populatedGame.currentPlayerId));
    let searchStartIndex = (currentPlayerIndex === -1) ? -1 : currentPlayerIndex;
    let attempts = 0; let nextPlayerIndex = searchStartIndex;
    while (attempts < activePlayers.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
        const nextPlayer = activePlayers[nextPlayerIndex];
        // Válido para avanzar en playing o guessing_phase
        if (populatedGame.status === 'playing' || populatedGame.status === 'guessing_phase') {
             console.log(`findNextActivePlayer: Siguiente turno para ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`); return nextPlayer;
        }
        attempts++; if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break;
    }
    console.log("findNextActivePlayer: No se encontró un siguiente jugador activo válido para el estado actual."); return null;
}

// *** NUEVA FUNCIÓN DE VERIFICACIÓN ***
/**
 * Verifica si todos los jugadores activos en un juego han colocado todos sus minerales.
 * @param {string|mongoose.Types.ObjectId} gameId El ID del juego.
 * @returns {Promise<boolean>} True si todos los activos tienen inventario vacío, false si no o si hay error.
 */
async function checkIfAllActivePlayersPlacedMinerals(gameId) {
    try {
        // Buscar jugadores activos asociados al juego
        const activePlayers = await Player.find({ gameId: gameId, isActive: true }).select('name inventory'); // Seleccionar solo lo necesario

        if (!activePlayers || activePlayers.length === 0) {
            console.log(`checkIfAllActivePlayersPlacedMinerals: No se encontraron jugadores activos para el juego ${gameId}.`);
            return true; // Si no hay jugadores activos, se cumple la condición (vacíamente)
        }

        // Iterar sobre los jugadores activos
        for (const player of activePlayers) {
            // Verificar si el inventario tiene elementos
            if (player.inventory && player.inventory.length > 0) {
                console.log(`checkIfAllActivePlayersPlacedMinerals: Jugador activo ${player.name} aún tiene ${player.inventory.length} minerales.`);
                return false; // Encontramos uno con minerales, no se cumple la condición
            }
        }

        // Si el bucle termina, significa que ningún jugador activo tenía minerales
        console.log(`checkIfAllActivePlayersPlacedMinerals: Todos los jugadores activos en ${gameId} han colocado sus minerales.`);
        return true;
    } catch (error) {
        console.error(`Error en checkIfAllActivePlayersPlacedMinerals para game ${gameId}:`, error);
        return false; // Asumir que no se cumple en caso de error
    }
}

// Construye el objeto gameState para enviar a UN jugador específico (ACTUALIZADO para allMineralsPlaced)
async function getGameStateForPlayer(gameId, playerId) {
    try {
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id')
            .populate('balancerPlayerId', 'name _id');

        if (!game) { console.error(`getGameStateForPlayer ERROR: No se encontró Game ${gameId}.`); return null; }

        const playersInGame = await Player.find({ gameId: gameId }).select(
            'name turnOrder isActive canPlaceMinerals inventory hackerBytes guessedColorsPhase2 phase2GuessAttemptsThisTurn phase1IncorrectGuessAttempts _id socketId'
        );

        if (!playersInGame || playersInGame.length === 0) { console.error(`getGameStateForPlayer ERROR: No se encontraron jugadores para Game ${gameId}.`); return null; }
        const player = playersInGame.find(p => p._id.equals(playerId));
        if (!player) { console.error(`getGameStateForPlayer ERROR: Jugador ${playerId} no encontrado en juego ${gameId}`); return null; }

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id);
        const mainScaleBalanced = game.isMainScaleBalanced();

        // *** NUEVO: Llamar a la función de verificación ***
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
            // *** NUEVO: Añadir estado al gameState ***
            allMineralsPlaced: allPlaced,
        };
        return gameStateToSend;
    } catch (error) { console.error(`getGameStateForPlayer ERROR para game ${gameId}, player ${playerId}:`, error); return null; }
}

// Emite el estado actualizado a todos los jugadores ACTIVOS en la sala
async function broadcastGameState(gameId, gameCode) {
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive');
    if (!game) { console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado.`); return; }
    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);
    for (const playerRef of game.players) {
        if (playerRef && playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id); // Esta función ahora incluye 'allMineralsPlaced'
            if (gameState) { io.to(playerRef.socketId).emit('gameStateUpdated', { gameState }); }
            else { console.warn(`broadcastGameState WARN: No se pudo generar gameState para jugador activo ${playerRef._id} en ${gameCode}`); }
        }
    }
}

// Emite el evento de fin de juego a todos
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id)
                                    .populate('players', 'socketId _id isActive name hackerBytes') // Incluir hackerBytes para el estado final
                                    .populate('successfulGuesser', '_id name')
                                    .populate('balancerPlayerId', '_id name');
    if (!populatedGame) { console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado.`); return; }

    let finalPrizePerPlayer = 0;
    let playersToRewardIds = [];

    // Determinar quién recibe premio
    if (populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') {
        playersToRewardIds = populatedGame.players.filter(p => p.isActive).map(p => p._id);
    } else if (populatedGame.status === 'finished_phase1_knowledge_win') {
        const winner = populatedGame.players.find(p => p._id.equals(populatedGame.successfulGuesser?._id));
        if (winner && winner.isActive) {
            playersToRewardIds.push(winner._id);
            finalPrizePerPlayer = populatedGame.currentPrizePot; // El ganador de conocimiento se lleva todo
            console.log(`Juego ganado por ${winner.name} (Fase 1 Conocimiento) con ${finalPrizePerPlayer} HB.`);
        } else {
            console.log("Ganador Conocimiento F1 desconectado. Premio perdido.");
            populatedGame.currentPrizePot = 0; // Perder premio si ganador no está
            await populatedGame.save();
        }
    }

    // Repartir premio si es victoria de equipo
    if ((populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') && playersToRewardIds.length > 0) {
        finalPrizePerPlayer = Math.floor(populatedGame.currentPrizePot / playersToRewardIds.length);
        console.log(`Repartiendo ${populatedGame.currentPrizePot} entre ${playersToRewardIds.length} jugadores activos. ${finalPrizePerPlayer} c/u.`);
        // Actualizar en DB
        try {
            await Player.updateMany({ _id: { $in: playersToRewardIds } }, { $inc: { hackerBytes: finalPrizePerPlayer } });
            console.log(`Premios de ${finalPrizePerPlayer} HB asignados a ${playersToRewardIds.length} jugadores.`);
        } catch (updateError) {
            console.error(`Error actualizando premios grupales:`, updateError);
        }
    } else if (!['finished_phase1_knowledge_win'].includes(populatedGame.status) && playersToRewardIds.length === 0) {
         console.log("Nadie activo/ganador o no es victoria de F1 conocimiento, premio perdido.");
         if(populatedGame.currentPrizePot !== 0) {
             populatedGame.currentPrizePot = 0;
             await populatedGame.save();
         }
    }

    // Asegurar que el bote sea 0 si no hay ganador o es derrota
    if (['finished_phase2_loss', 'finished_disconnect_vote', 'finished_disconnect_game', 'finished_failure'].includes(populatedGame.status)) {
        if(populatedGame.currentPrizePot !== 0) {
             populatedGame.currentPrizePot = 0;
             await populatedGame.save();
         }
    }

     // Enviar estado final y pesos a TODOS los sockets que estuvieron en el juego
     const allPlayersEver = await Player.find({gameId: populatedGame._id}).select('socketId _id'); // Necesitamos socketId aunque no estén activos

     for (const playerRef of allPlayersEver) {
        if (playerRef.socketId) { // Intentar enviar solo si hay socketId registrado
             try {
                 // Obtener el estado más reciente del jugador (con el premio actualizado si lo hubo)
                 const finalPlayerState = await Player.findById(playerRef._id).select('hackerBytes');
                 // Obtener el gameState final para este jugador
                 const finalGameStateForPlayer = await getGameStateForPlayer(populatedGame._id, playerRef._id);

                 if (finalGameStateForPlayer && finalPlayerState) {
                     // Sobrescribir los bytes del jugador en el gameState a enviar con el valor final real
                     finalGameStateForPlayer.myHackerBytes = finalPlayerState.hackerBytes;
                     io.to(playerRef.socketId).emit('gameOver', { gameState: finalGameStateForPlayer, actualWeights: populatedGame.actualMineralWeights });
                 } else {
                     console.warn(`broadcastGameOver WARN: No se pudo generar estado final/playerstate para ${playerRef._id}`);
                     // Enviar un estado básico de fin si falla la generación completa
                     io.to(playerRef.socketId).emit('gameOver', { gameState: { status: populatedGame.status, gameCode: populatedGame.gameCode }, actualWeights: populatedGame.actualMineralWeights });
                 }
             } catch (fetchError) {
                 console.error(`Error obteniendo estado final para ${playerRef._id} en broadcastGameOver:`, fetchError);
             }
        }
     }
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
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) { socket.emit('gameStateUpdated', { gameState: hostGameState }); }
            else { socket.emit('error', { message: 'Error al generar estado inicial.' }); }
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
             const playerGameState = await getGameStateForPlayer(game._id, player._id);
              if (playerGameState) { socket.emit('gameStateUpdated', { gameState: playerGameState }); }
        } catch (error) { console.error("Error uniéndose:", error); callback({ success: false, message: "Error interno al unirse." }); }
    });

    // Iniciar Juego (Host)
    socket.on('startGame', async ({ gameId }) => {
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

    // *** COLOCAR MINERALES (MODIFICADO) ***
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
         try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+inventory'); // Necesitamos inventario con pesos
            if (!game || !player) return socket.emit('error', { message: "Juego/jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "No en fase de colocación." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });

             // Recalcular si puede colocar basado en inventario actual (esto ya se hace en el pre-save hook)
             // player.canPlaceMinerals = player.isActive && player.inventory && player.inventory.length >= 2;
             // await player.save(); // Guardar canPlaceMinerals actualizado si fuera necesario

             // Re-validar si tiene suficientes minerales AHORA MISMO
             if (!player.inventory || player.inventory.length < 2) {
                return socket.emit('error', { message: "No tienes suficientes minerales para colocar." });
             }
             // Re-validar si puede jugar (esta validación ya la hace pre-save hook)
            // if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales." });

            if (!Array.isArray(placements) || placements.length < 2 || placements.length % 2 !== 0) { console.warn(`placeMinerals (${player.name}): Intento inválido (${placements?.length || 0}).`); return socket.emit('error', { message: 'Cantidad PAR (2, 4...).' }); }
            const currentInventory = [...player.inventory]; const mineralsToPlaceDetails = []; const placedInstanceIds = new Set();
            for (const placement of placements) {
                if (!placement || !placement.mineralInstanceId || !placement.targetScale || !placement.targetSide) throw new Error("Datos de colocación inválidos.");
                if (placedInstanceIds.has(placement.mineralInstanceId)) throw new Error("No puedes colocar el mismo mineral dos veces en la misma jugada.");
                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado en tu inventario.`);
                const mineral = currentInventory.splice(mineralIndex, 1)[0]; mineralsToPlaceDetails.push({ mineral, placement }); placedInstanceIds.add(placement.mineralInstanceId);
            }

             // Aplicar colocaciones a las balanzas
             mineralsToPlaceDetails.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 // Asegurar que existan los arrays y pesos
                 scale.leftMaterials = scale.leftMaterials || []; scale.rightMaterials = scale.rightMaterials || []; scale.leftWeight = scale.leftWeight || 0; scale.rightWeight = scale.rightWeight || 0;
                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials; const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';
                 sideArray.push(mineral); scale[weightProp] += mineral.weight;
             });
            game.markModified('mainScale'); game.markModified('secondaryScale');

            // Actualizar inventario del jugador y guardar
            player.inventory = currentInventory;
            await player.save(); // Esto disparará el hook pre-save que actualiza canPlaceMinerals

            // --- NUEVA LÓGICA DE VERIFICACIÓN ---
            const balanced = game.isMainScaleBalanced();
            const allPlaced = await checkIfAllActivePlayersPlacedMinerals(game._id);

            if (balanced && allPlaced) {
                // Ambos requisitos cumplidos: Iniciar Fase de Votación
                console.log(`¡Balanza equilibrada Y TODOS los minerales colocados por ${player.name} en ${game.gameCode}! Iniciando votación.`);
                game.status = 'voting';
                game.balancerPlayerId = player._id;
                game.currentPrizePot = INITIAL_PRIZE_POT; // Reiniciar bote para Fase 2

                // Configurar estado de votación
                const activePlayers = await Player.find({ gameId: game._id, isActive: true });
                game.votingState = {
                    votes: new Map(activePlayers.map(p => [p._id.toString(), null])), // Mapa de playerId a null (no votado)
                    requiredVotes: activePlayers.length,
                    receivedVotes: 0
                };
                game.markModified('votingState');

                await game.save();
                await broadcastGameState(game._id, game.gameCode); // Notificar inicio de votación

            } else {
                // Al menos una condición no se cumple: Avanzar Turno
                 if (balanced && !allPlaced) {
                     console.log(`Balanza equilibrada por ${player.name}, pero faltan minerales por colocar por otros jugadores. Avanzando turno.`);
                 } else if (!balanced && allPlaced) {
                      console.log(`Todos los minerales colocados, pero balanza NO equilibrada tras jugada de ${player.name}. Avanzando turno.`);
                 } else { // !balanced && !allPlaced
                      console.log(`Jugada de ${player.name} completada. Ni balanza equilibrada ni todos los minerales colocados. Avanzando turno.`);
                 }
                await advanceTurn(game, io); // Llama a la función helper para avanzar
            }
            // --- FIN NUEVA LÓGICA ---

        } catch (error) {
            console.error(`Error en placeMinerals para ${playerId}:`, error); socket.emit('error', { message: `Error al colocar: ${error.message || 'Error desconocido'}` });
             // Intentar re-enviar estado actual al jugador que tuvo el error
             try { const currentState = await getGameStateForPlayer(gameId, playerId); if (currentState) socket.emit('gameStateUpdated', { gameState: currentState }); } catch (e) { console.error("Error retransmitiendo estado después de error en placeMinerals:", e); }
        }
    });

    // Adivinar Peso Individual en Fase 1 (ACTUALIZADO CON LÍMITE)
    socket.on('guessSingleWeightPhase1', async ({ gameId, playerId, guessedColor, guessedWeight }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+phase1IncorrectGuessAttempts'); // Cargar mapa

            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "Solo puedes adivinar en Fase 1." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (!MINERAL_TYPES.includes(guessedColor)) return socket.emit('error', { message: "Color inválido." });
            if (guessedColor === 'Amarillo') return socket.emit('error', { message: "No puedes adivinar Amarillo." });

            const guessNum = parseInt(guessedWeight);
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Peso inválido (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (game.phase1CorrectlyGuessedWeights?.has(guessedColor)) return socket.emit('error', { message: `Peso de ${guessedColor} ya adivinado.` });

            const incorrectAttemptsMap = player.phase1IncorrectGuessAttempts || new Map();
            const currentIncorrectAttempts = incorrectAttemptsMap.get(guessedColor) || 0;

            if (currentIncorrectAttempts >= MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1) {
                console.log(`Fase 1: ${player.name} intentó adivinar ${guessedColor} pero ya agotó sus ${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1} intentos.`);
                socket.emit('singleGuessPhase1Result', { success: false, message: `Ya agotaste tus ${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1} intentos para adivinar ${guessedColor}.` });
                return;
            }

            console.log(`Fase 1: ${player.name} adivina ${guessedColor} = ${guessNum} (Intento incorrecto #${currentIncorrectAttempts + 1} si falla)`);
            const actualWeight = game.actualMineralWeights[guessedColor];

            if (guessNum === actualWeight) {
                console.log(`Fase 1: ¡Correcto! ${player.name} adivinó ${guessedColor}.`);
                if (!game.phase1CorrectlyGuessedWeights) game.phase1CorrectlyGuessedWeights = new Map();
                game.phase1CorrectlyGuessedWeights.set(guessedColor, actualWeight);
                game.markModified('phase1CorrectlyGuessedWeights');
                await game.save();

                const knownCountPhase1 = Object.keys(Object.fromEntries(game.phase1CorrectlyGuessedWeights)).length;
                if (knownCountPhase1 === GUESSABLE_MINERALS_COUNT) {
                     console.log(`¡VICTORIA INSTANTÁNEA! ${player.name} adivinó el último peso en Fase 1.`);
                     game.status = 'finished_phase1_knowledge_win';
                     game.successfulGuesser = player._id;
                     // Asignar premio directamente (sin necesidad de $inc aquí)
                     // player.hackerBytes += game.currentPrizePot; <-- Esto NO actualiza la DB directamente
                     await Player.findByIdAndUpdate(player._id, { $inc: { hackerBytes: game.currentPrizePot }});
                     // game.currentPrizePot = 0; // El bote se "consume" al ser asignado
                     await game.save();
                     await broadcastGameOver(game); // Llama a la función de fin que envía estado final
                     return;
                }

                socket.emit('singleGuessPhase1Result', { success: true, color: guessedColor, weight: actualWeight, message: `¡Correcto! ${guessedColor} pesa ${actualWeight}g.` });
                await broadcastGameState(game._id, game.gameCode);

            } else {
                console.log(`Fase 1: Incorrecto. ${player.name} falló ${guessedColor}.`);
                 if (!player.phase1IncorrectGuessAttempts) { player.phase1IncorrectGuessAttempts = new Map(); }
                const newCount = currentIncorrectAttempts + 1;
                player.phase1IncorrectGuessAttempts.set(guessedColor, newCount);
                player.markModified('phase1IncorrectGuessAttempts');
                await player.save();

                socket.emit('singleGuessPhase1Result', { success: false, message: `Incorrecto. ${guessedColor} no pesa ${guessNum}g. (Intento ${newCount}/${MAX_INCORRECT_GUESSES_PER_COLOR_PHASE1})` });
                // No transmitir estado global aquí, solo el jugador que falló recibe el feedback
            }

        } catch (error) {
             console.error(`Error en guessSingleWeightPhase1 para ${playerId}:`, error);
             socket.emit('error', { message: `Error procesando adivinanza F1: ${error.message || '?'}` });
             try { const playerStillConnected = await Player.findById(playerId).select('socketId'); if(playerStillConnected?.socketId) { const currentState = await getGameStateForPlayer(gameId, playerId); if (currentState) io.to(playerStillConnected.socketId).emit('gameStateUpdated', { gameState: currentState }); } } catch (e) { console.error("Error retransmitiendo estado:", e); }
        }
    });

    // Votar para Fase 2
    socket.on('castVote', async ({ gameId, playerId, vote }) => {
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
                    console.log(`Check viabilidad: Quedan ${unknownGuessableCount} pesos por adivinar. Objetivo: ${PHASE2_TARGET_CORRECT_GUESSES}`);
                    if (unknownGuessableCount < PHASE2_TARGET_CORRECT_GUESSES) {
                        console.log(`¡Fase 2 NO VIABLE! No quedan suficientes pesos por adivinar. Terminando como victoria por balance.`);
                        game.status = 'finished_balance_win';
                        game.successfulGuesser = game.balancerPlayerId; // Quien balanceó originalmennte
                        await game.save();
                        await broadcastGameOver(game); // Termina juego
                        return;
                    }
                    // Si es viable, iniciar Fase 2
                    game.status = 'guessing_phase'; game.phase2RoundsPlayed = 0; game.phase2CorrectGuessesTotal = 0; game.phase2CorrectGuessesMap = new Map();
                    let firstTurnPlayer = currentActivePlayers.find(p => p._id.equals(game.hostId)) || currentActivePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
                    if (firstTurnPlayer) {
                         game.currentPlayerId = firstTurnPlayer._id; game.currentTurnOrder = firstTurnPlayer.turnOrder;
                         await Player.updateMany({ gameId: game._id, isActive: true }, { $set: { guessedColorsPhase2: [], phase2GuessAttemptsThisTurn: 0 } });
                         await Player.findByIdAndUpdate(firstTurnPlayer._id, { phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN });
                         await game.save(); console.log(`Fase 2 iniciada. Turno ${firstTurnPlayer.name}`); await broadcastGameState(game._id, game.gameCode);
                    } else { console.error("Error crítico: No jugadores activos para iniciar Fase 2."); game.status = 'finished_disconnect_game'; game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game); return; }
                } else { console.log(`Votación RECHAZADA o Empate. Fin del juego (victoria por balance).`); game.status = 'finished_balance_win'; game.successfulGuesser = game.balancerPlayerId; await game.save(); await broadcastGameOver(game); }
            } else if (requiredNow === 0) { console.log("Voto completado pero 0 activos. Terminando."); game.status = 'finished_disconnect_vote'; game.currentPrizePot = 0; await game.save(); await broadcastGameOver(game); }
            else { await game.save(); await broadcastGameState(game._id, game.gameCode); }
        } catch (error) { console.error(`Error en castVote para ${playerId}:`, error); socket.emit('error', { message: `Error al votar: ${error.message || '?'}` }); }
    });

    // Adivinar Peso Individual (Fase 2)
    socket.on('guessSingleWeight', async ({ gameId, playerId, color, weightGuess }) => {
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

             // Manejo especial si desconecta durante votación
             if (game.status === 'voting') {
                 console.log(`Desconexión DURANTE VOTACIÓN por ${player.name}. Terminando juego.`);
                 io.to(game.gameCode).emit('gameEndedDueToVoteDisconnect', { playerName: player.name });
                 game.status = 'finished_disconnect_vote';
                 game.currentPrizePot = 0; // Pierden el premio
                 await game.save();
                 await broadcastGameOver(game);
                 return; // Salir después de manejar fin del juego
             }

             let needsTurnAdvance = false; if ((game.status === 'playing' || game.status === 'guessing_phase') && wasCurrentPlayer) { console.log(`disconnect: Era turno de ${player.name}. Avanzando...`); needsTurnAdvance = true; }

             const remainingActivePlayersCount = updatedPlayers.filter(p => p.isActive).length;
             if (remainingActivePlayersCount === 0) {
                 console.log(`¡Último jugador desconectado! Fin del juego.`);
                 if (game.status === 'guessing_phase') { game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss'; }
                 else { game.status = 'finished_disconnect_game'; } // Si estaba en 'playing' o 'waiting'
                 game.currentPlayerId = null;
                 if (game.status !== 'finished_phase2_win') { game.currentPrizePot = 0; } // Pierden premio si no ganaron fase 2
                 await game.save();
                 await broadcastGameOver(game);
            } else if (needsTurnAdvance) {
                await advanceTurn(game, io); // Avanzar turno si era el jugador actual
            } else {
                // Si no era el jugador actual y quedan activos, solo actualizar estado
                 await broadcastGameState(game._id, game.gameCode);
            }
        }
    });
});

// --- Función Helper: advanceTurn ---
async function advanceTurn(game, ioInstance) {
    if (!game || !game.status || game.status.startsWith('finished')) return;

    console.log(`advanceTurn: Iniciando avance desde estado ${game.status} con jugador ${game.currentPlayerId}`);

    const previousPlayerId = game.currentPlayerId;
    let nextPlayer = null;
    let roundEnded = false;

    nextPlayer = await findNextActivePlayer(game); // Esta función ya filtra por activos y estado compatible

    if (game.status === 'guessing_phase' && previousPlayerId && nextPlayer) {
        // Verificar si se completó una ronda de Fase 2
        const previousPlayer = await Player.findById(previousPlayerId).select('turnOrder');
        if (previousPlayer && (nextPlayer.turnOrder <= previousPlayer.turnOrder)) {
            roundEnded = true; game.phase2RoundsPlayed += 1; console.log(`Fin Ronda ${game.phase2RoundsPlayed} Fase 2.`);
            if (game.phase2RoundsPlayed >= PHASE2_TOTAL_ROUNDS) {
                 console.log(`Máximo de ${PHASE2_TOTAL_ROUNDS} rondas F2 completas. Evaluando...`);
                 game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
                 console.log(`Resultado final Fase 2: ${game.status}`);
                 game.currentPlayerId = null; // Nadie tiene el turno al finalizar
                 await game.save();
                 await broadcastGameOver(game); // Termina el juego
                 return; // Salir de la función advanceTurn
            }
        }
        // Resetear intentos para el siguiente jugador si el juego continúa
        if (nextPlayer && !game.status.startsWith('finished')) {
            await Player.findByIdAndUpdate(nextPlayer._id, { phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN });
            console.log(`advanceTurn: Reseteando intentos F2 para ${nextPlayer.name}`);
        }
    }

    // Asignar siguiente jugador si se encontró y el juego no terminó
    if (nextPlayer && !game.status.startsWith('finished')) {
        game.currentPlayerId = nextPlayer._id;
        game.currentTurnOrder = nextPlayer.turnOrder;
        console.log(`advanceTurn: Turno asignado a ${nextPlayer.name} (T${nextPlayer.turnOrder})`);
        await game.save();
        await broadcastGameState(game._id, game.gameCode);
    } else if (!game.status.startsWith('finished')) {
        // Si no se encontró siguiente jugador y el juego NO terminó por la lógica anterior (Fase 2)
        console.log("advanceTurn: No se encontró siguiente jugador activo. Fin del juego.");
        if (game.status === 'guessing_phase') { // Si estaba en Fase 2 y no hay más turnos
            game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
        } else if (game.status === 'playing') { // Si estaba en Fase 1 y no hay más turnos
            game.status = 'finished_failure'; // Nadie balanceó/ganó por conocimiento
        } else {
            game.status = 'finished_disconnect_game'; // Estado por defecto si algo raro pasó
        }
        console.log(`advanceTurn: Juego termina con estado ${game.status}`);
        game.currentPlayerId = null;
        if (game.status !== 'finished_phase2_win') { game.currentPrizePot = 0; } // Perder premio si no fue victoria F2
        await game.save();
        await broadcastGameOver(game);
    }
    // Si el juego ya terminó (p.ej. por F2), no hacer nada más.
}


// --- Rutas API (Opcional) ---
// const apiRoutes = require('./routes/api');
// app.use('/api', apiRoutes);

// --- Servir Frontend ---
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Servidor 'Juego de Escala v2' en puerto ${PORT}`); });