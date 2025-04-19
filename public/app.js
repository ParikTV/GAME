// public/app.js

// --- Conexión Socket.IO ---
const socket = io();

// --- Constantes del Cliente (Deben Sincronizarse con el Servidor) ---
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;
const PHASE2_TOTAL_ROUNDS = 3; // Para display
const PHASE2_TARGET_CORRECT_GUESSES = 3; // Para display
const PHASE2_GUESS_ATTEMPTS_PER_TURN = 2; // Para display
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'];

// --- Selectores DOM (Actualizados) ---
const screens = {
    welcome: document.getElementById('welcome-screen'),
    create: document.getElementById('create-screen'),
    join: document.getElementById('join-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen'),
    finalResults: document.getElementById('final-results-screen'),
};

// Botones Navegación/Acción
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const backFromCreateBtn = document.getElementById('back-from-create');
const backFromJoinBtn = document.getElementById('back-from-join');
const startGameBtn = document.getElementById('start-game-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const placeSelectedBtn = document.getElementById('place-selected-btn'); // Fase 1
const cancelPlacementBtn = document.getElementById('cancel-placement-btn'); // Fase 1
const passTurnBtn = document.getElementById('pass-turn-btn'); // Ambas Fases
const guessSingleWeightBtn = document.getElementById('guess-single-weight-btn'); // Fase 2
const playAgainBtn = document.getElementById('play-again-btn');
const voteYesBtn = document.getElementById('vote-yes-btn');
const voteNoBtn = document.getElementById('vote-no-btn');

// Formularios
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
// guessForm (viejo) eliminado

// Inputs y Selects
const guessSingleColorSelect = document.getElementById('guess-single-color-select');
const guessSingleWeightInput = document.getElementById('guess-single-weight-input');

// Displays Espera
const waitGameCodeDisplay = document.getElementById('wait-game-code-display');
const waitPlayerCount = document.getElementById('wait-player-count');
const waitPlayersList = document.getElementById('wait-players-list');
const hostInstructions = document.getElementById('host-instructions');
const playerWaitMessage = document.getElementById('player-wait-message');

// Displays Juego
const currentPlayerIndicator = document.getElementById('current-player-indicator');
const knownInfoText = document.getElementById('known-info-text');
const prizeAmountDisplay = document.getElementById('prize-amount-display');
const prizeConditionDisplay = document.getElementById('prize-condition-display');
const myHackerBytesDisplay = document.getElementById('my-hacker-bytes-display'); // Informativo al final

// Displays Fase 2
const phase2InfoCard = document.getElementById('phase2-info-card');
const phase2RoundIndicator = document.getElementById('phase2-round-indicator');
const phase2CorrectTotal = document.getElementById('phase2-correct-total');
const currentPrizePotDisplay = document.getElementById('current-prize-pot');
const phase2AttemptsLeft = document.getElementById('phase2-attempts-left');
const singleGuessFeedback = document.getElementById('single-guess-feedback');

// Elementos por Fase
const phase1Elements = document.querySelectorAll('.phase1-element');
const phase2Elements = document.querySelectorAll('.phase2-element');

// Balanzas
const mainScaleArm = document.getElementById('main-scale-arm');
const mainLeftPlatformVisual = document.getElementById('main-left-platform-visual');
const mainRightPlatformVisual = document.getElementById('main-right-platform-visual');
const mainLeftMaterials = document.getElementById('main-left-materials');
const mainRightMaterials = document.getElementById('main-right-materials');
const mainBalanceStatus = document.getElementById('main-balance-status');

const secondaryScaleArm = document.getElementById('secondary-scale-arm');
const secondaryLeftPlatformVisual = document.getElementById('secondary-left-platform-visual');
const secondaryRightPlatformVisual = document.getElementById('secondary-right-platform-visual');
const secondaryLeftMaterials = document.getElementById('secondary-left-materials');
const secondaryRightMaterials = document.getElementById('secondary-right-materials');

// Área del Jugador (Fase 1)
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
const votingModal = document.getElementById('voting-modal');
const notificationModal = document.getElementById('notification-modal');
const notificationMessage = document.getElementById('notification-message');
const balancerNameModal = document.getElementById('balancer-name-modal');
const voteStatusModal = document.getElementById('vote-status-modal');

// Displays Finales
const finalResultTitle = document.getElementById('final-result-title');
const finalResultMessage = document.getElementById('final-result-message');
const finalWinners = document.getElementById('final-winners');
const finalPrizeWon = document.getElementById('final-prize-won');
const finalPrizeAmount = document.getElementById('final-prize-amount');
const finalActualWeights = document.getElementById('final-actual-weights');


// --- Estado del Cliente ---
let gameId = null;
let playerId = null;
let isHost = false;
let gameState = null;
let currentScreen = screens.welcome;
let selectedMineralInstanceIds = []; // Para Fase 1
// turnTimerInterval eliminado o re-implementar si se necesita

// --- Funciones de Utilidad y UI ---

/** Muestra una pantalla con animación (sin cambios) */
function showScreen(screenElement) {
    if (!screenElement || currentScreen === screenElement) return;
    console.log(`CLIENT LOG: Switching screen to: ${screenElement.id}`);

    const outgoingScreen = currentScreen;
    currentScreen = screenElement;

    const outgoingAnimation = anime({
        targets: outgoingScreen,
        opacity: [1, 0],
        translateY: [0, 20],
        duration: 300,
        easing: 'easeInOutQuad',
        complete: () => {
            outgoingScreen.classList.remove('active');
            outgoingScreen.style.display = 'none';
            outgoingScreen.style.transform = 'translateY(0px)';
        }
    }).finished;

    outgoingAnimation.then(() => {
        screenElement.style.opacity = 0;
        screenElement.style.transform = 'translateY(20px)';
        screenElement.classList.add('active');
        screenElement.style.display = 'flex';

        anime({
            targets: screenElement,
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 400,
            easing: 'easeOutQuad',
            begin: () => {
                 // Actualizar UI *antes* de mostrar si es la pantalla de juego
                 if (screenElement === screens.game && gameState) {
                     console.log("CLIENT LOG: showScreen - Updating game UI before animating entry.");
                     updateGameUI(gameState);
                 }
                 const animatableElements = screenElement.querySelectorAll('.animatable-on-load');
                 if (animatableElements.length > 0) {
                     anime.set(animatableElements, { opacity: 0, translateY: 10 });
                     anime({
                         targets: animatableElements,
                         opacity: [0, 1],
                         translateY: [10, 0],
                         delay: anime.stagger(80, { start: 100 })
                     });
                 }
            },
            complete: () => {
                console.log(`CLIENT LOG: showScreen - Transition to ${screenElement.id} complete.`);
                 if (screenElement === screens.game) {
                     updatePlacementControlsVisibility(selectedMineralInstanceIds.length > 0); // Re-evaluar visibilidad
                 }
            }
        });
    });
}

/** Muestra un modal con animación (sin cambios) */
function showModal(modalElement) {
    if (!modalElement || modalElement.style.display === 'flex') return; // No mostrar si ya está visible
    const modalContent = modalElement.querySelector('.modal-content');
    anime.set(modalElement, { display: 'flex', opacity: 0 });
    anime.set(modalContent, { opacity: 0, scale: 0.8, translateY: -20 });
    anime({ targets: modalElement, opacity: [0, 1], duration: 300, easing: 'linear' });
    anime({
        targets: modalContent,
        opacity: [0, 1],
        scale: [0.8, 1],
        translateY: [-20, 0],
        duration: 400,
        delay: 50,
        easing: 'easeOutElastic(1, .8)'
    });
}

/** Oculta un modal con animación (sin cambios) */
function hideModal(modalElement) {
    if (!modalElement || modalElement.style.display === 'none') return;
    const modalContent = modalElement.querySelector('.modal-content');
    anime({ targets: modalContent, opacity: 0, scale: 0.8, translateY: -20, duration: 300, easing: 'easeInQuad' });
    anime({
        targets: modalElement,
        opacity: 0,
        duration: 350,
        delay: 100,
        easing: 'linear',
        complete: () => modalElement.style.display = 'none'
    });
}

/** Muestra una notificación (sin cambios) */
function showNotification(message, title = 'Notificación') {
    const notificationTitleEl = document.getElementById('notification-title');
    if(notificationTitleEl) notificationTitleEl.innerHTML = `<i class="fas fa-info-circle"></i> ${title}`;
    if(notificationMessage) notificationMessage.textContent = message;
    showModal(notificationModal);
}

/** Formatea un peso (sin cambios) */
function formatWeight(weight) { return (typeof weight === 'number') ? weight.toFixed(0) : '0'; }

/** Formatea Hacker Bytes (sin cambios) */
function formatHackerBytes(amount) { return (typeof amount === 'number') ? amount.toLocaleString('es-CR') : '0'; }

/** Actualiza UNA balanza (principal o secundaria) - Lógica de inclinación igual, display de peso eliminado */
function updateSingleScaleDisplay(scalePrefix, scaleData) {
    if (!scaleData) return;

    const scaleArm = document.getElementById(`${scalePrefix}-scale-arm`);
    const leftPlatform = document.getElementById(`${scalePrefix}-left-platform-visual`);
    const rightPlatform = document.getElementById(`${scalePrefix}-right-platform-visual`);
    const leftMaterialsEl = document.getElementById(`${scalePrefix}-left-materials`);
    const rightMaterialsEl = document.getElementById(`${scalePrefix}-right-materials`);

    const leftWeight = scaleData.leftWeight || 0;
    const rightWeight = scaleData.rightWeight || 0;

    renderScaleMaterialsStack(leftMaterialsEl, scaleData.leftMaterials || []);
    renderScaleMaterialsStack(rightMaterialsEl, scaleData.rightMaterials || []);

    // Animación de inclinación (misma lógica)
    if (scaleArm) {
        const difference = leftWeight - rightWeight;
        const maxAngle = 15; const maxPlatformOffset = 15; const sensitivity = 0.15;
        let angle = 0; let platformOffsetY = 0;
        // Inclinar solo si hay diferencia REAL (no considerar umbral aquí para visualización)
        if (difference !== 0) {
            angle = Math.sign(difference) * Math.min(maxAngle, Math.log1p(Math.abs(difference)) * maxAngle * sensitivity);
            platformOffsetY = Math.sign(difference) * Math.min(maxPlatformOffset, Math.abs(difference) * 0.5);
        }
        anime({ targets: scaleArm, rotate: angle, duration: 1200, easing: 'easeOutElastic(1, .7)' });
        if (leftPlatform && rightPlatform) {
             anime({ targets: [leftPlatform, rightPlatform], translateY: (el) => el.classList.contains('left') ? -platformOffsetY : platformOffsetY, duration: 1200, easing: 'easeOutElastic(1, .7)' });
        }
    }

    // Lógica específica para balanza principal (Estado equilibrado/desequilibrado)
    if (scalePrefix === 'main') {
        // Usar el estado precalculado del servidor que considera la igualdad estricta
        const isBalanced = gameState?.isMainScaleBalanced ?? false;
        if (mainBalanceStatus) {
             mainBalanceStatus.textContent = isBalanced ? '(Equilibrada)' : '(Desequilibrada)';
             mainBalanceStatus.classList.toggle('balanced', isBalanced);
             mainBalanceStatus.classList.toggle('unbalanced', !isBalanced);
        }
        // Ya no hay botón de adivinar global aquí
    }
}


/** Renderiza materiales en balanza (SOLO TIPO) con animación (sin cambios) */
function renderScaleMaterialsStack(container, materialsList) {
    if (!container) return;
    const fragment = document.createDocumentFragment(); const itemsToAnimateEnter = []; const existingElementsMap = new Map();
    container.childNodes.forEach(node => { if (node.nodeType === 1 && node.dataset.instanceId) existingElementsMap.set(node.dataset.instanceId, node); });
    materialsList.forEach(mat => {
        let div; const instanceId = mat.instanceId;
        if (existingElementsMap.has(instanceId)) { div = existingElementsMap.get(instanceId); existingElementsMap.delete(instanceId); }
        else {
            div = document.createElement('div'); const typeClass = mat.type ? mat.type.toLowerCase() : 'desconocido';
            div.className = `material-item ${typeClass}`; div.dataset.instanceId = instanceId;
            div.style.setProperty('--mineral-color', `var(--mineral-${typeClass})`); // Set CSS variable
            div.style.opacity = 0; div.style.transform = 'translateY(10px) scale(0.9)'; itemsToAnimateEnter.push(div);
        }
        div.textContent = `${mat.type || '?'}`; div.title = `Mineral ${mat.type || 'Desconocido'}`; fragment.appendChild(div);
    });
    const itemsToAnimateExit = Array.from(existingElementsMap.values());
    if (itemsToAnimateExit.length > 0) { anime({ targets: itemsToAnimateExit, opacity: 0, translateY: -10, scale: 0.9, duration: 300, easing: 'easeInQuad', complete: () => itemsToAnimateExit.forEach(el => el.remove()) }); }
    container.innerHTML = ''; container.appendChild(fragment);
    if (itemsToAnimateEnter.length > 0) { anime({ targets: itemsToAnimateEnter, opacity: 1, translateY: 0, scale: 1, delay: anime.stagger(60, { start: itemsToAnimateExit.length > 0 ? 150 : 0 }), duration: 400, easing: 'easeOutExpo' }); }
}


/** Renderiza inventario (SOLO TIPO) - Lógica adaptada para FASE 1 */
function renderPlayerInventory(inventory) {
    if (!myInventoryContainer) return;

    const fragment = document.createDocumentFragment();
    const currentInventoryMap = new Map();
    myInventoryContainer.childNodes.forEach(node => { if (node.nodeType === 1 && node.dataset.instanceId) currentInventoryMap.set(node.dataset.instanceId, node); });
    const itemsToAnimateEnter = [];

    // Interactuable si es mi turno Y estamos en Fase 1 ('playing') Y puede colocar
    const canInteract = gameState?.myTurn && gameState?.status === 'playing' && gameState?.iCanPlaceMinerals;

    if (!Array.isArray(inventory) || inventory.length === 0) {
        myInventoryContainer.innerHTML = '<p class="info-text">No te quedan minerales.</p>';
        if (myMineralCount) myMineralCount.textContent = '0';
        if (cannotPlaceMessage) cannotPlaceMessage.classList.remove('hidden');
        selectedMineralInstanceIds = [];
        updatePlacementControls(); // Ocultar controles
        return;
    }

    if (cannotPlaceMessage && inventory.length >= 2) cannotPlaceMessage.classList.add('hidden');
    if (myMineralCount) myMineralCount.textContent = inventory.length;

    inventory.forEach(mineral => {
        let button;
        const instanceId = mineral.instanceId;
        const typeClass = mineral.type ? mineral.type.toLowerCase() : 'desconocido';

        if (currentInventoryMap.has(instanceId)) {
            button = currentInventoryMap.get(instanceId);
            currentInventoryMap.delete(instanceId);
        } else {
            button = document.createElement('button');
            button.className = `inventory-item ${typeClass}`;
            button.dataset.instanceId = instanceId;
            button.style.opacity = 0;
            button.style.transform = 'scale(0.8)';
            button.addEventListener('click', handleInventoryItemClick);
            itemsToAnimateEnter.push(button);
        }
        // Actualizar estado y contenido
        button.textContent = `${mineral.type || '?'}`;
        button.title = `Mineral ${mineral.type || 'Desconocido'}`;
        button.style.setProperty('--mineral-color', `var(--mineral-${typeClass})`); // Set CSS variable
        button.disabled = !canInteract;
        button.classList.toggle('selected-material', selectedMineralInstanceIds.includes(instanceId) && canInteract);

        // Deseleccionar si ya no se puede interactuar
        if (selectedMineralInstanceIds.includes(instanceId) && !canInteract) {
            selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => id !== instanceId);
            button.classList.remove('selected-material');
        }

        fragment.appendChild(button);
    });

    const itemsToRemove = Array.from(currentInventoryMap.values());
    if (itemsToRemove.length > 0) { anime({ targets: itemsToRemove, opacity: 0, scale: 0.8, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) }); selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => !itemsToRemove.some(btn => btn.dataset.instanceId === id)); }
    myInventoryContainer.innerHTML = ''; myInventoryContainer.appendChild(fragment);
    if (itemsToAnimateEnter.length > 0) { anime({ targets: itemsToAnimateEnter, opacity: 1, scale: 1, delay: anime.stagger(50), duration: 300, easing: 'easeOutBack' }); }
    updatePlacementControls();
}


