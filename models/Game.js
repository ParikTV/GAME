const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['waiting', 'active', 'finished'],
    default: 'waiting'
  },
  startTime: Date,
  endTime: Date,
  players: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player'
  }],
  teams: [{
    teamId: Number,
    players: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player'
    }],
    isEliminated: {
      type: Boolean,
      default: false
    }
  }],
  currentTurn: {
    type: Number,
    default: 1
  },
  scaleStatus: {
    leftSide: {
      totalWeight: {
        type: Number,
        default: 0
      },
      materials: [{
        weight: Number,
        playerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Player'
        }
      }]
    },
    rightSide: {
      totalWeight: {
        type: Number,
        default: 0
      },
      materials: [{
        weight: Number,
        playerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Player'
        }
      }]
    },
    isBalanced: {
      type: Boolean,
      default: true
    },
    tiltDirection: {
      type: String,
      enum: ['left', 'right', 'balanced'],
      default: 'balanced'
    }
  },
  availableMaterials: [{
    weight: Number,
    isUsed: {
      type: Boolean,
      default: false
    }
  }],
  roundHistory: [{
    turnNumber: Number,
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player'
    },
    action: {
      type: String,
      enum: ['placed', 'skipped', 'eliminated']
    },
    materialWeight: Number,
    side: {
      type: String,
      enum: ['left', 'right']
    },
    scaleStatus: {
      leftWeight: Number,
      rightWeight: Number,
      tiltDirection: String
    },
    timestamp: Date
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Game', GameSchema);
