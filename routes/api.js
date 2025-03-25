const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const Player = require('../models/Player');

// Obtener todos los juegos
router.get('/games', async (req, res) => {
  try {
    const games = await Game.find().select('gameId status startTime endTime');
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener detalles de un juego específico
router.get('/games/:gameId', async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId })
      .populate('players')
      .populate('teams.players');
    
    if (!game) {
      return res.status(404).json({ message: 'Juego no encontrado' });
    }
    
    res.json(game);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener estadísticas de un juego
router.get('/games/:gameId/stats', async (req, res) => {
  try {
    const game = await Game.findOne({ gameId: req.params.gameId })
      .populate('players')
      .populate('teams.players')
      .populate('roundHistory.playerId');
    
    if (!game) {
      return res.status(404).json({ message: 'Juego no encontrado' });
    }
    
    // Calculando estadísticas
    const stats = {
      totalPlayers: game.players.length,
      activePlayers: game.players.filter(player => !player.isEliminated).length,
      eliminatedPlayers: game.players.filter(player => player.isEliminated).length,
      activeTeams: game.teams.filter(team => !team.isEliminated).length,
      eliminatedTeams: game.teams.filter(team => team.isEliminated).length,
      currentTurn: game.currentTurn,
      scaleStatus: game.scaleStatus,
      roundsCompleted: game.roundHistory.length,
      materialsByPlayer: game.players.map(player => ({
        playerName: player.name,
        materialsPlaced: player.materialsPlaced.length,
        totalWeight: player.materialsPlaced.reduce((sum, mat) => sum + mat.weight, 0)
      }))
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener información de un jugador
router.get('/players/:playerId', async (req, res) => {
  try {
    const player = await Player.findById(req.params.playerId);
    
    if (!player) {
      return res.status(404).json({ message: 'Jugador no encontrado' });
    }
    
    res.json(player);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Obtener el historial de movimientos de un jugador
router.get('/players/:playerId/history', async (req, res) => {
  try {
    const player = await Player.findById(req.params.playerId);
    
    if (!player) {
      return res.status(404).json({ message: 'Jugador no encontrado' });
    }
    
    // Buscar todos los movimientos del jugador en todos los juegos
    const games = await Game.find({
      'roundHistory.playerId': req.params.playerId
    });
    
    const playerHistory = [];
    
    games.forEach(game => {
      const moves = game.roundHistory.filter(
        round => round.playerId.toString() === req.params.playerId
      );
      
      moves.forEach(move => {
        playerHistory.push({
          gameId: game.gameId,
          ...move.toObject()
        });
      });
    });
    
    res.json(playerHistory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