/** Manejador de clic para item de inventario (sin cambios) */
function handleInventoryItemClick(event) {
    const button = event.currentTarget; if (button.disabled) return; const id = button.dataset.instanceId; const isSelected = button.classList.toggle('selected-material');
    if (isSelected) { if (!selectedMineralInstanceIds.includes(id)) selectedMineralInstanceIds.push(id); } else { selectedMineralInstanceIds = selectedMineralInstanceIds.filter(selId => selId !== id); }
    anime({ targets: button, scale: isSelected ? [1, 1.08, 1] : [1.08, 1], duration: 300, easing: 'easeOutElastic(1, .8)' });
    updatePlacementControls();
}


/** Actualiza la sección de controles de colocación (FASE 1) */
function updatePlacementControls() {
    if (!placementControlsSection || !gameState) return;
    const count = selectedMineralInstanceIds.length;
    // Puede colocar si es su turno, en fase 'playing', tiene minerales, y seleccionó >= 2
    const canPlaceSelection = gameState.myTurn && gameState.status === 'playing' && gameState.iCanPlaceMinerals && count >= 2;
    // Mostrar controles si tiene algo seleccionado Y es su turno Y está en fase 'playing' Y puede colocar
    const shouldShowControls = count > 0 && gameState.myTurn && gameState.status === 'playing' && gameState.iCanPlaceMinerals;

    updatePlacementControlsVisibility(shouldShowControls);

    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (placeSelectedBtn) placeSelectedBtn.disabled = !canPlaceSelection;
    if (placementError) placementError.classList.toggle('hidden', count === 0 || count >= 2);
    if(targetScaleSelect) targetScaleSelect.disabled = count === 0;
    if(targetSideSelect) targetSideSelect.disabled = count === 0;
}

