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

    const populatedGame = await Game.findById(game._id).populate('players');
    if (!populatedGame || !populatedGame.players) {
        console.error("getNextPlayer DEBUG: No se pudo popular el juego o los jugadores.");
        return null;
    }

    const currentPlayerIndex = populatedGame.players.findIndex(p => p.turnOrder === populatedGame.currentTurnOrder);

    if (currentPlayerIndex === -1) {
      console.error(`getNextPlayer DEBUG: Jugador actual con turnOrder ${populatedGame.currentTurnOrder} no encontrado en la lista.`);
      return null;
    }

    let attempts = 0;
    let nextPlayerIndex = currentPlayerIndex;

    while (attempts < populatedGame.players.length) {
        nextPlayerIndex = (nextPlayerIndex + 1) % populatedGame.players.length;
        const nextPlayer = populatedGame.players[nextPlayerIndex];

        console.log(`getNextPlayer DEBUG: Verificando jugador ${nextPlayer?.name} (Turno ${nextPlayer?.turnOrder}), isActive: ${nextPlayer?.isActive}, canPlace: ${nextPlayer?.canPlaceMinerals}`);

        if (nextPlayer && nextPlayer.isActive && nextPlayer.canPlaceMinerals) {
             console.log(`getNextPlayer: Siguiente turno para Jugador ${nextPlayer.turnOrder} (${nextPlayer.name})`);
             return nextPlayer; // Devuelve el objeto Player completo
        }
        attempts++;
        if (attempts > 0 && populatedGame.players[nextPlayerIndex].turnOrder === populatedGame.currentTurnOrder) break;
    }

    console.log("getNextPlayer: No se encontró un siguiente jugador activo que pueda colocar minerales.");
    return null;
}

// Construye el objeto gameState para enviar a UN jugador específico (CON SELECT QUITADO PARA TEST)
async function getGameStateForPlayer(gameId, playerId) {
    const game = await Game.findById(gameId)
        .populate({
            path: 'players' // ******** CAMBIO TEMPORAL: SIN SELECT ********
        })
        .populate('currentPlayerId', 'name turnOrder _id')
        .populate('successfulGuesser', 'name _id');

    // Obtenemos el jugador específico CON su inventario
    const player = await Player.findById(playerId).select('+inventory'); // Forzar inclusión de inventario

    if (!game || !player) {
        console.error(`getGameStateForPlayer DEBUG: No se encontró Game ${gameId} o Player ${playerId}`);
        return null;
    }

    console.log(`getGameStateForPlayer DEBUG: Building state for ${player.name}. CurrentPlayer in Game obj: ${game.currentPlayerId?._id} (Name: ${game.currentPlayerId?.name})`);

    const isPlayerTurn = game.currentPlayerId?._id.toString() === playerId.toString();
    const inventoryExists = Array.isArray(player.inventory);
    const canAffordGuess = typeof player.pieces === 'number' && player.pieces >= 1;
    const hasMinMinerals = inventoryExists && player.inventory.length >= 1;

    const playerCanCurrentlyGuess = player.isActive &&
                                    hasMinMinerals &&
                                    canAffordGuess &&
                                    game.isMainScaleBalanced() &&
                                    game.status === 'playing' &&
                                    isPlayerTurn;

    const getMineralCount = async (pId) => {
        const pData = await Player.findById(pId).select('inventory');
        return pData?.inventory?.length ?? 0;
    }

     const playersPublicInfoPromises = game.players.map(async p_ref => {
         const mineralCount = await getMineralCount(p_ref._id);
         return {
             id: p_ref._id,
             name: p_ref.name,
             turnOrder: p_ref.turnOrder,
             mineralCount: mineralCount,
             isActive: p_ref.isActive,
             canPlaceMinerals: p_ref.canPlaceMinerals, // Estos vienen porque quitamos el select
             canGuess: p_ref.canGuess // Estos vienen porque quitamos el select
         }
     });
    const playersPublicInfo = await Promise.all(playersPublicInfoPromises);


    const gameStateToSend = {
        gameId: game._id,
        gameCode: game.gameCode,
        status: game.status,
        isMainScaleBalanced: game.isMainScaleBalanced(),
        knownMineralInfo: game.knownMineralInfo,
        mainScale: game.mainScale,
        secondaryScale: game.secondaryScale,
        currentTurnOrder: game.currentTurnOrder,
        currentPlayer: game.currentPlayerId ? { id: game.currentPlayerId._id, name: game.currentPlayerId.name, turnOrder: game.currentPlayerId.turnOrder } : null,
        myTurn: isPlayerTurn,
        myPlayerId: player._id,
        myInventory: player.inventory,
        myPieces: player.pieces,
        iCanPlaceMinerals: player.canPlaceMinerals,
        iCanGuess: playerCanCurrentlyGuess,
        playersPublicInfo: playersPublicInfo,
        successfulGuesser: game.successfulGuesser ? { id: game.successfulGuesser._id, name: game.successfulGuesser.name } : null,
        lastGuessResult: game.lastGuessResult
    };

    return gameStateToSend;
}

