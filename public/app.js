// Conexión a Socket.IO
const socket = io();

// Elementos DOM
const screens = {
    welcome: document.getElementById('welcome-screen'),
    create: document.getElementById('create-screen'),
    join: document.getElementById('join-screen'),
    hostWaiting: document.getElementById('host-waiting-screen'),
    playerWaiting: document.getElementById('player-waiting-screen'),
    game: document.getElementById('game-screen'),
    turnResult: document.getElementById('turn-result-screen'),
    finalResults: document.getElementById('final-results-screen')
};

// Botones y elementos de navegación
const createGameBtn = document.getElementById('create-btn');
const joinGameBtn = document.getElementById('join-btn');
const backFromCreateBtn = document.getElementById('back-from-create');
const backFromJoinBtn = document.getElementById('back-from-join');
const copyCodeBtn = document.getElementById('copy-code-btn');
const startGameBtn = document.getElementById('start-game-btn');
const skipTurnBtn = document.getElementById('skip-turn-btn');
const selectLeftBtn = document.getElementById('select-left');
const selectRightBtn = document.getElementById('select-right');
const cancelSelectionBtn = document.getElementById('cancel-selection');
const nextTurnBtn = document.getElementById('next-turn-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const notificationOkBtn = document.getElementById('notification-ok');
const eliminationOkBtn = document.getElementById('elimination-ok');

// Formularios
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');

// Elementos de visualización
const gameCodeDisplay = document.getElementById('game-code-display');
const playersList = document.getElementById('players-list');
const playerCount = document.getElementById('player-count');
const joinedCount = document.getElementById('joined-count');
const currentTurn = document.getElementById('current-turn');
const currentPlayer = document.getElementById('current-player');
const waitingPlayer = document.getElementById('waiting-player');
const timer = document.getElementById('timer');
const teamsContainer = document.getElementById('teams-container');
const leftWeight = document.getElementById('left-weight');
const rightWeight = document.getElementById('right-weight');
const leftMaterials = document.getElementById('left-materials');
const rightMaterials = document.getElementById('right-materials');
const materialsContainer = document.getElementById('materials-container');
const scaleArm = document.getElementById('scale-arm');
const isYourTurn = document.getElementById('is-your-turn');
const waitingTurn = document.getElementById('waiting-turn');
const sideSelection = document.getElementById('side-selection');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const turnSummaryList = document.getElementById('turn-summary-list');
const winnersList = document.getElementById('winners-list');
const finalScaleInfo = document.getElementById('final-scale-info');
const eliminatedList = document.getElementById('eliminated-list');
const notificationModal = document.getElementById('notification-modal');
const eliminationModal = document.getElementById('elimination-modal');
const notificationMessage = document.getElementById('notification-message');

// Variables del estado del juego
let gameId = null;
let playerId = null;
let playerName = '';
let isHost = false;
let gameState = null;
let materials = [];
let selectedMaterial = null;
let timerInterval = null;
let eliminated = false;

// Funciones de utilidad
function showScreen(screenId) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    screenId.classList.add('active');
}

function showNotification(message) {
    notificationMessage.textContent = message;
    notificationModal.style.display = 'block';
}

function showEliminationModal() {
    eliminationModal.style.display = 'block';
}

function formatWeight(weight) {
    return Math.abs(weight).toFixed(1);
}

function updateScaleDisplay(leftWeightValue, rightWeightValue) {
    // Actualizar los pesos mostrados
    leftWeight.textContent = formatWeight(leftWeightValue);
    rightWeight.textContent = formatWeight(rightWeightValue);

    // Ajustar inclinación de la balanza
    const difference = leftWeightValue - rightWeightValue;
    const maxAngle = 25; // ángulo máximo de inclinación
    
    let angle = 0;
    if (Math.abs(difference) > 10) {
        angle = Math.min(Math.max(-maxAngle, difference * 0.5), maxAngle);
    } else {
        angle = difference * 0.5;
    }
    
    scaleArm.style.transform = `rotate(${angle}deg)`;
}

function getRandomColor() {
    const colors = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#33FFF3', '#FFA533', '#A533FF', '#33FFAA', '#FF3353'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function renderMaterials(availableMaterials) {
    materialsContainer.innerHTML = '';
    
    availableMaterials.forEach(material => {
        const materialButton = document.createElement('button');
        materialButton.className = `material-button ${material.type.toLowerCase()}`;
        materialButton.textContent = `${material.type} (${material.weight}g)`;
        materialButton.dataset.id = material.id;
        materialButton.dataset.type = material.type;
        materialButton.dataset.weight = material.weight;
        
        materialButton.addEventListener('click', () => {
            if (selectedMaterial) {
                document.querySelector(`.material-button.selected-material`)?.classList.remove('selected-material');
            }
            
            selectedMaterial = {
                id: material.id,
                type: material.type,
                weight: material.weight
            };
            
            materialButton.classList.add('selected-material');
            sideSelection.classList.remove('hidden');
        });
        
        materialsContainer.appendChild(materialButton);
    });
}

