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
const PHASE2_TARGET_CORRECT_GUESSES = 3;
const PHASE2_TOTAL_ROUNDS = 3;
const PHASE2_GUESS_ATTEMPTS_PER_TURN = 2;

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Genera los pesos secretos y la info inicial (Sin cambios requeridos aquí)
function generateGameSetup() {
    const weights = {};
    let generatedWeights = [];
    const availableWeights = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => i + MIN_WEIGHT);

    if (!availableWeights.includes(10)) {
         weights['Amarillo'] = 10;
    } else {
         weights['Amarillo'] = 10;
         availableWeights.splice(availableWeights.indexOf(10), 1);
    }
    generatedWeights.push(10);

    const remainingTypes = MINERAL_TYPES.filter(t => t !== 'Amarillo');
    remainingTypes.forEach(type => {
        if (availableWeights.length === 0) {
             const randomIndex = Math.floor(Math.random() * generatedWeights.length);
             weights[type] = generatedWeights[randomIndex];
        } else {
            const randomIndex = Math.floor(Math.random() * availableWeights.length);
            const assignedWeight = availableWeights.splice(randomIndex, 1)[0];
            weights[type] = assignedWeight;
            generatedWeights.push(assignedWeight);
        }
    });

    const sortedUniqueWeights = [...new Set(Object.values(weights))].sort((a, b) => b - a);
    const rankOfYellow = sortedUniqueWeights.indexOf(10) + 1;

    const knownInfo = {
        type: 'Amarillo',
        weight: 10,
        description: `El mineral Amarillo pesa 10g (es el ${rankOfYellow}º más pesado).`
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

// Determina el siguiente jugador ACTIVO (REVISADO para nueva lógica)
// Devuelve el objeto Player completo o null si no hay siguiente.
async function findNextActivePlayer(game) {
    if (!game || !game.players || game.players.length === 0 || !game.status) {
        console.error("findNextActivePlayer: Juego inválido o sin jugadores/estado.");
        return null;
    }

    let populatedGame = game;
    if (!game.populated('players')) {
        try {
            // Poblar solo jugadores activos con los campos necesarios
            populatedGame = await Game.findById(game._id)
                .populate({
                    path: 'players',
                    match: { isActive: true },
                    select: '_id name turnOrder isActive inventory canPlaceMinerals'
                });
            if (!populatedGame) throw new Error("Juego no encontrado al repopular");
        } catch (err) {
            console.error("findNextActivePlayer ERROR: Falló al repopular jugadores activos:", err);
            return null;
        }
    }

    // Filtrar los jugadores poblados (que ya deben ser activos)
    const activePlayers = populatedGame.players
        .filter(p => p != null) // Filtrar nulos si populate falló parcialmente
        .sort((a, b) => a.turnOrder - b.turnOrder);

    if (activePlayers.length === 0) {
        console.log("findNextActivePlayer: No hay jugadores activos.");
        return null;
    }

    const currentPlayerIndex = activePlayers.findIndex(p => p._id.equals(populatedGame.currentPlayerId));

    let searchStartIndex = currentPlayerIndex === -1 ? -1 : currentPlayerIndex;

    let attempts = 0;
    let nextPlayerIndex = searchStartIndex;

    while (attempts < activePlayers.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % activePlayers.length;
        const nextPlayer = activePlayers[nextPlayerIndex];

        // Condición para poder jugar varía según la fase:
        let canPlayNext = false;
        if (populatedGame.status === 'playing') {
             // Necesita poder colocar minerales (>=2 en inventario)
             nextPlayer.canPlaceMinerals = nextPlayer.inventory && nextPlayer.inventory.length >= 2; // Recalcular por si acaso
             canPlayNext = nextPlayer.canPlaceMinerals;
             // console.log(`findNextActivePlayer (playing): Verificando ${nextPlayer.name}. Puede colocar: ${canPlayNext}`);
        } else if (populatedGame.status === 'guessing_phase') {
             // Solo necesita estar activo
             canPlayNext = true; // Ya filtramos por activos
             // console.log(`findNextActivePlayer (guessing_phase): Verificando ${nextPlayer.name}. Está activo.`);
        }

        if (canPlayNext) {
             console.log(`findNextActivePlayer: Siguiente turno para ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
             // Devolver el jugador encontrado (ya está poblado con lo necesario)
             return nextPlayer;
        }

        attempts++;
        // Evitar bucle infinito si nadie puede jugar
        if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break;
    }

    console.log("findNextActivePlayer: No se encontró un siguiente jugador activo que cumpla las condiciones.");
    return null;
}


// Construye el objeto gameState para enviar a UN jugador específico (ACTUALIZADO)
async function getGameStateForPlayer(gameId, playerId) {
    try {
        // Poblar más campos si son necesarios para la lógica del cliente
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id')
            .populate('balancerPlayerId', 'name _id'); // Poblar quién balanceó

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
        const mainScaleBalanced = game.isMainScaleBalanced(); // Usar el método actualizado

        // Crear la información pública (sin pesos de inventario)
        const playersPublicInfo = playersInGame.map(p => ({
             id: p._id,
             name: p.name,
             turnOrder: p.turnOrder,
             mineralCount: p.inventory?.length ?? 0,
             isActive: p.isActive,
             canPlaceMinerals: p.canPlaceMinerals,
             // Añadir info relevante para UI si es necesario (ej: ¿ya votó?)
             hasVoted: game.status === 'voting' && game.votingState?.votes?.get(p._id.toString()) !== null
        }));

        // Construir estado de votación para el cliente
        let clientVotingState = null;
        if (game.status === 'voting' && game.votingState) {
            clientVotingState = {
                requiredVotes: game.votingState.requiredVotes,
                receivedVotes: game.votingState.receivedVotes,
                myVote: game.votingState.votes.get(player._id.toString()), // null, 'yes', 'no'
                // No enviar el mapa completo de votos al cliente
            };
        }

        const gameStateToSend = {
            gameId: game._id,
            gameCode: game.gameCode,
            hostId: game.hostId, // Necesario para saber quién empieza Fase 2
            status: game.status,
            isMainScaleBalanced: mainScaleBalanced,
            knownMineralInfo: game.knownMineralInfo,
            // Filtrar pesos de los materiales en las balanzas antes de enviar
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
            iCanPlaceMinerals: player.canPlaceMinerals, // Estado general
            myPhase2AttemptsLeft: player.phase2GuessAttemptsThisTurn,
            myGuessedColorsPhase2: player.guessedColorsPhase2,

            // Info global del juego
            playersPublicInfo: playersPublicInfo,
            currentPrizePot: game.currentPrizePot,
            balancerPlayer: game.balancerPlayerId ? { id: game.balancerPlayerId._id, name: game.balancerPlayerId.name } : null,
            votingState: clientVotingState, // Estado de votación filtrado
            phase2RoundsPlayed: game.phase2RoundsPlayed,
            phase2CorrectGuessesTotal: game.phase2CorrectGuessesTotal,
            // No enviar phase2CorrectGuessesMap al cliente directamente, es info interna
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
        // Enviar solo a jugadores activos y con socketId
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

// Emite el evento de fin de juego a todos (ACTUALIZADO para manejar nuevos estados)
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    // Poblar lo necesario para mostrar el resultado final
    const populatedGame = await Game.findById(game._id)
                                    .populate('players', 'socketId _id isActive name') // Necesitamos nombres para mostrar
                                    .populate('successfulGuesser', '_id name')
                                    .populate('balancerPlayerId', '_id name');
    if (!populatedGame) {
         console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado para transmitir fin.`);
         return;
    }

    // Asignar premios si es necesario ANTES de enviar estado final
    let finalPrizePerPlayer = 0;
    if (populatedGame.status === 'finished_balance_win' || populatedGame.status === 'finished_phase2_win') {
        // Premio se reparte entre los jugadores ACTIVOS al final del juego
        const activePlayersAtEnd = populatedGame.players.filter(p => p.isActive);
        if (activePlayersAtEnd.length > 0) {
            finalPrizePerPlayer = Math.floor(populatedGame.currentPrizePot / activePlayersAtEnd.length);
            console.log(`Repartiendo ${populatedGame.currentPrizePot} entre ${activePlayersAtEnd.length} jugadores. ${finalPrizePerPlayer} c/u.`);
            // Actualizar DB (mejor si se hace en una transacción)
            for (const player of activePlayersAtEnd) {
                try {
                    await Player.findByIdAndUpdate(player._id, { $inc: { hackerBytes: finalPrizePerPlayer } });
                } catch (updateError) {
                    console.error(`Error actualizando premio para jugador ${player._id}:`, updateError);
                }
            }
        } else {
             console.log("Nadie activo al final, premio se pierde.");
             populatedGame.currentPrizePot = 0; // Asegurar que el premio es 0 si nadie queda
        }
    } else {
         // Si es phase2_loss o disconnect, el premio es 0.
         populatedGame.currentPrizePot = 0;
    }
     // Si el estado del juego ya refleja una pérdida, asegurar que el premio sea 0
     if (populatedGame.status === 'finished_phase2_loss' || populatedGame.status === 'finished_disconnect_vote' || populatedGame.status === 'finished_disconnect_game' || populatedGame.status === 'finished_failure') {
         populatedGame.currentPrizePot = 0;
     }


     // Ahora, obtener el estado final DESPUÉS de actualizar premios si aplica
     for (const playerRef of populatedGame.players) {
        if (playerRef.socketId) { // Enviar a todos, incluso inactivos, para que vean el final
            // Necesitamos obtener el estado individual actualizado con el premio si lo hubo
             try {
                 const finalPlayerState = await Player.findById(playerRef._id); // Volver a leer estado del jugador
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

    // Crear Juego (CORREGIDO)
    socket.on('createGame', async ({ hostName }, callback) => {
        try {
            const gameCode = generateGameCode();
            const { weights, knownInfo } = generateGameSetup();

            // 1. Crear instancia de Host (SIN guardarlo aún)
            const host = new Player({
                socketId: socket.id,
                name: hostName,
                turnOrder: 1,
                inventory: createPlayerInventory(weights),
                hackerBytes: 0 // Inicia en 0
                // gameId se asignará DESPUÉS de crear el juego
            });

            // 2. Crear instancia de Game, referenciando el _id del host (Mongoose genera _id al crear instancia)
            const game = new Game({
                gameCode,
                hostId: host._id, // Usar ID generado por Mongoose para el host
                players: [host._id], // Añadir referencia al host
                actualMineralWeights: weights,
                knownMineralInfo: knownInfo,
                mainScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 },
                secondaryScale: { leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 },
                votingState: { votes: new Map(), requiredVotes: 0, receivedVotes: 0 },
                phase2CorrectGuessesMap: new Map(),
                status: 'waiting',
                currentPrizePot: INITIAL_PRIZE_POT
            });

            // 3. Guardar el Juego PRIMERO para obtener su _id
            await game.save();

            // 4. Asignar el game._id al Host
            host.gameId = game._id;

            // 5. Ahora SÍ guardar el Host
            await host.save();

            // 6. Unir socket a la sala y continuar
            socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}). Host unido a la sala.`);

            // Enviar callback
            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });

            // Enviar estado inicial al host
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) {
                socket.emit('gameStateUpdated', { gameState: hostGameState });
            } else {
                 socket.emit('error', { message: 'Error al generar el estado inicial del juego.' });
            }

        } catch (error) {
            // El error original ('Player validation failed...') ya no debería ocurrir aquí
            console.error("Error detallado creando juego:", error);
            let errorMessage = "Error interno al crear el juego.";
             if (error.name === 'ValidationError') errorMessage = `Error de validación: ${error.message}`;
             else if (error.code === 11000) errorMessage = "Error al generar código único, intenta de nuevo.";
            // Intentar limpiar si algo se creó parcialmente? (Complejo)
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
            // Jugador inicia SIN HackerBytes
            const player = new Player({
                socketId: socket.id,
                name: playerName,
                gameId: game._id,
                turnOrder: turnOrder,
                inventory: createPlayerInventory(game.actualMineralWeights),
                hackerBytes: 0 // Inicia en 0
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
            const game = await Game.findById(gameId).populate('players', '_id turnOrder isActive'); // Poblar para encontrar primero
            if (!game) return socket.emit('error', { message: "Juego no encontrado." });

            // Asegurar que quien pide iniciar es el host registrado en el juego
            if (!game.hostId || socket.id !== (await Player.findById(game.hostId))?.socketId) {
                // Buscar el jugador por socket id para enviar el error
                 const playerRequesting = await Player.findOne({socketId: socket.id, gameId: gameId});
                 if (playerRequesting) {
                     return socket.emit('error', { message: "Solo el host puede iniciar." });
                 } else {
                     // Si no encontramos al jugador, simplemente logueamos
                     console.warn(`Intento de iniciar juego ${game.gameCode} por socket ${socket.id} no reconocido como host.`);
                     return;
                 }
            }

            if (game.status !== 'waiting') return socket.emit('error', { message: `El juego ya está ${game.status}.` });

            const activePlayers = game.players.filter(p => p.isActive);
             if (activePlayers.length < 2) {
                  return socket.emit('error', { message: "Se necesitan al menos 2 jugadores activos." });
             }

            // Encontrar al primer jugador por turnOrder (usualmente el host)
            const firstPlayer = activePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
            if (!firstPlayer) {
                console.error(`startGame CRITICAL ERROR: ¡No se encontró primer jugador activo! gameId: ${game._id}.`);
                 return socket.emit('error', { message: "Error interno: Jugador inicial no encontrado." });
            }

            game.status = 'playing';
            game.currentTurnOrder = firstPlayer.turnOrder;
            game.currentPlayerId = firstPlayer._id;
            // Limpiar estados de fases anteriores si se re-inicia
            game.balancerPlayerId = null;
            game.votingState = { votes: new Map(), requiredVotes: 0, receivedVotes: 0 };
            game.phase2RoundsPlayed = 0;
            game.phase2CorrectGuessesTotal = 0;
            game.phase2CorrectGuessesMap = new Map();
            game.successfulGuesser = null;
            game.currentPrizePot = INITIAL_PRIZE_POT; // Resetear premio al iniciar

            await game.save();
            console.log(`startGame: Juego ${game.gameCode} iniciado. Turno para Jugador ${firstPlayer.turnOrder}.`);
            await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error(`Error iniciando juego ${gameId}:`, error);
            socket.emit('error', { message: `Error interno al iniciar: ${error.message}` });
        }
    });

    // Colocar Minerales (MODIFICADO para nueva regla y votación)
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
         try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId).select('+inventory'); // Cargar inventario

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "El juego no está en fase de colocación." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });

             // Recalcular canPlaceMinerals por si acaso
             player.canPlaceMinerals = player.isActive && player.inventory && player.inventory.length >= 2;
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales." });

            // --- NUEVA VALIDACIÓN: Cantidad Par y Mínimo 2 ---
            if (!Array.isArray(placements) || placements.length < 2 || placements.length % 2 !== 0) {
                console.warn(`placeMinerals (${player.name}): Intento de colocar cantidad inválida (${placements?.length || 0}).`);
                return socket.emit('error', { message: 'Debes colocar una cantidad par de minerales (2, 4, 6...).' });
            }
            // --- FIN NUEVA VALIDACIÓN ---

            const currentInventory = [...player.inventory]; // Copia para operar
            const mineralsToPlaceDetails = []; // Guardar { mineral, placement }
            const placedInstanceIds = new Set();

            // 1. Validar y extraer minerales del inventario
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

                const mineral = currentInventory.splice(mineralIndex, 1)[0]; // Quitar del inventario temporal
                mineralsToPlaceDetails.push({ mineral, placement });
                placedInstanceIds.add(placement.mineralInstanceId);
            }

             // 2. Actualizar balanzas en el objeto Game
             mineralsToPlaceDetails.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 // Asegurar que las propiedades existan
                 scale.leftMaterials = scale.leftMaterials || [];
                 scale.rightMaterials = scale.rightMaterials || [];
                 scale.leftWeight = scale.leftWeight || 0;
                 scale.rightWeight = scale.rightWeight || 0;

                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials;
                 const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';

                 sideArray.push(mineral); // Guardar objeto completo con peso
                 scale[weightProp] += mineral.weight;
             });

            game.markModified('mainScale');
            game.markModified('secondaryScale');

            // 3. Actualizar inventario real del jugador
            player.inventory = currentInventory;
            // El hook pre-save actualizará canPlaceMinerals
            await player.save();

            // 4. Comprobar si la balanza principal está equilibrada
            if (game.isMainScaleBalanced()) {
                // --- INICIAR FASE DE VOTACIÓN ---
                console.log(`¡Balanza equilibrada por ${player.name} en ${game.gameCode}! Iniciando votación.`);
                game.status = 'voting';
                game.balancerPlayerId = player._id;
                game.currentPrizePot = INITIAL_PRIZE_POT; // Establecer premio en riesgo

                const activePlayers = await Player.find({ gameId: game._id, isActive: true });
                game.votingState = {
                    votes: new Map(activePlayers.map(p => [p._id.toString(), null])),
                    requiredVotes: activePlayers.length,
                    receivedVotes: 0
                };
                game.markModified('votingState'); // Necesario para Maps

                await game.save();
                await broadcastGameState(game._id, game.gameCode); // Notificar a todos que se inicia votación

            } else {
                // --- CONTINUAR FASE 1: PASAR TURNO ---
                await advanceTurn(game, io); // Llama a la función helper
            }

        } catch (error) {
            console.error(`Error en placeMinerals para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al colocar minerales: ${error.message || 'Error desconocido.'}` });
             // Reintentar broadcast del estado actual si falla
             try {
                 const currentState = await getGameStateForPlayer(gameId, playerId);
                 if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
             } catch (e) { console.error("Error retransmitiendo estado tras fallo:", e); }
        }
    });


    // Votar para Fase 2
    socket.on('castVote', async ({ gameId, playerId, vote }) => {
        try {
            const game = await Game.findById(gameId).populate('players', '_id isActive turnOrder name'); // Poblar para contar activos, turnos y nombre
            const player = game.players.find(p => p._id.equals(playerId)); // Buscar en la lista poblada

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

            // Notificar a todos que alguien votó (para UI)
            io.to(game.gameCode).emit('voteReceived', { playerId: playerId, playerName: player.name });

            // Recalcular activos (usar la lista ya poblada)
            const currentActivePlayers = game.players.filter(p => p.isActive);
            const requiredNow = currentActivePlayers.length;
            game.votingState.requiredVotes = requiredNow; // Actualizar por si acaso

            if (game.votingState.receivedVotes >= requiredNow && requiredNow > 0) {
                console.log(`Todos (${requiredNow}) los activos han votado en ${game.gameCode}. Contando...`);
                let yesVotes = 0;
                let noVotes = 0;

                // Usar currentActivePlayers para el conteo final
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
                    game.phase2CorrectGuessesMap = new Map(); // Limpiar mapa

                    // Encontrar al Host original para darle el primer turno de Fase 2
                    let firstTurnPlayer = currentActivePlayers.find(p => p._id.equals(game.hostId));

                    if (!firstTurnPlayer) { // Si el host está inactivo
                         firstTurnPlayer = currentActivePlayers.sort((a, b) => a.turnOrder - b.turnOrder)[0];
                    }

                    if (firstTurnPlayer) {
                         game.currentPlayerId = firstTurnPlayer._id;
                         game.currentTurnOrder = firstTurnPlayer.turnOrder;
                         // Asignar intentos al jugador inicial y limpiar colores adivinados
                         await Player.updateMany(
                             { gameId: game._id, isActive: true }, // Actualizar solo activos
                             { $set: { guessedColorsPhase2: [], phase2GuessAttemptsThisTurn: 0 } } // Limpiar colores y resetear intentos a 0
                         );
                         // Establecer intentos para el primer jugador
                         await Player.findByIdAndUpdate(firstTurnPlayer._id, {
                              phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN
                         });

                         await game.save();
                         console.log(`Fase 2 iniciada. Turno para ${firstTurnPlayer.name} (Turno ${firstTurnPlayer.turnOrder})`);
                         await broadcastGameState(game._id, game.gameCode);

                    } else {
                         // Nadie activo? Juego termina
                         console.error("Error crítico: No hay jugadores activos para iniciar Fase 2.");
                         game.status = 'finished_disconnect_game'; // O un estado similar
                         game.currentPrizePot = 0; // Asegurar premio 0
                         await game.save();
                         await broadcastGameOver(game);
                         return;
                    }

                } else { // Mayoría NO o Empate -> Terminar juego, gana quien balanceó
                    console.log(`Votación RECHAZADA/Empate para Fase 2 en ${game.gameCode}. Terminando juego.`);
                    game.status = 'finished_balance_win';
                    game.successfulGuesser = game.balancerPlayerId; // Asignar ganador
                    // currentPrizePot ya está en INITIAL_PRIZE_POT
                    await game.save();
                    await broadcastGameOver(game); // broadcastGameOver reparte el premio
                }
            } else if (requiredNow === 0) {
                 // Caso raro: el último jugador votó y ya no quedan activos
                 console.log("Votación completada pero no quedan jugadores activos.");
                 game.status = 'finished_disconnect_vote'; // Estado específico
                 game.currentPrizePot = 0;
                 await game.save();
                 await broadcastGameOver(game);
            }
            else {
                 // Aún no han votado todos, solo guardar el voto
                 await game.save();
                 // Retransmitir estado para mostrar quién falta por votar
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

            // --- Validaciones Fase 2 ---
            if (!game || !player || !player.isActive) return socket.emit('error', { message: "Juego o jugador inválido." });
            if (game.status !== 'guessing_phase') return socket.emit('error', { message: "No es la fase de adivinanza." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (player.phase2GuessAttemptsThisTurn <= 0) return socket.emit('error', { message: "No te quedan intentos este turno." });
            if (!MINERAL_TYPES.includes(color)) return socket.emit('error', { message: "Color inválido." });
            const guessNum = parseInt(weightGuess); // Asegurar que sea número
            if (isNaN(guessNum) || guessNum < MIN_WEIGHT || guessNum > MAX_WEIGHT) return socket.emit('error', { message: `Adivinanza inválida (${MIN_WEIGHT}-${MAX_WEIGHT}).` });
            if (player.guessedColorsPhase2.includes(color)) return socket.emit('error', { message: `Ya intentaste adivinar ${color}.` });
            // --- Fin Validaciones ---

            console.log(`${player.name} intenta adivinar ${color} = ${guessNum}`);

            player.phase2GuessAttemptsThisTurn -= 1;
            player.guessedColorsPhase2.push(color);
            // Guardar jugador DESPUÉS de determinar resultado y premio
            // await player.save(); // Guardar después

            const actualWeight = game.actualMineralWeights[color];
            const alreadyGuessedCorrectly = game.phase2CorrectGuessesMap.has(color);

            if (guessNum === actualWeight) { // Acierto
                 if (!alreadyGuessedCorrectly) {
                      // ¡Acierto ÚNICO! Contabilizar y sumar premio.
                      console.log(`¡CORRECTO! ${player.name} adivinó ${color}.`);
                      game.phase2CorrectGuessesTotal += 1;
                      game.phase2CorrectGuessesMap.set(color, player._id);
                      game.currentPrizePot += PHASE2_REWARD_PER_CORRECT_GUESS;
                      game.markModified('phase2CorrectGuessesMap');
                      await game.save(); // Guardar cambios del juego (incluye premio)
                      await player.save(); // Guardar jugador (intentos, color)

                      io.to(game.gameCode).emit('singleGuessResult', {
                           playerId: player._id, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: true, message: `¡${player.name} adivinó ${color}!`, newTotalGuesses: game.phase2CorrectGuessesTotal
                      });
                      io.to(game.gameCode).emit('prizePotUpdated', { newPrizePot: game.currentPrizePot });

                 } else {
                      // Correcto, pero ya adivinado
                      await player.save(); // Guardar jugador (intentos, color)
                      console.log(`${player.name} adivinó ${color} (correcto), pero ya descubierto.`);
                      io.to(game.gameCode).emit('singleGuessResult', {
                           playerId: player._id, playerName: player.name, color, weightGuess: guessNum, correct: true, justGuessed: false, message: `${player.name} adivinó ${color} (correcto), pero ya lo habían encontrado.`
                      });
                 }
            } else {
                 // Incorrecto
                 await player.save(); // Guardar jugador (intentos, color)
                 console.log(`INCORRECTO. ${player.name} falló ${color}.`);
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
            await advanceTurn(game, io); // Llamar helper

        } catch (error) {
            console.error(`Error en passTurn para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al pasar turno: ${error.message || 'Error desconocido.'}` });
        }
    });

    // Desconexión (ACTUALIZADO)
     socket.on('disconnect', async (reason) => {
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });

        if (player && player.gameId) {
             const game = await Game.findById(player.gameId).populate('players', '_id isActive turnOrder'); // Poblar para lógica
             if (!game) {
                 console.log(`disconnect: Juego ${player.gameId} no encontrado para ${player.name}. Limpiando socketId.`);
                 player.socketId = null; // Limpiar socket aunque no haya juego activo
                 await player.save();
                 return;
             }

             // Si el juego ya terminó, solo limpiar socketId
             if (game.status.startsWith('finished')) {
                  console.log(`disconnect: Juego ${game.gameCode} ya terminado. Limpiando socketId de ${player.name}.`);
                  player.socketId = null;
                  await player.save();
                  return;
             }

             // --- Manejo de desconexión en fases activas ---
             console.log(`Jugador ${player.name} desconectado de ${game.gameCode} (Estado: ${game.status}). Marcando inactivo.`);
             const wasCurrentPlayer = game.currentPlayerId?.equals(player._id);
             player.isActive = false;
             player.socketId = null;
             await player.save();

             // Notificar a otros sobre la desconexión
             io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });
             // Actualizar lista de jugadores para todos
              const updatedPlayers = await Player.find({ gameId: game._id }).select('_id name turnOrder isActive inventory');
              const playersPublicInfo = updatedPlayers.map(p => ({
                  id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                  mineralCount: p.inventory?.length ?? 0
              }));
              io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });


             // CASO 1: Desconexión durante VOTACIÓN -> Termina juego INMEDIATAMENTE
             if (game.status === 'voting') {
                 console.log(`Desconexión DURANTE VOTACIÓN en ${game.gameCode}. Terminando.`);
                 game.status = 'finished_disconnect_vote';
                 game.currentPrizePot = 0; // Nadie gana
                 await game.save();
                 await broadcastGameOver(game);
                 return; // Importante salir aquí
             }

             // CASO 2: Desconexión durante 'playing' o 'guessing_phase'
             let needsTurnAdvance = false;
             if ((game.status === 'playing' || game.status === 'guessing_phase') && wasCurrentPlayer) {
                  console.log(`disconnect: Era el turno del jugador desconectado ${player.name}. Avanzando turno...`);
                  needsTurnAdvance = true;
             }

             // Comprobar si quedan jugadores activos DESPUÉS de marcarlo inactivo
             const remainingActivePlayersCount = await Player.countDocuments({ gameId: game._id, isActive: true });

             if (remainingActivePlayersCount === 0) {
                 // Si era el último jugador activo
                 console.log(`¡Último jugador ${player.name} desconectado de ${game.gameCode}! Terminando juego.`);
                 if (game.status === 'guessing_phase') {
                      game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
                      if (game.status === 'finished_phase2_loss') game.currentPrizePot = 0;
                 } else {
                      game.status = 'finished_disconnect_game';
                      game.currentPrizePot = 0;
                 }
                 game.currentPlayerId = null;
                 await game.save();
                 await broadcastGameOver(game);

             } else if (needsTurnAdvance) {
                  // Si era su turno y quedan otros, avanzar turno
                  await advanceTurn(game, io);
             } else {
                  // No era su turno, pero quedan otros, solo notificar estado
                  await broadcastGameState(game._id, game.gameCode);
             }

        } else {
             // No se encontró jugador asociado a ese socketId
             // console.log(`disconnect: No se encontró jugador para socket ${socket.id}.`);
        }
    });

});

// --- Función Helper: advanceTurn (ACTUALIZADA) ---
async function advanceTurn(game, ioInstance) {
    if (!game || !game.status || game.status.startsWith('finished')) return; // Guard clause

    const previousPlayerId = game.currentPlayerId; // Quién acaba de pasar/desconectar
    let nextPlayer = null;
    let roundEnded = false; // Flag para Fase 2

    // 1. Encontrar al siguiente jugador activo que pueda jugar
    nextPlayer = await findNextActivePlayer(game);

    // 2. Manejar lógica de Rondas y Fin de Fase 2 (si aplica)
    if (game.status === 'guessing_phase' && previousPlayerId && nextPlayer) {
        // Obtener turnOrder de ambos para detectar fin de ronda
        // Necesitamos leer el jugador anterior de la DB si no lo tenemos poblado
        const previousPlayer = await Player.findById(previousPlayerId).select('turnOrder');
        if (previousPlayer && (nextPlayer.turnOrder <= previousPlayer.turnOrder)) {
            roundEnded = true;
            game.phase2RoundsPlayed += 1;
            console.log(`Fin de Ronda ${game.phase2RoundsPlayed} en Fase 2.`);

            if (game.phase2RoundsPlayed >= PHASE2_TOTAL_ROUNDS) {
                 // Se completaron las 3 rondas, evaluar resultado
                 console.log("Se completaron las 3 rondas de Fase 2. Evaluando...");
                 if (game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES) {
                      console.log(`¡Equipo GANA Fase 2! Aciertos: ${game.phase2CorrectGuessesTotal}`);
                      game.status = 'finished_phase2_win';
                 } else {
                      console.log(`Equipo PIERDE Fase 2. Aciertos: ${game.phase2CorrectGuessesTotal} < ${PHASE2_TARGET_CORRECT_GUESSES}`);
                      game.status = 'finished_phase2_loss';
                      // El premio ya se habrá puesto a 0 al momento de asignar victoria/derrota antes del broadcast
                 }
                 game.currentPlayerId = null; // Fin del juego
                 await game.save();
                 await broadcastGameOver(game);
                 return; // Salir de advanceTurn porque el juego terminó
            }
        }
        // Si el juego continúa en Fase 2, resetear intentos para el siguiente jugador
        if (nextPlayer && !game.status.startsWith('finished')) {
             await Player.findByIdAndUpdate(nextPlayer._id, {
                 phase2GuessAttemptsThisTurn: PHASE2_GUESS_ATTEMPTS_PER_TURN
             });
        }
    }

    // 3. Actualizar turno o terminar si no hay siguiente jugador
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
             // Si estábamos en Fase 2 y se traba, evaluar con los aciertos actuales
              game.status = game.phase2CorrectGuessesTotal >= PHASE2_TARGET_CORRECT_GUESSES ? 'finished_phase2_win' : 'finished_phase2_loss';
         } else if (game.status === 'playing') {
             // Si estábamos en Fase 1 y nadie puede mover
             game.status = 'finished_failure'; // O 'finished_stalemate'
         } else {
              // Si el estado es 'voting' u otro inesperado y no hay siguiente, terminar por desconexión/error
              game.status = 'finished_disconnect_game';
         }
         // Asegurar que el premio sea 0 si no se ganó explícitamente
         if (game.status !== 'finished_phase2_win' && game.status !== 'finished_balance_win') {
             game.currentPrizePot = 0;
         }
         game.currentPlayerId = null;
         await game.save();
         await broadcastGameOver(game);
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