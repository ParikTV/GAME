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
// const TURN_DURATION_MS = 5 * 60 * 1000; // 5 minutos (Manejar timer en cliente?)

// --- Funciones de Utilidad del Servidor ---

function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Genera los pesos secretos y la info inicial
function generateGameSetup() {
    const weights = {};
    let generatedWeights = [];
    const availableWeights = Array.from({ length: MAX_WEIGHT - MIN_WEIGHT + 1 }, (_, i) => i + MIN_WEIGHT);

    if (!availableWeights.includes(10)) console.warn("El rango 1-20 no incluye 10?");

    weights['Amarillo'] = 10;
    availableWeights.splice(availableWeights.indexOf(10), 1);
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

    const sortedWeights = [...generatedWeights].sort((a, b) => b - a);
    const rankOfYellow = sortedWeights.indexOf(10) + 1;

    const knownInfo = {
        type: 'Amarillo',
        weight: 10,
        description: `El mineral Amarillo pesa 10g (es el ${rankOfYellow}º más pesado).`
    };

    console.log("Pesos Secretos Generados:", weights);
    console.log("Info Conocida Inicial:", knownInfo);
    return { weights, knownInfo };
}

// Crea el inventario para un jugador
function createPlayerInventory(actualWeights) {
    const inventory = [];
    MINERAL_TYPES.forEach(type => {
        const weight = actualWeights[type];
        for (let i = 0; i < MINERALS_PER_PLAYER_PER_TYPE; i++) {
            inventory.push({
                instanceId: uuidv4(),
                type: type,
                weight: weight
            });
        }
    });
    return inventory;
}

// Determina el siguiente jugador que puede jugar
async function getNextPlayer(game) {
    if (!game || !game.players || game.players.length === 0) return null;

    // Asegurarse de que los jugadores están poblados correctamente para acceder a sus propiedades
    // Si game.players ya tiene los objetos Player completos, no hace falta repopular
    // Si game.players solo tiene IDs, necesitas poblar:
    let populatedGame = game;
    if (!game.populated('players')) {
        populatedGame = await Game.findById(game._id).populate('players').exec();
    }

    if (!populatedGame || !populatedGame.players) {
        console.error("getNextPlayer DEBUG: No se pudo obtener el juego con jugadores poblados.");
        return null;
    }

    const playersInOrder = populatedGame.players.sort((a, b) => a.turnOrder - b.turnOrder);
    const currentPlayerIndex = playersInOrder.findIndex(p => p.turnOrder === populatedGame.currentTurnOrder);

    if (currentPlayerIndex === -1) {
      console.error(`getNextPlayer DEBUG: Jugador actual con turnOrder ${populatedGame.currentTurnOrder} no encontrado en la lista ordenada.`);
      // Intenta buscar por ID si el turnOrder falló
      const fallbackIndex = playersInOrder.findIndex(p => p._id.equals(populatedGame.currentPlayerId));
       if (fallbackIndex === -1) {
            console.error(`getNextPlayer DEBUG: Fallback por ID (${populatedGame.currentPlayerId}) también falló.`);
            return null; // No se puede determinar el jugador actual
       }
       // Si encontramos por ID, usamos ese índice, pero esto indica un posible problema de sincronización de turnOrder
       console.warn(`getNextPlayer WARN: Jugador actual encontrado por ID pero no por turnOrder ${populatedGame.currentTurnOrder}. Usando índice ${fallbackIndex}.`);
       // currentPlayerIndex = fallbackIndex; // Descomentar si quieres proceder con el índice encontrado por ID
       return null; // Es más seguro detenerse si hay inconsistencia
    }

    let attempts = 0;
    let nextPlayerIndex = currentPlayerIndex;

    while (attempts < playersInOrder.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % playersInOrder.length;
        const nextPlayer = playersInOrder[nextPlayerIndex];

        console.log(`getNextPlayer DEBUG: Verificando jugador ${nextPlayer?.name} (Turno ${nextPlayer?.turnOrder}), isActive: ${nextPlayer?.isActive}, canPlace: ${nextPlayer?.canPlaceMinerals}`);

        // Asegúrate que el jugador exista y pueda jugar
        if (nextPlayer && nextPlayer.isActive && nextPlayer.canPlaceMinerals) {
             console.log(`getNextPlayer: Siguiente turno para Jugador ${nextPlayer.turnOrder} (${nextPlayer.name})`);
             return nextPlayer; // Devuelve el objeto Player completo
        }
        attempts++;
        // Si hemos dado una vuelta completa, paramos
        if (nextPlayerIndex === currentPlayerIndex) break;
    }

    console.log("getNextPlayer: No se encontró un siguiente jugador activo que pueda colocar minerales.");
    return null;
}