function renderTeams(teams) {
    teamsContainer.innerHTML = '';
    
    teams.forEach(team => {
        const teamBox = document.createElement('div');
        teamBox.className = 'team-box';
        teamBox.textContent = `Equipo ${team.id}: ${team.players.join(', ')}`;
        teamBox.style.borderLeft = `4px solid ${getRandomColor()}`;
        teamsContainer.appendChild(teamBox);
    });
}

function renderScaleMaterials(side, materials) {
    const container = side === 'left' ? leftMaterials : rightMaterials;
    container.innerHTML = '';
    
    materials.forEach(material => {
        const materialItem = document.createElement('div');
        materialItem.className = `material-item ${material.type.toLowerCase()}`;
        materialItem.textContent = material.type;
        container.appendChild(materialItem);
    });
}

function updateGameUI(gameState) {
    // Actualizar información del turno
    currentTurn.textContent = gameState.currentTurn;
    currentPlayer.textContent = gameState.currentPlayer?.name || '-';
    waitingPlayer.textContent = gameState.currentPlayer?.name || '-';
    
    // Actualizar balanza
    updateScaleDisplay(gameState.leftWeight, gameState.rightWeight);
    renderScaleMaterials('left', gameState.leftMaterials);
    renderScaleMaterials('right', gameState.rightMaterials);
    
    // Actualizar equipos
    if (gameState.teams && gameState.teams.length > 0) {
        renderTeams(gameState.teams);
    }
    
    // Verificar si es el turno del jugador actual
    if (gameState.currentPlayer && gameState.currentPlayer.id === playerId && !eliminated) {
        isYourTurn.classList.remove('hidden');
        waitingTurn.classList.add('hidden');
        skipTurnBtn.classList.remove('hidden');
        renderMaterials(gameState.availableMaterials || []);
    } else {
        isYourTurn.classList.add('hidden');
        waitingTurn.classList.remove('hidden');
        skipTurnBtn.classList.add('hidden');
        sideSelection.classList.add('hidden');
    }
    
    // Reiniciar timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    if (gameState.turnActive) {
        let timeLeft = 30; // 30 segundos por turno
        timer.textContent = timeLeft;
        
        timerInterval = setInterval(() => {
            timeLeft--;
            timer.textContent = timeLeft;
            
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                // Socket se encargará de manejar el tiempo agotado
            }
        }, 1000);
    }
}

function startGame() {
    if (isHost) {
        socket.emit('startGame', { gameId });
    }
}

function placeMaterial(side) {
    if (!selectedMaterial) return;
    
    socket.emit('placeMaterial', {
        gameId,
        playerId,
        materialId: selectedMaterial.id,
        side: side
    });
    
    selectedMaterial = null;
    sideSelection.classList.add('hidden');
    document.querySelector('.material-button.selected-material')?.classList.remove('selected-material');
}

function skipTurn() {
    socket.emit('skipTurn', {
        gameId,
        playerId
    });
}

// Eventos de navegación
createGameBtn.addEventListener('click', () => {
    showScreen(screens.create);
});

joinGameBtn.addEventListener('click', () => {
    showScreen(screens.join);
});

backFromCreateBtn.addEventListener('click', () => {
    showScreen(screens.welcome);
});

backFromJoinBtn.addEventListener('click', () => {
    showScreen(screens.join);
});

copyCodeBtn.addEventListener('click', () => {
    const code = gameCodeDisplay.textContent;
    navigator.clipboard.writeText(code)
        .then(() => {
            showNotification('Código copiado al portapapeles');
        })
        .catch(() => {
            showNotification('No se pudo copiar el código');
        });
});

startGameBtn.addEventListener('click', startGame);

selectLeftBtn.addEventListener('click', () => placeMaterial('left'));
selectRightBtn.addEventListener('click', () => placeMaterial('right'));
cancelSelectionBtn.addEventListener('click', () => {
    selectedMaterial = null;
    sideSelection.classList.add('hidden');
    document.querySelector('.material-button.selected-material')?.classList.remove('selected-material');
});

skipTurnBtn.addEventListener('click', skipTurn);

nextTurnBtn.addEventListener('click', () => {
    if (gameState.gameEnded) {
        showScreen(screens.finalResults);
    } else {
        showScreen(screens.game);
        socket.emit('readyForNextTurn', { gameId, playerId });
    }
});

playAgainBtn.addEventListener('click', () => {
    location.reload();
});

