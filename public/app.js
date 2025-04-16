// --- Conexión Socket.IO ---
const socket = io();

// --- Selectores DOM (Actualizar según HTML final) ---
const screens = {
    welcome: document.getElementById('welcome-screen'),
    create: document.getElementById('create-screen'),
    join: document.getElementById('join-screen'),
    waiting: document.getElementById('waiting-screen'), // Pantalla de espera unificada
    game: document.getElementById('game-screen'),
    finalResults: document.getElementById('final-results-screen'),
};

// Botones Navegación/Acción
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const backFromCreateBtn = document.getElementById('back-from-create');
const backFromJoinBtn = document.getElementById('back-from-join');
const startGameBtn = document.getElementById('start-game-btn'); // En waiting screen
const copyCodeBtn = document.getElementById('copy-code-btn');
const placeSelectedBtn = document.getElementById('place-selected-btn');
const cancelPlacementBtn = document.getElementById('cancel-placement-btn');
const guessWeightsBtn = document.getElementById('guess-weights-btn');
const playAgainBtn = document.getElementById('play-again-btn');

// Formularios
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
const guessForm = document.getElementById('guess-form');

// Displays Espera
const waitGameCodeDisplay = document.getElementById('wait-game-code-display');
const waitPlayerCount = document.getElementById('wait-player-count');
const waitPlayersList = document.getElementById('wait-players-list');
const hostInstructions = document.getElementById('host-instructions');
const playerWaitMessage = document.getElementById('player-wait-message');

// Displays Juego
const currentPlayerIndicator = document.getElementById('current-player-indicator');
const gameTimer = document.getElementById('game-timer');
const knownInfoText = document.getElementById('known-info-text');
const lastGuessInfoCard = document.querySelector('.last-guess-info');
const lastGuessText = document.getElementById('last-guess-text');

// Balanzas
const mainScaleArm = document.getElementById('main-scale-arm');
const mainLeftMaterials = document.getElementById('main-left-materials');
const mainRightMaterials = document.getElementById('main-right-materials');
const mainLeftWeight = document.getElementById('main-left-weight');
const mainRightWeight = document.getElementById('main-right-weight');
const mainBalanceStatus = document.getElementById('main-balance-status');

const secondaryScaleArm = document.getElementById('secondary-scale-arm');
const secondaryLeftMaterials = document.getElementById('secondary-left-materials');
const secondaryRightMaterials = document.getElementById('secondary-right-materials');
const secondaryLeftWeight = document.getElementById('secondary-left-weight');
const secondaryRightWeight = document.getElementById('secondary-right-weight');

// Área del Jugador
const myTurnIndicator = document.getElementById('my-turn-indicator');
const waitingTurnIndicator = document.getElementById('waiting-turn-indicator');
const myInventoryContainer = document.getElementById('my-inventory-container');
const myMineralCount = document.getElementById('my-mineral-count');
const placementControlsSection = document.getElementById('placement-controls-section');
const selectedCountSpan = document.getElementById('selected-count');
const targetScaleSelect = document.getElementById('target-scale-select');
const targetSideSelect = document.getElementById('target-side-select');
const placementError = document.getElementById('placement-error');
const cannotPlaceMessage = document.getElementById('cannot-place-message');

// Sidebar Jugadores
const gamePlayersList = document.getElementById('game-players-list');

// Modales
const guessModal = document.getElementById('guess-modal');
const notificationModal = document.getElementById('notification-modal');
const notificationMessage = document.getElementById('notification-message');

// Estado del Cliente
let gameId = null;
let playerId = null;
let isHost = false;
let gameState = null; // Guarda el último estado recibido del servidor
let currentScreen = screens.welcome;
let selectedMineralInstanceIds = []; // IDs de los minerales seleccionados del inventario
let turnTimerInterval = null; // Intervalo para el timer de turno
const MIN_WEIGHT = 1; // Constante para validación
const MAX_WEIGHT = 20; // Constante para validación
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura']; // Para formulario


