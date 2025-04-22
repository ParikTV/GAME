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
// const PHASE1_PARTIAL_GUESS_REWARD = 1000000; // REMOVED - Ya no existe la adivinanza parcial
const PHASE2_REWARD_PER_CORRECT_GUESS = 2000000;
const PHASE2_TARGET_CORRECT_GUESSES = 3;
const PHASE2_TOTAL_ROUNDS = 3;
const PHASE2_GUESS_ATTEMPTS_PER_TURN = 2;

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Genera los pesos secretos y la info inicial
function generateGameSetup() {
    const weights = {};
    let generatedWeights = [];
    const availableWeights = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => i + MIN_WEIGHT);

    // Asegurar que Amarillo sea 10g
    weights['Amarillo'] = 10;
    const yellowIndex = availableWeights.indexOf(10);
    if (yellowIndex > -1) {
        availableWeights.splice(yellowIndex, 1);
    }
    generatedWeights.push(10);

    const remainingTypes = MINERAL_TYPES.filter(t => t !== 'Amarillo');
    remainingTypes.forEach(type => {
        if (availableWeights.length === 0) {
            // Si no quedan pesos únicos, repetir uno existente (raro con 20 pesos)
            const randomIndex = Math.floor(Math.random() * generatedWeights.length);
            weights[type] = generatedWeights[randomIndex];
        } else {
            const randomIndex = Math.floor(Math.random() * availableWeights.length);
            const assignedWeight = availableWeights.splice(randomIndex, 1)[0];
            weights[type] = assignedWeight;
            generatedWeights.push(assignedWeight);
        }
    });

    // Calcular el rango del Amarillo
    const sortedUniqueWeights = [...new Set(Object.values(weights))].sort((a, b) => b - a);
    const rankOfYellow = sortedUniqueWeights.indexOf(10) + 1;
    const rankSuffix = (rank) => {
        if (rank === 1) return '1º';
        if (rank === 2) return '2º';
        if (rank === 3) return '3º';
        return `${rank}º`;
    };

    const knownInfo = {
        type: 'Amarillo',
        weight: 10,
        description: `El mineral Amarillo pesa 10g (es el ${rankSuffix(rankOfYellow)} más pesado).`
    };
    console.log("Pesos Secretos Generados:", weights);
    console.log("Info Conocida Inicial:", knownInfo);
    return { weights, knownInfo };
}

// Crea el inventario para un jugador (Mantiene el peso para uso del servidor)
function createPlayerInventory(actualWeights) {
    const inventory = [];
    MINERAL_TYPES.forEach(type => {
        const weight = actualWeights[type];
        if (typeof weight !== 'number') {
             console.error(`Error: Peso no encontrado o inválido para el tipo ${type} al crear inventario.`);
             return;
        }
        for (let i = 0; i < MINERALS_PER_PLAYER_PER_TYPE; i++) {
            inventory.push({
                instanceId: uuidv4(),
                type: type,
                weight: weight // IMPORTANTE: Se necesita para la lógica del servidor
            });
        }
    });
    return inventory;
}

