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

// --- Constantes del Juego ---
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'];
const MINERALS_PER_PLAYER_PER_TYPE = 2;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;
const DEFAULT_STARTING_HACKERBYTES = 500; // Valor inicial de Hacker Bytes
const COSTO_ADIVINANZA = 100; // Costo en Hacker Bytes para intentar ganar adivinando
const REWARD_PER_CORRECT_GUESS = 250; // Recompensa extra por cada acierto individual al fallar la adivinanza global
const MAX_GUESS_ATTEMPTS = 2; // Límite de intentos por jugador para la adivinanza que gana el juego
const PREMIO_GORDO_HACKERBYTES = 10000000; // Premio por ganar adivinando todos los pesos

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Genera los pesos secretos y la info inicial (CONFIRMADO: Ya es aleatorio excepto Amarillo=10)
function generateGameSetup() {
    const weights = {};
    let generatedWeights = [];
    const availableWeights = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => i + MIN_WEIGHT);

    // Asegurar que 10 esté disponible si el rango es correcto
    if (!availableWeights.includes(10)) {
         console.warn("generateGameSetup WARN: El rango MIN_WEIGHT-MAX_WEIGHT no incluye 10. Forzando...");
         weights['Amarillo'] = 10; // Forzar si no está
         // No quitar de availableWeights si no estaba
    } else {
         weights['Amarillo'] = 10;
         availableWeights.splice(availableWeights.indexOf(10), 1); // Quitar 10
    }
    generatedWeights.push(10);

    const remainingTypes = MINERAL_TYPES.filter(t => t !== 'Amarillo');
    remainingTypes.forEach(type => {
        if (availableWeights.length === 0) {
             // Si no quedan pesos únicos, repetir uno al azar de los ya generados
             console.warn("generateGameSetup WARN: No quedan pesos únicos disponibles. Repitiendo peso.")
             const randomIndex = Math.floor(Math.random() * generatedWeights.length);
             weights[type] = generatedWeights[randomIndex];
        } else {
            // Asignar un peso único aleatorio de los restantes
            const randomIndex = Math.floor(Math.random() * availableWeights.length);
            const assignedWeight = availableWeights.splice(randomIndex, 1)[0];
            weights[type] = assignedWeight;
            generatedWeights.push(assignedWeight);
        }
    });

    // Calcular el rango del Amarillo
    const sortedUniqueWeights = [...new Set(Object.values(weights))].sort((a, b) => b - a); // Ordenar pesos únicos descendentemente
    const rankOfYellow = sortedUniqueWeights.indexOf(10) + 1; // El índice + 1 es el rango

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
        if (typeof weight !== 'number') { // Sanity check
             console.error(`Error: Peso no encontrado o inválido para el tipo ${type} al crear inventario.`);
             return; // Saltar este tipo si hay error
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

// Determina el siguiente jugador que puede jugar (Función existente, verificar compatibilidad)
async function getNextPlayer(game) {
    if (!game || !game.players || game.players.length === 0) return null;

    let populatedGame = game;
    if (!game.populated('players')) {
         try {
            populatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive canPlaceMinerals inventory'); // Poblar campos necesarios
            if (!populatedGame) throw new Error("Juego no encontrado al repopular");
         } catch (err) {
             console.error("getNextPlayer ERROR: Falló al repopular jugadores:", err);
             return null;
         }
    }

    if (!populatedGame.players) {
        console.error("getNextPlayer DEBUG: No se pudo obtener el juego con jugadores poblados.");
        return null;
    }

    // Asegurarse que los jugadores tengan el estado canPlaceMinerals actualizado
    // Esto debería ocurrir con player.save(), pero podemos re-validar aquí si es necesario
    const activePlayers = populatedGame.players.filter(p => p.isActive);
    for(const p of activePlayers) {
        p.canPlaceMinerals = p.isActive && p.inventory && p.inventory.length >= 2;
        // Podríamos guardar aquí, pero puede ser ineficiente. Mejor confiar en el guardado tras la acción.
    }

    const playersInOrder = activePlayers
        .filter(p => p.turnOrder != null) // Filtrar por si acaso hay datos corruptos
        .sort((a, b) => a.turnOrder - b.turnOrder);

    if (playersInOrder.length === 0) {
        console.log("getNextPlayer: No hay jugadores activos y ordenados.");
        return null;
    }

    const currentPlayerIndex = playersInOrder.findIndex(p => p.turnOrder === populatedGame.currentTurnOrder);

    // Si no se encuentra el índice actual (podría pasar si el jugador actual se desconectó o ya no puede jugar)
    // o si es el inicio (currentTurnOrder es 0 o null), empezamos la búsqueda desde "antes" del primero.
    let searchStartIndex = currentPlayerIndex;
    if (currentPlayerIndex === -1) {
        console.warn(`getNextPlayer WARN: Jugador actual con turnOrder ${populatedGame.currentTurnOrder} no activo/encontrado. Iniciando búsqueda desde el principio.`);
        searchStartIndex = -1; // Empezar búsqueda desde el índice 0 en la próxima iteración
    }

    let attempts = 0;
    let nextPlayerIndex = searchStartIndex;

    while (attempts < playersInOrder.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % playersInOrder.length;
        const nextPlayer = playersInOrder[nextPlayerIndex];

        // Validar si el siguiente jugador puede colocar minerales
        const canNextPlayerPlace = nextPlayer.isActive && nextPlayer.inventory && nextPlayer.inventory.length >= 2;
        console.log(`getNextPlayer DEBUG: Verificando jugador ${nextPlayer?.name} (Turno ${nextPlayer?.turnOrder}), isActive: ${nextPlayer?.isActive}, canPlaceCalculated: ${canNextPlayerPlace}`);

        if (nextPlayer && canNextPlayerPlace) { // Solo avanzar si puede colocar
             console.log(`getNextPlayer: Siguiente turno para Jugador ${nextPlayer.turnOrder} (${nextPlayer.name})`);
             return nextPlayer; // Devuelve el objeto Player completo
        }
        attempts++;
        // Si hemos dado una vuelta completa Y el índice actual era válido, paramos.
        if (currentPlayerIndex !== -1 && nextPlayerIndex === currentPlayerIndex) break;
    }

    console.log("getNextPlayer: No se encontró un siguiente jugador activo que pueda colocar minerales.");
    return null;
}


// Construye el objeto gameState para enviar a UN jugador específico (ACTUALIZADO)
async function getGameStateForPlayer(gameId, playerId) {
    try {
        const game = await Game.findById(gameId)
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id'); // Poblar referencias clave

        // Obtener todos los jugadores de una vez con los campos necesarios
        // Incluir 'hackerBytes' y 'totalGuessAttemptsMade'
        const playersInGame = await Player.find({ gameId: gameId }).select(
            'name turnOrder isActive canPlaceMinerals canGuess inventory hackerBytes totalGuessAttemptsMade _id socketId'
        );

        if (!game || !playersInGame || playersInGame.length === 0) {
            console.error(`getGameStateForPlayer ERROR: No se encontró Game ${gameId} o jugadores.`);
            return null;
        }

        // Encontrar al jugador específico para quien es este estado
        const player = playersInGame.find(p => p._id.equals(playerId));
        if (!player) {
             console.error(`getGameStateForPlayer ERROR: Jugador ${playerId} no encontrado en la lista del juego ${gameId}`);
             return null;
        }

        console.log(`getGameStateForPlayer DEBUG: Construyendo estado para ${player.name} (${playerId}). CurrentPlayer en Game obj: ${game.currentPlayerId?._id} (Name: ${game.currentPlayerId?.name}, Turn: ${game.currentPlayerId?.turnOrder})`);

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id);
        console.log(`getGameStateForPlayer DEBUG: isPlayerTurn para ${player.name}: ${isPlayerTurn}`);

        const inventoryExists = Array.isArray(player.inventory);
        const hasMinMineralsForGuess = inventoryExists && player.inventory.length >= 1;
        const canAffordGuess = typeof player.hackerBytes === 'number' && player.hackerBytes >= COSTO_ADIVINANZA;
        const mainScaleBalanced = game.isMainScaleBalanced();
        const attemptsLeft = player.totalGuessAttemptsMade < MAX_GUESS_ATTEMPTS;

        // Lógica DE SI PUEDE INTENTAR ADIVINAR *AHORA MISMO*
        const playerCanCurrentlyGuess = player.isActive &&
                                        hasMinMineralsForGuess &&
                                        canAffordGuess &&
                                        mainScaleBalanced && // Requiere balanza equilibrada
                                        game.status === 'playing' &&
                                        isPlayerTurn && // Debe ser su turno
                                        attemptsLeft; // Debe tener intentos restantes

        // Crear la información pública (sin pesos de inventario)
        const playersPublicInfo = playersInGame.map(p => ({
             id: p._id,
             name: p.name,
             turnOrder: p.turnOrder,
             mineralCount: p.inventory?.length ?? 0, // Contar minerales
             isActive: p.isActive,
             canPlaceMinerals: p.canPlaceMinerals, // Estado general
             canGuess: p.canGuess // Estado general (basado en hook pre-save)
        }));

        const gameStateToSend = {
            gameId: game._id,
            gameCode: game.gameCode,
            status: game.status,
            isMainScaleBalanced: mainScaleBalanced, // Estado actual de la balanza
            knownMineralInfo: game.knownMineralInfo,
            // IMPORTANTE: Filtrar pesos de los materiales en las balanzas antes de enviar
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
            myTurn: isPlayerTurn,
            myPlayerId: player._id,
            // IMPORTANTE: Filtrar peso del inventario antes de enviar
            myInventory: player.inventory ? player.inventory.map(({ instanceId, type }) => ({ instanceId, type })) : [],
            myHackerBytes: player.hackerBytes, // <--- Enviar Hacker Bytes
            myGuessAttemptsLeft: Math.max(0, MAX_GUESS_ATTEMPTS - player.totalGuessAttemptsMade), // <--- Enviar intentos restantes
            iCanPlaceMinerals: player.canPlaceMinerals, // Estado general
            iCanGuess: playerCanCurrentlyGuess, // Estado específico para AHORA
            playersPublicInfo: playersPublicInfo,
            successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
            // Enviar el objeto completo de lastGuessResult si existe
            lastGuessResult: game.lastGuessResult ? {
                playerId: game.lastGuessResult.playerId,
                correct: game.lastGuessResult.correct,
                timestamp: game.lastGuessResult.timestamp,
                rewardGranted: game.lastGuessResult.rewardGranted,
                correctCount: game.lastGuessResult.correctCount
            } : null,
        };

        return gameStateToSend;

    } catch (error) {
        console.error(`getGameStateForPlayer ERROR para game ${gameId}, player ${playerId}:`, error);
        return null;
    }
}

