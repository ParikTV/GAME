const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const MineralSchema = new mongoose.Schema({
    instanceId: {
        type: String,
        required: true,
        unique: true,
        default: uuidv4 // ID único para esta pieza específica
    },
    type: { // El color/tipo
        type: String,
        required: true,
        enum: ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'] // Los 5 colores
    },
    // El peso REAL (secreto) asociado con este TIPO de mineral en esta partida
    // Se copia aquí para facilitar el acceso, pero la fuente es Game.actualMineralWeights
    weight: {
        type: Number,
        required: true
    }
}, { _id: false }); // No necesitamos el _id de subdocumento

module.exports = MineralSchema;