// Construye el objeto gameState para enviar a UN jugador específico
async function getGameStateForPlayer(gameId, playerId) {
    try {
        // Poblar jugadores con los campos necesarios explícitamente
        const game = await Game.findById(gameId)
            .populate({
                path: 'players',
                select: 'name turnOrder isActive canPlaceMinerals canGuess pieces _id socketId' // Asegurar campos necesarios
            })
            .populate('currentPlayerId', 'name turnOrder _id')
            .populate('successfulGuesser', 'name _id');

        // Obtenemos el jugador específico CON su inventario
        const player = await Player.findById(playerId).select('+inventory'); // Forzar inclusión de inventario

        if (!game || !player) {
            console.error(`getGameStateForPlayer ERROR: No se encontró Game ${gameId} o Player ${playerId}`);
            return null;
        }

        console.log(`getGameStateForPlayer DEBUG: Construyendo estado para ${player.name} (${playerId}). CurrentPlayer en Game obj: ${game.currentPlayerId?._id} (Name: ${game.currentPlayerId?.name}, Turn: ${game.currentPlayerId?.turnOrder})`);

        const isPlayerTurn = !!game.currentPlayerId && game.currentPlayerId._id.equals(player._id); // Método seguro para comparar ObjectIds
        console.log(`getGameStateForPlayer DEBUG: isPlayerTurn para ${player.name}: ${isPlayerTurn}`);

        const inventoryExists = Array.isArray(player.inventory);
        const hasMinMineralsForGuess = inventoryExists && player.inventory.length >= 1;
        const canAffordGuess = typeof player.pieces === 'number' && player.pieces >= 1;
        const mainScaleBalanced = game.isMainScaleBalanced();

        // Refinar lógica de iCanGuess para el estado
        const playerCanCurrentlyGuess = player.isActive &&
                                        hasMinMineralsForGuess &&
                                        canAffordGuess &&
                                        mainScaleBalanced &&
                                        game.status === 'playing' &&
                                        isPlayerTurn;

        // Obtener la cuenta de minerales para todos los jugadores (más eficiente)
        const playersPublicInfo = await Promise.all(game.players.map(async p => {
             // Re-obtener el jugador si es necesario para la cuenta de inventario actualizada
             // O asumir que la población inicial es suficiente si no hay cambios drásticos entre llamadas
            const pData = await Player.findById(p._id).select('inventory'); // O usar p.inventory si ya está poblado y actualizado
             return {
                 id: p._id,
                 name: p.name,
                 turnOrder: p.turnOrder,
                 mineralCount: pData?.inventory?.length ?? p.inventory?.length ?? 0, // Usar inventario poblado o re-leído
                 isActive: p.isActive,
                 canPlaceMinerals: p.canPlaceMinerals,
                 canGuess: p.canGuess // Este 'canGuess' es el general, no el específico del turno actual
             };
        }));


        const gameStateToSend = {
            gameId: game._id,
            gameCode: game.gameCode,
            status: game.status,
            isMainScaleBalanced: mainScaleBalanced,
            knownMineralInfo: game.knownMineralInfo,
            mainScale: game.mainScale,
            secondaryScale: game.secondaryScale,
            currentTurnOrder: game.currentTurnOrder,
            currentPlayer: game.currentPlayerId ? { id: game.currentPlayerId._id, name: game.currentPlayerId.name, turnOrder: game.currentPlayerId.turnOrder } : null,
            myTurn: isPlayerTurn,
            myPlayerId: player._id,
            myInventory: player.inventory, // Enviar inventario completo
            myPieces: player.pieces,
            iCanPlaceMinerals: player.canPlaceMinerals, // Estado general del jugador
            iCanGuess: playerCanCurrentlyGuess, // Estado específico de si puede adivinar AHORA
            playersPublicInfo: playersPublicInfo,
            successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
            lastGuessResult: game.lastGuessResult
        };

        // Log detallado del estado ANTES de enviarlo
        // console.log(`getGameStateForPlayer DEBUG: Estado final para ${player.name}:`, JSON.stringify(gameStateToSend, null, 2));

        return gameStateToSend;

    } catch (error) {
        console.error(`getGameStateForPlayer ERROR para game ${gameId}, player ${playerId}:`, error);
        return null;
    }
}