/** Controla la visibilidad animada de los controles de colocación (sin cambios) */
function updatePlacementControlsVisibility(shouldShow) {
    if (!placementControlsSection) return; const isCurrentlyVisible = placementControlsSection.classList.contains('visible');
    if (shouldShow && !isCurrentlyVisible) {
        placementControlsSection.classList.remove('hidden'); placementControlsSection.classList.add('visible');
        const targetHeight = placementControlsSection.scrollHeight;
        anime({ targets: placementControlsSection, height: [0, targetHeight + 'px'], opacity: [0, 1], paddingTop: [0, 20], marginTop: [0, 20], duration: 350, easing: 'easeOutQuad',
            begin: () => { if(!placementControlsSection.style.borderTop) placementControlsSection.style.borderTop = `1px solid ${getComputedStyle(document.documentElement).getPropertyValue('--border-color')}`; },
            complete: () => placementControlsSection.style.height = 'auto' });
    } else if (!shouldShow && isCurrentlyVisible) {
        anime({ targets: placementControlsSection, height: 0, opacity: 0, paddingTop: 0, marginTop: 0, borderTopWidth: 0, duration: 300, easing: 'easeInQuad',
            complete: () => { placementControlsSection.classList.remove('visible'); placementControlsSection.classList.add('hidden'); placementControlsSection.style.height = ''; placementControlsSection.style.borderTop = ''; placementControlsSection.style.borderTopWidth = ''; } });
    }
}

/** Popula el selector de colores para adivinar en Fase 2 */
function populateGuessColorSelect() {
    if (!guessSingleColorSelect || !gameState || gameState.status !== 'guessing_phase') return;

    const previouslyAttempted = gameState.myGuessedColorsPhase2 || [];
    // Necesitamos saber qué colores ya fueron adivinados correctamente por el equipo.
    // Esta info no está directamente en gameState, asumimos que si intento un color ya adivinado, el servidor lo rechazará o notificará.
    // Por ahora, solo filtramos los que YO ya intenté.
    const availableColors = MINERAL_TYPES.filter(color => !previouslyAttempted.includes(color));

    // Guardar valor seleccionado si existe
    const currentSelection = guessSingleColorSelect.value;

    guessSingleColorSelect.innerHTML = '<option value="">-- Selecciona Color --</option>'; // Reset
    availableColors.forEach(color => {
        const option = document.createElement('option');
        option.value = color;
        option.textContent = color;
        option.classList.add(color.toLowerCase()); // Para estilos
        guessSingleColorSelect.appendChild(option);
    });

    // Restaurar selección si aún es válida
    if (availableColors.includes(currentSelection)) {
        guessSingleColorSelect.value = currentSelection;
    }

    // Habilitar/deshabilitar basado en si quedan opciones
    guessSingleColorSelect.disabled = availableColors.length === 0;
}

