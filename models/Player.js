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
    inventory: [MineralSchema],
    pieces: { // Moneda del juego para adivinar
        type: Number,
        default: 1 // Regla original parece dar 1 pieza al inicio? Ajustar si no.
    },
    // Indica si el jugador aún tiene suficientes minerales para jugar (>= 2)
    canPlaceMinerals: {
        type: Boolean,
        default: true
    },
    // Indica si el jugador puede intentar adivinar (puede depender de si tiene minerales o piezas)
    canGuess: {
        type: Boolean,
        default: true
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
  this.canPlaceMinerals = this.inventory && this.inventory.length >= 2;
  // Ajustar canGuess según las reglas exactas (¿necesita minerales? ¿piezas?)
  this.canGuess = this.inventory && this.inventory.length >= 1 && this.pieces >= 1; // Ejemplo: necesita >=1 mineral y >=1 pieza
  next();
});

module.exports = mongoose.model('Player', PlayerSchema);