// Emite el estado actualizado a todos los jugadores en la sala
async function broadcastGameState(gameId, gameCode) {
    // Obtener el juego con los socketIds actuales de los jugadores
    const game = await Game.findById(gameId).populate('players', 'socketId _id isActive');
    if (!game) {
         console.error(`broadcastGameState ERROR: Juego ${gameId} no encontrado para transmitir.`);
         return;
    }

    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}. CurrentPlayerId: ${game.currentPlayerId}`);

    for (const playerRef of game.players) {
        // Solo intentar enviar a jugadores activos con socketId
        if (playerRef.isActive && playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) {
                 console.log(`broadcastGameState DEBUG: Enviando estado a ${playerRef._id} (socket ${playerRef.socketId}). CurrentPlayer en estado: ${gameState.currentPlayer?.id} (${gameState.currentPlayer?.name}) | myTurn flag: ${gameState.myTurn}`);
                 io.to(playerRef.socketId).emit('gameStateUpdated', { gameState });
            } else {
                 console.warn(`broadcastGameState WARN: No se pudo generar gameState para jugador activo ${playerRef._id} en juego ${gameCode}`);
            }
        } else {
             console.log(`broadcastGameState INFO: Omitiendo broadcast para Jugador ${playerRef._id} (Socket: ${playerRef.socketId}, Active: ${playerRef.isActive})`);
        }
    }
}

// Emite el evento de fin de juego a todos
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    // Poblar con socketId para saber a quién enviar
    const populatedGame = await Game.findById(game._id).populate('players', 'socketId _id isActive');
    if (!populatedGame) {
         console.error(`broadcastGameOver ERROR: Juego ${game._id} no encontrado para transmitir fin.`);
         return;
    }

     for (const playerRef of populatedGame.players) {
        // Enviar incluso a inactivos para que vean el resultado final si siguen conectados
        if (playerRef.socketId) {
            // Generar el estado final como lo vería ese jugador
            const finalGameState = await getGameStateForPlayer(game._id, playerRef._id);
             if (finalGameState) {
                console.log(`broadcastGameOver DEBUG: Sending final state to ${playerRef._id} (socket ${playerRef.socketId}). Winner: ${finalGameState?.successfulGuesser?.name}. Status: ${finalGameState?.status}`);
                io.to(playerRef.socketId).emit('gameOver', {
                     gameState: finalGameState,
                     actualWeights: game.actualMineralWeights // Enviar pesos reales
                 });
             } else {
                 console.warn(`broadcastGameOver WARN: No se pudo generar estado final para ${playerRef._id}`);
             }
        } else {
             console.log(`broadcastGameOver INFO: Omitiendo broadcast final para Jugador ${playerRef._id} (sin socketId)`);
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

            // 1. Crear objeto Host en memoria (SIN gameId inicial)
            const host = new Player({
                socketId: socket.id,
                name: hostName,
                turnOrder: 1,
                inventory: createPlayerInventory(weights)
                // gameId se asignará después de crear el juego
            });
            // ¡NO guardes el host todavía!

            // 2. Crear objeto Game, referenciando el _id del host en memoria
            const game = new Game({
                gameCode,
                hostId: host._id, // Usar el _id generado por Mongoose para el host
                players: [host._id], // Añadir referencia al host
                actualMineralWeights: weights,
                knownMineralInfo: knownInfo,
                mainScale: { leftWeight: 0, rightWeight: 0, leftMaterials: [], rightMaterials: [] },
                secondaryScale: { leftWeight: 0, rightWeight: 0, leftMaterials: [], rightMaterials: [] },
                status: 'waiting'
            });

            // 3. Guardar el Juego PRIMERO para obtener su _id
            await game.save();
            console.log(`createGame DEBUG: Juego guardado con ID: ${game._id}`);

            // 4. Asignar el game._id al host (que aún está en memoria)
            host.gameId = game._id;
            console.log(`createGame DEBUG: Asignado gameId ${game._id} al Host ${host.name}`);

            // 5. AHORA guardar el Host (ya tiene gameId y pasará la validación)
            await host.save();
            console.log(`createGame DEBUG: Host guardado con ID: ${host._id} y gameId: ${host.gameId}`);

            // 6. Unir al host a la sala y enviar respuesta/estado
            socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id}). Host unido a la sala.`);

            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });

            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            if (hostGameState) {
                console.log(`createGame DEBUG: Enviando estado inicial a host ${host.name}. CurrentPlayer en estado: ${hostGameState.currentPlayer?.id}`);
                socket.emit('gameStateUpdated', { gameState: hostGameState });
            } else {
                 console.error(`createGame ERROR: No se pudo generar estado inicial para el host ${host.name}`);
                 // Considerar notificar al host de un problema
                 socket.emit('error', { message: 'Error al generar el estado inicial del juego.' });
            }

        } catch (error) {
            // Loguear el error completo para diagnóstico
            console.error("Error detallado creando juego:", error);
            let errorMessage = "Error interno al crear el juego.";
            if (error.name === 'ValidationError') {
                 // Formatear mejor el error de validación
                 const fields = Object.keys(error.errors).join(', ');
                 errorMessage = `Error de validación en los campos: ${fields}. Mensaje: ${error.message}`;
            } else if (error.code === 11000) { // Error de duplicado (ej. gameCode)
                 errorMessage = "Error al generar código único o nombre duplicado, intenta de nuevo.";
            }
            callback({ success: false, message: errorMessage });
        }
    });


    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name'); // Poblar para verificar nombre
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó o terminó." });

            // Validar nombre único (case-insensitive)
            const nameExists = game.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
            if (nameExists) return callback({ success: false, message: "Ese nombre ya está en uso en esta partida." });

            const turnOrder = game.players.length + 1;
            const player = new Player({
                socketId: socket.id,
                name: playerName,
                gameId: game._id,
                turnOrder: turnOrder,
                inventory: createPlayerInventory(game.actualMineralWeights) // Dar inventario al unirse
            });
            await player.save();

            // Añadir jugador al juego y guardar
            game.players.push(player._id);
            await game.save();


            socket.join(gameCode); // Unir al jugador a la sala
            console.log(`${playerName} (Turno ${turnOrder}) se unió a ${gameCode}`);

             // Notificar a todos en la sala sobre la lista actualizada de jugadores
             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive'); // Repopular con campos necesarios
             const playersPublicInfoPromises = updatedGame.players.map(async p => {
                 const pData = await Player.findById(p._id).select('inventory');
                 return {
                     id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                     mineralCount: pData?.inventory?.length ?? 0
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
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                console.log(`startGame ABORTED: Juego ${gameId} no encontrado.`);
                return socket.emit('error', { message: "Juego no encontrado." });
            }
            // Verificar si el que envía es el host
            const playerRequesting = await Player.findOne({ socketId: socket.id, gameId: gameId });
            if (!playerRequesting || !game.hostId.equals(playerRequesting._id)) {
                 console.log(`startGame ABORTED: Socket ${socket.id} (Player ${playerRequesting?._id}) no es el host (${game.hostId}) de ${game.gameCode}`);
                 return socket.emit('error', { message: "Solo el host puede iniciar el juego." });
            }

            if (game.status !== 'waiting') {
                console.log(`startGame ABORTED: Juego ${game.gameCode} ya está ${game.status}.`);
                // Podrías enviar un estado actualizado si ya está jugando, o un error si terminó
                if (game.status === 'playing') {
                     const currentState = await getGameStateForPlayer(game._id, playerRequesting._id);
                     if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
                } else {
                    socket.emit('error', { message: `El juego ya está ${game.status}.` });
                }
                return;
            }
             if (game.players.length < 2) {
                  console.log(`startGame ABORTED: Juego ${game.gameCode} tiene ${game.players.length} jugadores, se necesitan 2.`);
                 return socket.emit('error', { message: "Se necesitan al menos 2 jugadores para iniciar." });
             }

            console.log(`startGame: Procesando inicio para ${game.gameCode} por Host ${playerRequesting.name}`);

            // Encontrar al jugador con turnOrder 1 (debería ser el host)
            const firstPlayer = await Player.findOne({ gameId: game._id, turnOrder: 1 });
            if (!firstPlayer) {
                console.error(`startGame CRITICAL ERROR: ¡No se encontró jugador con turno 1! gameId: ${game._id}. Host ID: ${game.hostId}`);
                 // Intentar asignar al host si su turnOrder no es 1 por alguna razón? O fallar.
                return socket.emit('error', { message: "Error interno crítico: Jugador inicial no encontrado." });
            }
            console.log(`startGame: Jugador inicial encontrado: ${firstPlayer.name} (ID: ${firstPlayer._id}, Turno: ${firstPlayer.turnOrder})`);

            // Actualizar estado del juego
            game.status = 'playing';
            game.currentTurnOrder = 1;
            game.currentPlayerId = firstPlayer._id; // Asignar ID del primer jugador

            console.log(`startGame: Asignado currentPlayerId: ${game.currentPlayerId}`);

            await game.save(); // Guardar los cambios

            // **Re-confirmación Opcional (Mayor seguridad contra timing issues)**
            const confirmedGame = await Game.findById(game._id);
            if (!confirmedGame || confirmedGame.status !== 'playing' || !confirmedGame.currentPlayerId?.equals(firstPlayer._id)) {
                 console.error(`startGame ERROR: Falló la confirmación después de guardar! Status: ${confirmedGame?.status}, CurrentPlayer: ${confirmedGame?.currentPlayerId} (Esperado: ${firstPlayer._id})`);
                 // Revertir estado o notificar error grave
                 game.status = 'waiting'; // Intentar revertir
                 game.currentPlayerId = null;
                 game.currentTurnOrder = 0;
                 await game.save();
                 return socket.emit('error', { message: "Error interno crítico al confirmar inicio de turno." });
            }
            // --- Fin Re-confirmación Opcional ---

            console.log(`startGame: Juego ${confirmedGame.gameCode} iniciado correctamente. Turno inicial para ${firstPlayer.name}. CurrentPlayerId: ${confirmedGame.currentPlayerId}`);

            // Transmitir el estado inicial del juego a todos
            await broadcastGameState(confirmedGame._id, confirmedGame.gameCode);

        } catch (error) {
            console.error(`Error iniciando juego ${gameId}:`, error);
            socket.emit('error', { message: `Error interno al iniciar el juego: ${error.message}` });
        }
    });


    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
        try {
            const game = await Game.findById(gameId);
            // Obtener jugador y validar
             const player = await Player.findById(playerId);

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "El juego no está activo." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno." });
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales para colocar (según tu estado)." }); // Validar estado del jugador
            if (!Array.isArray(placements) || placements.length < 2) return socket.emit('error', { message: "Debes seleccionar y colocar al menos 2 minerales." }); // Validar regla

            // Validar que el jugador tiene los minerales que intenta colocar
            const currentInventory = [...player.inventory]; // Copia para trabajar
            const mineralsToPlace = [];
            const placedInstanceIds = new Set(); // Para evitar duplicados en la misma jugada

            for (const placement of placements) {
                if (!placement || !placement.mineralInstanceId || !placement.targetScale || !placement.targetSide) {
                     throw new Error("Datos de colocación inválidos.");
                }
                if (placedInstanceIds.has(placement.mineralInstanceId)) {
                    throw new Error("No puedes colocar el mismo mineral dos veces en una jugada.");
                }

                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) {
                    throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado en tu inventario.`);
                }
                const mineral = currentInventory.splice(mineralIndex, 1)[0]; // Quitar del inventario temporal
                mineralsToPlace.push({ mineral, placement });
                placedInstanceIds.add(placement.mineralInstanceId);
            }

            // Si todas las validaciones pasan, aplicar los cambios al juego
            mineralsToPlace.forEach(({ mineral, placement }) => {
                 const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 // Asegurar que las propiedades de la balanza existan
                 if (!scale.leftMaterials) scale.leftMaterials = [];
                 if (!scale.rightMaterials) scale.rightMaterials = [];
                 if (typeof scale.leftWeight !== 'number') scale.leftWeight = 0;
                 if (typeof scale.rightWeight !== 'number') scale.rightWeight = 0;

                 const sideArray = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials;
                 const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';

                 sideArray.push({ instanceId: mineral.instanceId, type: mineral.type, weight: mineral.weight });
                 scale[weightProp] = (scale[weightProp] || 0) + mineral.weight;
            });

            // Marcar las balanzas como modificadas para Mongoose
            game.markModified('mainScale');
            game.markModified('secondaryScale');

            // Actualizar el inventario real del jugador
            player.inventory = currentInventory;
            await player.save(); // Guarda el inventario actualizado y recalcula canPlaceMinerals/canGuess
            console.log(`placeMinerals: Jugador ${player.name} colocó ${mineralsToPlace.length} minerales. Inventario restante: ${player.inventory.length}. CanPlace: ${player.canPlaceMinerals}`);

            // Determinar el siguiente jugador
            const nextPlayer = await getNextPlayer(game);
            if (nextPlayer) {
                game.currentTurnOrder = nextPlayer.turnOrder;
                game.currentPlayerId = nextPlayer._id;
                console.log(`placeMinerals: Turno avanza a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
            } else {
                // Nadie más puede jugar (o todos están inactivos/sin minerales suficientes)
                console.log("placeMinerals: No se encontró un siguiente jugador válido. Finalizando juego.");
                game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure'; // Mantener éxito si alguien ya adivinó
                game.currentPlayerId = null; // Nadie tiene el turno
                game.currentTurnOrder = 0;
            }
            await game.save(); // Guardar el estado del juego (balanzas, turno)

            // Transmitir el nuevo estado o el fin del juego
            if (game.status.startsWith('finished')) {
                await broadcastGameOver(game);
            } else {
                await broadcastGameState(game._id, game.gameCode);
            }

        } catch (error) {
            console.error(`Error en placeMinerals para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al colocar minerales: ${error.message || 'Error desconocido.'}` });
             // Considerar re-transmitir el estado anterior al jugador si falla, para evitar UI inconsistente
             const currentState = await getGameStateForPlayer(gameId, playerId);
             if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
        }
    });


    // Adivinar Pesos
     socket.on('guessWeights', async ({ gameId, playerId, guesses }) => {
       try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            // Validaciones
            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no válido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "No se puede adivinar si el juego no está activo." });
            if (!game.currentPlayerId?.equals(player._id)) return socket.emit('error', { message: "No es tu turno para adivinar." });
            if (!game.isMainScaleBalanced()) return socket.emit('error', { message: "La balanza principal debe estar equilibrada para adivinar." });
            if (!player.canGuess) return socket.emit('error', { message: "No cumples los requisitos para adivinar (piezas/minerales)." }); // Validar estado general

            // Verificar la adivinanza
            let allCorrect = true;
            for (const type of MINERAL_TYPES) {
                // Asegurarse que el tipo existe en ambos lados y el valor es un número
                 if (typeof guesses[type] !== 'number' || !game.actualMineralWeights.hasOwnProperty(type) || game.actualMineralWeights[type] !== guesses[type]) {
                     allCorrect = false;
                      console.log(`guessWeights DEBUG: Fallo en ${type}. Adivinado: ${guesses[type]}, Real: ${game.actualMineralWeights[type]}`);
                     break;
                 }
            }

             // Registrar el intento
             game.lastGuessResult = { playerId: player._id, correct: allCorrect, timestamp: new Date() };
              // Cobrar la pieza por intentar (siempre que se intente, ¿o solo si falla?) -> Asumamos que siempre cuesta
             if (player.pieces > 0) {
                 player.pieces -= 1;
                 await player.save(); // Guardar cambio de piezas y recalcular canGuess
             } else {
                  console.warn(`guessWeights WARN: Jugador ${player.name} intentó adivinar sin piezas.`);
                 // Podríamos emitir error aquí si la regla es estricta
             }


             if (allCorrect) {
                 // ¡Adivinanza Correcta!
                 game.successfulGuesser = player._id;
                 game.status = 'finished_success';
                 game.currentPlayerId = null; // Nadie más juega
                 game.currentTurnOrder = 0;
                 await game.save();
                 console.log(`¡${player.name} adivinó correctamente! Juego ${game.gameCode} terminado con éxito.`);
                 await broadcastGameOver(game); // Transmitir resultado final
             } else {
                 // Adivinanza Incorrecta
                 console.log(`${player.name} falló la adivinanza en el juego ${game.gameCode}.`);
                 // Avanzar al siguiente jugador
                 const nextPlayer = await getNextPlayer(game);
                 if (nextPlayer) {
                     game.currentTurnOrder = nextPlayer.turnOrder;
                     game.currentPlayerId = nextPlayer._id;
                     console.log(`guessWeights: Turno avanza a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder}) después de fallo.`);
                 } else {
                     // Nadie más puede jugar
                     console.log("guessWeights: Adivinanza incorrecta y nadie más puede jugar. Finalizando juego.");
                     game.status = 'finished_failure'; // Termina sin éxito
                     game.currentPlayerId = null;
                     game.currentTurnOrder = 0;
                 }
                 await game.save(); // Guardar el resultado del intento y el posible cambio de turno/estado

                 // Transmitir estado actualizado o fin del juego
                  if (game.status.startsWith('finished')) {
                     await broadcastGameOver(game);
                 } else {
                     await broadcastGameState(game._id, game.gameCode); // Notificar el fallo y el siguiente turno
                 }
             }

       } catch(error) {
            console.error(`Error en guessWeights para jugador ${playerId}:`, error);
            socket.emit('error', { message: `Error al procesar adivinanza: ${error.message || 'Error desconocido.'}` });
             // Re-transmitir estado?
             const currentState = await getGameStateForPlayer(gameId, playerId);
             if (currentState) socket.emit('gameStateUpdated', { gameState: currentState });
       }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        // Encontrar al jugador asociado a este socket
        const player = await Player.findOne({ socketId: socket.id });

        if (player && player.gameId) {
             const game = await Game.findById(player.gameId);
             // Solo actuar si el juego existe y está en curso o esperando
             if (game && (game.status === 'playing' || game.status === 'waiting')) {
                 console.log(`Jugador ${player.name} (ID: ${player._id}) desconectado del juego ${game.gameCode}. Marcando inactivo.`);
                 player.isActive = false;
                 player.socketId = null; // Limpiar socketId
                 await player.save(); // Guardar estado inactivo

                  // Notificar a los demás jugadores en la sala (si no ha terminado)
                  io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });

                  // Actualizar lista de jugadores para todos en la sala de espera o juego
                   const updatedGameInfo = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
                    if (updatedGameInfo) {
                       const playersPublicInfoPromises = updatedGameInfo.players.map(async p => {
                            const pData = await Player.findById(p._id).select('inventory');
                            return {
                                id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                                mineralCount: pData?.inventory?.length ?? 0
                            };
                       });
                       const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
                       io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length }); // Para sala de espera y sidebar
                    }


                 // Si era el turno del jugador desconectado y el juego estaba en 'playing'
                 if (game.status === 'playing' && game.currentPlayerId?.equals(player._id)) {
                    console.log(`disconnect: Era el turno del jugador desconectado ${player.name}. Avanzando turno...`);
                    const nextPlayer = await getNextPlayer(game); // Buscar siguiente jugador activo
                     if (nextPlayer) {
                         game.currentTurnOrder = nextPlayer.turnOrder;
                         game.currentPlayerId = nextPlayer._id;
                         console.log(`disconnect: Turno avanza a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder}) debido a desconexión.`);
                     } else {
                          // Nadie más puede jugar
                          console.log("disconnect: Nadie más puede jugar después de la desconexión. Finalizando.");
                          game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure';
                          game.currentPlayerId = null;
                          game.currentTurnOrder = 0;
                     }
                     await game.save(); // Guardar cambio de turno/estado

                     // Transmitir el nuevo estado o fin
                     if (game.status.startsWith('finished')) {
                        await broadcastGameOver(game);
                     } else {
                         await broadcastGameState(game._id, game.gameCode);
                     }
                 } else if (game.status === 'playing') {
                     // Si no era su turno, solo retransmitir el estado actual para reflejar la inactividad
                      await broadcastGameState(game._id, game.gameCode);
                 }
                 // Si estaba en 'waiting', la actualización de playerListUpdated es suficiente.

             } else if (player) {
                 // Si el jugador existe pero el juego no está activo/encontrado, solo limpiar socketId
                 player.socketId = null;
                 await player.save();
             }
        } else {
            console.log(`disconnect: No se encontró jugador asociado al socket ${socket.id}.`);
        }
    });

});

// --- Rutas API (Opcional, mantenidas como estaban) ---
// const apiRoutes = require('./routes/api');
// app.use('/api', apiRoutes);

// --- Servir Frontend ---
// Captura todas las demás rutas y sirve el index.html (para SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Iniciar Servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor 'Juego de Escala (DVP V2 - Debug)' iniciado en puerto ${PORT}`);
});