/** Función PRINCIPAL para actualizar TODA la UI del juego (REESTRUCTURADA) */
function updateGameUI(newState) {
    console.log(`--- Updating UI for Player ${playerId}. Status: ${newState?.status} ---`);
    if (!newState) {
        console.error("CLIENT ERROR: updateGameUI llamado sin estado válido!");
        showNotification("Error: Estado de juego inválido recibido.", "Error Sincro");
        return;
    }

    const oldStatus = gameState?.status;
    const wasMyTurnBefore = gameState?.myTurn;
    gameState = newState; // Actualizar estado global

    // --- Actualizaciones Generales (Siempre visibles) ---
    const currentPlayer = gameState.currentPlayer;
    if (currentPlayerIndicator) { // Indicador de turno
        const newText = currentPlayer
            ? `${currentPlayer.name} (T${currentPlayer.turnOrder})`
            : (gameState.status.startsWith('finished') ? 'Juego Terminado' : 'Esperando...');
        if (currentPlayerIndicator.textContent !== newText) {
             anime({ targets: currentPlayerIndicator, opacity: [1, 0], duration: 200, easing: 'linear', complete: () => {
                 currentPlayerIndicator.textContent = newText;
                 anime({ targets: currentPlayerIndicator, opacity: [0, 1], duration: 400 }); } });
        }
    }
    if (knownInfoText) knownInfoText.textContent = gameState.knownMineralInfo?.description || '-'; // Pista inicial
    if (prizeAmountDisplay) prizeAmountDisplay.textContent = formatHackerBytes(gameState.currentPrizePot); // Premio potencial/actual

    // Actualizar condición del premio
    if (prizeConditionDisplay) {
        if (gameState.status === 'playing') prizeConditionDisplay.textContent = "(Equilibra la balanza para votar)";
        else if (gameState.status === 'guessing_phase') prizeConditionDisplay.textContent = `(Adivina ${PHASE2_TARGET_CORRECT_GUESSES} pesos en ${PHASE2_TOTAL_ROUNDS} rondas)`;
        else if (gameState.status === 'voting') prizeConditionDisplay.textContent = "(Vota para continuar o terminar)";
        else prizeConditionDisplay.textContent = "(Juego terminado)";
    }

    // --- Balanzas ---
    updateSingleScaleDisplay('main', gameState.mainScale);
    updateSingleScaleDisplay('secondary', gameState.secondaryScale);

    // --- Lista de Jugadores Sidebar ---
    if (gamePlayersList) {
        const fragment = document.createDocumentFragment();
        const playerElementsMap = new Map();
        gamePlayersList.childNodes.forEach(node => { if (node.nodeType === 1 && node.dataset.playerId) playerElementsMap.set(node.dataset.playerId, node); });
        const itemsToAnimateEnter = [];

        gameState.playersPublicInfo?.forEach(p => {
            const isCurrent = p.id === gameState.currentPlayer?.id;
            const isMe = p.id === playerId;
            let li;
            if (playerElementsMap.has(p.id)) { li = playerElementsMap.get(p.id); playerElementsMap.delete(p.id); }
            else { li = document.createElement('li'); li.dataset.playerId = p.id; li.style.opacity = 0; itemsToAnimateEnter.push(li); }
            li.className = 'player-row';
            if (!p.isActive) li.classList.add('player-inactive');
            if (isMe) li.classList.add('my-player-row');
            if (isCurrent && (gameState.status === 'playing' || gameState.status === 'guessing_phase')) li.classList.add('current-player-row');

            // Construir HTML interno
            li.innerHTML = `
                <span class="player-order">${p.turnOrder || '?'}</span>.
                <span class="player-name">${p.name || '??'} ${isMe ? '<span class="you-tag">(Tú)</span>' : ''}</span>
                ${gameState.status !== 'guessing_phase' ? `<span class="player-minerals">(<i class="fas fa-gem"></i> ${p.mineralCount ?? '?'})</span>` : ''} <span class="player-status">
                    ${!p.isActive ? '<span class="status-tag inactive-tag" title="Desconectado">Desc.</span>' : ''}
                    ${p.isActive && !(p.canPlaceMinerals ?? true) && gameState.status === 'playing' ? '<span class="status-tag cannot-play-tag" title="No puede colocar">No Juega</span>' : ''}
                    ${gameState.status === 'voting' && p.isActive && !p.hasVoted ? '<span class="status-tag waiting-vote-tag" title="Esperando voto">Votando...</span>' : ''}
                </span>
                ${isCurrent && (gameState.status === 'playing' || gameState.status === 'guessing_phase') ? '<i class="fas fa-star player-turn-star" title="Turno actual"></i>' : ''}
            `;
            fragment.appendChild(li);
        });
        const itemsToRemove = Array.from(playerElementsMap.values());
        if (itemsToRemove.length > 0) { anime({ targets: itemsToRemove, opacity: 0, height: 0, padding: 0, margin: 0, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) }); }
        gamePlayersList.innerHTML = ''; gamePlayersList.appendChild(fragment);
        if (itemsToAnimateEnter.length > 0) { anime({ targets: itemsToAnimateEnter, opacity: [0, 1], translateX: [-5, 0], delay: anime.stagger(40), duration: 300, easing: 'easeOutQuad' }); }
    }

    // --- Lógica Específica por Fase ---
    const isMyTurnNow = gameState.myTurn;
    const statusChanged = oldStatus !== gameState.status;

    // Añadir/quitar clase al body para estilos condicionales
    document.body.classList.toggle('guessing-phase-active', gameState.status === 'guessing_phase');

    // Mostrar/Ocultar elementos de Fase 1 vs Fase 2
    phase1Elements.forEach(el => el.classList.toggle('hidden', gameState.status !== 'playing'));
    phase2Elements.forEach(el => el.classList.toggle('hidden', gameState.status !== 'guessing_phase'));

    // Indicador de Turno
    if (myTurnIndicator) myTurnIndicator.classList.toggle('hidden', !isMyTurnNow || gameState.status.startsWith('finished') || gameState.status === 'voting');
    if (waitingTurnIndicator) waitingTurnIndicator.classList.toggle('hidden', isMyTurnNow || gameState.status.startsWith('finished') || gameState.status === 'voting');
    // Animar cambio de turno si aplica
    if (isMyTurnNow && !wasMyTurnBefore && !myTurnIndicator.classList.contains('hidden')) { anime({ targets: myTurnIndicator, opacity: [0, 1], translateY: [-10, 0], duration: 400 }); }
    else if (!isMyTurnNow && wasMyTurnBefore && !waitingTurnIndicator.classList.contains('hidden')) { anime({ targets: waitingTurnIndicator, opacity: [0, 1], duration: 400 }); }

    // Botón Pasar Turno
    if (passTurnBtn) passTurnBtn.disabled = !isMyTurnNow || (gameState.status !== 'playing' && gameState.status !== 'guessing_phase');


    // Fase 1: Colocación
    if (gameState.status === 'playing') {
        renderPlayerInventory(gameState.myInventory || []); // Actualiza inventario y controles de colocación
        if (statusChanged) { // Si acabamos de entrar a 'playing'
            selectedMineralInstanceIds = []; // Limpiar selección
            updatePlacementControls(); // Asegurar estado inicial correcto
        }
    } else {
        // Si no estamos en 'playing', ocultar controles de colocación y limpiar selección
        updatePlacementControlsVisibility(false);
        if (selectedMineralInstanceIds.length > 0) {
            myInventoryContainer?.querySelectorAll('.selected-material').forEach(btn => btn.classList.remove('selected-material'));
            selectedMineralInstanceIds = [];
        }
    }

    // Fase de Votación
    if (gameState.status === 'voting') {
        if (votingModal.style.display === 'none' || statusChanged) { // Mostrar si estaba oculto o si cambió el estado
             if(balancerNameModal && gameState.balancerPlayer) balancerNameModal.textContent = gameState.balancerPlayer.name || 'Alguien';
             const myVote = gameState.votingState?.myVote;
             const canVote = myVote === null;
             if(voteYesBtn) voteYesBtn.disabled = !canVote;
             if(voteNoBtn) voteNoBtn.disabled = !canVote;
             if(voteStatusModal) voteStatusModal.textContent = canVote ? "Esperando tu voto..." : "Voto registrado. Esperando a los demás...";
             showModal(votingModal);
        }
        // Actualizar estado de espera si ya voté
        if (gameState.votingState?.myVote !== null && voteStatusModal) {
             const votesReceived = gameState.votingState?.receivedVotes ?? 0;
             const votesRequired = gameState.votingState?.requiredVotes ?? gameState.playersPublicInfo.filter(p => p.isActive).length;
             voteStatusModal.textContent = `Voto registrado (${votesReceived}/${votesRequired}). Esperando a los demás...`;
        }

    } else {
        if (votingModal.style.display !== 'none') hideModal(votingModal); // Ocultar si no estamos votando
    }

    // Fase 2: Adivinanza
    if (gameState.status === 'guessing_phase') {
        if (phase2RoundIndicator) phase2RoundIndicator.textContent = `${gameState.phase2RoundsPlayed + 1} / ${PHASE2_TOTAL_ROUNDS}`;
        if (phase2CorrectTotal) phase2CorrectTotal.textContent = `${gameState.phase2CorrectGuessesTotal} / ${PHASE2_TARGET_CORRECT_GUESSES}`;
        if (currentPrizePotDisplay) currentPrizePotDisplay.textContent = formatHackerBytes(gameState.currentPrizePot);

        if (isMyTurnNow) {
            if (phase2AttemptsLeft) phase2AttemptsLeft.textContent = `${gameState.myPhase2AttemptsLeft} / ${PHASE2_GUESS_ATTEMPTS_PER_TURN}`;
            populateGuessColorSelect(); // Llenar select con colores disponibles
            const canGuess = gameState.myPhase2AttemptsLeft > 0 && guessSingleColorSelect && guessSingleColorSelect.options.length > 1; // Hay intentos Y colores disponibles
            if(guessSingleWeightInput) guessSingleWeightInput.disabled = !canGuess;
            if(guessSingleWeightBtn) guessSingleWeightBtn.disabled = !canGuess;
            if(singleGuessFeedback) singleGuessFeedback.textContent = canGuess ? "Selecciona color y peso." : (gameState.myPhase2AttemptsLeft <= 0 ? "No te quedan intentos." : "No quedan colores por adivinar.");
        } else {
            // No es mi turno
            if (phase2AttemptsLeft) phase2AttemptsLeft.textContent = `- / ${PHASE2_GUESS_ATTEMPTS_PER_TURN}`;
            if(guessSingleColorSelect) guessSingleColorSelect.disabled = true;
            if(guessSingleWeightInput) guessSingleWeightInput.disabled = true;
            if(guessSingleWeightBtn) guessSingleWeightBtn.disabled = true;
            if(singleGuessFeedback) singleGuessFeedback.textContent = "Esperando turno...";
        }
    }

    // Limpiar feedback de adivinanza si cambia el turno
    if (isMyTurnNow && !wasMyTurnBefore && singleGuessFeedback) {
         singleGuessFeedback.textContent = "";
         if (guessSingleWeightInput) guessSingleWeightInput.value = ""; // Limpiar input
         if (guessSingleColorSelect) guessSingleColorSelect.value = ""; // Deseleccionar
    }
}