// --- Funciones de Utilidad y UI ---

function showScreen(screenElement) {
    if (!screenElement || currentScreen === screenElement) return;
    console.log(`Switching screen to: ${screenElement.id}`);

    const outgoingScreen = currentScreen;
    currentScreen = screenElement;

    anime({
        targets: outgoingScreen,
        opacity: [1, 0],
        duration: 200,
        easing: 'easeInQuad',
        complete: () => {
            outgoingScreen.classList.remove('active');
            outgoingScreen.style.display = 'none';

            screenElement.style.opacity = 0;
            screenElement.classList.add('active');
            screenElement.style.display = 'flex';

            anime({
                targets: screenElement,
                opacity: [0, 1],
                duration: 300,
                easing: 'easeOutQuad',
            });
             if (screenElement === screens.game && gameState) {
                 updateGameUI(gameState);
             }
             // Log para confirmar finalización
             console.log(`showScreen: Transition to ${screenElement.id} complete.`);
        }
    });
}

function showModal(modalElement) {
    if (!modalElement) return;
    const modalContent = modalElement.querySelector('.modal-content');
    anime.set(modalElement, { display: 'block', opacity: 0 });
    anime.set(modalContent, { opacity: 0, scale: 0.9 });
    anime({ targets: modalElement, opacity: 1, duration: 300, easing: 'easeOutQuad' });
    anime({ targets: modalContent, opacity: 1, scale: 1, duration: 400, delay: 50, easing: 'easeOutBack' });
}

function hideModal(modalElement) {
    if (!modalElement) return;
    const modalContent = modalElement.querySelector('.modal-content');
    anime({ targets: modalContent, opacity: 0, scale: 0.9, duration: 300, easing: 'easeInQuad' });
    anime({
        targets: modalElement, opacity: 0, duration: 350, delay: 50, easing: 'easeInQuad',
        complete: () => modalElement.style.display = 'none'
    });
}

function showNotification(message) {
    if(notificationMessage) notificationMessage.textContent = message;
    showModal(notificationModal);
}

function formatWeight(weight) {
    return (typeof weight === 'number') ? weight.toFixed(0) : '0'; // Pesos enteros
}

// Actualiza UNA balanza (principal o secundaria) - CON UMBRAL DEFINIDO
function updateSingleScaleDisplay(scalePrefix, scaleData) {
    if (!scaleData) {
        console.warn(`updateSingleScaleDisplay: No scaleData provided for ${scalePrefix}`);
        return;
    }
    const scaleArm = document.getElementById(`${scalePrefix}-scale-arm`);
    const leftWeightEl = document.getElementById(`${scalePrefix}-left-weight`);
    const rightWeightEl = document.getElementById(`${scalePrefix}-right-weight`);
    const leftMaterialsEl = document.getElementById(`${scalePrefix}-left-materials`);
    const rightMaterialsEl = document.getElementById(`${scalePrefix}-right-materials`);

    const leftWeight = scaleData.leftWeight || 0;
    const rightWeight = scaleData.rightWeight || 0;

    const threshold = 1; // Definir el umbral de equilibrio (ej: 1g o menos)

    if(leftWeightEl) leftWeightEl.textContent = formatWeight(leftWeight);
    if(rightWeightEl) rightWeightEl.textContent = formatWeight(rightWeight);

    renderScaleMaterialsStack(leftMaterialsEl, scaleData.leftMaterials || []);
    renderScaleMaterialsStack(rightMaterialsEl, scaleData.rightMaterials || []);

    if (scaleArm) {
        const difference = leftWeight - rightWeight;
        const maxAngle = 15;
        const sensitivity = 0.2;

        let angle = 0;
        if (Math.abs(difference) > threshold) {
            angle = Math.sign(difference) * Math.min(maxAngle, Math.abs(difference) * sensitivity);
        }

        const currentRotation = anime.get(scaleArm, 'rotate', 'deg') || 0;
        if (Math.abs(currentRotation - angle) > 0.1) {
             anime({
                targets: scaleArm,
                rotate: [currentRotation, angle],
                duration: 800,
                easing: 'easeOutElastic(1, .7)'
            });
        } else {
            anime.set(scaleArm, { rotate: angle });
        }
    }

    if (scalePrefix === 'main') {
        const isBalanced = Math.abs(leftWeight - rightWeight) <= threshold;
        if (mainBalanceStatus) mainBalanceStatus.textContent = isBalanced ? '(Equilibrada)' : '(Desequilibrada)';

        if (guessWeightsBtn && gameState) {
             const canGuessNow = isBalanced && gameState.myTurn && gameState.iCanGuess;
             guessWeightsBtn.disabled = !canGuessNow;
             guessWeightsBtn.title = canGuessNow ? "Adivinar pesos de todos los minerales" : (
                !isBalanced ? "La balanza principal debe estar equilibrada" :
                !gameState.myTurn ? "No es tu turno" :
                !gameState.iCanGuess ? "Ya no puedes adivinar (revisa piezas/minerales)" : "Condición desconocida"
             );
        }
    }
}

