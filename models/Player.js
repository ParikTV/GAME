const mongoose = require('mongoose');
const MineralSchema = require('./MineralSchema'); // Importar si está en archivo separado

const PlayerSchema = new mongoose.Schema({
    socketId: { type: String }, // ID del socket actual
    name: {
        type: String,
        required: true,
        trim: true
    },
    gameId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Game', // Referencia al juego
        required: true
    },
    turnOrder: { // Orden asignado al unirse (1, 2, ...)
        type: Number,
        required: true
    },
    // Los 10 minerales específicos asignados a este jugador al inicio
    inventory: [MineralSchema], // Mantiene el peso en el backend

    // Indica si el jugador aún tiene suficientes minerales para jugar (>= 2)
    canPlaceMinerals: {
        type: Boolean,
        default: true
    },
    // Para desconexiones o si ya no puede jugar
    isActive: {
        type: Boolean,
        default: true
    },

    // --- NUEVOS CAMPOS ---
    hackerBytes: { // Premio acumulado personal (generalmente ganado al final)
        type: Number,
        default: 0
    },
    guessedColorsPhase2: { // Colores que este jugador ya INTENTÓ adivinar en Fase 2
        type: [String],
        default: []
    },
    phase2GuessAttemptsThisTurn: { // Intentos restantes en el turno ACTUAL de Fase 2
        type: Number,
        default: 0 // Se setea al inicio del turno en Fase 2
    },

    // Campos de conexión originales (opcional mantenerlos)
    connectionInfo: {
        ip: String,
        userAgent: String,
        connectionTime: Date,
        disconnectionTime: Date
     }
    // --- CAMPOS ELIMINADOS ---
    // pieces: Number,
    // canGuess: Boolean,
    // totalGuessAttemptsMade: Number, // Ya no se usa globalmente, ahora es por turno en Fase 2

}, {
    timestamps: true // Añade createdAt y updatedAt automáticamente
});

// Hook pre-save para actualizar estados calculados
PlayerSchema.pre('save', function(next) {
  // Solo actualizar canPlaceMinerals basado en inventario
  this.canPlaceMinerals = this.isActive && this.inventory && this.inventory.length >= 2;
  // canGuess ya no se calcula aquí
  next();
});

module.exports = mongoose.model('Player', PlayerSchema);