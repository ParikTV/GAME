const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// Cargar variables de entorno
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Configuración del servidor
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/juego-escala', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Conexión a MongoDB establecida'))
.catch(err => console.error('Error al conectar a MongoDB:', err));

// Definir esquemas y modelos
const PlayerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    teamId: { type: Number, default: null }
});

const MaterialSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, required: true },
    weight: { type: Number, required: true }
}, { _id: false }); // Desactivar _id automático

const GameSchema = new mongoose.Schema({
    gameCode: { type: String, required: true, unique: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
    materials: [MaterialSchema],
    leftMaterials: [MaterialSchema],
    rightMaterials: [MaterialSchema],
    leftWeight: { type: Number, default: 0 },
    rightWeight: { type: Number, default: 0 },
    currentTurn: { type: Number, default: 1 },
    currentPlayerIndex: { type: Number, default: 0 },
    eliminatedPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
    status: { type: String, enum: ['waiting', 'playing', 'ended'], default: 'waiting' },
    winner: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', PlayerSchema);
const Game = mongoose.model('Game', GameSchema);

// Funciones de utilidad
function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateRandomMaterials() {
    const materialTypes = ['Metal', 'Madera', 'Vidrio', 'Plastico', 'Piedra', 'Algodon', 'Tela', 'Papel', 'Espuma', 'Ceramica'];
    const materials = [];
    
    // Generar 30 materiales (3 de cada tipo)
    materialTypes.forEach(type => {
        for (let i = 0; i < 3; i++) {
            // Generar peso aleatorio entre 5g y 50g
            const weight = parseFloat((Math.random() * 45 + 5).toFixed(1));
            materials.push({
                id: uuidv4(),
                type: type,
                weight: weight
            });
        }
    });
    
    return materials;
}

function createTeams(players) {
    // Dividir a los jugadores en 5 equipos de 2 cada uno
    const shuffledPlayers = [...players];
    
    // Mezclar aleatoriamente los jugadores
    for (let i = shuffledPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
    }
    
    const teams = [];
    for (let i = 0; i < 5; i++) {
        teams.push({
            id: i + 1,
            players: [
                shuffledPlayers[i * 2].name,
                shuffledPlayers[i * 2 + 1].name
            ],
            playerIds: [
                shuffledPlayers[i * 2]._id,
                shuffledPlayers[i * 2 + 1]._id
            ]
        });
        
        // Actualizar el equipo de los jugadores
        shuffledPlayers[i * 2].teamId = i + 1;
        shuffledPlayers[i * 2 + 1].teamId = i + 1;
    }
    
    return teams;
}

function calculateDifference(leftWeight, rightWeight) {
    return Math.abs(leftWeight - rightWeight);
}

function getAvailableMaterials(game, playerId) {
    // Obtener todos los materiales que no han sido usados
    const usedMaterialIds = [
        ...game.leftMaterials.map(m => m.id), 
        ...game.rightMaterials.map(m => m.id)
    ];
    
    return game.materials.filter(m => !usedMaterialIds.includes(m.id));
}

function isGameBalanced(leftWeight, rightWeight) {
    // Si la diferencia es menor o igual a 10g, la balanza está equilibrada
    return calculateDifference(leftWeight, rightWeight) <= 10;
}

function getCurrentPlayer(game) {
    if (game.players.length === 0 || game.currentPlayerIndex >= game.players.length) {
        return null;
    }
    
    return game.players[0];
}

function getWinners(game) {
    const winners = [];
    
    // Si la balanza está equilibrada, ganan los jugadores activos
    if (isGameBalanced(game.leftWeight, game.rightWeight)) {
        game.players.forEach(player => {
            if (!game.eliminatedPlayers.includes(player._id)) {
                winners.push({
                    id: player._id,
                    name: player.name,
                    isTeam: false
                });
            }
        });
    } 
    // Si hay equipos completos (ambos miembros siguen en juego)
    else {
        const teamCounts = {};
        
        // Contar jugadores activos por equipo
        game.players.forEach(player => {
            if (!game.eliminatedPlayers.includes(player._id) && player.teamId) {
                teamCounts[player.teamId] = (teamCounts[player.teamId] || 0) + 1;
            }
        });
        
        // Equipos con ambos jugadores activos
        Object.entries(teamCounts).forEach(([teamId, count]) => {
            if (count === 2) {
                const team = game.teams.find(t => t.id === parseInt(teamId));
                if (team) {
                    winners.push({
                        id: teamId,
                        name: `Equipo ${teamId}`,
                        players: team.players,
                        isTeam: true
                    });
                }
            }
        });
        
        // Si no hay equipos completos, ganan los jugadores individuales activos
        if (winners.length === 0) {
            game.players.forEach(player => {
                if (!game.eliminatedPlayers.includes(player._id)) {
                    winners.push({
                        id: player._id,
                        name: player.name,
                        isTeam: false
                    });
                }
            });
        }
    }
    
    return winners;
}

// Configuración de Socket.IO
io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado:', socket.id);
    
    // Crear un nuevo juego
    socket.on('createGame', async (data, callback) => {
        try {
            const gameCode = generateGameCode();
            
            // Crear el host como jugador
            const host = new Player({
                name: data.hostName,
                isActive: true
            });
            
            await host.save();
            
            // Crear el juego
            const game = new Game({
                gameCode,
                host: host._id,
                players: [host._id],
                materials: generateRandomMaterials()
            });
            
            await game.save();
            
            // Unir al host a la sala del juego
            socket.join(gameCode);
            
            callback({
                success: true,
                gameId: game._id,
                playerId: host._id,
                gameCode
            });
            
        } catch (error) {
            console.error('Error al crear juego:', error);
            callback({
                success: false,
                message: 'Error al crear el juego. Inténtalo de nuevo.'
            });
        }
    });
    
    // Unirse a un juego existente
    socket.on('joinGame', async (data, callback) => {
        try {
            const { gameCode, playerName } = data;
            
            const game = await Game.findOne({ gameCode });
            
            if (!game) {
                return callback({
                    success: false,
                    message: 'Juego no encontrado. Verifica el código.'
                });
            }
            
            if (game.status !== 'waiting') {
                return callback({
                    success: false,
                    message: 'El juego ya ha comenzado o ha terminado.'
                });
            }
            
            if (game.players.length >= 10) {
                return callback({
                    success: false,
                    message: 'El juego ya está lleno (10 jugadores).'
                });
            }
            
            // Crear un nuevo jugador
            const player = new Player({
                name: playerName,
                isActive: true
            });
            
            await player.save();
            
            // Añadir jugador al juego
            game.players.push(player._id);
            await game.save();
            
            // Unir al jugador a la sala del juego
            socket.join(gameCode);
            
            // Obtener lista actualizada de jugadores
            const populatedGame = await Game.findById(game._id).populate('players');
            
            // Notificar a todos los jugadores que se ha unido uno nuevo
            io.to(gameCode).emit('playerJoined', {
                players: populatedGame.players.map(p => ({ id: p._id, name: p.name })),
                count: populatedGame.players.length
            });
            
            callback({
                success: true,
                gameId: game._id,
                playerId: player._id
            });
            
        } catch (error) {
            console.error('Error al unirse al juego:', error);
            callback({
                success: false,
                message: 'Error al unirse al juego. Inténtalo de nuevo.'
            });
        }
    });
    
    // Iniciar el juego
    socket.on('startGame', async (data) => {
        try {
            const { gameId } = data;
            
            const game = await Game.findById(gameId).populate('players');
            
            if (!game) {
                return socket.emit('error', { message: 'Juego no encontrado.' });
            }
            
            if (game.status !== 'waiting') {
                return socket.emit('error', { message: 'El juego ya ha comenzado o ha terminado.' });
            }
            
            if (game.players.length < 10) {
                return socket.emit('error', { message: 'Se necesitan 10 jugadores para iniciar el juego.' });
            }
            
            // Crear equipos
            const teams = createTeams(game.players);
            
            // Actualizar jugadores con sus equipos
            for (const player of game.players) {
                const team = teams.find(t => t.playerIds.includes(player._id));
                if (team) {
                    player.teamId = team.id;
                    await player.save();
                }
            }
            
            // Actualizar el juego
            game.teams = teams.map(t => ({ id: t.id, players: t.players }));
            game.status = 'playing';
            game.currentPlayerIndex = 0;
            game.currentTurn = 1;
            
            await game.save();
            
            // Obtener el jugador actual
            const currentPlayer = game.players[0];
            
            // Preparar estado del juego para los clientes
            const gameState = {
                gameId: game._id,
                players: game.players.map(p => ({ id: p._id, name: p.name, teamId: p.teamId })),
                teams: game.teams,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight,
                leftMaterials: game.leftMaterials,
                rightMaterials: game.rightMaterials,
                currentTurn: game.currentTurn,
                currentPlayer: { id: currentPlayer._id, name: currentPlayer.name },
                availableMaterials: getAvailableMaterials(game),
                turnActive: true
            };
            
            // Notificar a todos los jugadores que el juego ha comenzado
            io.to(game.gameCode).emit('gameStarted', { gameState });
            
        } catch (error) {
            console.error('Error al iniciar el juego:', error);
            socket.emit('error', { message: 'Error al iniciar el juego.' });
        }
    });
    
    // Colocar material en la balanza
    socket.on('placeMaterial', async (data) => {
        try {
            const { gameId, playerId, materialId, side } = data;
            
            const game = await Game.findById(gameId).populate('players');
            
            if (!game) {
                return socket.emit('error', { message: 'Juego no encontrado.' });
            }
            
            if (game.status !== 'playing') {
                return socket.emit('error', { message: 'El juego no está en curso.' });
            }
            
            const currentPlayer = game.players[game.currentPlayerIndex];
            
            if (!currentPlayer || currentPlayer._id.toString() !== playerId) {
                return socket.emit('error', { message: 'No es tu turno.' });
            }
            
            // Buscar el material seleccionado
            const materialIndex = game.materials.findIndex(m => m.id === materialId);
            
            if (materialIndex === -1) {
                return socket.emit('error', { message: 'Material no encontrado o ya utilizado.' });
            }
            
            const material = game.materials[materialIndex];
            
            // Añadir material al lado correspondiente
            if (side === 'left') {
                game.leftMaterials.push(material);
                game.leftWeight += material.weight;
            } else {
                game.rightMaterials.push(material);
                game.rightWeight += material.weight;
            }
            
            // Verificar si la balanza está equilibrada
            const balanced = isGameBalanced(game.leftWeight, game.rightWeight);
            const eliminatedPlayers = [];
            
            if (!balanced) {
                // Eliminar al jugador actual
                game.eliminatedPlayers.push(currentPlayer._id);
                currentPlayer.isActive = false;
                await currentPlayer.save();
                
                eliminatedPlayers.push({
                    id: currentPlayer._id,
                    name: currentPlayer.name
                });
            }
            
            // Avanzar al siguiente jugador que no esté eliminado
            let nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            while (game.eliminatedPlayers.includes(game.players[nextPlayerIndex]._id)) {
                nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
                
                // Si hemos dado la vuelta completa, es que no quedan jugadores
                if (nextPlayerIndex === game.currentPlayerIndex) {
                    game.status = 'ended';
                    break;
                }
            }
            
            // Verificar si el juego ha terminado
            const activePlayersCount = game.players.length - game.eliminatedPlayers.length;
            let gameEnded = false;
            
            if (activePlayersCount <= 1 || game.status === 'ended') {
                game.status = 'ended';
                gameEnded = true;
            }
            
            // Guardar los cambios
            game.currentPlayerIndex = nextPlayerIndex;
            if (!gameEnded) {
                game.currentTurn++;
            }
            
            await game.save();
            
            // Preparar estado del juego actualizado
            const nextPlayer = gameEnded ? null : game.players[nextPlayerIndex];
            
            const gameState = {
                gameId: game._id,
                players: game.players.map(p => ({ id: p._id, name: p.name, teamId: p.teamId })),
                teams: game.teams,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight,
                leftMaterials: game.leftMaterials,
                rightMaterials: game.rightMaterials,
                currentTurn: game.currentTurn,
                currentPlayer: nextPlayer ? { id: nextPlayer._id, name: nextPlayer.name } : null,
                eliminatedPlayers: game.eliminatedPlayers.map(id => 
                    game.players.find(p => p._id.toString() === id.toString())
                ).filter(p => p).map(p => ({ id: p._id, name: p.name })),
                availableMaterials: getAvailableMaterials(game),
                turnActive: !gameEnded,
                gameEnded
            };
            
            // Notificar resultado del turno
            io.to(game.gameCode).emit('turnResult', {
                gameState,
                balanced,
                eliminatedPlayers,
                currentPlayerName: currentPlayer.name,
                material,
                side,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight
            });
            
            // Si el juego ha terminado, enviar resultados finales
            if (gameEnded) {
                const winners = getWinners(game);
                
                io.to(game.gameCode).emit('gameOver', {
                    gameState,
                    winners,
                    leftWeight: game.leftWeight,
                    rightWeight: game.rightWeight,
                    eliminatedPlayers: game.eliminatedPlayers.map(id => 
                        game.players.find(p => p._id.toString() === id.toString())
                    ).filter(p => p).map(p => ({ id: p._id, name: p.name }))
                });
            }
            
        } catch (error) {
            console.error('Error al colocar material:', error);
            socket.emit('error', { message: 'Error al colocar el material.' });
        }
    });
    
    // Saltar turno
    socket.on('skipTurn', async (data) => {
        try {
            const { gameId, playerId } = data;
            
            const game = await Game.findById(gameId).populate('players');
            
            if (!game) {
                return socket.emit('error', { message: 'Juego no encontrado.' });
            }
            
            if (game.status !== 'playing') {
                return socket.emit('error', { message: 'El juego no está en curso.' });
            }
            
            const currentPlayer = game.players[game.currentPlayerIndex];
            
            if (!currentPlayer || currentPlayer._id.toString() !== playerId) {
                return socket.emit('error', { message: 'No es tu turno.' });
            }
            
            // Verificar si la balanza está equilibrada
            const balanced = isGameBalanced(game.leftWeight, game.rightWeight);
            
            // Avanzar al siguiente jugador que no esté eliminado
            let nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            while (game.eliminatedPlayers.includes(game.players[nextPlayerIndex]._id)) {
                nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length;
                
                // Si hemos dado la vuelta completa, es que no quedan jugadores
                if (nextPlayerIndex === game.currentPlayerIndex) {
                    game.status = 'ended';
                    break;
                }
            }
            
            // Guardar los cambios
            game.currentPlayerIndex = nextPlayerIndex;
            game.currentTurn++;
            
            await game.save();
            
            // Preparar estado del juego actualizado
            const nextPlayer = game.players[nextPlayerIndex];
            
            const gameState = {
                gameId: game._id,
                players: game.players.map(p => ({ id: p._id, name: p.name, teamId: p.teamId })),
                teams: game.teams,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight,
                leftMaterials: game.leftMaterials,
                rightMaterials: game.rightMaterials,
                currentTurn: game.currentTurn,
                currentPlayer: { id: nextPlayer._id, name: nextPlayer.name },
                eliminatedPlayers: game.eliminatedPlayers.map(id => 
                    game.players.find(p => p._id.toString() === id.toString())
                ).filter(p => p).map(p => ({ id: p._id, name: p.name })),
                availableMaterials: getAvailableMaterials(game),
                turnActive: true,
                gameEnded: false
            };
            
            // Notificar resultado del turno
            io.to(game.gameCode).emit('turnResult', {
                gameState,
                balanced,
                eliminatedPlayers: [],
                currentPlayerName: currentPlayer.name,
                material: null,
                side: null,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight
            });
            
        } catch (error) {
            console.error('Error al saltar turno:', error);
            socket.emit('error', { message: 'Error al saltar el turno.' });
        }
    });
    
    // Cliente listo para el siguiente turno
    socket.on('readyForNextTurn', async (data) => {
        try {
            const { gameId, playerId } = data;
            
            const game = await Game.findById(gameId).populate('players');
            
            if (!game) {
                return socket.emit('error', { message: 'Juego no encontrado.' });
            }
            
            if (game.status !== 'playing') {
                return socket.emit('error', { message: 'El juego no está en curso.' });
            }
            
            // Enviar estado actualizado del juego
            const currentPlayer = game.players[game.currentPlayerIndex];
            
            const gameState = {
                gameId: game._id,
                players: game.players.map(p => ({ id: p._id, name: p.name, teamId: p.teamId })),
                teams: game.teams,
                leftWeight: game.leftWeight,
                rightWeight: game.rightWeight,
                leftMaterials: game.leftMaterials,
                rightMaterials: game.rightMaterials,
                currentTurn: game.currentTurn,
                currentPlayer: currentPlayer ? { id: currentPlayer._id, name: currentPlayer.name } : null,
                eliminatedPlayers: game.eliminatedPlayers.map(id => 
                    game.players.find(p => p._id.toString() === id.toString())
                ).filter(p => p).map(p => ({ id: p._id, name: p.name })),
                availableMaterials: getAvailableMaterials(game),
                turnActive: true,
                gameEnded: false
            };
            
            socket.emit('gameStateUpdated', { gameState });
            
        } catch (error) {
            console.error('Error al preparar siguiente turno:', error);
            socket.emit('error', { message: 'Error al preparar el siguiente turno.' });
        }
    });
    
    // Desconexión del cliente
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Rutas API
app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.find().populate('host').populate('players');
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener juegos', error });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await Game.findById(req.params.id).populate('host').populate('players');
        if (!game) {
            return res.status(404).json({ message: 'Juego no encontrado' });
        }
        res.json(game);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el juego', error });
    }
});

app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find();
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener jugadores', error });
    }
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor iniciado en el puerto ${PORT}`);
});