// Renderiza los divs de materiales en una pila específica
function renderScaleMaterialsStack(container, materialsList) {
    if (!container) return;
    const fragment = document.createDocumentFragment();
    const itemsToAnimate = [];
    const existingElementsMap = new Map();
    container.childNodes.forEach(node => {
        if (node.dataset && node.dataset.instanceId) {
            existingElementsMap.set(node.dataset.instanceId, node);
        }
    });

    materialsList.forEach(mat => {
        const div = document.createElement('div');
        const typeClass = mat.type ? mat.type.toLowerCase() : 'desconocido';
        div.className = `material-item ${typeClass}`;
        div.textContent = `${mat.type || '?'} (${formatWeight(mat.weight)}g)`;
        div.dataset.instanceId = mat.instanceId;

        if (!existingElementsMap.has(mat.instanceId)) {
             div.style.opacity = 0;
             div.style.transform = 'translateY(5px) scale(0.9)';
             itemsToAnimate.push(div);
        }
        fragment.appendChild(div);
    });

     container.innerHTML = '';
     container.appendChild(fragment);

     if (itemsToAnimate.length > 0) {
         anime({
             targets: itemsToAnimate,
             opacity: [0, 1],
             translateY: [5, 0],
             scale: [0.9, 1],
             delay: anime.stagger(50),
             duration: 400,
             easing: 'easeOutExpo'
         });
     }
}


// Renderiza el inventario del jugador con selección múltiple
function renderPlayerInventory(inventory) {
    if (!myInventoryContainer) return;
    myInventoryContainer.innerHTML = '';

    const previouslySelected = new Set(selectedMineralInstanceIds);
    selectedMineralInstanceIds = [];

    if (!Array.isArray(inventory) || inventory.length === 0) {
        myInventoryContainer.innerHTML = '<p class="info-text">No te quedan minerales.</p>';
        if (myMineralCount) myMineralCount.textContent = '0';
        if(cannotPlaceMessage) cannotPlaceMessage.classList.remove('hidden');
        updatePlacementControls();
        return;
    }

    if(cannotPlaceMessage) cannotPlaceMessage.classList.add('hidden');
    if (myMineralCount) myMineralCount.textContent = inventory.length;

    inventory.forEach(mineral => {
        const button = document.createElement('button');
        const typeClass = mineral.type ? mineral.type.toLowerCase() : 'desconocido';
        button.className = `material-button inventory-item ${typeClass}`;
        button.textContent = `${mineral.type || '?'} (${formatWeight(mineral.weight)}g)`;
        button.dataset.instanceId = mineral.instanceId;
        button.disabled = !(gameState?.myTurn && gameState?.iCanPlaceMinerals);

        if (previouslySelected.has(mineral.instanceId)) {
             button.classList.add('selected-material');
             if (!button.disabled) {
                selectedMineralInstanceIds.push(mineral.instanceId);
             }
        }

        button.addEventListener('click', () => {
            if (button.disabled) return;

            button.classList.toggle('selected-material');
            const id = mineral.instanceId;
            const isSelected = button.classList.contains('selected-material');

            if (isSelected) {
                if (!selectedMineralInstanceIds.includes(id)) selectedMineralInstanceIds.push(id);
            } else {
                selectedMineralInstanceIds = selectedMineralInstanceIds.filter(selId => selId !== id);
            }
            updatePlacementControls();
        });
        myInventoryContainer.appendChild(button);
    });

    updatePlacementControls();
}