/** Establece estado de carga en botón (sin cambios) */
function setLoadingState(button, isLoading, loadingText = '') {
     if (!button) return; if (isLoading) { button.disabled = true; button.dataset.originalContent = button.innerHTML; button.innerHTML = `<span class="spinner" role="status" aria-hidden="true"><i class="fas fa-spinner fa-spin"></i></span> ${loadingText || ''}`; button.classList.add('loading'); } else { button.disabled = false; if (button.dataset.originalContent) { button.innerHTML = button.dataset.originalContent; } button.classList.remove('loading'); delete button.dataset.originalContent; }
}


// --- Event Listeners de Controles del Cliente ---

// Navegación inicial y formularios (sin cambios)
createBtn?.addEventListener('click', () => showScreen(screens.create));
joinBtn?.addEventListener('click', () => showScreen(screens.join));
backFromCreateBtn?.addEventListener('click', () => showScreen(screens.welcome));
backFromJoinBtn?.addEventListener('click', () => showScreen(screens.welcome));
copyCodeBtn?.addEventListener('click', () => {
    const code = waitGameCodeDisplay?.textContent; if (code && code !== '------' && navigator.clipboard) { navigator.clipboard.writeText(code).then(() => { copyCodeBtn.innerHTML = '<i class="fas fa-check"></i>'; setTimeout(() => { copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500); }).catch(err => { showNotification('Error al copiar.', 'Error'); }); } else if (code && code !== '------') { showNotification('Código: ' + code, 'Copia Manual'); }
});
createForm?.addEventListener('submit', (e) => {
    e.preventDefault(); const hostNameInput = document.getElementById('host-name'); const hostName = hostNameInput?.value.trim(); const submitBtn = document.getElementById('create-form-submit'); if (!hostName) { showNotification("Ingresa tu nombre.", "Requerido"); hostNameInput?.focus(); return; }
    if (submitBtn) { setLoadingState(submitBtn, true, 'Creando...'); socket.emit('createGame', { hostName }, (response) => { setLoadingState(submitBtn, false); if (response?.success) { gameId = response.gameId; playerId = response.playerId; isHost = true; if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = response.gameCode; updateWaitingList([]); if(hostInstructions) hostInstructions.classList.remove('hidden'); if(startGameBtn) { startGameBtn.classList.remove('hidden'); startGameBtn.disabled = true; } if(playerWaitMessage) playerWaitMessage.classList.add('hidden'); showScreen(screens.waiting); } else { showNotification(response?.message || 'Error al crear.', 'Error'); } }); }
});
joinForm?.addEventListener('submit', (e) => {
    e.preventDefault(); const gameCodeInput = document.getElementById('join-game-code'); const playerNameInput = document.getElementById('join-player-name'); const gameCode = gameCodeInput?.value.trim(); const playerName = playerNameInput?.value.trim(); const submitBtn = document.getElementById('join-form-submit'); let hasError = false;
    if (!gameCode || !/^[0-9]{6}$/.test(gameCode)) { hasError = true; gameCodeInput?.classList.add('input-error'); } else { gameCodeInput?.classList.remove('input-error'); }
    if (!playerName) { hasError = true; playerNameInput?.classList.add('input-error'); } else { playerNameInput?.classList.remove('input-error'); }
    if (hasError) { showNotification("Ingresa código (6 dígitos) y nombre.", "Inválido"); return; }
    if (submitBtn) { setLoadingState(submitBtn, true, 'Uniéndose...'); socket.emit('joinGame', { gameCode, playerName }, (response) => { setLoadingState(submitBtn, false); if (response?.success) { gameId = response.gameId; playerId = response.playerId; isHost = false; if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = gameCode; if(hostInstructions) hostInstructions.classList.add('hidden'); if(startGameBtn) startGameBtn.classList.add('hidden'); if(playerWaitMessage) playerWaitMessage.classList.remove('hidden'); showScreen(screens.waiting); updateWaitingList(response.players || []); } else { showNotification(response?.message || 'Error al unirse.', 'Error'); } }); }
});

// Iniciar Juego (Host)
startGameBtn?.addEventListener('click', () => {
    if (isHost && gameId && !startGameBtn.disabled) {
        setLoadingState(startGameBtn, true, 'Iniciando...');
        socket.emit('startGame', { gameId });
    } else if (startGameBtn.disabled) {
         showNotification("Se necesitan al menos 2 jugadores activos.", "Faltan Jugadores");
    }
});

// Colocar Minerales Seleccionados (Fase 1)
placeSelectedBtn?.addEventListener('click', () => {
    if (placeSelectedBtn.disabled || selectedMineralInstanceIds.length < 2) return;
    const placements = selectedMineralInstanceIds.map(instanceId => ({
        mineralInstanceId: instanceId,
        targetScale: targetScaleSelect?.value || 'main',
        targetSide: targetSideSelect?.value || 'left'
    }));
    console.log("CLIENT LOG: Emitiendo 'placeMinerals':", placements);
    setLoadingState(placeSelectedBtn, true);
    if (cancelPlacementBtn) cancelPlacementBtn.disabled = true;
    myInventoryContainer?.querySelectorAll('.inventory-item').forEach(btn => btn.disabled = true); // Deshabilitar inventario
    socket.emit('placeMinerals', { gameId, playerId, placements });
    // La selección se limpiará visualmente en la próxima actualización de gameState
});

// Limpiar Selección de Minerales (Fase 1)
cancelPlacementBtn?.addEventListener('click', () => {
    const itemsToDeselect = []; myInventoryContainer?.querySelectorAll('.selected-material').forEach(btn => { btn.classList.remove('selected-material'); itemsToDeselect.push(btn); });
    if (itemsToDeselect.length > 0) { anime({ targets: itemsToDeselect, scale: [1.08, 1], duration: 200 }); }
    selectedMineralInstanceIds = [];
    updatePlacementControls();
});

// Botones de Votación
voteYesBtn?.addEventListener('click', () => {
    if (voteYesBtn.disabled) return;
    console.log("CLIENT LOG: Votando SÍ");
    voteYesBtn.disabled = true; // Deshabilitar ambos al votar
    voteNoBtn.disabled = true;
    if(voteStatusModal) voteStatusModal.textContent = "Enviando voto...";
    socket.emit('castVote', { gameId, playerId, vote: 'yes' });
});
voteNoBtn?.addEventListener('click', () => {
    if (voteNoBtn.disabled) return;
    console.log("CLIENT LOG: Votando NO");
    voteYesBtn.disabled = true; // Deshabilitar ambos al votar
    voteNoBtn.disabled = true;
    if(voteStatusModal) voteStatusModal.textContent = "Enviando voto...";
    socket.emit('castVote', { gameId, playerId, vote: 'no' });
});

// Adivinar Peso Individual (Fase 2)
guessSingleWeightBtn?.addEventListener('click', () => {
    if (guessSingleWeightBtn.disabled) return;
    const color = guessSingleColorSelect?.value;
    const weightGuessStr = guessSingleWeightInput?.value;
    const weightGuess = parseInt(weightGuessStr);

    if (!color) { showNotification("Selecciona un color para adivinar.", "Color Faltante"); return; }
    if (isNaN(weightGuess) || weightGuess < MIN_WEIGHT || weightGuess > MAX_WEIGHT) {
        showNotification(`Ingresa un peso válido (${MIN_WEIGHT}-${MAX_WEIGHT}).`, "Peso Inválido");
        guessSingleWeightInput?.focus(); return;
    }

    console.log(`CLIENT LOG: Emitiendo 'guessSingleWeight': ${color} = ${weightGuess}`);
    if(singleGuessFeedback) singleGuessFeedback.textContent = `Intentando ${color}...`;
    // Deshabilitar botón mientras procesa?
    guessSingleWeightBtn.disabled = true;
    socket.emit('guessSingleWeight', { gameId, playerId, color, weightGuess });
});

// Pasar Turno
passTurnBtn?.addEventListener('click', () => {
    if (passTurnBtn.disabled) return;
    console.log("CLIENT LOG: Emitiendo 'passTurn'");
    passTurnBtn.disabled = true; // Deshabilitar mientras procesa
    setLoadingState(passTurnBtn, true, 'Pasando...'); // Añadir estado de carga
    socket.emit('passTurn', { gameId, playerId });
});

// Jugar Otra Vez
playAgainBtn?.addEventListener('click', () => {
     anime({ targets: 'body', opacity: 0, duration: 400, easing: 'easeInQuad', complete: () => window.location.reload() });
});

// Cerrar Modales Genérico
document.querySelectorAll('.modal .close-btn, .modal .modal-cancel-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
        const modal = event.target.closest('.modal');
        if (modal && modal !== votingModal) { // No permitir cerrar modal de votación con 'x' o 'cancel'
             hideModal(modal);
        } else if (modal === notificationModal) { // Permitir cerrar notificación
             hideModal(modal);
        }
    });
});