notificationOkBtn.addEventListener('click', () => {
    notificationModal.style.display = 'none';
});

eliminationOkBtn.addEventListener('click', () => {
    eliminationModal.style.display = 'none';
});

// Cerrar modales al hacer clic en la X
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
        event.target.closest('.modal').style.display = 'none';
    });
});

// Manejadores de formularios
createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostName = document.getElementById('host-name').value;
    
    if (hostName) {
        playerName = hostName;
        isHost = true;
        
        socket.emit('createGame', { hostName }, (response) => {
            if (response.success) {
                gameId = response.gameId;
                playerId = response.playerId;
                gameCodeDisplay.textContent = response.gameCode;
                showScreen(screens.hostWaiting);
            } else {
                showNotification(response.message || 'Error al crear el juego');
            }
        });
    }
});

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCode = document.getElementById('game-code').value;
    const name = document.getElementById('player-name').value;
    
    if (gameCode && name) {
        playerName = name;
        
        socket.emit('joinGame', { gameCode, playerName: name }, (response) => {
            if (response.success) {
                gameId = response.gameId;
                playerId = response.playerId;
                showScreen(screens.playerWaiting);
            } else {
                showNotification(response.message || 'Error al unirse al juego');
            }
        });
    }
});

// Eventos de Socket.IO
socket.on('playerJoined', (data) => {
    const { players, count } = data;
    
    playersList.innerHTML = '';
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        playersList.appendChild(li);
    });
    
    playerCount.textContent = count;
    joinedCount.textContent = count;
    
    if (isHost && count >= 10) {
        startGameBtn.disabled = false;
        document.getElementById('waiting-message').innerHTML = 
            '<p>¡Ya hay 10 jugadores! Puedes iniciar el juego.</p>';
    }
});

socket.on('gameStarted', (data) => {
    gameState = data.gameState;
    materials = data.materials || [];
    
    updateGameUI(gameState);
    showScreen(screens.game);
});

socket.on('gameStateUpdated', (data) => {
    gameState = data.gameState;
    updateGameUI(gameState);
});

socket.on('turnResult', (data) => {
    gameState = data.gameState;
    
    let resultText = '';
    if (data.balanced) {
        resultTitle.textContent = '¡Balanza Equilibrada!';
        resultText = 'La balanza se mantiene equilibrada. El juego continúa.';
    } else {
        resultTitle.textContent = '¡Balanza Desequilibrada!';
        resultText = `La balanza se ha desequilibrado. ¡${data.eliminatedPlayers.map(p => p.name).join(', ')} ${data.eliminatedPlayers.length > 1 ? 'han sido eliminados' : 'ha sido eliminado'}!`;
    }
    
    if (data.eliminatedPlayers.some(p => p.id === playerId)) {
        eliminated = true;
        showEliminationModal();
    }
    
    resultMessage.textContent = resultText;
    
    // Mostrar resumen del turno
    turnSummaryList.innerHTML = '';
    const summaryItems = [
        `Jugador: ${data.currentPlayerName}`,
        `Material: ${data.material ? data.material.type : 'Ninguno'} (${data.material ? data.material.weight + 'g' : '0g'})`,
        `Lado: ${data.side === 'left' ? 'Izquierdo' : data.side === 'right' ? 'Derecho' : 'Ninguno'}`,
        `Peso izquierdo: ${formatWeight(data.leftWeight)}g`,
        `Peso derecho: ${formatWeight(data.rightWeight)}g`,
        `Diferencia: ${formatWeight(Math.abs(data.leftWeight - data.rightWeight))}g`
    ];
    
    summaryItems.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        turnSummaryList.appendChild(li);
    });
    
    showScreen(screens.turnResult);
});

socket.on('gameOver', (data) => {
    gameState = data.gameState;
    
    // Mostrar ganadores
    winnersList.innerHTML = '';
    data.winners.forEach(winner => {
        const li = document.createElement('li');
        li.textContent = `${winner.name} ${winner.isTeam ? '(Equipo)' : '(Individual)'}`;
        winnersList.appendChild(li);
    });
    
    // Mostrar estado final de la balanza
    finalScaleInfo.innerHTML = `
        <p>Peso izquierdo: ${formatWeight(data.leftWeight)}g</p>
        <p>Peso derecho: ${formatWeight(data.rightWeight)}g</p>
        <p>Diferencia: ${formatWeight(Math.abs(data.leftWeight - data.rightWeight))}g</p>
    `;
    
    // Mostrar jugadores eliminados
    eliminatedList.innerHTML = '';
    data.eliminatedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;
        eliminatedList.appendChild(li);
    });
    
    showScreen(screens.finalResults);
});

socket.on('error', (data) => {
    showNotification(data.message);
});

// Inicializar la aplicación
showScreen(screens.welcome);