// Actualiza la sección de controles de colocación
function updatePlacementControls() {
    if (!placementControlsSection) return;
    const count = selectedMineralInstanceIds.length;
    const canPlaceNow = count >= 2 && gameState?.myTurn && gameState?.iCanPlaceMinerals;

    placementControlsSection.classList.toggle('hidden', count === 0 || !gameState?.myTurn);

    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (placeSelectedBtn) placeSelectedBtn.disabled = !canPlaceNow;
    if (placementError) placementError.classList.toggle('hidden', count >= 2 || count === 0);

    if(targetScaleSelect) targetScaleSelect.disabled = count === 0;
    if(targetSideSelect) targetSideSelect.disabled = count === 0;
}

// Función PRINCIPAL para actualizar TODA la UI (CORREGIDA - Usa gameState.currentPlayer)
function updateGameUI(newState) {
    if (!newState) {
        console.warn("updateGameUI llamado sin estado válido.");
        return;
    }
    gameState = newState;

    console.log("Updating UI - CurrentPlayer from state:", gameState.currentPlayer);

    const currentPlayer = gameState.currentPlayer;

    if (currentPlayerIndicator) {
        currentPlayerIndicator.textContent = currentPlayer
            ? `${currentPlayer.name} (T${currentPlayer.turnOrder})`
            : (gameState.status.startsWith('finished') ? 'Juego Terminado' : 'Esperando...');
    } else { console.warn("Elemento 'currentPlayerIndicator' no encontrado."); }

    if (knownInfoText) {
         knownInfoText.textContent = gameState.knownMineralInfo?.description || '-';
    } else { console.warn("Elemento 'knownInfoText' no encontrado."); }

    if (lastGuessInfoCard) {
        const lastGuess = gameState.lastGuessResult;
        const guesserInfo = lastGuess ? gameState.playersPublicInfo?.find(p => p.id === lastGuess.playerId) : null;
        if (lastGuess && !lastGuess.correct && guesserInfo) {
             if (lastGuessText) lastGuessText.textContent = `El intento de ${guesserInfo.name} fue incorrecto.`;
             lastGuessInfoCard.classList.remove('hidden');
        } else {
            lastGuessInfoCard.classList.add('hidden');
        }
    }

    updateSingleScaleDisplay('main', gameState.mainScale);
    updateSingleScaleDisplay('secondary', gameState.secondaryScale);

    if (myTurnIndicator) myTurnIndicator.classList.toggle('hidden', !gameState.myTurn);
    if (waitingTurnIndicator) waitingTurnIndicator.classList.toggle('hidden', gameState.myTurn || gameState.status !== 'playing');

    renderPlayerInventory(gameState.myInventory || []);

    if(cannotPlaceMessage) cannotPlaceMessage.classList.toggle('hidden', gameState.iCanPlaceMinerals ?? true);

    if (gamePlayersList) {
        gamePlayersList.innerHTML = '';
        gameState.playersPublicInfo?.forEach(p => {
            const li = document.createElement('li');
            li.className = p.isActive ? 'player-active' : 'player-inactive';
            if (p.id === playerId) li.classList.add('my-player-row');
            if (p.id === gameState.currentPlayer?.id) li.classList.add('current-player-row');

             const mineralCountDisplay = (typeof p.mineralCount === 'number') ? p.mineralCount : '?';

            li.innerHTML = `
                <span class="player-order">${p.turnOrder || '?'}</span>.
                <span class="player-name">${p.name || '??'} ${p.id === playerId ? '(Tú)' : ''}</span>
                <span class="player-minerals">(<i class="fas fa-gem"></i> ${mineralCountDisplay})</span>
                ${!p.isActive ? '<span class="player-status">(Desc.)</span>' : ''}
                ${p.isActive && !(p.canPlaceMinerals ?? true) ? '<span class="player-status">(No Juega)</span>' : ''}
                ${p.id === gameState.currentPlayer?.id ? '<i class="fas fa-star player-turn-star"></i>' : ''}
            `;
            gamePlayersList.appendChild(li);
        });
    } else { console.warn("Elemento 'gamePlayersList' no encontrado."); }

    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = null;
    if (gameState.myTurn && gameState.status === 'playing') {
        startTurnTimer(5 * 60);
    } else {
         if (gameTimer) gameTimer.textContent = '--:--';
         if (gameTimer) gameTimer.classList.remove('timer-alert');
    }
}