// --- Event Listeners de Socket.IO ---

socket.on('connect', () => console.log('CLIENT LOG: Conectado:', socket.id));
socket.on('disconnect', (reason) => { console.warn('CLIENT LOG: Desconectado:', reason); showNotification(`Desconexión: ${reason}. Recarga para reconectar.`, "Desconectado"); /* Deshabilitar UI? */ });
socket.on('error', (data) => {
     console.error('SERVER ERROR:', data.message);
     showNotification(`Error: ${data.message || 'Error desconocido.'}`, 'Error del Servidor');
     // Resetear botones loading si falló una acción
     if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
     if (passTurnBtn?.classList.contains('loading')) setLoadingState(passTurnBtn, false);
     if (startGameBtn?.classList.contains('loading')) setLoadingState(startGameBtn, false);
     // Habilitar controles de nuevo si corresponde
     if (gameState?.myTurn && (gameState.status === 'playing' || gameState.status === 'guessing_phase') && passTurnBtn) passTurnBtn.disabled = false;
     if (gameState?.myTurn && gameState.status === 'playing' && placeSelectedBtn && selectedMineralInstanceIds.length >= 2) placeSelectedBtn.disabled = false;

});

// Actualiza lista de jugadores en sala de espera
socket.on('playerListUpdated', (data) => {
    console.log("CLIENT LOG: Recibido playerListUpdated:", data);
    updateWaitingList(data.players);
    if (isHost && startGameBtn && currentScreen === screens.waiting) { // Solo actualizar botón si estamos en espera
        const activeCount = data.players?.filter(p => p.isActive).length ?? 0;
        startGameBtn.disabled = activeCount < 2;
        startGameBtn.title = activeCount < 2 ? "Se necesitan al menos 2 jugadores activos" : "Iniciar el juego";
        if (activeCount >= 2 && startGameBtn.classList.contains('loading')) { setLoadingState(startGameBtn, false); } // Resetear si se habilita mientras carga
    }
});