// Determina el siguiente jugador ACTIVO
async function findNextActivePlayer(game) {
    if (!game || !game.players || game.players.length === 0 || !game.status) {
        console.error("findNextActivePlayer: Juego inválido o sin jugadores/estado.");
        return null;
    }

    let populatedGame = game;
    // Poblar si no lo está, seleccionando solo los campos necesarios
    if (!game.populated('players')) {
        try {
            populatedGame = await Game.findById(game._id)
                .populate({
                    path: 'players',
                    match: { isActive: true }, // Filtrar inactivos en la consulta
                    select: '_id name turnOrder isActive canPlaceMinerals inventory' // Añadir canPlaceMinerals e inventory si es necesario para alguna lógica futura aquí
                });
            if (!populatedGame) throw new Error("Juego no encontrado al repopular");
        } catch (err) {
            console.error("findNextActivePlayer ERROR: Falló al repopular jugadores activos:", err);
            return null; // No se puede continuar sin la lista de jugadores
        }
    }

    // Usar la lista poblada (que ya debería contener solo activos)
    const activePlayers = populatedGame.players
        .filter(p => p != null) // Filtrar nulos por si acaso
        .sort((a, b) => a.turnOrder - b.turnOrder);

    if (activePlayers.length === 0) {
        console.log("findNextActivePlayer: No hay jugadores activos.");
        return null;
    }

    const currentPlayerIndex = activePlayers.findIndex(p => p._id.equals(populatedGame.currentPlayerId));
    let searchStartIndex = (currentPlayerIndex === -1) ? -1 : currentPlayerIndex; // Si no hay jugador actual (inicio juego?), empezar búsqueda desde el "principio" lógico (-1 + 1 = 0)

    let attempts = 0;
    let nextPlayerIndex = searchStartIndex;

    while (attempts < activePlayers.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
        const nextPlayer = activePlayers[nextPlayerIndex];

        // En Fase 1 y Fase 2, cualquier jugador activo puede tener turno.
        // La capacidad de realizar acciones específicas (colocar, adivinar) se valida en los handlers correspondientes.
        if (populatedGame.status === 'playing' || populatedGame.status === 'guessing_phase') {
             console.log(`findNextActivePlayer: Siguiente turno para ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
             return nextPlayer; // Devolver el jugador encontrado
        }

        attempts++;
        // Evitar bucle infinito si se dió la vuelta completa (aunque no debería pasar con la lógica actual)
        if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break;
    }

    console.log("findNextActivePlayer: No se encontró un siguiente jugador activo (¿estado de juego incorrecto o error lógico?).");
    return null;
}


// Construye el objeto gameState para enviar a UN jugador específico (ACTUALIZADO)
async function getGameStateForPlayer(gameId, playerId) {
    try {
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id')
            .populate('balancerPlayerId', 'name _id');

        // Obtener todos los jugadores de una vez con los campos necesarios
        const playersInGame = await Player.find({ gameId: gameId }).select(
            'name turnOrder isActive canPlaceMinerals inventory hackerBytes guessedColorsPhase2 phase2GuessAttemptsThisTurn _id socketId'
        );

        if (!game || !playersInGame || playersInGame.length === 0) {
            console.error(`getGameStateForPlayer ERROR: No se encontró Game ${gameId} o jugadores.`);
            return null;
        }

        const player = playersInGame.find(p => p._id.equals(playerId));
        if (!player) {
             console.error(`getGameStateForPlayer ERROR: Jugador ${playerId} no encontrado en la lista del juego ${gameId}`);
             return null;
        }

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id);
        const mainScaleBalanced = game.isMainScaleBalanced();

        // Crear la información pública (sin pesos de inventario)
        const playersPublicInfo = playersInGame.map(p => ({
             id: p._id,
             name: p.name,
             turnOrder: p.turnOrder,
             mineralCount: p.inventory?.length ?? 0,
             isActive: p.isActive,
             canPlaceMinerals: p.canPlaceMinerals,
             hasVoted: game.status === 'voting' && game.votingState?.votes?.has(p._id.toString()) && game.votingState.votes.get(p._id.toString()) !== null
        }));

        // Construir estado de votación para el cliente
        let clientVotingState = null;
        if (game.status === 'voting' && game.votingState) {
            clientVotingState = {
                requiredVotes: game.votingState.requiredVotes,
                receivedVotes: game.votingState.receivedVotes,
                myVote: game.votingState.votes.get(player._id.toString()), // null, 'yes', 'no'
            };
        }

        // Convertir Map a Objeto para enviar al cliente
        const phase1GuessedWeightsObject = game.phase1CorrectlyGuessedWeights
            ? Object.fromEntries(game.phase1CorrectlyGuessedWeights)
            : {};

        const gameStateToSend = {
            gameId: game._id,
            gameCode: game.gameCode,
            hostId: game.hostId,
            status: game.status,
            isMainScaleBalanced: mainScaleBalanced,
            knownMineralInfo: game.knownMineralInfo,
            mainScale: {
                leftWeight: game.mainScale.leftWeight || 0,
                rightWeight: game.mainScale.rightWeight || 0,
                leftMaterials: game.mainScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [],
                rightMaterials: game.mainScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [],
            },
            secondaryScale: {
                leftWeight: game.secondaryScale.leftWeight || 0,
                rightWeight: game.secondaryScale.rightWeight || 0,
                leftMaterials: game.secondaryScale.leftMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [],
                rightMaterials: game.secondaryScale.rightMaterials?.map(({ instanceId, type }) => ({ instanceId, type })) || [],
            },
            currentTurnOrder: game.currentTurnOrder,
            currentPlayer: game.currentPlayerId ? { id: game.currentPlayerId._id, name: game.currentPlayerId.name, turnOrder: game.currentPlayerId.turnOrder } : null,

            // Info específica del jugador que recibe
            myTurn: isPlayerTurn,
            myPlayerId: player._id,
            myInventory: player.inventory ? player.inventory.map(({ instanceId, type }) => ({ instanceId, type })) : [],
            myHackerBytes: player.hackerBytes,
            iCanPlaceMinerals: player.canPlaceMinerals,
            myPhase2AttemptsLeft: player.phase2GuessAttemptsThisTurn,
            myGuessedColorsPhase2: player.guessedColorsPhase2,
            // NUEVO: Enviar pesos correctamente adivinados en Fase 1
            phase1CorrectlyGuessedWeights: phase1GuessedWeightsObject,

            // Info global del juego
            playersPublicInfo: playersPublicInfo,
            currentPrizePot: game.currentPrizePot,
            balancerPlayer: game.balancerPlayerId ? { id: game.balancerPlayerId._id, name: game.balancerPlayerId.name } : null,
            votingState: clientVotingState,
            phase2RoundsPlayed: game.phase2RoundsPlayed,
            phase2CorrectGuessesTotal: game.phase2CorrectGuessesTotal,
            successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
        };

        return gameStateToSend;

    } catch (error) {
        console.error(`getGameStateForPlayer ERROR para game ${gameId}, player ${playerId}:`, error);
        return null;
    }
}


// Emite el estado actualizado a todos los jugadores ACTIVOS en la sala
async function broadcastGameState(gameId, gameCode) {
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive'); // Necesitamos socketId activo
    if (!game) {
         console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado para transmitir.`);
         return;
    }

    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);

    for (const playerRef of game.players) {
        if (playerRef && playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) {
                 io.to(playerRef.socketId).emit('gameStateUpdated', { gameState });
            } else {
                 console.warn(`broadcastGameState WARN: No se pudo generar gameState para jugador activo ${playerRef._id} en juego ${gameCode}`);
            }
        }
    }
}