// Inicia el temporizador de turno
function startTurnTimer(durationSeconds) {
    let remaining = durationSeconds;
    if (!gameTimer) return;

    const updateDisplay = () => {
        if(!gameTimer) return;
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        gameTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        gameTimer.classList.toggle('timer-alert', remaining <= 30 && remaining > 0);
    };

    updateDisplay();
    turnTimerInterval = setInterval(() => {
        remaining--;
        updateDisplay();
        if (remaining < 0) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
            console.log("¡Tiempo de turno agotado!");
        }
    }, 1000);
}


// --- Event Listeners de Controles del Cliente ---

// Navegación inicial
createBtn?.addEventListener('click', () => showScreen(screens.create));
joinBtn?.addEventListener('click', () => showScreen(screens.join));
backFromCreateBtn?.addEventListener('click', () => showScreen(screens.welcome));
backFromJoinBtn?.addEventListener('click', () => showScreen(screens.welcome));

// Copiar código
copyCodeBtn?.addEventListener('click', () => {
    const code = waitGameCodeDisplay?.textContent;
    if (code && code !== '------' && navigator.clipboard) {
        navigator.clipboard.writeText(code)
            .then(() => showNotification('Código copiado: ' + code))
            .catch(err => showNotification('Error al copiar el código.'));
    }
});

// Crear Juego
createForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostNameInput = document.getElementById('host-name');
    const hostName = hostNameInput?.value.trim();
    const submitBtn = createForm.querySelector('button[type="submit"]');

    if (hostName && submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';
        socket.emit('createGame', { hostName }, (response) => {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Crear';
            if (response?.success) {
                gameId = response.gameId;
                playerId = response.playerId;
                isHost = true;
                if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = response.gameCode;
                showScreen(screens.waiting);
                if(hostInstructions) hostInstructions.classList.remove('hidden');
                if(startGameBtn) startGameBtn.classList.remove('hidden');
                if(playerWaitMessage) playerWaitMessage.classList.add('hidden');
                if(waitPlayersList) waitPlayersList.innerHTML = `<li>1. ${hostName} (Host)</li>`;
                if(waitPlayerCount) waitPlayerCount.textContent = '1';
                if(startGameBtn) startGameBtn.disabled = true; // Requiere mínimo 2 jugadores
            } else {
                showNotification(response?.message || 'Error al crear juego.');
            }
        });
    } else if (!hostName){
         showNotification("Ingresa tu nombre.");
    }
});