// Función helper para actualizar lista en espera
function updateWaitingList(players) {
    if (!waitPlayersList || !waitPlayerCount) return;
    const fragment = document.createDocumentFragment();
    const activeCount = players?.filter(p => p.isActive).length ?? 0;
    waitPlayerCount.textContent = activeCount;

    if (!players || players.length === 0) {
         waitPlayersList.innerHTML = '<li class="waiting-placeholder">Esperando jugadores...</li>';
         return;
    }

    players.sort((a,b) => a.turnOrder - b.turnOrder).forEach(p => {
        const li = document.createElement('li');
        li.dataset.playerId = p.id;
        li.innerHTML = `<span class="player-order">${p.turnOrder}.</span> ${p.name} ${p.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''} ${p.id === gameState?.hostId || (isHost && p.turnOrder === 1) ? '<span class="host-tag">(Host)</span>' : ''} ${!p.isActive ? '<span class="status-tag inactive-tag">(Desc.)</span>': ''}`;
        fragment.appendChild(li);
    });
    waitPlayersList.innerHTML = '';
    waitPlayersList.appendChild(fragment);
}


// El juego ha comenzado o se actualizó estado
socket.on('gameStarted', ({ gameState: receivedGameState }) => {
    console.log("CLIENT LOG: Recibido 'gameStarted'.");
    if (isHost && startGameBtn && startGameBtn.classList.contains('loading')) { setLoadingState(startGameBtn, false); }
    if (receivedGameState) {
        gameId = receivedGameState.gameId; // Asegurar que tenemos el ID
        playerId = receivedGameState.myPlayerId; // Asegurar nuestro ID
        isHost = receivedGameState.hostId === playerId; // Reconfirmar si somos host
        gameState = receivedGameState;
        showScreen(screens.game); // updateGameUI se llama dentro
    } else {
        showNotification("Error al recibir estado inicial.", "Error al Iniciar");
    }
});

socket.on('gameStateUpdated', ({ gameState: receivedGameState }) => {
    console.log('--- Received gameStateUpdated ---');
    if (!receivedGameState) { console.error("CLIENT ERROR: Estado nulo en gameStateUpdated!"); return; }

    // Resetear botones de carga si aplica (ahora incluye pasar turno)
    if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
    if (passTurnBtn?.classList.contains('loading')) setLoadingState(passTurnBtn, false);
    if (guessSingleWeightBtn?.disabled && !receivedGameState.myTurn) guessSingleWeightBtn.disabled = false; // Reactivar si ya no es mi turno


    // Si el estado es 'playing' o 'guessing_phase' y estamos en la pantalla correcta
    if ((receivedGameState.status === 'playing' || receivedGameState.status === 'guessing_phase' || receivedGameState.status === 'voting') && currentScreen !== screens.game) {
        console.log(`CLIENT LOG: gameStateUpdated recibido (${receivedGameState.status}), cambiando a pantalla de juego.`);
        gameState = receivedGameState; // Guardar estado ANTES de cambiar pantalla
        showScreen(screens.game); // Cambia y luego actualiza (updateGameUI se llama dentro de showScreen)
    } else if (currentScreen === screens.game) {
        updateGameUI(receivedGameState); // Actualiza la pantalla actual
    } else if (currentScreen === screens.waiting && receivedGameState.status === 'waiting') {
         // Actualizar lista de jugadores en espera si gameState cambia ahí
         updateWaitingList(receivedGameState.playersPublicInfo);
         gameState = receivedGameState; // Guardar por si acaso
    }
     else {
         console.log(`CLIENT LOG: gameStateUpdated ignorado o manejado por cambio de pantalla (Pantalla: ${currentScreen?.id}, Estado: ${receivedGameState.status})`);
         gameState = receivedGameState; // Guardar estado aunque no se actualice UI principal
     }
});

// Voto recibido de otro jugador
socket.on('voteReceived', ({ playerId: voterId, playerName: voterName }) => {
    console.log(`CLIENT LOG: Voto recibido de ${voterName}`);
    // Actualizar UI del modal de votación si está abierto
    if (votingModal.style.display === 'flex' && voteStatusModal && gameState) {
        // Intentar predecir el nuevo conteo o usar el estado local actual
        const votesReceived = gameState.votingState?.receivedVotes ?? 0; // Usar estado local
        const votesRequired = gameState.votingState?.requiredVotes ?? gameState.playersPublicInfo?.filter(p => p.isActive).length ?? 0;
        // Mostrar +1 si el voto recibido no es el mío
        const displayReceived = (voterId !== playerId) ? votesReceived + 1 : votesReceived;
        voteStatusModal.textContent = `Voto de ${voterName} recibido (${displayReceived}/${votesRequired}). Esperando a los demás...`;
    }
});

// Resultado de adivinanza individual (Fase 2)
socket.on('singleGuessResult', ({ playerId: guesserId, playerName, color, weightGuess, correct, justGuessed, message, newTotalGuesses }) => {
    console.log(`CLIENT LOG: Resultado adivinanza individual (${color}): ${message}`);

     // Mostrar feedback siempre, no solo en mi turno, para ver qué pasó
     if (singleGuessFeedback && currentScreen === screens.game) {
         singleGuessFeedback.textContent = message;
         singleGuessFeedback.classList.toggle('success-highlight', correct && justGuessed);
         singleGuessFeedback.classList.toggle('error-text', !correct);
         // Limpiar input y repoblar select si fui YO quien adivinó
         if (guesserId === playerId) {
              if(guessSingleWeightInput) guessSingleWeightInput.value = "";
              populateGuessColorSelect(); // Repoblar para quitar el color intentado
              if (guessSingleColorSelect) guessSingleColorSelect.value = ""; // Deseleccionar
               // Reactivar botón si aún quedan intentos
              if(guessSingleWeightBtn && gameState?.myPhase2AttemptsLeft > 0) guessSingleWeightBtn.disabled = false;
         }
     }
    // Actualizar contador total si hubo acierto nuevo (gameStateUpdated lo hará formalmente)
     if(correct && justGuessed && phase2CorrectTotal && newTotalGuesses !== undefined) {
         phase2CorrectTotal.textContent = `${newTotalGuesses} / ${PHASE2_TARGET_CORRECT_GUESSES}`;
     }
});