// Emite el evento de fin de juego a todos (ACTUALIZADO para quitar phase1_guess_win)
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id)
                                    .populate('players', 'socketId _id isActive name')
                                    .populate('successfulGuesser', '_id name') // Usado solo por balance_win (o futuros estados)
                                    .populate('balancerPlayerId', '_id name');
    if (!populatedGame) {
         console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado para transmitir fin.`);
         return;
    }

    let finalPrizePerPlayer = 0;
    let playersToReward = [];

    // Determinar quién gana basado en el estado final
    if (populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') {
        // Gana el equipo activo
        playersToReward = populatedGame.players.filter(p => p.isActive);
    }
    // else if (populatedGame.status === 'finished_phase1_guess_win') {
        // // Gana solo el successfulGuesser
        // const winner = populatedGame.players.find(p => p._id.equals(populatedGame.successfulGuesser?._id));
        // if (winner && winner.isActive) {
        //     playersToReward.push(winner);
        // }
    // } // REMOVED finished_phase1_guess_win

    // Repartir premio si hay ganadores
    if (playersToReward.length > 0) {
        finalPrizePerPlayer = Math.floor(populatedGame.currentPrizePot / playersToReward.length);
        console.log(`Repartiendo ${populatedGame.currentPrizePot} entre ${playersToReward.length} jugador(es). ${finalPrizePerPlayer} c/u.`);
        for (const player of playersToReward) {
            try {
                // Usar $inc para añadir al premio existente (aunque debería ser 0 al inicio)
                await Player.findByIdAndUpdate(player._id, { $inc: { hackerBytes: finalPrizePerPlayer } });
            } catch (updateError) {
                console.error(`Error actualizando premio para jugador ${player._id}:`, updateError);
            }
        }
    } else {
         console.log("Nadie activo al final (o ganador desconectó), premio se pierde.");
         // Asegurar que el premio del juego sea 0 si no se repartió
         populatedGame.currentPrizePot = 0;
         if (populatedGame.status !== 'finished_failure') { // Solo si no terminó por otra causa
             await populatedGame.save(); // Guardar el premio 0 en el juego
         }
    }

     // Si el estado del juego implica una pérdida directa, asegurar que el premio sea 0.
     if (['finished_phase2_loss', 'finished_disconnect_vote', 'finished_disconnect_game', 'finished_failure'].includes(populatedGame.status)) {
         populatedGame.currentPrizePot = 0;
         // Podríamos guardar aquí también, pero getGameStateForPlayer lo reflejará
     }


     // Ahora, obtener el estado final DESPUÉS de actualizar premios si aplica
     for (const playerRef of populatedGame.players) {
        if (playerRef.socketId) { // Enviar a todos, incluso inactivos
             try {
                 // Volver a leer estado del jugador para asegurar que el premio está actualizado
                 const finalPlayerState = await Player.findById(playerRef._id);
                 const finalGameState = await getGameStateForPlayer(populatedGame._id, playerRef._id); // Construir estado final

                 if (finalGameState && finalPlayerState) {
                      // Asegurarse que los hackerBytes reflejen el premio recién asignado
                      finalGameState.myHackerBytes = finalPlayerState.hackerBytes;

                     io.to(playerRef.socketId).emit('gameOver', {
                         gameState: finalGameState,
                         actualWeights: populatedGame.actualMineralWeights // Enviar pesos reales AL FINAL
                     });
                 } else {
                     console.warn(`broadcastGameOver WARN: No se pudo generar estado final completo para ${playerRef._id}`);
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
            const gameCode = generateGameCode();
            const { weights, knownInfo } = generateGameSetup();

            const host = new Player({
                socketId: socket.id,
                name: hostName,
                turnOrder: 1,
                inventory: createPlayerInventory(weights),
                hackerBytes: 0
            });

            const game = new Game({
                gameCode,
                hostId: host._id,
                players: [host._id],
                actualMineralWeights: weights,
                knownMineralInfo: knownInfo,
                mainScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 },
                secondaryScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 },
                votingState: { votes: new Map(), requiredVotes: 0, receivedVotes: 0 },
                phase1CorrectlyGuessedWeights: new Map(), // Inicializar mapa vacío
                phase2CorrectGuessesMap: new Map(),
                status: 'waiting',
                currentPrizePot: INITIAL_PRIZE_POT
            });

            await game.save();
            host.gameId = game._id;
            await host.save();

            socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}). Host unido a la sala.`);

            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });

            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) {
                socket.emit('gameStateUpdated', { gameState: hostGameState });
            } else {
                 socket.emit('error', { message: 'Error al generar el estado inicial del juego.' });
            }

        } catch (error) {
            console.error("Error detallado creando juego:", error);
            let errorMessage = "Error interno al crear el juego.";
             if (error.name === 'ValidationError') errorMessage = `Error de validación: ${error.message}`;
             else if (error.code === 11000) errorMessage = "Error al generar código único, intenta de nuevo.";
            callback({ success: false, message: errorMessage });
        }
    });

    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name');
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó o terminó." });

            const nameExists = game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
            if (nameExists) return callback({ success: false, message: "Ese nombre ya está en uso." });

            const turnOrder = game.players.length + 1;
            const player = new Player({
                socketId: socket.id,
                name: playerName,
                gameId: game._id,
                turnOrder: turnOrder,
                inventory: createPlayerInventory(game.actualMineralWeights),
                hackerBytes: 0
            });
            await player.save();

            game.players.push(player._id);
            await game.save();

            socket.join(gameCode);
            console.log(`${playerName} (Turno ${turnOrder}) se unió a ${gameCode}`);

             // Notificar a todos lista actualizada
             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
             const playersPublicInfoPromises = updatedGame.players.map(async p => {
                 const pData = await Player.findById(p._id).select('inventory');
                 return {
                     id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                     mineralCount: pData?.inventory?.length ?? 0
                  };
              });
             const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
             io.to(gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });

             callback({ success: true, gameId: game._id, playerId: player._id });

             // Enviar estado inicial al jugador que se unió
             const playerGameState = await getGameStateForPlayer(game._id, player._id);
              if (playerGameState) {
                   socket.emit('gameStateUpdated', { gameState: playerGameState });
              }

        } catch (error) {
            console.error("Error uniéndose al juego:", error);
            callback({ success: false, message: "Error interno al unirse al juego." });
        }
    });

    // Iniciar Juego (Host)
    socket.on('startGame', async ({ gameId }) => {
         try {
            const game = await Game.findById(gameId).populate('players', '_id turnOrder isActive socketId'); // Poblar socketId para validación
            if (!game) return socket.emit('error', { message: "Juego no encontrado." });

            const hostPlayer = game.players.find(p => p._id.equals(game.hostId));
            if (!hostPlayer || hostPlayer.socketId !== socket.id) {
                return socket.emit('error', { message: "Solo el host puede iniciar." });
            }

            if (game.status !== 'waiting') return socket.emit('error', { message: `El juego ya está ${game.status}.` });

            const activePlayers = game.players.filter(p => p.isActive);
             if (activePlayers.length < 2) {
                  return socket.emit('error', { message: "Se necesitan al menos 2 jugadores activos." });
             }

            const firstPlayer = activePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
            if (!firstPlayer) {
                console.error(`startGame CRITICAL ERROR: ¡No se encontró primer jugador activo! gameId: ${game._id}.`);
                 return socket.emit('error', { message: "Error interno: Jugador inicial no encontrado." });
            }

            game.status = 'playing';
            game.currentTurnOrder = firstPlayer.turnOrder;
            game.currentPlayerId = firstPlayer._id;
            // Resetear estados de juego anteriores
            game.balancerPlayerId = null;
            game.votingState = { votes: new Map(), requiredVotes: 0, receivedVotes: 0 };
            game.phase1CorrectlyGuessedWeights = new Map(); // Resetear mapa de Fase 1
            game.phase2RoundsPlayed = 0;
            game.phase2CorrectGuessesTotal = 0;
            game.phase2CorrectGuessesMap = new Map();
            game.successfulGuesser = null;
            game.currentPrizePot = INITIAL_PRIZE_POT;

            await game.save();
            console.log(`startGame: Juego ${game.gameCode} iniciado. Turno para Jugador ${firstPlayer.turnOrder}.`);
            await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error(`Error iniciando juego ${gameId}:`, error);
            socket.emit('error', { message: `Error interno al iniciar: ${error.message}` });
        }
    });

    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
         try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+inventory');

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "El juego no está en fase de colocación." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });

             player.canPlaceMinerals = player.isActive && player.inventory && player.inventory.length >= 2;
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales." });

            if (!Array.isArray(placements) || placements.length < 2 || placements.length % 2 !== 0) {
                console.warn(`placeMinerals (${player.name}): Intento de colocar cantidad inválida (${placements?.length || 0}).`);
                return socket.emit('error', { message: 'Debes colocar una cantidad par de minerales (2, 4, 6...).' });
            }

            const currentInventory = [...player.inventory];
            const mineralsToPlaceDetails = [];
            const placedInstanceIds = new Set();

            for (const placement of placements) {
                if (!placement || !placement.mineralInstanceId || !placement.targetScale || !placement.targetSide) {
                    throw new Error("Datos de colocación inválidos recibidos.");
                }
                if (placedInstanceIds.has(placement.mineralInstanceId)) {
                    throw new Error("No puedes colocar el mismo mineral dos veces en un turno.");
                }

                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) {
                    throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado en tu inventario.`);
                }

                const mineral = currentInventory.splice(mineralIndex, 1)[0];
                mineralsToPlaceDetails.push({ mineral, placement });
                placedInstanceIds.add(placement.mineralInstanceId);
            }

             mineralsToPlaceDetails.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 scale.leftMaterials = scale.leftMaterials || [];
                 scale.rightMaterials = scale.rightMaterials || [];
                 scale.leftWeight = scale.leftWeight || 0;
                 scale.rightWeight = scale.rightWeight || 0;

                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials;
                 const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';

                 sideArray.push(mineral);
                 scale[weightProp] += mineral.weight;
             });

            game.markModified('mainScale');
            game.markModified('secondaryScale');

            player.inventory = currentInventory;
            await player.save(); // Hook pre-save actualiza canPlaceMinerals

            if (game.isMainScaleBalanced()) {
                console.log(`¡Balanza equilibrada por ${player.name} en ${game.gameCode}! Iniciando votación.`);
                game.status = 'voting';
                game.balancerPlayerId = player._id;
                game.currentPrizePot = INITIAL_PRIZE_POT;

                const activePlayers = await Player.find({ gameId: game._id, isActive: true });
                game.votingState = {
                    votes: new Map(activePlayers.map(p => [p._id.toString(), null])),
                    requiredVotes: activePlayers.length,
                    receivedVotes: 0
                };
                game.markModified('votingState');

                await game.save();
                await broadcastGameState(game._id, game.gameCode);

            } else {
                await advanceTurn(game, io);
            }

        } catch (error) {
            console.error(`Error en placeMinerals para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al colocar minerales: ${error.message || 'Error desconocido.'}` });
             try {
                 const currentState = await getGameStateForPlayer(gameId, playerId);
                 if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
             } catch (e) { console.error("Error retransmitiendo estado tras fallo:", e); }
        }
    });

    // -------------------------------------------------------------------------
    // REMOVED socket.on('guessAllWeightsPhase1', ...)
    // -------------------------------------------------------------------------

    // NUEVO: Adivinar Peso Individual en Fase 1
    socket.on('guessSingleWeightPhase1', async ({ gameId, playerId, guessedColor, guessedWeight }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            // --- Validaciones Fase 1 (Nueva Acción) ---
            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "Solo puedes adivinar pesos durante la Fase 1." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (!MINERAL_TYPES.includes(guessedColor)) return socket.emit('error', { message: "Color de mineral inválido." });
            if (guessedColor === 'Amarillo') return socket.emit('error', { message: "No puedes adivinar el peso del mineral Amarillo (ya es conocido)." });

            const guessNum = parseInt(guessedWeight);
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) {
                 return socket.emit('error', { message: `El peso adivinado debe ser un número entre ${MIN_WEIGHT} y ${MAX_WEIGHT}.` });
            }

            // Verificar si ya fue adivinado correctamente en esta fase
            if (game.phase1CorrectlyGuessedWeights?.has(guessedColor)) {
                 return socket.emit('error', { message: `El peso de ${guessedColor} ya fue adivinado correctamente en esta fase.` });
            }
            // --- Fin Validaciones ---

            console.log(`Fase 1: ${player.name} intenta adivinar ${guessedColor} = ${guessNum}`);

            const actualWeight = game.actualMineralWeights[guessedColor];

            if (guessNum === actualWeight) {
                // --- ¡Acierto en Fase 1! ---
                console.log(`Fase 1: ¡Correcto! ${player.name} adivinó ${guessedColor}.`);

                // Inicializar el mapa si no existe
                if (!game.phase1CorrectlyGuessedWeights) {
                     game.phase1CorrectlyGuessedWeights = new Map();
                }
                game.phase1CorrectlyGuessedWeights.set(guessedColor, actualWeight);
                game.markModified('phase1CorrectlyGuessedWeights'); // MUY IMPORTANTE para Mapas
                await game.save();

                // Enviar resultado SÓLO al jugador que adivinó
                socket.emit('singleGuessPhase1Result', {
                    success: true,
                    color: guessedColor,
                    weight: actualWeight,
                    message: `¡Correcto! El mineral ${guessedColor} pesa ${actualWeight}g.`
                });

                // Transmitir estado a TODOS para actualizar la UI con los pesos revelados
                await broadcastGameState(game._id, game.gameCode);

            } else {
                // --- Fallo en Fase 1 ---
                console.log(`Fase 1: Incorrecto. ${player.name} falló ${guessedColor}.`);

                // Enviar resultado SÓLO al jugador que falló
                socket.emit('singleGuessPhase1Result', {
                    success: false,
                    color: guessedColor,
                    message: `Incorrecto. El mineral ${guessedColor} no pesa ${guessNum}g.`
                });

                // NO se guarda el juego, NO se transmite estado (nada cambió globalmente)
            }

             // IMPORTANTE: El turno NO avanza después de esta adivinanza. El jugador puede seguir colocando o pasar.

        } catch (error) {
             console.error(`Error en guessSingleWeightPhase1 para jugador ${playerId}:`, error);
             socket.emit('error', { message: `Error al procesar adivinanza Fase 1: ${error.message || 'Error desconocido.'}` });
             // Reintentar broadcast del estado actual si falla y el jugador sigue conectado
             try {
                  const playerStillConnected = await Player.findById(playerId).select('socketId');
                  if(playerStillConnected?.socketId) {
                     const currentState = await getGameStateForPlayer(gameId, playerId);
                     if (currentState) io.to(playerStillConnected.socketId).emit('gameStateUpdated', { gameState: currentState });
                  }
             } catch (e) { console.error("Error retransmitiendo estado tras fallo:", e); }
        }
    });


    // Votar para Fase 2
    socket.on('castVote', async ({ gameId, playerId, vote }) => {
        try {
            const game = await Game.findById(gameId).populate('players', '_id isActive turnOrder name');
            const player = game.players.find(p => p._id.equals(playerId));

            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'voting') return socket.emit('error', { message: "No es la fase de votación." });
            if (!game.votingState || !game.votingState.votes) {
                 console.error("Error crítico: votingState no inicializado correctamente.");
                 return socket.emit('error', { message: "Error interno del servidor (estado de votación)." });
            }
            if (!game.votingState.votes.has(playerId.toString())) return socket.emit('error', { message: "No estás habilitado para votar en esta partida." });
            if (game.votingState.votes.get(playerId.toString()) !== null) return socket.emit('error', { message: "Ya has emitido tu voto." });
            if (vote !== 'yes' && vote !== 'no') return socket.emit('error', { message: "Voto inválido (debe ser 'yes' o 'no')." });

            console.log(`Voto recibido de ${player.name}: ${vote}`);
            game.votingState.votes.set(playerId.toString(), vote);
            game.votingState.receivedVotes += 1;
            game.markModified('votingState');

            io.to(game.gameCode).emit('voteReceived', { playerId: playerId, playerName: player.name });

            const currentActivePlayers = game.players.filter(p => p.isActive);
            const requiredNow = currentActivePlayers.length;
            game.votingState.requiredVotes = requiredNow;

            if (game.votingState.receivedVotes >= requiredNow && requiredNow > 0) {
                console.log(`Todos (${requiredNow}) los activos han votado en ${game.gameCode}. Contando...`);
                let yesVotes = 0;
                let noVotes = 0;

                currentActivePlayers.forEach(p => {
                     const playerVote = game.votingState.votes.get(p._id.toString());
                     if (playerVote === 'yes') yesVotes++;
                     else if (playerVote === 'no') noVotes++;
                });

                console.log(`Resultados (solo activos): SI=${yesVotes}, NO=${noVotes}`);

                if (yesVotes > noVotes) { // Mayoría SÍ -> Iniciar Fase 2
                    console.log(`Votación APROBADA para Fase 2 en ${game.gameCode}.`);
                    game.status = 'guessing_phase';
                    game.phase2RoundsPlayed = 0;
                    game.phase2CorrectGuessesTotal = 0;
                    game.phase2CorrectGuessesMap = new Map();

                    let firstTurnPlayer = currentActivePlayers.find(p => p._id.equals(game.hostId));
                    if (!firstTurnPlayer) {
                         firstTurnPlayer = currentActivePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
                    }

                    if (firstTurnPlayer) {
                         game.currentPlayerId = firstTurnPlayer._id;
                         game.currentTurnOrder = firstTurnPlayer.turnOrder;
                         await Player.updateMany(
                             { gameId: game._id, isActive: true },
                             { $set: { guessedColorsPhase2: [], phase2GuessAttemptsThisTurn: 0 } }
                         );
                         await Player.findByIdAndUpdate(firstTurnPlayer._id, {
                              phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN
                         });

                         await game.save();
                         console.log(`Fase 2 iniciada. Turno para ${firstTurnPlayer.name} (Turno ${firstTurnPlayer.turnOrder})`);
                         await broadcastGameState(game._id, game.gameCode);

                    } else {
                         console.error("Error crítico: No hay jugadores activos para iniciar Fase 2.");
                         game.status = 'finished_disconnect_game';
                         game.currentPrizePot = 0;
                         await game.save();
                         await broadcastGameOver(game);
                         return;
                    }

                } else { // Mayoría NO o Empate -> Terminar juego
                    console.log(`Votación RECHAZADA/Empate para Fase 2 en ${game.gameCode}. Terminando juego.`);
                    game.status = 'finished_balance_win';
                    game.successfulGuesser = game.balancerPlayerId;
                    await game.save();
                    await broadcastGameOver(game);
                }
            } else if (requiredNow === 0) {
                 console.log("Votación completada pero no quedan jugadores activos.");
                 game.status = 'finished_disconnect_vote';
                 game.currentPrizePot = 0;
                 await game.save();
                 await broadcastGameOver(game);
            }
            else {
                 await game.save();
                 await broadcastGameState(game._id, game.gameCode);
            }

        } catch (error) {
            console.error(`Error en castVote para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al procesar voto: ${error.message || 'Error desconocido.'}` });
        }
    });

    // Adivinar Peso Individual (Fase 2)
    socket.on('guessSingleWeight', async ({ gameId, playerId, color, weightGuess }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'guessing_phase') return socket.emit('error', { message: "No es la fase de adivinanza." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (player.phase2GuessAttemptsThisTurn <= 0) return socket.emit('error', { message: "No te quedan intentos este turno." });
            if (!MINERAL_TYPES.includes(color)) return socket.emit('error', { message: "Color inválido." });
            const guessNum = parseInt(weightGuess);
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Adivinanza inválida (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (player.guessedColorsPhase2.includes(color)) return socket.emit('error', { message: `Ya intentaste adivinar ${color}.` });

            console.log(`Fase 2: ${player.name} intenta adivinar ${color} = ${guessNum}`);

            player.phase2GuessAttemptsThisTurn -= 1;
            player.guessedColorsPhase2.push(color);

            const actualWeight = game.actualMineralWeights[color];
            const alreadyGuessedCorrectly = game.phase2CorrectGuessesMap.has(color);

            if (guessNum === actualWeight) {
                 if (!alreadyGuessedCorrectly) {
                      console.log(`Fase 2: ¡CORRECTO! ${player.name} adivinó ${color}.`);
                      game.phase2CorrectGuessesTotal += 1;
                      game.phase2CorrectGuessesMap.set(color, player._id);
                      game.currentPrizePot += PHASE2_REWARD_PER_CORRECT_GUESS;
                      game.markModified('phase2CorrectGuessesMap');
                      await game.save();
                      await player.save();

                      io.to(game.gameCode).emit('singleGuessResult', {
                           playerId: player._id, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: true, message: `¡${player.name} adivinó ${color}!`, newTotalGuesses: game.phase2CorrectGuessesTotal
                      });
                      io.to(game.gameCode).emit('prizePotUpdated', { newPrizePot: game.currentPrizePot });

                 } else {
                      await player.save();
                      console.log(`Fase 2: ${player.name} adivinó ${color} (correcto), pero ya descubierto.`);
                      io.to(game.gameCode).emit('singleGuessResult', {
                           playerId: player._id, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: false, message: `${player.name} adivinó ${color} (correcto), pero ya lo habían encontrado.`
                      });
                 }
            } else {
                 await player.save();
                 console.log(`Fase 2: INCORRECTO. ${player.name} falló ${color}.`);
                 io.to(game.gameCode).emit('singleGuessResult', {
                      playerId: player._id, playerName: player.name, color, weightGuess: guessNum, correct: false, justGuessed: false, message: `${player.name} falló al adivinar ${color}.`
                 });
            }

             // Siempre transmitir estado después del intento
             await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error(`Error en guessSingleWeight para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al adivinar: ${error.message || 'Error desconocido.'}` });
        }
    });

    // Pasar Turno
    socket.on('passTurn', async ({ gameId, playerId }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'playing' && game.status !== 'guessing_phase') return socket.emit('error', { message: "No se puede pasar turno ahora." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno para pasar." });

            console.log(`${player.name} pasa el turno en ${game.gameCode}. Estado: ${game.status}`);
            await advanceTurn(game, io);

        } catch (error) {
            console.error(`Error en passTurn para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al pasar turno: ${error.message || 'Error desconocido.'}` });
        }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });

        if (player && player.gameId) {
             const game = await Game.findById(player.gameId).populate('players', '_id isActive turnOrder name'); // Poblar nombres
             if (!game) {
                 console.log(`disconnect: Juego ${player.gameId} no encontrado para ${player.name}. Limpiando socketId.`);
                 player.socketId = null;
                 await player.save();
                 return;
             }

             if (game.status.startsWith('finished')) {
                  console.log(`disconnect: Juego ${game.gameCode} ya terminado. Limpiando socketId de ${player.name}.`);
                  player.socketId = null;
                  await player.save();
                  return;
             }

             console.log(`Jugador ${player.name} desconectado de ${game.gameCode} (Estado: ${game.status}). Marcando inactivo.`);
             const wasCurrentPlayer = game.currentPlayerId?.equals(player._id);
             player.isActive = false;
             player.socketId = null;
             await player.save();

             // Notificar a otros sobre la desconexión
             io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });

             // Actualizar lista de jugadores para todos (re-leer para obtener estado actualizado)
              const updatedPlayers = await Player.find({ gameId: game._id }).select('_id name turnOrder isActive inventory');
              const playersPublicInfo = updatedPlayers.map(p => ({
                  id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                  mineralCount: p.inventory?.length ?? 0
              }));
              io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });


             if (game.status === 'voting') {
                 console.log(`Desconexión DURANTE VOTACIÓN en ${game.gameCode}. Terminando.`);
                 // Informar a los clientes restantes
                 io.to(game.gameCode).emit('gameEndedDueToVoteDisconnect', { playerName: player.name });
                 game.status = 'finished_disconnect_vote';
                 game.currentPrizePot = 0;
                 await game.save();
                 await broadcastGameOver(game);
                 return;
             }

             let needsTurnAdvance = false;
             if ((game.status === 'playing' || game.status === 'guessing_phase') && wasCurrentPlayer) {
                  console.log(`disconnect: Era el turno del jugador desconectado ${player.name}. Avanzando turno...`);
                  needsTurnAdvance = true;
             }

             const remainingActivePlayersCount = updatedPlayers.filter(p => p.isActive).length; // Usar lista ya leída

             if (remainingActivePlayersCount === 0) {
                 console.log(`¡Último jugador ${player.name} desconectado de ${game.gameCode}! Terminando juego.`);
                 if (game.status === 'guessing_phase') {
                      game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
                 } else {
                      game.status = 'finished_disconnect_game';
                 }
                 // El premio se determina en broadcastGameOver
                 game.currentPlayerId = null;
                 await game.save();
                 await broadcastGameOver(game);

             } else if (needsTurnAdvance) {
                  await advanceTurn(game, io);
             } else {
                  // Si no era su turno, solo transmitir el estado actualizado
                  await broadcastGameState(game._id, game.gameCode);
             }

        } else {
            // console.log(`disconnect: No se encontró jugador para socket ${socket.id}.`);
        }
    });

});

// --- Función Helper: advanceTurn (ACTUALIZADA) ---
async function advanceTurn(game, ioInstance) {
    if (!game || !game.status || game.status.startsWith('finished')) return; // Guard clause

    const previousPlayerId = game.currentPlayerId;
    let nextPlayer = null;
    let roundEnded = false;

    nextPlayer = await findNextActivePlayer(game); // Busca el siguiente activo

    // Lógica de Rondas Fase 2
    if (game.status === 'guessing_phase' && previousPlayerId && nextPlayer) {
        // Necesitamos leer el turnOrder del jugador anterior
        const previousPlayer = await Player.findById(previousPlayerId).select('turnOrder');
        if (previousPlayer && (nextPlayer.turnOrder <= previousPlayer.turnOrder)) {
            // Se completó una vuelta completa
            roundEnded = true;
            game.phase2RoundsPlayed += 1;
            console.log(`Fin de Ronda ${game.phase2RoundsPlayed} en Fase 2.`);

            if (game.phase2RoundsPlayed >= PHASE2_TOTAL_ROUNDS) {
                 console.log("Se completaron las 3 rondas de Fase 2. Evaluando...");
                 game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES
                               ? 'finished_phase2_win'
                               : 'finished_phase2_loss';
                 console.log(`Resultado Fase 2: ${game.status}`);
                 game.currentPlayerId = null;
                 await game.save();
                 await broadcastGameOver(game); // broadcastGameOver manejará premio
                 return;
            }
        }
        // Resetear intentos para el siguiente jugador si el juego continúa
        if (nextPlayer && !game.status.startsWith('finished')) {
             await Player.findByIdAndUpdate(nextPlayer._id, {
                 phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN
             });
             console.log(`advanceTurn: Reseteando intentos Fase 2 para ${nextPlayer.name}`);
        }
    }

    // Actualizar turno o terminar si no hay siguiente
    if (nextPlayer) {
         game.currentPlayerId = nextPlayer._id;
         game.currentTurnOrder = nextPlayer.turnOrder;
         console.log(`advanceTurn: Turno pasa a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
         await game.save();
         await broadcastGameState(game._id, game.gameCode);
    } else {
        // No se encontró siguiente jugador válido
        console.log("advanceTurn: No se encontró un siguiente jugador válido. Terminando juego.");
         if (game.status === 'guessing_phase') {
             game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
         } else if (game.status === 'playing') {
             game.status = 'finished_failure'; // Nadie más puede jugar/adivinar en Fase 1
         } else {
              game.status = 'finished_disconnect_game'; // Estado inesperado, asumir desconexión
         }
         console.log(`advanceTurn: Juego termina con estado ${game.status}`);
         game.currentPlayerId = null;
         await game.save();
         await broadcastGameOver(game); // broadcastGameOver manejará premio
    }
}

// --- Rutas API (Opcional) ---
// const apiRoutes = require('./routes/api');
// app.use('/api', apiRoutes);

// --- Servir Frontend ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor 'Juego de Escala v2' iniciado en puerto ${PORT}`);
});