// Unirse a Juego
joinForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCodeInput = document.getElementById('join-game-code');
    const playerNameInput = document.getElementById('join-player-name');
    const gameCode = gameCodeInput?.value.trim().toUpperCase();
    const playerName = playerNameInput?.value.trim();
    const submitBtn = joinForm.querySelector('button[type="submit"]');

    if (gameCode && playerName && submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uniéndose...';
        socket.emit('joinGame', { gameCode, playerName }, (response) => {
             submitBtn.disabled = false;
             submitBtn.innerHTML = '<i class="fas fa-door-open"></i> Unirse';
             if (response?.success) {
                 gameId = response.gameId;
                 playerId = response.playerId;
                 isHost = false;
                 if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = gameCode;
                 showScreen(screens.waiting);
                 if(hostInstructions) hostInstructions.classList.add('hidden');
                 if(startGameBtn) startGameBtn.classList.add('hidden');
                 if(playerWaitMessage) playerWaitMessage.classList.remove('hidden');
             } else {
                 showNotification(response?.message || 'Error al unirse al juego.');
             }
        });
    } else {
         showNotification("Ingresa el código y tu nombre.");
    }
});

// Iniciar Juego (Host)
startGameBtn?.addEventListener('click', () => {
    if (isHost && gameId && !startGameBtn.disabled) {
        console.log("Host iniciando juego...");
        startGameBtn.disabled = true;
        startGameBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...';
        socket.emit('startGame', { gameId });
    }
});

// Colocar Minerales Seleccionados
placeSelectedBtn?.addEventListener('click', () => {
    if (placeSelectedBtn.disabled) return;

    const placements = selectedMineralInstanceIds.map(instanceId => ({
        mineralInstanceId: instanceId,
        targetScale: targetScaleSelect?.value || 'main',
        targetSide: targetSideSelect?.value || 'left'
    }));

    console.log("Intentando colocar:", placements);
    socket.emit('placeMinerals', { gameId, playerId, placements });

    placeSelectedBtn.disabled = true;
    cancelPlacementBtn.disabled = true;
    myInventoryContainer?.querySelectorAll('.inventory-item').forEach(btn => btn.disabled = true);
});

// Limpiar Selección de Minerales
cancelPlacementBtn?.addEventListener('click', () => {
    selectedMineralInstanceIds = [];
    myInventoryContainer?.querySelectorAll('.selected-material').forEach(btn => {
        btn.classList.remove('selected-material');
    });
    updatePlacementControls();
});

// Abrir Modal de Adivinanza
guessWeightsBtn?.addEventListener('click', () => {
    if (guessWeightsBtn.disabled) return;
    guessForm?.reset();
    guessForm?.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    showModal(guessModal);
});

// Enviar Adivinanza
guessForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const guesses = {};
    let formIsValid = true;
    MINERAL_TYPES.forEach(type => {
        const input = guessForm.elements[type];
        const value = parseInt(input?.value);
        input?.classList.remove('input-error');
        if (isNaN(value) || value < MIN_WEIGHT || value > MAX_WEIGHT) {
             formIsValid = false;
             input?.classList.add('input-error');
        } else {
            guesses[type] = value;
        }
    });

    if (!formIsValid) {
        showNotification(`Ingresa pesos válidos (${MIN_WEIGHT}-${MAX_WEIGHT}g) para todos los minerales.`);
        return;
    }

    console.log("Enviando adivinanza:", guesses);
    socket.emit('guessWeights', { gameId, playerId, guesses });
    hideModal(guessModal);
    if(guessWeightsBtn) guessWeightsBtn.disabled = true;
});

// Jugar Otra Vez (Recargar)
playAgainBtn?.addEventListener('click', () => {
     anime({
        targets: 'body',
        opacity: 0,
        duration: 400,
        easing: 'easeInQuad',
        complete: () => location.reload()
    });
});

// Cerrar Modales
document.querySelectorAll('.modal .close-btn, .modal .modal-cancel-btn, #notification-ok').forEach(btn => {
    btn.addEventListener('click', (event) => {
        const modal = event.target.closest('.modal');
        if (modal) hideModal(modal);
    });
});