// Actualización del premio (Fase 2)
socket.on('prizePotUpdated', ({ newPrizePot }) => {
    console.log(`CLIENT LOG: Premio actualizado a ${newPrizePot}`);
    if (gameState) gameState.currentPrizePot = newPrizePot; // Actualizar estado local
    const potDisplay = currentPrizePotDisplay || prizeAmountDisplay; // Usar el display correcto
    if (potDisplay) {
        potDisplay.textContent = formatHackerBytes(newPrizePot);
        // Animar cambio
        anime({ targets: potDisplay, scale: [1.15, 1], duration: 600, easing: 'easeOutElastic(1, .7)' });
    }
});


// Fin del juego
socket.on('gameOver', ({ gameState: finalGameState, actualWeights }) => {
    console.log("CLIENT LOG: Recibido 'gameOver'. Status:", finalGameState?.status);

    // Limpiar estados/modales activos
    if (votingModal && votingModal.style.display !== 'none') hideModal(votingModal);
    // Resetear botones loading si aplica
    if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
    if (passTurnBtn?.classList.contains('loading')) setLoadingState(passTurnBtn, false);
    if (startGameBtn?.classList.contains('loading')) setLoadingState(startGameBtn, false);


    if (finalGameState) {
        gameState = finalGameState; // Guardar estado final

        let titleIcon = 'fa-flag-checkered';
        let resultMsg = 'Juego Terminado.';
        let winnerText = 'Ganadores: Ninguno';
        // El premio se toma directamente de mis hackerBytes al final
        const myFinalPrize = finalGameState.myHackerBytes || 0;

        switch(finalGameState.status) {
            case 'finished_balance_win':
                titleIcon = 'fa-check-circle';
                resultMsg = `¡${finalGameState.balancerPlayer?.name || 'Alguien'} equilibró y el equipo decidió terminar!`;
                winnerText = `🏆 Ganador(es): ¡Equipo Activo! (Inició ${finalGameState.balancerPlayer?.name || '?'})`;
                break;
            case 'finished_phase2_win':
                titleIcon = 'fa-trophy';
                resultMsg = `¡El equipo superó la Fase 2 con ${finalGameState.phase2CorrectGuessesTotal} aciertos!`;
                winnerText = `🏆 Ganadores: ¡Todo el equipo activo!`;
                break;
            case 'finished_phase2_loss':
                titleIcon = 'fa-times-circle';
                resultMsg = `El equipo no alcanzó los ${PHASE2_TARGET_CORRECT_GUESSES} aciertos en Fase 2 (${finalGameState.phase2CorrectGuessesTotal} / ${PHASE2_TARGET_CORRECT_GUESSES}).`;
                winnerText = 'Ganadores: Ninguno';
                break;
            case 'finished_disconnect_vote':
                titleIcon = 'fa-user-slash';
                resultMsg = 'El juego terminó porque un jugador se desconectó durante la votación.';
                winnerText = 'Ganadores: Ninguno';
                break;
            case 'finished_disconnect_game':
                 titleIcon = 'fa-user-slash';
                 resultMsg = 'El juego terminó porque no quedaron jugadores activos.';
                 winnerText = 'Ganadores: Ninguno';
                 break;
            case 'finished_failure': // Estado genérico
                 titleIcon = 'fa-exclamation-circle';
                 resultMsg = 'El juego terminó sin un ganador claro.';
                 winnerText = 'Ganadores: Ninguno';
                 break;
            default:
                 resultMsg = `Juego terminado con estado: ${finalGameState.status}`;
        }

        if (finalResultTitle) finalResultTitle.innerHTML = `<i class="fas ${titleIcon}"></i> Fin del Juego`;
        if (finalResultMessage) finalResultMessage.textContent = resultMsg;
        if (finalWinners) finalWinners.textContent = winnerText;

        // Mostrar premio personal ganado
        if (finalPrizeWon && finalPrizeAmount) {
             finalPrizeAmount.textContent = `${formatHackerBytes(myFinalPrize)} Hacker Bytes`;
             finalPrizeWon.classList.toggle('hidden', myFinalPrize <= 0);
        } else if (finalPrizeWon) {
             finalPrizeWon.classList.add('hidden');
        }


        // Mostrar pesos reales
        if (finalActualWeights && actualWeights) {
            finalActualWeights.innerHTML = ''; const weightItems = [];
            MINERAL_TYPES.sort().forEach(type => {
                 if (actualWeights.hasOwnProperty(type)) {
                     const li = document.createElement('li'); const typeClass = type.toLowerCase();
                     li.innerHTML = `<span class="mineral-color-indicator ${typeClass}" title="${type}"></span> <strong>${type}:</strong> ${actualWeights[type]}g`;
                     li.style.opacity = 0; finalActualWeights.appendChild(li); weightItems.push(li);
                 }
            });
             anime({ targets: weightItems, opacity: [0, 1], translateY: [5, 0], delay: anime.stagger(80), duration: 400 });
        } else if (finalActualWeights) { finalActualWeights.innerHTML = '<li>Error al mostrar pesos.</li>'; }

        showScreen(screens.finalResults);
    } else {
         console.error("CLIENT ERROR: gameOver recibido sin gameState válido.");
         showNotification("Error al recibir resultados finales.", "Error Final");
    }
});

// Notificación de jugador desconectado
socket.on('playerDisconnected', ({ playerId: disconnectedPlayerId, playerName }) => {
    console.log(`CLIENT LOG: ${playerName} se desconectó.`);
    // Evitar mostrar notificación si soy yo quien desconecta
    if (playerId !== disconnectedPlayerId) {
        showNotification(`${playerName} se ha desconectado.`, "Jugador Desconectado");
    }
    // La UI se actualizará con el próximo gameStateUpdated o playerListUpdated
});

// Notificación de fin por desconexión en voto
socket.on('gameEndedDueToVoteDisconnect', ({ playerName }) => {
     showNotification(`El juego terminó porque ${playerName} se desconectó durante la votación.`, "Fin del Juego");
     // La pantalla cambiará con 'gameOver'
});


// --- Inicialización al Cargar la Página ---
window.addEventListener('load', () => {
    console.log("CLIENT LOG: Página cargada. Inicializando Juego Escala v2.");
    Object.values(screens).forEach(s => { if (s !== screens.welcome) { s.classList.remove('active'); s.style.display = 'none'; s.style.opacity = 0; } });
    if (screens.welcome) {
        screens.welcome.style.opacity = 0; screens.welcome.style.display = 'flex'; screens.welcome.classList.add('active'); currentScreen = screens.welcome;
        anime({ targets: screens.welcome, opacity: [0, 1], translateY: [10, 0], duration: 500 });
        anime({ targets: '#welcome-screen .animatable-on-load', opacity: [0, 1], translateY: [10, 0], delay: anime.stagger(100, {start: 200}) });
    } else {
        console.error("CLIENT CRITICAL: Pantalla de bienvenida no encontrada.");
        document.body.innerHTML = '<h1 style="color: red;">Error Crítico: Interfaz no cargada.</h1>';
    }
});