// models/Game.js
const mongoose = require('mongoose');
const MineralSchema = require('./MineralSchema'); // Importar si está en archivo separado

// Schema para el estado de una balanza (principal o secundaria)
const ScaleStateSchema = new mongoose.Schema({
    leftMaterials: [MineralSchema],  // Minerales colocados en este lado (CON peso en backend)
    rightMaterials: [MineralSchema], // Minerales colocados en este lado (CON peso en backend)
    leftWeight: { type: Number, default: 0 },
    rightWeight: { type: Number, default: 0 }
}, { _id: false });

const GameSchema = new mongoose.Schema({
    gameCode: { // Código de 6 dígitos para unirse
        type: String,
        required: true,
        unique: true,
        match: /^[0-9]{6}$/
    },
    hostId: { // Quién creó el juego
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        required: true
    },
    players: [{ // Lista de jugadores en la partida
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player'
    }],
    status: { // Estado actual del juego
        type: String,
        enum: [
            'waiting',                 // Esperando jugadores
            'playing',                 // Fase 1: Colocar minerales / Adivinanza Opcional
            'voting',                  // Fase de votación para continuar
            'guessing_phase',          // Fase 2: Adivinanza individual
            'finished_balance_win',    // Ganó por balancear y votó NO/empate
            'finished_phase1_guess_win',// Ganó adivinando todo en Fase 1 (NUEVO)
            'finished_phase2_win',     // Ganó Fase 2 (>= 3 aciertos)
            'finished_phase2_loss',    // Perdió Fase 2 (< 3 aciertos)
            'finished_disconnect_vote',// Alguien desconectó en votación
            'finished_disconnect_game',// Juego terminó por desconexiones generales
            'finished_failure'         // Estado genérico si nadie balanceó/ganó (puede necesitar refinar)
        ],
        default: 'waiting'
    },
    // Los pesos SECRETOS de cada tipo de mineral para esta partida
    actualMineralWeights: {
        Rojo: { type: Number, min: 1, max: 20, required: true },
        Amarillo: { type: Number, min: 1, max: 20, required: true },
        Verde: { type: Number, min: 1, max: 20, required: true },
        Azul: { type: Number, min: 1, max: 20, required: true },
        Purpura: { type: Number, min: 1, max: 20, required: true }
    },
    // La información que se revela al inicio
    knownMineralInfo: {
        type: { type: String, enum: ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'] },
        weight: { type: Number },
        description: { type: String } // Ej: "El mineral Amarillo pesa 10g y es el 3º más pesado."
    },
    // Estado de las balanzas
    mainScale: { type: ScaleStateSchema, default: () => ({ leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }) },
    secondaryScale: { type: ScaleStateSchema, default: () => ({ leftMaterials: [], rightMaterials: [], leftWeight: 0, rightWeight: 0 }) },

    // Control de turnos
    currentTurnOrder: { // El número de orden (1, 2, ...) del jugador actual
        type: Number,
        default: 1
    },
    currentPlayerId: { // El _id del jugador actual
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        default: null
    },

    // --- NUEVOS CAMPOS ---
    currentPrizePot: { // Premio inicial/acumulado
        type: Number,
        default: 10000000 // O inicializar en server.js al empezar votación
    },
    balancerPlayerId: { // Quién equilibró la balanza en Fase 1
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        default: null
    },
    votingState: { // Estado de la votación
        votes: {
            type: Map,
            of: String // 'yes'/'no' o null
        },
        requiredVotes: { type: Number, default: 0 },
        receivedVotes: { type: Number, default: 0 }
    },
    phase2RoundsPlayed: { type: Number, default: 0 }, // Contador de rondas en Fase 2
    phase2CorrectGuessesTotal: { type: Number, default: 0 }, // Contador global de aciertos únicos en Fase 2
    phase2CorrectGuessesMap: { // Para asegurar que cada color se cuenta solo una vez
        type: Map,
        of: mongoose.Schema.Types.ObjectId, // { 'Color': playerId }
        default: {}
    },
    successfulGuesser: { // Quién ganó (balance_win, phase1_guess_win) o equipo (phase2_win - puede ser null)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        default: null
    },
    // roundHistory: [{...}] // Opcional si se quiere mantener historial detallado

}, {
    timestamps: true // Añade createdAt y updatedAt
});

// Método helper para verificar si la balanza principal está EXACTAMENTE equilibrada
GameSchema.methods.isMainScaleBalanced = function() {
    if (!this.mainScale) return false; // Si no existe, no está balanceada
    const left = this.mainScale.leftWeight ?? 0; // Tratar null/undefined como 0
    const right = this.mainScale.rightWeight ?? 0;
    // Exactamente iguales Y al menos uno es diferente de cero (para evitar balance inicial 0=0)
    return left === right && (left !== 0 || right !== 0);
};

module.exports = mongoose.model('Game', GameSchema);