// --- Event Listeners de Socket.IO ---

socket.on('connect', () => {
    console.log('Conectado al servidor WebSocket.');
});

socket.on('disconnect', (reason) => {
    console.warn('Desconectado del servidor:', reason);
    showNotification(`Desconexión: ${reason}. Recarga para continuar.`);
});

socket.on('error', (data) => {
    console.error('Error recibido del servidor:', data.message);
    showNotification(`Error del servidor: ${data.message}`);
    // Habilitar botones importantes si estaban deshabilitados
     const createSubmitBtn = createForm?.querySelector('button[type="submit"]');
     if(createSubmitBtn) { createSubmitBtn.disabled = false; createSubmitBtn.innerHTML = '<i class="fas fa-check"></i> Crear'; }
     const joinSubmitBtn = joinForm?.querySelector('button[type="submit"]');
     if(joinSubmitBtn) { joinSubmitBtn.disabled = false; joinSubmitBtn.innerHTML = '<i class="fas fa-door-open"></i> Unirse'; }
     if(startGameBtn) { startGameBtn.disabled = (waitPlayerCount?.textContent < 2); startGameBtn.innerHTML = '<i class="fas fa-play"></i> Iniciar Juego'; } // Rehabilita si hay suficientes jugadores

});

// Actualiza lista de jugadores en sala de espera
socket.on('playerListUpdated', (data) => {
    console.log("Recibido playerListUpdated:", data);
    if (currentScreen === screens.waiting && waitPlayersList && waitPlayerCount && startGameBtn) {
        waitPlayersList.innerHTML = '';
        data.players?.forEach(p => {
            const li = document.createElement('li');
            li.textContent = `${p.turnOrder}. ${p.name} ${p.id === playerId ? '(Tú)' : ''}`;
            li.classList.toggle('inactive', !p.isActive);
            waitPlayersList.appendChild(li);
        });
        const currentCount = data.count ?? 0;
        waitPlayerCount.textContent = currentCount;
        if (isHost) {
             startGameBtn.disabled = (currentCount < 2); // Habilitar si hay 2 o más
        }
    }
});

// El juego ha comenzado (CORREGIDO - Sin reseteo de botón)
socket.on('gameStarted', ({ gameState }) => {
    console.log("Recibido gameStarted:", gameState);
    if (gameState) {
        gameId = gameState.gameId;
        showScreen(screens.game);
        updateGameUI(gameState);
        console.log("gameStarted handler: Screen switched and UI updated.");
    } else {
        showNotification("Error: No se recibió estado válido al iniciar el juego.");
        // Habilitar botón de inicio si falla (por si el host necesita reintentar)
        if(isHost && startGameBtn) {
             startGameBtn.disabled = (waitPlayerCount?.textContent < 2); // Habilitar si hay suficientes
             startGameBtn.innerHTML = '<i class="fas fa-play"></i> Iniciar Juego';
        }
    }
});

