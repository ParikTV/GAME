// models/Player.js
const mongoose = require('mongoose');
const MineralSchema = require('./MineralSchema'); // Importar si está en archivo separado

// --- Constantes del Juego (Sincronizar con server.js) ---
const MAX_GUESS_ATTEMPTS = 2; // Límite de intentos de adivinanza para ganar
const COSTO_ADIVINANZA = 100; // Costo en Hacker Bytes para intentar adivinar (ganar)

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
    // NOTA: El peso se mantiene aquí para la lógica del servidor, pero no se envía al cliente.
    inventory: [MineralSchema],
    hackerBytes: { // <--- RENOMBRADO de 'pieces'
        type: Number,
        default: 500 // Ejemplo: Empezar con 500 Hacker Bytes (Ajusta si es necesario)
    },
    // Intentos realizados para la adivinanza que gana el juego
    totalGuessAttemptsMade: {
        type: Number,
        default: 0
    },
    // Indica si el jugador aún tiene suficientes minerales para jugar (>= 2)
    canPlaceMinerals: {
        type: Boolean,
        default: true
    },
    // Indica si el jugador CUMPLE LOS REQUISITOS GENERALES para intentar adivinar (estado, minerales, bytes, intentos)
    // La decisión final de si PUEDE adivinar en un momento específico depende también del turno y estado de la balanza (ver getGameStateForPlayer)
    canGuess: {
        type: Boolean,
        default: true // Calculado en pre-save
    },
    // Para desconexiones o si ya no puede jugar
    isActive: {
        type: Boolean,
        default: true
    },
    // Campos de conexión originales (opcional mantenerlos)
    connectionInfo: {
        ip: String,
        userAgent: String,
        connectionTime: Date,
        disconnectionTime: Date
     }
}, {
    timestamps: true // Añade createdAt y updatedAt automáticamente
});

// Hook pre-save para actualizar estados calculados
PlayerSchema.pre('save', function(next) {
  // Puede colocar si tiene 2 o más minerales y está activo
  this.canPlaceMinerals = this.isActive && this.inventory && this.inventory.length >= 2;

  // Puede intentar la adivinanza (generalmente) si:
  // - Está activo
  // - Tiene al menos 1 mineral en inventario
  // - Tiene suficientes Hacker Bytes para el costo
  // - No ha agotado sus intentos máximos
  this.canGuess = this.isActive &&
                  this.inventory && this.inventory.length >= 1 &&
                  this.hackerBytes >= COSTO_ADIVINANZA &&
                  this.totalGuessAttemptsMade < MAX_GUESS_ATTEMPTS;

  next();
});

module.exports = mongoose.model('Player', PlayerSchema);