// Emite el estado actualizado a todos los jugadores en la sala (Sin cambios necesarios aquí)
async function broadcastGameState(gameId, gameCode) {
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive'); // Necesitamos socketId
    if (!game) {
         console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado para transmitir.`);
         return;
    }

    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);

    for (const playerRef of game.players) {
        if (playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) {
                 // console.log(`broadcastGameState DEBUG: Enviando estado a ${playerRef._id} (socket ${playerRef.socketId}). myTurn flag: ${gameState.myTurn}`);
                 io.to(playerRef.socketId).emit('gameStateUpdated', { gameState });
            } else {
                 console.warn(`broadcastGameState WARN: No se pudo generar gameState para jugador activo ${playerRef._id} en juego ${gameCode}`);
            }
        } else {
             // console.log(`broadcastGameState INFO: Omitiendo broadcast para Jugador ${playerRef._id} (Socket: ${playerRef.socketId}, Active: ${playerRef.isActive})`);
        }
    }
}

// Emite el evento de fin de juego a todos (ACTUALIZADO para emitir jackpot)
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id)
                                    .populate('players', 'socketId _id isActive')
                                    .populate('successfulGuesser', '_id'); // Poblar ganador si existe
    if (!populatedGame) {
         console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado para transmitir fin.`);
         return;
    }

     // Emitir evento especial al ganador SI ganó por adivinanza ANTES de gameOver
     if (populatedGame.status === 'finished_success' && populatedGame.successfulGuesser) {
          const winnerPlayer = populatedGame.players.find(p => p._id.equals(populatedGame.successfulGuesser._id));
          if (winnerPlayer && winnerPlayer.socketId) {
              console.log(`broadcastGameOver: Emitiendo 'jackpotWin' a ${winnerPlayer._id}`);
              io.to(winnerPlayer.socketId).emit('jackpotWin');
          }
     }

     // Esperar un instante para que la animación del jackpot pueda empezar antes del cambio de pantalla
     await new Promise(resolve => setTimeout(resolve, 100)); // Pequeña pausa (100ms)

     // Enviar estado final y pesos a todos
     for (const playerRef of populatedGame.players) {
        if (playerRef.socketId) {
            const finalGameState = await getGameStateForPlayer(game._id, playerRef._id);
             if (finalGameState) {
                // console.log(`broadcastGameOver DEBUG: Sending final state to ${playerRef._id}. Winner: ${finalGameState?.successfulGuesser?.name}. Status: ${finalGameState?.status}`);
                io.to(playerRef.socketId).emit('gameOver', {
                     gameState: finalGameState,
                     actualWeights: populatedGame.actualMineralWeights // Enviar pesos reales AL FINAL
                 });
             } else {
                 console.warn(`broadcastGameOver WARN: No se pudo generar estado final para ${playerRef._id}`);
             }
        } else {
             // console.log(`broadcastGameOver INFO: Omitiendo broadcast final para Jugador ${playerRef._id} (sin socketId)`);
        }
     }
}