// Emite el estado actualizado a todos los jugadores en la sala
async function broadcastGameState(gameId, gameCode) {
    const game = await Game.findById(gameId).populate('players', 'socketId _id');
    if (!game) return;

    console.log(`Broadcasting state for game ${gameCode}, status: ${game.status}`);

    for (const playerRef of game.players) {
        if (playerRef.socketId) {
            const gameState = await getGameStateForPlayer(gameId, playerRef._id);
            if (gameState) {
                 console.log(`broadcastGameState DEBUG: Sending state to ${playerRef._id} (socket ${playerRef.socketId}). CurrentPlayer in state: ${gameState.currentPlayer?.id}`);
                 io.to(playerRef.socketId).emit('gameStateUpdated', { gameState });
            } else {
                 console.warn(`broadcastGameState WARN: No se pudo generar gameState para ${playerRef._id}`);
            }
        } else {
             console.log(`broadcastGameState INFO: Jugador ${playerRef._id} no tiene socketId activo.`);
        }
    }
}

// Emite el evento de fin de juego a todos
async function broadcastGameOver(game) {
    console.log(`Broadcasting GAME OVER for game ${game.gameCode}, status: ${game.status}`);
    const populatedGame = await Game.findById(game._id).populate('players', 'socketId _id');
    if (!populatedGame) return;

     for (const playerRef of populatedGame.players) {
        if (playerRef.socketId) {
            const finalGameState = await getGameStateForPlayer(game._id, playerRef._id);
            console.log(`broadcastGameOver DEBUG: Sending final state to ${playerRef._id}. Winner: ${finalGameState?.successfulGuesser?.name}. Status: ${finalGameState?.status}`);
            io.to(playerRef.socketId).emit('gameOver', {
                 gameState: finalGameState,
                 actualWeights: game.actualMineralWeights
             });
        }
     }
}