// Actualización del estado del juego durante la partida
socket.on('gameStateUpdated', ({ gameState }) => {
    console.log("Recibido gameStateUpdated:", gameState);
     if (gameState) {
        gameId = gameState.gameId;
         const wasMyTurnBefore = gameState?.myTurn; // Captura estado anterior

         updateGameUI(gameState); // Actualizar la UI con el nuevo estado

         // Si estamos en la pantalla de juego
         if (currentScreen === screens.game) {
             // Reactivar controles si ahora es mi turno y antes no lo era
             if (gameState.myTurn && !wasMyTurnBefore) {
                 console.log("Ahora es mi turno, reactivando controles si aplica.");
                  // Habilitar botones del inventario (renderPlayerInventory lo hace)
                  // Habilitar botones de colocar/cancelar (updatePlacementControls lo hace si hay selección)
                  updatePlacementControls();
                 if(guessWeightsBtn) { // Habilitar/deshabilitar botón de adivinar
                     guessWeightsBtn.disabled = !(gameState.isMainScaleBalanced && gameState.iCanGuess);
                 }
             }
             // Asegurar que botones de acción estén correctamente habilitados/deshabilitados
              if (gameState.myTurn) {
                 if(cancelPlacementBtn) cancelPlacementBtn.disabled = false;
                 // placeSelectedBtn se habilita/deshabilita en updatePlacementControls
             } else {
                  // Deshabilitar explícitamente si no es mi turno
                  if(placeSelectedBtn) placeSelectedBtn.disabled = true;
                  if(cancelPlacementBtn) cancelPlacementBtn.disabled = true;
                  if(guessWeightsBtn) guessWeightsBtn.disabled = true;
             }

         } else if (gameState.status === 'playing' && currentScreen === screens.waiting) {
             console.log("Juego empezó mientras esperaba, mostrando pantalla de juego.");
             showScreen(screens.game);
             // updateGameUI ya se llamó al inicio de la función
         }
     } else {
        console.warn("gameStateUpdated recibido sin gameState válido.");
     }
});

// Fin del juego
socket.on('gameOver', ({ gameState, actualWeights }) => {
    console.log("Recibido gameOver:", gameState, actualWeights);
    if (gameState) {
        updateGameUI(gameState); // Actualizar UI final antes de mostrar resultados

        const titleEl = document.getElementById('final-result-title');
        const messageEl = document.getElementById('final-result-message');
        const winnersEl = document.getElementById('final-winners');
        const weightsEl = document.getElementById('final-actual-weights');

        if (titleEl) titleEl.innerHTML = `<i class="fas ${gameState.status === 'finished_success' ? 'fa-trophy' : 'fa-times-circle'}"></i> ${gameState.status === 'finished_success' ? '¡Éxito!' : 'Fracaso'}`;
        if (messageEl) messageEl.textContent = gameState.status === 'finished_success'
            ? `¡${gameState.successfulGuesser?.name || 'Alguien'} adivinó correctamente!`
            : 'Nadie adivinó los pesos o la balanza no quedó equilibrada.';
        if (winnersEl) winnersEl.textContent = gameState.status === 'finished_success'
            ? `Ganador: ${gameState.successfulGuesser?.name || 'Desconocido'}`
            : 'Ganadores: Ninguno';

        if (weightsEl && actualWeights) {
            weightsEl.innerHTML = '';
            MINERAL_TYPES.forEach(type => {
                 const li = document.createElement('li');
                 li.innerHTML = `<strong>${type}:</strong> ${actualWeights[type] ?? '?'}g`;
                 weightsEl.appendChild(li);
            });
        } else if (weightsEl) {
             weightsEl.innerHTML = '<li>Error al obtener pesos finales.</li>';
        }

        showScreen(screens.finalResults);
    } else {
         console.error("gameOver recibido sin gameState válido.");
         showNotification("Error al recibir los resultados finales del juego.");
    }
});

// Notificación de jugador desconectado
socket.on('playerDisconnected', ({ playerName }) => {
    console.log(`${playerName} se ha desconectado.`);
    // Opcional: mostrar notificación no modal
});


// --- Inicialización al Cargar la Página ---
window.addEventListener('load', () => {
    Object.values(screens).forEach(s => { s.classList.remove('active'); s.style.display = 'none';});
    if (screens.welcome) {
        screens.welcome.classList.add('active');
        screens.welcome.style.display = 'flex';
        screens.welcome.style.opacity = 0;
        currentScreen = screens.welcome;
        anime({
            targets: screens.welcome,
            opacity: [0, 1],
            duration: 500,
            easing: 'easeOutQuad'
        });
         anime({
            targets: '#welcome-screen .animatable-button',
            opacity: [0, 1],
            translateY: [10, 0],
            delay: anime.stagger(100, {start: 100})
        });
    } else {
        console.error("Error: No se encontró la pantalla de bienvenida (#welcome-screen).");
    }
});