// --- Lógica de Socket.IO ---
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Crear Juego
    socket.on('createGame', async ({ hostName }, callback) => {
        // (Misma lógica que antes, pero asegurar que el default de hackerBytes se aplique)
        try {
            const gameCode = generateGameCode();
            const { weights, knownInfo } = generateGameSetup();

            const host = new Player({
                socketId: socket.id,
                name: hostName,
                turnOrder: 1,
                inventory: createPlayerInventory(weights),
                hackerBytes: DEFAULT_STARTING_HACKERBYTES // <--- Asignar valor inicial
                // gameId se asignará después
            });

            const game = new Game({
                gameCode,
                hostId: host._id,
                players: [host._id],
                actualMineralWeights: weights,
                knownMineralInfo: knownInfo,
                mainScale: { leftWeight: 0, rightWeight: 0, leftMaterials: [], rightMaterials: [] },
                secondaryScale: { leftWeight: 0, rightWeight: 0, leftMaterials: [], rightMaterials: [] },
                status: 'waiting',
                lastGuessResult: null // Asegurar que inicia nulo
            });

            await game.save();
            host.gameId = game._id; // Asignar ID del juego guardado
            await host.save(); // Guardar host con gameId

            socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}). Host unido a la sala.`);

            // Enviar callback ANTES de emitir el estado inicial
            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });

            // Enviar estado inicial al host
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) {
                socket.emit('gameStateUpdated', { gameState: hostGameState });
            } else {
                 socket.emit('error', { message: 'Error al generar el estado inicial del juego.' });
            }

        } catch (error) {
            console.error("Error detallado creando juego:", error);
            let errorMessage = "Error interno al crear el juego.";
             if (error.name === 'ValidationError') {
                 const fields = Object.keys(error.errors).join(', ');
                 errorMessage = `Error de validación en los campos: ${fields}. Mensaje: ${error.message}`;
             } else if (error.code === 11000) {
                 errorMessage = "Error al generar código único o nombre duplicado, intenta de nuevo.";
             }
            callback({ success: false, message: errorMessage });
        }
    });


    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        // (Misma lógica que antes, pero asignar hackerBytes iniciales)
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name');
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó o terminó." });

            const nameExists = game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
            if (nameExists) return callback({ success: false, message: "Ese nombre ya está en uso en esta partida." });

            const turnOrder = game.players.length + 1;
            const player = new Player({
                socketId: socket.id,
                name: playerName,
                gameId: game._id,
                turnOrder: turnOrder,
                inventory: createPlayerInventory(game.actualMineralWeights),
                hackerBytes: DEFAULT_STARTING_HACKERBYTES // <--- Asignar valor inicial
            });
            await player.save();

            game.players.push(player._id);
            await game.save();

            socket.join(gameCode);
            console.log(`${playerName} (Turno ${turnOrder}) se unió a ${gameCode}`);

             // Notificar a todos lista actualizada (mejorada para incluir count)
             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
             const playersPublicInfoPromises = updatedGame.players.map(async p => {
                 const pData = await Player.findById(p._id).select('inventory');
                 return {
                     id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                     mineralCount: pData?.inventory?.length ?? p.inventory?.length ?? 0 // Usar inventario del jugador individual
                  };
              });
             const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
             io.to(gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });

             // Enviar confirmación al jugador que se unió
             callback({ success: true, gameId: game._id, playerId: player._id, playerCount: turnOrder });

             // Enviar estado inicial al jugador que se unió
             const playerGameState = await getGameStateForPlayer(game._id, player._id);
              if (playerGameState) {
                   socket.emit('gameStateUpdated', { gameState: playerGameState });
              } else {
                  console.error(`joinGame ERROR: No se pudo generar estado para el nuevo jugador ${playerName}`);
              }

        } catch (error) {
            console.error("Error uniéndose al juego:", error);
            callback({ success: false, message: "Error interno al unirse al juego." });
        }
    });

    // Iniciar Juego (Host)
    socket.on('startGame', async ({ gameId }) => {
        // (Misma lógica que antes, funciona bien)
         try {
            const game = await Game.findById(gameId);
            if (!game) return socket.emit('error', { message: "Juego no encontrado." });

            const playerRequesting = await Player.findOne({ socketId: socket.id, gameId: gameId });
            if (!playerRequesting || !game.hostId.equals(playerRequesting._id)) {
                 return socket.emit('error', { message: "Solo el host puede iniciar el juego." });
            }
            if (game.status !== 'waiting') {
                 if (game.status === 'playing') {
                      const currentState = await getGameStateForPlayer(game._id, playerRequesting._id);
                      if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
                 } else {
                     socket.emit('error', { message: `El juego ya está ${game.status}.` });
                 }
                 return;
            }
             if (game.players.length < 2) {
                  return socket.emit('error', { message: "Se necesitan al menos 2 jugadores para iniciar." });
             }

            const firstPlayer = await Player.findOne({ gameId: game._id, turnOrder: 1 });
            if (!firstPlayer) {
                console.error(`startGame CRITICAL ERROR: ¡No se encontró jugador con turno 1! gameId: ${game._id}.`);
                 return socket.emit('error', { message: "Error interno crítico: Jugador inicial no encontrado." });
            }

            game.status = 'playing';
            game.currentTurnOrder = 1;
            game.currentPlayerId = firstPlayer._id;
            game.lastGuessResult = null; // Limpiar resultado anterior al iniciar

            await game.save();
            console.log(`startGame: Juego ${game.gameCode} iniciado. Turno para ${firstPlayer.name}.`);
            await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error(`Error iniciando juego ${gameId}:`, error);
            socket.emit('error', { message: `Error interno al iniciar el juego: ${error.message}` });
        }
    });

    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
        // (Lógica existente funciona, pero asegurar que getNextPlayer es robusto)
         try {
            const game = await Game.findById(gameId);
             const player = await Player.findById(playerId).select('+inventory'); // Asegurar inventario cargado

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "El juego no está activo." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales para colocar." });
            if (!Array.isArray(placements) || placements.length < 2) return socket.emit('error', { message: "Debes seleccionar y colocar al menos 2 minerales." });

            const currentInventory = [...player.inventory];
            const mineralsToPlace = [];
            const placedInstanceIds = new Set();

            for (const placement of placements) {
                if (!placement || !placement.mineralInstanceId || !placement.targetScale || !placement.targetSide) throw new Error("Datos de colocación inválidos.");
                if (placedInstanceIds.has(placement.mineralInstanceId)) throw new Error("No puedes colocar el mismo mineral dos veces.");

                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado.`);

                const mineral = currentInventory.splice(mineralIndex, 1)[0];
                mineralsToPlace.push({ mineral, placement });
                placedInstanceIds.add(placement.mineralInstanceId);
            }

            mineralsToPlace.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 if (!scale.leftMaterials) scale.leftMaterials = []; // Inicializar si es null/undefined
                 if (!scale.rightMaterials) scale.rightMaterials = [];
                 scale.leftWeight = scale.leftWeight || 0; // Inicializar si es null/undefined
                 scale.rightWeight = scale.rightWeight || 0;

                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials;
                 const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';

                 // Guardar objeto completo (con peso) en la balanza del servidor
                 sideArray.push({ instanceId: mineral.instanceId, type: mineral.type, weight: mineral.weight });
                 scale[weightProp] += mineral.weight;
            });

            game.markModified('mainScale');
            game.markModified('secondaryScale');

            player.inventory = currentInventory;
            await player.save(); // Guarda inventario y recalcula canPlaceMinerals/canGuess

            const nextPlayer = await getNextPlayer(game);
            if (nextPlayer) {
                game.currentTurnOrder = nextPlayer.turnOrder;
                game.currentPlayerId = nextPlayer._id;
            } else {
                game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure';
                game.currentPlayerId = null;
                game.currentTurnOrder = 0;
            }
            await game.save();

            if (game.status.startsWith('finished')) {
                await broadcastGameOver(game);
            } else {
                await broadcastGameState(game._id, game.gameCode);
            }

        } catch (error) {
            console.error(`Error en placeMinerals para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al colocar minerales: ${error.message || 'Error desconocido.'}` });
             const currentState = await getGameStateForPlayer(gameId, playerId);
             if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
        }
    });

    // Adivinar Pesos (ACTUALIZADO CON NUEVA LÓGICA)
     socket.on('guessWeights', async ({ gameId, playerId, guesses }) => {
       try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            // --- Validaciones Robustas ---
            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no válido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "No se puede adivinar si el juego no está activo." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno para adivinar." });
            if (!game.isMainScaleBalanced()) return socket.emit('error', { message: "La balanza principal debe estar equilibrada para adivinar." });

            // Validar si puede adivinar según su estado general (piezas, minerales, intentos)
             // Recalcular canGuess basado en estado actual por si acaso el pre-save no se ejecutó recientemente
             const canPlayerAfford = player.hackerBytes >= COSTO_ADIVINANZA;
             const hasPlayerAttempts = player.totalGuessAttemptsMade < MAX_GUESS_ATTEMPTS;
             const hasPlayerMinerals = player.inventory && player.inventory.length >= 1;

            if (!(player.isActive && hasPlayerMinerals && canPlayerAfford && hasPlayerAttempts)) {
                 // Dar mensaje específico
                 let reason = "No cumples los requisitos generales para adivinar";
                 if (!canPlayerAfford) reason = `No tienes suficientes Hacker Bytes (Necesitas ${COSTO_ADIVINANZA}).`;
                 else if (!hasPlayerAttempts) reason = "Has agotado tus intentos de adivinanza.";
                 else if (!hasPlayerMinerals) reason = "Necesitas al menos 1 mineral en inventario.";
                 return socket.emit('error', { message: reason });
            }
            // --- Fin Validaciones ---

            // Incrementar intentos AHORA
            player.totalGuessAttemptsMade += 1;
            // Cobrar costo AHORA
            player.hackerBytes -= COSTO_ADIVINANZA;

            // Verificar la adivinanza completa
            let allCorrect = true;
            let correctIndividualGuesses = 0;
            for (const type of MINERAL_TYPES) {
                // Validar que el tipo existe y el valor es un número
                const guessValue = guesses ? guesses[type] : undefined; // Manejar guesses nulo
                const actualValue = game.actualMineralWeights ? game.actualMineralWeights[type] : undefined;

                if (typeof guessValue !== 'number' || typeof actualValue === 'undefined') {
                     console.warn(`guessWeights WARN: Adivinanza inválida o peso real faltante para ${type}. Guess: ${guessValue}, Actual: ${actualValue}`);
                     allCorrect = false;
                     // No contar como correcto si falta el dato real o la adivinanza es inválida
                 } else if (actualValue === guessValue) {
                     correctIndividualGuesses++;
                 } else {
                     allCorrect = false;
                     // console.log(`guessWeights DEBUG: Fallo en ${type}. Adivinado: ${guessValue}, Real: ${actualValue}`);
                 }
            }

            // Calcular recompensa extra (solo si la adivinanza global falló)
            let extraReward = 0;
            if (!allCorrect && correctIndividualGuesses > 0) {
                 extraReward = correctIndividualGuesses * REWARD_PER_CORRECT_GUESS;
                 player.hackerBytes += extraReward; // Añadir premio extra
                 console.log(`${player.name} acertó ${correctIndividualGuesses} pesos. Ganó ${extraReward} HB extra.`);
            }

             // Registrar el resultado completo del intento
             game.lastGuessResult = {
                 playerId: player._id,
                 correct: allCorrect,
                 timestamp: new Date(),
                 rewardGranted: extraReward,
                 correctCount: correctIndividualGuesses
             };

             // GUARDAR jugador CONteo de intentos, costo y posible premio extra ANTES de decidir el flujo
             await player.save();

             // --- Flujo del Juego ---
             if (allCorrect) {
                 // ¡VICTORIA POR ADIVINANZA!
                 player.hackerBytes += PREMIO_GORDO_HACKERBYTES; // Añadir premio gordo
                 game.successfulGuesser = player._id;
                 game.status = 'finished_success';
                 game.currentPlayerId = null; // Nadie más juega
                 game.currentTurnOrder = 0;
                 await player.save(); // Guardar jugador CON premio gordo
                 await game.save(); // Guardar estado final del juego
                 console.log(`¡${player.name} adivinó correctamente! Ganó ${PREMIO_GORDO_HACKERBYTES} Hacker Bytes. Juego ${game.gameCode} terminado.`);
                 // Transmitir Jackpot y Game Over (broadcastGameOver se encarga de ambos)
                 await broadcastGameOver(game);

             } else {
                 // ADIVINANZA INCORRECTA
                 console.log(`${player.name} falló la adivinanza global en ${game.gameCode}.`);
                 // Avanzar al siguiente jugador
                 const nextPlayer = await getNextPlayer(game);
                 if (nextPlayer) {
                     game.currentTurnOrder = nextPlayer.turnOrder;
                     game.currentPlayerId = nextPlayer._id;
                 } else {
                     // Nadie más puede jugar -> Fin por fallo
                     game.status = 'finished_failure';
                     game.currentPlayerId = null;
                     game.currentTurnOrder = 0;
                 }
                 await game.save(); // Guardar cambio de turno/estado

                 // Transmitir estado actualizado o fin del juego
                  if (game.status.startsWith('finished')) {
                     await broadcastGameOver(game);
                 } else {
                     await broadcastGameState(game._id, game.gameCode); // Notificar el fallo, premio extra y siguiente turno
                 }
             }

       } catch(error) {
            console.error(`Error en guessWeights para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al procesar adivinanza: ${error.message || 'Error desconocido.'}` });
             // Intentar revertir el intento y costo si falla catastróficamente? (Complejo)
             // Por ahora, solo retransmitir el estado que el jugador tenía antes del error
             try {
                const currentState = await getGameStateForPlayer(gameId, playerId);
                if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
             } catch(broadcastError) {
                 console.error("Error anidado al intentar retransmitir estado tras error en guessWeights:", broadcastError);
             }
       }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        // (Lógica existente parece correcta, asegurar que getNextPlayer y broadcast funcionen)
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });

        if (player && player.gameId) {
             const game = await Game.findById(player.gameId);
             if (game && (game.status === 'playing' || game.status === 'waiting')) {
                 console.log(`Jugador ${player.name} desconectado de ${game.gameCode}. Marcando inactivo.`);
                 player.isActive = false;
                 player.socketId = null;
                 await player.save();

                  io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });

                  // Actualizar lista para todos (reutilizando la lógica de joinGame)
                   const updatedGameInfo = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
                    if (updatedGameInfo) {
                       const playersPublicInfoPromises = updatedGameInfo.players.map(async p => {
                            // Contar minerales directamente del jugador en la lista si está poblado
                            const pData = await Player.findById(p._id).select('inventory'); // O usar p.inventory si está poblado
                            return {
                                id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                                mineralCount: pData?.inventory?.length ?? p.inventory?.length ?? 0
                            };
                       });
                       const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
                       io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
                    }


                 if (game.status === 'playing' && game.currentPlayerId?.equals(player._id)) {
                    console.log(`disconnect: Era el turno del jugador desconectado ${player.name}. Avanzando...`);
                    const nextPlayer = await getNextPlayer(game);
                     if (nextPlayer) {
                         game.currentTurnOrder = nextPlayer.turnOrder;
                         game.currentPlayerId = nextPlayer._id;
                     } else {
                          game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure';
                          game.currentPlayerId = null;
                          game.currentTurnOrder = 0;
                     }
                     await game.save();

                     if (game.status.startsWith('finished')) {
                        await broadcastGameOver(game);
                     } else {
                         await broadcastGameState(game._id, game.gameCode);
                     }
                 } else if (game.status === 'playing') {
                      // No era su turno, pero retransmitir para mostrar inactividad
                      await broadcastGameState(game._id, game.gameCode);
                 }

             } else if (player) {
                 player.socketId = null; // Limpiar socket aunque juego no esté activo
                 await player.save();
             }
        } else {
            // console.log(`disconnect: No se encontró jugador para socket ${socket.id}.`);
        }
    });

});

// --- Rutas API (Opcional, mantenidas como estaban) ---
// const apiRoutes = require('./routes/api');
// app.use('/api', apiRoutes);

// --- Servir Frontend ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor 'Juego de Escala - HackerBytes Edition' iniciado en puerto ${PORT}`);
});