const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  socketId: {
    type: String,
    required: true
  },
  teamId: {
    type: Number,
    required: true
  },
  turnOrder: {
    type: Number,
    required: true
  },
  isEliminated: {
    type: Boolean,
    default: false
  },
  materialsPlaced: [{
    weight: Number,
    timestamp: Date
  }],
  connectionInfo: {
    ip: String,
    userAgent: String,
    connectionTime: Date,
    disconnectionTime: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Player', PlayerSchema);
