const mongoose = require('mongoose');
const MineralSchema = require('./MineralSchema'); // Importar si está en archivo separado

// Schema para el estado de una balanza (principal o secundaria)
const ScaleStateSchema = new mongoose.Schema({
    leftMaterials: [MineralSchema],  // Minerales colocados en este lado
    rightMaterials: [MineralSchema],
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
        enum: ['waiting', 'playing', 'finished_success', 'finished_failure'],
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
    // Información sobre adivinanzas
    successfulGuesser: { // Quién adivinó correctamente (si alguien lo hizo)
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        default: null
    },
    // Almacenar el resultado del último intento de adivinanza (opcional)
    lastGuessResult: {
        playerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        correct: { type: Boolean },
        timestamp: { type: Date }
    },
    // Historial de rondas (opcional, similar al original si quieres guardar cada acción)
    // roundHistory: [{...}]

}, {
    timestamps: true // Añade createdAt y updatedAt
});

// Método helper para verificar si la balanza principal está equilibrada
GameSchema.methods.isMainScaleBalanced = function() {
    if (!this.mainScale) return true; // Default es {} ahora
    const difference = Math.abs((this.mainScale.leftWeight || 0) - (this.mainScale.rightWeight || 0));
    // Regla: Asumamos <= 1g ya que son enteros.
    const threshold = 1;
    return difference <= threshold;
};

module.exports = mongoose.model('Game', GameSchema);