// --- Lógica de Socket.IO ---
io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Crear Juego (Corregido orden de save)
    socket.on('createGame', async ({ hostName }, callback) => {
        try {
            const gameCode = generateGameCode();
            const { weights, knownInfo } = generateGameSetup();

            const host = new Player({
                socketId: socket.id,
                name: hostName,
                turnOrder: 1,
                inventory: createPlayerInventory(weights)
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
                status: 'waiting'
            });

            host.gameId = game._id;

            await host.save();
            console.log(`createGame DEBUG: Host guardado con ID: ${host._id}`);

            await game.save();
            console.log(`createGame DEBUG: Juego guardado con ID: ${game._id} y hostId: ${game.hostId}`);

            socket.join(gameCode);
            console.log(`Juego ${gameCode} creado por Host ${hostName} (${host._id})`);
            console.log(`createGame DEBUG: Host creado con turnOrder: ${host.turnOrder}, ID: ${host._id}, GameID: ${host.gameId}`);

            callback({ success: true, gameId: game._id, playerId: host._id, gameCode });
            const hostGameState = await getGameStateForPlayer(game._id, host._id);
            console.log(`createGame DEBUG: Enviando estado inicial a host. CurrentPlayer en estado: ${hostGameState?.currentPlayer?.id}`);
            socket.emit('gameStateUpdated', { gameState: hostGameState });

        } catch (error) {
            console.error("Error creando juego:", error);
            let errorMessage = "Error interno al crear el juego.";
            if (error.name === 'ValidationError') {
                 errorMessage = `Error de validación al crear juego: ${error.message}`;
            }
            callback({ success: false, message: errorMessage });
        }
    });


    // Unirse a Juego
    socket.on('joinGame', async ({ gameCode, playerName }, callback) => {
        try {
            const game = await Game.findOne({ gameCode }).populate('players', '_id name');
            if (!game) return callback({ success: false, message: "Juego no encontrado." });
            if (game.status !== 'waiting') return callback({ success: false, message: "El juego ya comenzó o terminó." });

            const nameExists = game.players.some(p => p.name === playerName);
            if (nameExists) return callback({ success: false, message: "Ese nombre ya está en uso." });

            const turnOrder = game.players.length + 1;
            const player = new Player({
                socketId: socket.id,
                name: playerName,
                gameId: game._id,
                turnOrder: turnOrder,
                inventory: createPlayerInventory(game.actualMineralWeights)
            });
            await player.save();

            await Game.updateOne({ _id: game._id }, { $push: { players: player._id } });

            socket.join(gameCode);
            console.log(`${playerName} (Turno ${turnOrder}) se unió a ${gameCode}`);

             const updatedGame = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
             const playersPublicInfoPromises = updatedGame.players.map(async p => ({
                 id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                 mineralCount: (await Player.findById(p._id).select('inventory'))?.inventory?.length ?? 0
              }));
             const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
             io.to(gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });


             callback({ success: true, gameId: game._id, playerId: player._id, playerCount: turnOrder });
             const playerGameState = await getGameStateForPlayer(game._id, player._id);
             socket.emit('gameStateUpdated', { gameState: playerGameState });

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
            if (game.status !== 'waiting') {
                console.log(`startGame ABORTED: Juego ${game.gameCode} ya está ${game.status}.`);
                return;
            }
            console.log(`startGame: Procesando inicio para ${game.gameCode}`);

            const firstPlayer = await Player.findOne({ gameId: game._id, turnOrder: 1 });
            if (!firstPlayer) {
                console.error(`startGame ERROR: ¡No se encontró jugador con turno 1! gameId: ${game._id}`);
                const hostPlayer = await Player.findById(game.hostId);
                console.log(`startGame DEBUG: Host (ID ${game.hostId}) encontrado: ${hostPlayer?.name}, turnOrder: ${hostPlayer?.turnOrder}`);
                 if (hostPlayer && hostPlayer.turnOrder !== 1) console.warn(`startGame WARN: Host ${hostPlayer.name} no tiene turnOrder 1, tiene ${hostPlayer.turnOrder}`);
                return socket.emit('error', { message: "Error interno: Jugador inicial (Turno 1) no encontrado." });
            }
            console.log(`startGame: Jugador inicial encontrado: ${firstPlayer.name} (ID: ${firstPlayer._id}, Turno: ${firstPlayer.turnOrder})`);

            game.status = 'playing';
            game.currentTurnOrder = 1;
            game.currentPlayerId = firstPlayer._id;

            console.log(`startGame: Asignado currentPlayerId: ${game.currentPlayerId}`);

            await game.save();

            const savedGame = await Game.findById(game._id);
            console.log(`startGame: currentPlayerId DESPUÉS de save en DB: ${savedGame?.currentPlayerId}`);

            console.log(`Juego ${game.gameCode} iniciado. Turno inicial para ${firstPlayer.name}`);
            await broadcastGameState(game._id, game.gameCode);

        } catch (error) {
            console.error("Error iniciando juego:", error);
            socket.emit('error', { message: "Error interno al iniciar el juego." });
        }
    });


    // Colocar Minerales
    socket.on('placeMinerals', async ({ gameId, playerId, placements }) => {
        try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no encontrado." });
            if (game.status !== 'playing') return socket.emit('error', { message: "El juego no está activo." });
            if (game.currentPlayerId?.toString() !== playerId) return socket.emit('error', { message: "No es tu turno." });
            if (!player.canPlaceMinerals) return socket.emit('error', { message: "No tienes suficientes minerales para colocar." });
            if (!Array.isArray(placements) || placements.length < 2) return socket.emit('error', { message: "Debes colocar al menos 2 minerales." });

            const currentInventory = [...player.inventory];
            const successfullyPlaced = [];

            for (const placement of placements) {
                const mineralIndex = currentInventory.findIndex(m => m.instanceId === placement.mineralInstanceId);
                if (mineralIndex === -1) throw new Error(`Mineral ${placement.mineralInstanceId} no encontrado en inventario de ${player.name}.`);

                const mineral = currentInventory.splice(mineralIndex, 1)[0];

                const scale = placement.targetScale === 'main' ? game.mainScale : game.secondaryScale;
                 if (!scale.leftMaterials) scale.leftMaterials = [];
                 if (!scale.rightMaterials) scale.rightMaterials = [];
                 if (scale.leftWeight === undefined) scale.leftWeight = 0;
                 if (scale.rightWeight === undefined) scale.rightWeight = 0;

                const side = placement.targetSide === 'left' ? scale.leftMaterials : scale.rightMaterials;
                const weightProp = placement.targetSide === 'left' ? 'leftWeight' : 'rightWeight';

                side.push({ instanceId: mineral.instanceId, type: mineral.type, weight: mineral.weight });
                scale[weightProp] = (scale[weightProp] || 0) + mineral.weight;
                successfullyPlaced.push(placement);
            }

             game.markModified('mainScale');
             game.markModified('secondaryScale');

            player.inventory = currentInventory;
            await player.save();
            console.log(`Jugador ${player.name} colocó ${successfullyPlaced.length} minerales.`);

            const nextPlayer = await getNextPlayer(game);
            if (nextPlayer) {
                game.currentTurnOrder = nextPlayer.turnOrder;
                game.currentPlayerId = nextPlayer._id;
                console.log(`Turno avanza a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
            } else {
                console.log("Nadie más puede jugar. Finalizando juego.");
                game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure';
                game.currentPlayerId = null;
            }
            await game.save();

            if (game.status.startsWith('finished')) {
                await broadcastGameOver(game);
            } else {
                await broadcastGameState(game._id, game.gameCode);
            }

        } catch (error) {
            console.error("Error en placeMinerals:", error);
            socket.emit('error', { message: `Error al colocar minerales: ${error.message}` });
        }
    });


    // Adivinar Pesos
     socket.on('guessWeights', async ({ gameId, playerId, guesses }) => {
       try {
            const game = await Game.findById(gameId);
            const player = await Player.findById(playerId);

            if (!game || !player) return socket.emit('error', { message: "Juego o jugador no válido." });
            if (game.status !== 'playing') return socket.emit('error', { message: "No se puede adivinar ahora." });
            if (game.currentPlayerId?.toString() !== playerId) return socket.emit('error', { message: "No es tu turno para adivinar." });
            if (!game.isMainScaleBalanced()) return socket.emit('error', { message: "La balanza principal debe estar equilibrada." });

            let allCorrect = true;
            for (const type of MINERAL_TYPES) {
                 if (typeof guesses[type] !== 'number' || game.actualMineralWeights[type] !== guesses[type]) {
                     allCorrect = false;
                     break;
                 }
            }
             game.lastGuessResult = { playerId: player._id, correct: allCorrect, timestamp: new Date() };

             if (allCorrect) {
                 game.successfulGuesser = player._id;
                 game.status = 'finished_success';
                 game.currentPlayerId = null;
                 await game.save();
                 console.log(`¡${player.name} adivinó correctamente! Juego ${game.gameCode} terminado.`);
                 await broadcastGameOver(game);
             } else {
                 console.log(`${player.name} falló la adivinanza.`);
                  const nextPlayer = await getNextPlayer(game);
                 if (nextPlayer) {
                     game.currentTurnOrder = nextPlayer.turnOrder;
                     game.currentPlayerId = nextPlayer._id;
                     console.log(`Turno avanza a ${nextPlayer.name} (Turno ${nextPlayer.turnOrder})`);
                 } else {
                     console.log("Adivinanza incorrecta y nadie más puede jugar.");
                     game.status = 'finished_failure';
                     game.currentPlayerId = null;
                 }
                 await game.save();

                  if (game.status.startsWith('finished')) {
                     await broadcastGameOver(game);
                 } else {
                     await broadcastGameState(game._id, game.gameCode);
                 }
             }

       } catch(error) {
            console.error("Error en guessWeights:", error);
            socket.emit('error', { message: `Error al procesar adivinanza: ${error.message}` });
       }
    });

    // Desconexión
     socket.on('disconnect', async (reason) => {
        console.log(`Cliente desconectado: ${socket.id}, Razón: ${reason}`);
        const player = await Player.findOne({ socketId: socket.id });
        if (player && player.gameId) {
            const game = await Game.findById(player.gameId);
            if (game && (game.status === 'playing' || game.status === 'waiting')) {
                 console.log(`Jugador ${player.name} desconectado del juego ${game.gameCode}. Marcando inactivo.`);
                 player.isActive = false;
                 player.socketId = null;
                 await player.save();

                 if (game.status === 'playing' && game.currentPlayerId?.toString() === player._id.toString()) {
                    console.log("Era el turno del jugador desconectado. Avanzando turno...");
                    const nextPlayer = await getNextPlayer(game);
                     if (nextPlayer) {
                         game.currentTurnOrder = nextPlayer.turnOrder;
                         game.currentPlayerId = nextPlayer._id;
                     } else {
                          game.status = game.successfulGuesser ? 'finished_success' : 'finished_failure';
                          game.currentPlayerId = null;
                     }
                     await game.save();

                     if (game.status.startsWith('finished')) {
                        await broadcastGameOver(game);
                     } else {
                         await broadcastGameState(game._id, game.gameCode);
                     }
                 } else if (game.status !== 'finished_success' && game.status !== 'finished_failure') {
                      io.to(game.gameCode).emit('playerDisconnected', { playerId: player._id, playerName: player.name });
                       const updatedGameInfo = await Game.findById(game._id).populate('players', '_id name turnOrder isActive');
                        const playersPublicInfoPromises = updatedGameInfo.players.map(async p => ({
                           id: p._id, name: p.name, turnOrder: p.turnOrder, isActive: p.isActive,
                           mineralCount: (await Player.findById(p._id).select('inventory'))?.inventory?.length ?? 0
                        }));
                       const playersPublicInfo = await Promise.all(playersPublicInfoPromises);
                       io.to(game.gameCode).emit('playerListUpdated', { players: playersPublicInfo, count: playersPublicInfo.length });
                 }
            } else if (player) {
                 player.socketId = null;
                 await player.save();
            }
        }
    });

});

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
    console.log(`Servidor 'Juego de Escala (DVP V2 - Debug)' iniciado en puerto ${PORT}`);
});