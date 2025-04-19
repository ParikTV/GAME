// public/app.js

// --- Conexión Socket.IO ---
const socket = io();

// --- Constantes del Cliente (Deben Sincronizarse con el Servidor) ---
const COSTO_ADIVINANZA = 100; // Costo en Hacker Bytes para intentar ganar adivinando
const MAX_GUESS_ATTEMPTS = 2; // Límite de intentos por jugador para la adivinanza que gana el juego
const MIN_WEIGHT = 1; // Para validación en modal (aunque el servidor valida)
const MAX_WEIGHT = 20; // Para validación en modal
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura']; // Para iterar

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
const myHackerBytesDisplay = document.getElementById('my-hacker-bytes-display'); // Display Hacker Bytes

// Balanzas
const mainScaleArm = document.getElementById('main-scale-arm');
const mainLeftPlatformVisual = document.getElementById('main-left-platform-visual');
const mainRightPlatformVisual = document.getElementById('main-right-platform-visual');
const mainLeftMaterials = document.getElementById('main-left-materials');
const mainRightMaterials = document.getElementById('main-right-materials');
const mainLeftWeight = document.getElementById('main-left-weight'); // Total weight (YA NO SE USA PARA MOSTRAR)
const mainRightWeight = document.getElementById('main-right-weight'); // Total weight (YA NO SE USA PARA MOSTRAR)
const mainBalanceStatus = document.getElementById('main-balance-status');

const secondaryScaleArm = document.getElementById('secondary-scale-arm');
const secondaryLeftPlatformVisual = document.getElementById('secondary-left-platform-visual');
const secondaryRightPlatformVisual = document.getElementById('secondary-right-platform-visual');
const secondaryLeftMaterials = document.getElementById('secondary-left-materials');
const secondaryRightMaterials = document.getElementById('secondary-right-materials');
const secondaryLeftWeight = document.getElementById('secondary-left-weight'); // Total weight (YA NO SE USA PARA MOSTRAR)
const secondaryRightWeight = document.getElementById('secondary-right-weight'); // Total weight (YA NO SE USA PARA MOSTRAR)

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
const guessCostDisplay = document.getElementById('guess-cost-display'); // Span para costo en modal

// Estado del Cliente
let gameId = null;
let playerId = null;
let isHost = false;
let gameState = null;
let currentScreen = screens.welcome;
let selectedMineralInstanceIds = [];
let turnTimerInterval = null;
let lastKnownPlayerId = null;

// --- Funciones de Utilidad y UI ---

/** Muestra una pantalla con animación */
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
                 if (screenElement === screens.game && gameState) {
                     console.log("CLIENT LOG: showScreen - Updating game UI before animating entry.");
                     updateGameUI(gameState);
                 }
                 const animatableElements = screenElement.querySelectorAll('.animatable-on-load');
                 if (animatableElements.length > 0) {
                     anime.set(animatableElements, { opacity: 0, translateY: 10 }); // Reset before animating
                     anime({
                         targets: animatableElements,
                         opacity: [0, 1],
                         translateY: [10, 0],
                         delay: anime.stagger(80, { start: 100 }) // Stagger slightly later
                     });
                 }
            },
            complete: () => {
                console.log(`CLIENT LOG: showScreen - Transition to ${screenElement.id} complete.`);
                 // Si es la pantalla de juego, asegurar que el área de colocación se anime correctamente si es necesario
                 if (screenElement === screens.game) {
                     updatePlacementControlsVisibility(true); // Forzar chequeo de visibilidad
                 }
            }
        });
    });
}

/** Muestra un modal con animación */
function showModal(modalElement) {
    if (!modalElement) return;
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

/** Oculta un modal con animación */
function hideModal(modalElement) {
    if (!modalElement || modalElement.style.display === 'none') return; // Evitar ocultar si ya está oculto
    const modalContent = modalElement.querySelector('.modal-content');

    anime({
        targets: modalContent,
        opacity: 0,
        scale: 0.8,
        translateY: -20,
        duration: 300,
        easing: 'easeInQuad'
    });

    anime({
        targets: modalElement,
        opacity: 0,
        duration: 350,
        delay: 100,
        easing: 'linear',
        complete: () => modalElement.style.display = 'none'
    });
}

/** Muestra una notificación */
function showNotification(message, title = 'Notificación') {
    const notificationTitleEl = document.getElementById('notification-title');
    if(notificationTitleEl) notificationTitleEl.innerHTML = `<i class="fas fa-info-circle"></i> ${title}`;
    if(notificationMessage) notificationMessage.textContent = message;
    showModal(notificationModal);
}

/** Formatea un peso (entero) */
function formatWeight(weight) {
    return (typeof weight === 'number') ? weight.toFixed(0) : '0';
}

/** Formatea Hacker Bytes (ej: con comas) */
function formatHackerBytes(amount) {
    return (typeof amount === 'number') ? amount.toLocaleString('es-CR') : '0'; // Formato local
}


/** Actualiza UNA balanza (principal o secundaria) */
function updateSingleScaleDisplay(scalePrefix, scaleData) {
    if (!scaleData) return; // Salir si no hay datos

    const scaleArm = document.getElementById(`${scalePrefix}-scale-arm`);
    const leftPlatform = document.getElementById(`${scalePrefix}-left-platform-visual`);
    const rightPlatform = document.getElementById(`${scalePrefix}-right-platform-visual`);
    const leftWeightEl = document.getElementById(`${scalePrefix}-left-weight`); // Referencia mantenida, pero no se usa para mostrar
    const rightWeightEl = document.getElementById(`${scalePrefix}-right-weight`); // Referencia mantenida, pero no se usa para mostrar
    const leftMaterialsEl = document.getElementById(`${scalePrefix}-left-materials`);
    const rightMaterialsEl = document.getElementById(`${scalePrefix}-right-materials`);

    const leftWeight = scaleData.leftWeight || 0;
    const rightWeight = scaleData.rightWeight || 0;

    // Actualizar pesos TOTALES mostrados - LÍNEAS ELIMINADAS/COMENTADAS
    // if (leftWeightEl) leftWeightEl.textContent = formatWeight(leftWeight);
    // if (rightWeightEl) rightWeightEl.textContent = formatWeight(rightWeight);

    // Renderizar pilas de materiales (SOLO TIPO)
    renderScaleMaterialsStack(leftMaterialsEl, scaleData.leftMaterials || []);
    renderScaleMaterialsStack(rightMaterialsEl, scaleData.rightMaterials || []);

    // Animación de inclinación
    if (scaleArm) {
        const difference = leftWeight - rightWeight;
        const maxAngle = 15;
        const maxPlatformOffset = 15;
        const sensitivity = 0.15;
        const equilibriumThreshold = 0; // Equilibrio exacto

        let angle = 0;
        let platformOffsetY = 0;

        // Solo inclinar si la diferencia es mayor que el umbral (0)
        if (Math.abs(difference) > equilibriumThreshold) {
            angle = Math.sign(difference) * Math.min(maxAngle, Math.log1p(Math.abs(difference)) * maxAngle * sensitivity);
            platformOffsetY = Math.sign(difference) * Math.min(maxPlatformOffset, Math.abs(difference) * 0.5);
        }

        anime({
            targets: scaleArm,
            rotate: angle,
            duration: 1200,
            easing: 'easeOutElastic(1, .7)'
        });

        if (leftPlatform && rightPlatform) {
             anime({
                targets: [leftPlatform, rightPlatform],
                translateY: (el) => el.classList.contains('left') ? -platformOffsetY : platformOffsetY,
                duration: 1200,
                easing: 'easeOutElastic(1, .7)'
             });
        }
    }

    // Lógica específica para balanza principal
    if (scalePrefix === 'main') {
        const isBalanced = Math.abs(leftWeight - rightWeight) <= 0; // Equilibrio exacto
        if (mainBalanceStatus) {
             mainBalanceStatus.textContent = isBalanced ? '(Equilibrada)' : '(Desequilibrada)';
             mainBalanceStatus.classList.toggle('balanced', isBalanced);
             mainBalanceStatus.classList.toggle('unbalanced', !isBalanced);
        }

        // Habilitar/deshabilitar botón de adivinar y actualizar texto
        if (guessWeightsBtn && gameState) {
             const canGuessNow = gameState.iCanGuess; // Este flag ya considera todo (turno, balance, coste, intentos)
             const attemptsLeft = gameState.myGuessAttemptsLeft ?? MAX_GUESS_ATTEMPTS; // Default si no viene
             guessWeightsBtn.disabled = !canGuessNow;
             // Actualizar texto del botón con intentos
             guessWeightsBtn.innerHTML = `<i class="fas fa-question-circle"></i> Adivinar Pesos (${attemptsLeft}/${MAX_GUESS_ATTEMPTS})`;

             // Actualizar tooltip con razón de deshabilitación
             guessWeightsBtn.title = canGuessNow ? `Adivinar pesos de todos los minerales (Cuesta ${COSTO_ADIVINANZA} Hacker Bytes)` : (
                !gameState.isMainScaleBalanced ? "La balanza principal debe estar equilibrada" :
                !gameState.myTurn ? "No es tu turno" :
                !(gameState.myHackerBytes >= COSTO_ADIVINANZA) ? `No tienes suficientes Hacker Bytes (${COSTO_ADIVINANZA})` :
                attemptsLeft <= 0 ? "Ya usaste tus intentos de adivinanza" :
                // !(gameState.myInventory && gameState.myInventory.length >= 1) ? "Necesitas al menos 1 mineral" : // Este chequeo está en iCanGuess
                "No se puede adivinar ahora"
             );
        }
        // Actualizar costo en el modal
        if(guessCostDisplay) guessCostDisplay.textContent = COSTO_ADIVINANZA;
    }
}


/** Renderiza materiales en balanza (SOLO TIPO) con animación */
function renderScaleMaterialsStack(container, materialsList) {
    if (!container) return;

    const fragment = document.createDocumentFragment();
    const itemsToAnimateEnter = [];
    const existingElementsMap = new Map();

    container.childNodes.forEach(node => {
        if (node.nodeType === 1 && node.dataset.instanceId) {
            existingElementsMap.set(node.dataset.instanceId, node);
        }
    });

    materialsList.forEach(mat => {
        let div;
        const instanceId = mat.instanceId;

        if (existingElementsMap.has(instanceId)) {
            div = existingElementsMap.get(instanceId);
            existingElementsMap.delete(instanceId);
        } else {
            div = document.createElement('div');
            const typeClass = mat.type ? mat.type.toLowerCase() : 'desconocido';
            div.className = `material-item ${typeClass}`;
            div.dataset.instanceId = instanceId;
            div.style.opacity = 0;
            div.style.transform = 'translateY(10px) scale(0.9)';
            itemsToAnimateEnter.push(div);
        }
        // Mostrar SOLO el tipo
        div.textContent = `${mat.type || '?'}`;
        div.title = `Mineral ${mat.type || 'Desconocido'}`; // Tooltip sin peso
        fragment.appendChild(div);
    });

    const itemsToAnimateExit = Array.from(existingElementsMap.values());

    if (itemsToAnimateExit.length > 0) {
        anime({
            targets: itemsToAnimateExit,
            opacity: 0,
            translateY: -10,
            scale: 0.9,
            duration: 300,
            easing: 'easeInQuad',
            complete: () => itemsToAnimateExit.forEach(el => el.remove())
        });
    }

    // Añadir los nuevos elementos (reemplazando el contenido)
    container.innerHTML = ''; // Limpiar eficientemente
    container.appendChild(fragment);

    if (itemsToAnimateEnter.length > 0) {
        anime({
            targets: itemsToAnimateEnter,
            opacity: 1,
            translateY: 0,
            scale: 1,
            delay: anime.stagger(60, { start: itemsToAnimateExit.length > 0 ? 150 : 0 }),
            duration: 400,
            easing: 'easeOutExpo'
        });
    }
}


/** Renderiza inventario (SOLO TIPO) */
function renderPlayerInventory(inventory) {
    if (!myInventoryContainer) return;

    const fragment = document.createDocumentFragment();
    const currentInventoryMap = new Map();
    myInventoryContainer.childNodes.forEach(node => {
        if (node.nodeType === 1 && node.dataset.instanceId) {
            currentInventoryMap.set(node.dataset.instanceId, node);
        }
    });

    const newInventorySet = new Set(inventory?.map(m => m.instanceId) ?? []);
    const itemsToAnimateEnter = [];
    const itemsToKeep = [];

    // Puede interactuar si es su turno Y puede colocar (tiene >= 2 minerales)
    const canInteract = gameState?.myTurn && gameState?.iCanPlaceMinerals;

    if (!Array.isArray(inventory) || inventory.length === 0) {
        myInventoryContainer.innerHTML = '<p class="info-text">No te quedan minerales.</p>';
        if (myMineralCount) myMineralCount.textContent = '0';
        if (cannotPlaceMessage) cannotPlaceMessage.classList.remove('hidden');
        selectedMineralInstanceIds = [];
        updatePlacementControls();
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
            button.disabled = !canInteract;
            button.classList.toggle('selected-material', selectedMineralInstanceIds.includes(instanceId) && canInteract);
            itemsToKeep.push(button);
        } else {
            button = document.createElement('button');
            button.className = `inventory-item ${typeClass}`; // Usar clase base
            // Mostrar SOLO el tipo
            button.textContent = `${mineral.type || '?'}`;
            button.title = `Mineral ${mineral.type || 'Desconocido'}`; // Tooltip sin peso
            button.dataset.instanceId = instanceId;
            button.disabled = !canInteract;
            button.style.opacity = 0;
            button.style.transform = 'scale(0.8)';

            if (selectedMineralInstanceIds.includes(instanceId) && canInteract) {
                 button.classList.add('selected-material');
            } else if (selectedMineralInstanceIds.includes(instanceId) && !canInteract) {
                 selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => id !== instanceId);
            }

            button.addEventListener('click', handleInventoryItemClick);
            itemsToAnimateEnter.push(button);
        }
        fragment.appendChild(button);
    });

    const itemsToRemove = Array.from(currentInventoryMap.values());
    if (itemsToRemove.length > 0) {
        anime({
            targets: itemsToRemove,
            opacity: 0, scale: 0.8, duration: 300, easing: 'easeInQuad',
            complete: () => itemsToRemove.forEach(el => el.remove())
        });
        selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => !itemsToRemove.some(btn => btn.dataset.instanceId === id));
    }

    myInventoryContainer.innerHTML = '';
    myInventoryContainer.appendChild(fragment);

    if (itemsToAnimateEnter.length > 0) {
        anime({
            targets: itemsToAnimateEnter,
            opacity: 1, scale: 1, delay: anime.stagger(50), duration: 300, easing: 'easeOutBack'
        });
    }

    updatePlacementControls();
}


/** Manejador de clic para item de inventario */
function handleInventoryItemClick(event) {
    const button = event.currentTarget;
    if (button.disabled) return;

    const id = button.dataset.instanceId;
    const isSelected = button.classList.toggle('selected-material');

    if (isSelected) {
        if (!selectedMineralInstanceIds.includes(id)) selectedMineralInstanceIds.push(id);
    } else {
        selectedMineralInstanceIds = selectedMineralInstanceIds.filter(selId => selId !== id);
    }

    anime({
        targets: button,
        scale: isSelected ? [1, 1.08, 1] : [1.08, 1],
        duration: 300,
        easing: 'easeOutElastic(1, .8)'
    });

    updatePlacementControls();
}


/** Actualiza la sección de controles de colocación */
function updatePlacementControls() {
    if (!placementControlsSection || !gameState) return;

    const count = selectedMineralInstanceIds.length;
    const canPlaceSelection = gameState.myTurn && gameState.iCanPlaceMinerals && count >= 2;

    // Mostrar controles si tiene algo seleccionado Y es su turno Y puede colocar
    const shouldShowControls = count > 0 && gameState.myTurn && gameState.iCanPlaceMinerals;
    updatePlacementControlsVisibility(shouldShowControls); // Llamar a función separada para animación

    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (placeSelectedBtn) placeSelectedBtn.disabled = !canPlaceSelection;
    if (placementError) placementError.classList.toggle('hidden', count === 0 || count >= 2);

    if(targetScaleSelect) targetScaleSelect.disabled = count === 0;
    if(targetSideSelect) targetSideSelect.disabled = count === 0;
}

/** Controla la visibilidad animada de los controles de colocación */
function updatePlacementControlsVisibility(shouldShow) {
    if (!placementControlsSection) return;
    const isCurrentlyVisible = placementControlsSection.classList.contains('visible');

    if (shouldShow && !isCurrentlyVisible) {
        placementControlsSection.classList.remove('hidden'); // Quitar hidden si estaba
        placementControlsSection.classList.add('visible');
        // Animar entrada
        const targetHeight = placementControlsSection.scrollHeight; // Calcular altura necesaria
        anime({
            targets: placementControlsSection,
            height: [0, targetHeight + 'px'], // Animar altura desde 0
            opacity: [0, 1],
            paddingTop: [0, 20], // Animar padding
            marginTop: [0, 20], // Animar margen
            duration: 350,
            easing: 'easeOutQuad',
            begin: () => {
                 // Añadir borde justo antes de empezar a animar altura > 0
                 if(!placementControlsSection.style.borderTop) {
                     placementControlsSection.style.borderTop = `1px solid ${getComputedStyle(document.documentElement).getPropertyValue('--border-color')}`;
                 }
            },
            complete: () => {
                placementControlsSection.style.height = 'auto'; // Dejar altura automática al final
            }
        });
    } else if (!shouldShow && isCurrentlyVisible) {
        // Animar salida
        anime({
            targets: placementControlsSection,
            height: 0,
            opacity: 0,
            paddingTop: 0,
            marginTop: 0,
            borderTopWidth: 0, // Animar borde a 0
            duration: 300,
            easing: 'easeInQuad',
            complete: () => {
                placementControlsSection.classList.remove('visible');
                placementControlsSection.classList.add('hidden'); // Añadir hidden al final
                placementControlsSection.style.height = ''; // Resetear para futuro
                 placementControlsSection.style.borderTop = ''; // Resetear borde
                 placementControlsSection.style.borderTopWidth = ''; // Resetear ancho borde
            }
        });
    }
}

/** Función PRINCIPAL para actualizar TODA la UI del juego */
function updateGameUI(newState) {
    console.log(`--- Updating UI for Player ${playerId} ---`);
    if (!newState) {
        console.error("CLIENT ERROR: updateGameUI llamado sin estado válido!");
        showNotification("Error: Se recibió un estado de juego inválido.", "Error de Sincronización");
        return;
    }
    // console.log('Received State:', JSON.stringify(newState, null, 2)); // Log detallado opcional

    const oldPlayerId = gameState?.currentPlayer?.id;
    const wasMyTurnBefore = gameState?.myTurn;
    gameState = newState; // Actualizar estado global

    const currentPlayer = gameState.currentPlayer;
    const isNewTurn = currentPlayer?.id !== oldPlayerId;

    // --- Indicadores Superiores ---
    if (currentPlayerIndicator) {
        const newText = currentPlayer
            ? `${currentPlayer.name} (Turno ${currentPlayer.turnOrder})`
            : (gameState.status.startsWith('finished') ? 'Juego Terminado' : 'Esperando...');
        if (currentPlayerIndicator.textContent !== newText) {
            // (Animación de cambio de texto como antes)
             anime({
                 targets: currentPlayerIndicator, opacity: [1, 0], duration: 200, easing: 'linear',
                 complete: () => {
                     currentPlayerIndicator.textContent = newText;
                     anime({ targets: currentPlayerIndicator, opacity: [0, 1], translateX: isNewTurn ? [-10, 0] : 0, scale: isNewTurn ? [1.1, 1] : 1, color: isNewTurn ? ['#FFF', '#f0c040', '#e8e8ea'] : '#e8e8ea', duration: 400, easing: 'easeOutQuad' });
                 }
             });
        }
    }
    if (knownInfoText) knownInfoText.textContent = gameState.knownMineralInfo?.description || '-';
    if (myHackerBytesDisplay) myHackerBytesDisplay.textContent = formatHackerBytes(gameState.myHackerBytes); // <-- Actualizar Hacker Bytes

    // --- Última Adivinanza (con premio extra) ---
    if (lastGuessInfoCard && lastGuessText) {
        const lastGuess = gameState.lastGuessResult;
        const guesserInfo = lastGuess ? gameState.playersPublicInfo?.find(p => p.id === lastGuess.playerId) : null;
        const isMyGuess = lastGuess && lastGuess.playerId === playerId; // ¿Fue mi adivinanza?

        const shouldShowGeneral = lastGuess && !lastGuess.correct && guesserInfo;
        const shouldShowReward = shouldShowGeneral && lastGuess.rewardGranted > 0;

        if (shouldShowReward) {
             const who = isMyGuess ? "Tu intento" : `El intento de <strong>${guesserInfo.name}</strong>`;
             lastGuessText.innerHTML = `${who} fue incorrecto, pero acertó ${lastGuess.correctCount} peso(s).<br>¡Ganó <strong class="success-highlight">+${formatHackerBytes(lastGuess.rewardGranted)}</strong> Hacker Bytes!`;
             if (lastGuessInfoCard.classList.contains('hidden')) {
                 lastGuessInfoCard.classList.remove('hidden');
                 anime({ targets: lastGuessInfoCard, opacity: [0, 1], duration: 300, easing: 'easeOutQuad' });
             }
        } else if (shouldShowGeneral) {
            const who = isMyGuess ? "Tu intento" : `El intento de ${guesserInfo.name}`;
             lastGuessText.textContent = `${who} fue incorrecto.`;
             if (lastGuessInfoCard.classList.contains('hidden')) {
                lastGuessInfoCard.classList.remove('hidden');
                anime({ targets: lastGuessInfoCard, opacity: [0, 1], duration: 300, easing: 'easeOutQuad' });
             }
        } else {
             if (!lastGuessInfoCard.classList.contains('hidden')) {
                 anime({ targets: lastGuessInfoCard, opacity: [1, 0], duration: 300, easing: 'easeInQuad', complete: () => lastGuessInfoCard.classList.add('hidden') });
             }
        }
    }

    // --- Balanzas ---
    updateSingleScaleDisplay('main', gameState.mainScale);
    updateSingleScaleDisplay('secondary', gameState.secondaryScale);

    // --- Estado del Jugador (Turno, Inventario, Controles) ---
    const isMyTurnNow = gameState.myTurn;
    if (myTurnIndicator) myTurnIndicator.classList.toggle('hidden', !isMyTurnNow);
    if (waitingTurnIndicator) waitingTurnIndicator.classList.toggle('hidden', isMyTurnNow || gameState.status !== 'playing');

    // Animar cambio de turno
     if (isMyTurnNow && !wasMyTurnBefore && !myTurnIndicator.classList.contains('hidden')) {
          anime({ targets: myTurnIndicator, opacity: [0, 1], translateY: [-10, 0], duration: 400, easing: 'easeOutQuad' });
     } else if (!isMyTurnNow && wasMyTurnBefore && !waitingTurnIndicator.classList.contains('hidden')) {
         anime({ targets: waitingTurnIndicator, opacity: [0, 1], duration: 400, easing: 'easeOutQuad' });
     }

    // Actualizar inventario (ya no muestra pesos)
    renderPlayerInventory(gameState.myInventory || []);
    // Actualizar controles de colocación (se anima dentro de la función)
    updatePlacementControls();


    // --- Lista de Jugadores Sidebar ---
    if (gamePlayersList) {
        // (Misma lógica de renderizado que antes, funciona bien)
        const fragment = document.createDocumentFragment();
        const playerElementsMap = new Map();
        gamePlayersList.childNodes.forEach(node => { if (node.nodeType === 1 && node.dataset.playerId) playerElementsMap.set(node.dataset.playerId, node); });
        const itemsToAnimateEnter = [];
        const itemsToAnimateUpdate = [];

        gameState.playersPublicInfo?.forEach(p => {
            const isCurrent = p.id === gameState.currentPlayer?.id;
            const isMe = p.id === playerId;
            const mineralCountDisplay = (typeof p.mineralCount === 'number') ? p.mineralCount : '?';
            let li;
            if (playerElementsMap.has(p.id)) {
                li = playerElementsMap.get(p.id); playerElementsMap.delete(p.id); itemsToAnimateUpdate.push(li);
            } else {
                li = document.createElement('li'); li.dataset.playerId = p.id; li.style.opacity = 0; itemsToAnimateEnter.push(li);
            }
            li.className = 'player-row';
            if (!p.isActive) li.classList.add('player-inactive');
            if (isMe) li.classList.add('my-player-row');
            if (isCurrent && gameState.status === 'playing') li.classList.add('current-player-row'); // Solo resaltar si está jugando
            li.innerHTML = `
                <span class="player-order">${p.turnOrder || '?'}</span>.
                <span class="player-name">${p.name || '??'} ${isMe ? '<span class="you-tag">(Tú)</span>' : ''}</span>
                <span class="player-minerals">(<i class="fas fa-gem"></i> ${mineralCountDisplay})</span>
                <span class="player-status">
                    ${!p.isActive ? '<span class="status-tag inactive-tag" title="Desconectado">Desc.</span>' : ''}
                    ${p.isActive && !(p.canPlaceMinerals ?? true) ? '<span class="status-tag cannot-play-tag" title="No puede colocar más minerales">No Juega</span>' : ''}
                </span>
                ${isCurrent && gameState.status === 'playing' ? '<i class="fas fa-star player-turn-star" title="Turno actual"></i>' : ''}
            `;
            fragment.appendChild(li);
        });
        const itemsToRemove = Array.from(playerElementsMap.values());
        if (itemsToRemove.length > 0) { anime({ targets: itemsToRemove, opacity: 0, height: 0, padding: 0, margin: 0, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) }); }
        gamePlayersList.innerHTML = ''; gamePlayersList.appendChild(fragment);
        if (itemsToAnimateEnter.length > 0) { anime({ targets: itemsToAnimateEnter, opacity: [0, 1], translateX: [-5, 0], delay: anime.stagger(40), duration: 300, easing: 'easeOutQuad' }); }
    }

    // --- Temporizador ---
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = null;
    if (gameState.status === 'playing') {
        if (isMyTurnNow) {
             startTurnTimer(5 * 60); // 5 minutos (Ajustar si es necesario)
        } else {
             if (gameTimer) gameTimer.textContent = '--:--';
             if (gameTimer) gameTimer.classList.remove('timer-alert', 'shake-animation');
        }
    } else {
        if (gameTimer) gameTimer.textContent = '--:--';
        if (gameTimer) gameTimer.classList.remove('timer-alert', 'shake-animation');
    }

    lastKnownPlayerId = currentPlayer?.id;
}

/** Inicia el temporizador de turno */
function startTurnTimer(durationSeconds) {
    // (Misma lógica que antes)
    let remaining = durationSeconds;
    if (!gameTimer) return;
    const updateDisplay = () => {
        if(!gameTimer || !gameState || !gameState.myTurn) {
             if(turnTimerInterval) clearInterval(turnTimerInterval); turnTimerInterval = null;
             if(gameTimer) gameTimer.textContent = '--:--'; return;
        }
        const minutes = Math.floor(remaining / 60); const seconds = remaining % 60;
        gameTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        const isAlert = remaining <= 30 && remaining > 0;
        gameTimer.classList.toggle('timer-alert', isAlert);
        gameTimer.classList.toggle('shake-animation', remaining <= 10 && remaining > 0 && remaining % 2 === 0);
        if (remaining <= 0) {
             clearInterval(turnTimerInterval); turnTimerInterval = null;
             console.log("¡Tiempo de turno agotado!"); gameTimer.textContent = '00:00';
             gameTimer.classList.add('timer-alert');
             // Podría emitir timeout al servidor aquí
        }
    };
    updateDisplay();
    turnTimerInterval = setInterval(() => { remaining--; updateDisplay(); }, 1000);
}


/** Establece estado de carga en botón */
function setLoadingState(button, isLoading, loadingText = '') {
    // (Misma lógica que antes)
     if (!button) return;
     if (isLoading) {
         button.disabled = true;
         button.dataset.originalContent = button.innerHTML; // Guardar HTML completo
         button.innerHTML = `<span class="spinner" role="status" aria-hidden="true"><i class="fas fa-spinner fa-spin"></i></span> ${loadingText || ''}`;
         button.classList.add('loading');
     } else {
         button.disabled = false;
          if (button.dataset.originalContent) {
              button.innerHTML = button.dataset.originalContent; // Restaurar HTML
          } else {
               // Fallback si no se guardó (intentar deducir o texto genérico)
               // Necesitaría lógica más compleja para restaurar texto + icono
               button.innerHTML = button.textContent || "Acción"; // Simple fallback
          }
         button.classList.remove('loading');
          delete button.dataset.originalContent;
     }
}

/** Muestra la animación de Jackpot */
function showJackpotAnimation() {
    const jackpotEl = document.getElementById('jackpot-animation');
    if (!jackpotEl) return;

    // Asegurar estado inicial
    anime.set(jackpotEl, { display: 'flex', opacity: 0 });
    const content = jackpotEl.querySelector('.jackpot-content');
    const title = jackpotEl.querySelector('.jackpot-title');
    const amount = jackpotEl.querySelector('.jackpot-amount');
    const subtitle = jackpotEl.querySelector('.jackpot-subtitle');
    anime.set(content, { scale: 0.5 });
    anime.set([title, amount, subtitle], { opacity: 0 }); // Ocultar elementos internos

    console.log("CLIENT LOG: Mostrando Animación Jackpot!");

    // Animación de entrada del overlay
    anime({
        targets: jackpotEl,
        opacity: [0, 1],
        duration: 400,
        easing: 'linear',
        complete: () => {
            // Animación del contenido una vez el fondo es visible
            anime({
                targets: content,
                scale: [0.5, 1],
                opacity: 1, // Asegurar que el contenedor sea visible
                duration: 800,
                easing: 'easeOutElastic(1, .6)'
            });
            // Animaciones escalonadas para el texto
            anime({ targets: title, opacity: [0, 1], translateY: [20, 0], duration: 800, easing: 'easeOutExpo', delay: 300 });
            anime({ targets: amount, opacity: [0, 1], scale: [0.8, 1], duration: 800, easing: 'easeOutBack', delay: 600 });
            anime({ targets: subtitle, opacity: [0, 1], translateY: [-10, 0], duration: 800, easing: 'easeOutExpo', delay: 900 });
        }
    });


    // Ocultar después de un tiempo
    setTimeout(() => {
        anime({
            targets: jackpotEl,
            opacity: 0,
            duration: 600,
            easing: 'easeInQuad',
            complete: () => {
                jackpotEl.style.display = 'none';
                // Resetear estilos para la próxima vez si es necesario
                anime.set(content, { scale: 1, opacity: 1 });
                anime.set([title, amount, subtitle], { opacity: 1, translateY: 0, scale: 1});
            }
        });
    }, 6000); // Mostrar por 6 segundos
}


// --- Event Listeners de Controles del Cliente ---

// (Listeners de navegación, crear, unirse, copiar código: sin cambios necesarios)
createBtn?.addEventListener('click', () => showScreen(screens.create));
joinBtn?.addEventListener('click', () => showScreen(screens.join));
backFromCreateBtn?.addEventListener('click', () => showScreen(screens.welcome));
backFromJoinBtn?.addEventListener('click', () => showScreen(screens.welcome));
copyCodeBtn?.addEventListener('click', () => {
    const code = waitGameCodeDisplay?.textContent;
    if (code && code !== '------' && navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
            copyCodeBtn.innerHTML = '<i class="fas fa-check"></i>'; copyCodeBtn.style.borderColor = 'var(--success-color)';
            setTimeout(() => { copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i>'; copyCodeBtn.style.borderColor = ''; }, 1500);
        }).catch(err => { console.error("Error al copiar:", err); showNotification('Error al copiar.', 'Error'); });
    } else if (code && code !== '------') { showNotification('Código: ' + code, 'Copia Manual'); }
});
createForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostNameInput = document.getElementById('host-name');
    const hostName = hostNameInput?.value.trim();
    const submitBtn = document.getElementById('create-form-submit');
    if (!hostName) { showNotification("Ingresa tu nombre.", "Nombre Requerido"); hostNameInput?.classList.add('input-error'); setTimeout(() => hostNameInput?.classList.remove('input-error'), 2500); hostNameInput?.focus(); return; }
    if (submitBtn) { setLoadingState(submitBtn, true, 'Creando...'); socket.emit('createGame', { hostName }, (response) => { setLoadingState(submitBtn, false); if (response?.success) { gameId = response.gameId; playerId = response.playerId; isHost = true; if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = response.gameCode; if(waitPlayerCount) waitPlayerCount.textContent = '1'; if(waitPlayersList) { waitPlayersList.innerHTML = ''; const li = document.createElement('li'); li.innerHTML = `<span class="player-order">1</span>. ${hostName} <span class="host-tag">(Host)</span> <span class="you-tag">(Tú)</span>`; waitPlayersList.appendChild(li); } if(hostInstructions) hostInstructions.classList.remove('hidden'); if(startGameBtn) { startGameBtn.classList.remove('hidden'); startGameBtn.disabled = true; startGameBtn.title = "Se necesitan al menos 2 jugadores"; } if(playerWaitMessage) playerWaitMessage.classList.add('hidden'); showScreen(screens.waiting); } else { showNotification(response?.message || 'Error al crear juego.', 'Error'); } }); }
});
joinForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCodeInput = document.getElementById('join-game-code');
    const playerNameInput = document.getElementById('join-player-name');
    const gameCode = gameCodeInput?.value.trim();
    const playerName = playerNameInput?.value.trim();
    const submitBtn = document.getElementById('join-form-submit');
    let hasError = false; gameCodeInput?.classList.remove('input-error'); playerNameInput?.classList.remove('input-error');
    if (!gameCode || !/^[0-9]{6}$/.test(gameCode)) { gameCodeInput?.classList.add('input-error'); hasError = true; }
    if (!playerName) { playerNameInput?.classList.add('input-error'); hasError = true; }
    if (hasError) { showNotification("Ingresa código (6 dígitos) y nombre.", "Datos Inválidos"); if (!gameCode || !/^[0-9]{6}$/.test(gameCode)) gameCodeInput?.focus(); else if (!playerName) playerNameInput?.focus(); return; }
    if (submitBtn) { setLoadingState(submitBtn, true, 'Uniéndose...'); socket.emit('joinGame', { gameCode, playerName }, (response) => { setLoadingState(submitBtn, false); if (response?.success) { gameId = response.gameId; playerId = response.playerId; isHost = false; if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = gameCode; if(hostInstructions) hostInstructions.classList.add('hidden'); if(startGameBtn) startGameBtn.classList.add('hidden'); if(playerWaitMessage) playerWaitMessage.classList.remove('hidden'); showScreen(screens.waiting); } else { showNotification(response?.message || 'Error al unirse.', 'Error'); if (response?.message?.includes("nombre")) playerNameInput?.focus(); else if (response?.message?.includes("encontrado")) gameCodeInput?.focus(); } }); }
});

// Iniciar Juego (Host)
startGameBtn?.addEventListener('click', () => {
    // (Misma lógica que antes)
    if (isHost && gameId && !startGameBtn.disabled) {
        console.log("CLIENT LOG: Host presionó 'Iniciar Juego'.");
        setLoadingState(startGameBtn, true, 'Iniciando...');
        socket.emit('startGame', { gameId });
    } else if (startGameBtn.disabled) {
         showNotification("Se necesitan al menos 2 jugadores.", "Faltan Jugadores");
    }
});

// Colocar Minerales Seleccionados
placeSelectedBtn?.addEventListener('click', () => {
    // (Misma lógica que antes)
    if (placeSelectedBtn.disabled || selectedMineralInstanceIds.length < 2) return;
    const placements = selectedMineralInstanceIds.map(instanceId => ({
        mineralInstanceId: instanceId,
        targetScale: targetScaleSelect?.value || 'main',
        targetSide: targetSideSelect?.value || 'left'
    }));
    console.log("CLIENT LOG: Emitiendo 'placeMinerals':", placements);
    setLoadingState(placeSelectedBtn, true);
    if (cancelPlacementBtn) cancelPlacementBtn.disabled = true;
    myInventoryContainer?.querySelectorAll('.inventory-item').forEach(btn => btn.disabled = true);
    socket.emit('placeMinerals', { gameId, playerId, placements });
    // La selección se limpiará en gameStateUpdated
});

// Limpiar Selección de Minerales
cancelPlacementBtn?.addEventListener('click', () => {
    // (Misma lógica que antes)
    const itemsToDeselect = [];
    myInventoryContainer?.querySelectorAll('.selected-material').forEach(btn => { btn.classList.remove('selected-material'); itemsToDeselect.push(btn); });
    if (itemsToDeselect.length > 0) { anime({ targets: itemsToDeselect, scale: [1.08, 1], duration: 200, easing: 'easeOutQuad' }); }
    selectedMineralInstanceIds = [];
    updatePlacementControls();
});

// Abrir Modal de Adivinanza
guessWeightsBtn?.addEventListener('click', () => {
    // (Misma lógica que antes)
    if (guessWeightsBtn.disabled) return;
    guessForm?.reset();
    guessForm?.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    showModal(guessModal);
    document.getElementById('guess-rojo')?.focus();
});

// Enviar Adivinanza
guessForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const guesses = {};
    let formIsValid = true;
    const submitBtn = guessForm.querySelector('button[type="submit"]');

    MINERAL_TYPES.forEach(type => {
        const input = guessForm.elements[type];
        input?.classList.remove('input-error');
        if (!input) { formIsValid = false; return; }
        const value = parseInt(input.value);
        if (isNaN(value) || value < MIN_WEIGHT || value > MAX_WEIGHT) {
             formIsValid = false; input.classList.add('input-error');
        } else {
            guesses[type] = value;
        }
    });

    if (!formIsValid) {
        showNotification(`Ingresa pesos válidos (${MIN_WEIGHT}-${MAX_WEIGHT}g) para todos.`, "Adivinanza Incompleta");
        anime({ targets: guessModal.querySelector('.modal-content'), translateX: [-5, 5, -3, 3, 0], duration: 400, easing: 'easeInOutSine'});
        guessForm.querySelector('.input-error')?.focus();
        return;
    }

    console.log("CLIENT LOG: Emitiendo 'guessWeights':", guesses);
    if (submitBtn) setLoadingState(submitBtn, true, 'Enviando...');
    socket.emit('guessWeights', { gameId, playerId, guesses });
    // El servidor manejará el cierre del modal o la actualización del estado.
});

// Jugar Otra Vez
playAgainBtn?.addEventListener('click', () => {
    // (Misma lógica que antes)
     anime({ targets: 'body', opacity: 0, duration: 400, easing: 'easeInQuad', complete: () => window.location.reload() });
});

// Cerrar Modales Genérico
document.querySelectorAll('.modal .close-btn, .modal .modal-cancel-btn, #notification-ok').forEach(btn => {
    btn.addEventListener('click', (event) => {
        const modal = event.target.closest('.modal');
        if (modal) hideModal(modal);
    });
});


// --- Event Listeners de Socket.IO ---

socket.on('connect', () => console.log('CLIENT LOG: Conectado al servidor:', socket.id));
socket.on('disconnect', (reason) => { console.warn('CLIENT LOG: Desconectado:', reason); showNotification(`Desconexión: ${reason}. Recarga para reconectar.`, "Desconectado"); document.querySelectorAll('button, input, select').forEach(el => { if (el !== playAgainBtn) el.disabled = true; }); if (turnTimerInterval) clearInterval(turnTimerInterval); turnTimerInterval = null; if(gameTimer) gameTimer.textContent = '--:--'; });

socket.on('error', (data) => {
    console.error('CLIENT ERROR: Error del servidor:', data.message);
    showNotification(`Error: ${data.message || 'Error desconocido.'}`, 'Error');
    // Resetear botones en carga
     document.querySelectorAll('button.loading').forEach(btn => {
         if (btn === startGameBtn || btn === placeSelectedBtn || btn === guessForm?.querySelector('button[type="submit"]')) {
             setLoadingState(btn, false);
         }
     });
     // Reactivar controles si aplica
     if (placeSelectedBtn && !placeSelectedBtn.disabled) { if(cancelPlacementBtn) cancelPlacementBtn.disabled = false; }
     if (isHost && startGameBtn && gameState?.status === 'waiting') { startGameBtn.disabled = (parseInt(waitPlayerCount?.textContent || '0') < 2); }
});

// Actualiza lista de jugadores en sala de espera
socket.on('playerListUpdated', (data) => {
    // (Misma lógica que antes, funciona bien)
    console.log("CLIENT LOG: Recibido playerListUpdated:", data);
    if (currentScreen === screens.waiting && waitPlayersList && waitPlayerCount) {
        const fragment = document.createDocumentFragment();
        const playerElementsMap = new Map();
        waitPlayersList.childNodes.forEach(node => { if (node.nodeType === 1 && node.dataset.playerId) playerElementsMap.set(node.dataset.playerId, node); });
        const itemsToEnter = [];
        data.players?.forEach(p => {
             let li;
             if (playerElementsMap.has(p.id)) { li = playerElementsMap.get(p.id); playerElementsMap.delete(p.id); }
             else { li = document.createElement('li'); li.dataset.playerId = p.id; li.style.opacity = 0; itemsToEnter.push(li); }
             li.innerHTML = `<span class="player-order">${p.turnOrder}.</span> ${p.name} ${p.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''} ${p.id === gameState?.hostId || (isHost && p.turnOrder === 1) ? '<span class="host-tag">(Host)</span>' : ''}`;
             li.classList.toggle('inactive', !p.isActive);
             fragment.appendChild(li);
        });
        const itemsToRemove = Array.from(playerElementsMap.values());
        if (itemsToRemove.length > 0) { anime({ targets: itemsToRemove, opacity: 0, height: 0, padding: 0, margin: 0, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) }); }
        waitPlayersList.innerHTML = ''; waitPlayersList.appendChild(fragment);
        if (itemsToEnter.length > 0) { anime({ targets: itemsToEnter, opacity: [0, 1], translateX: [-10, 0], delay: anime.stagger(50), duration: 300, easing: 'easeOutQuad' }); }
        const currentCount = data.count ?? data.players?.length ?? 0;
        waitPlayerCount.textContent = currentCount;
        if (isHost && startGameBtn) {
             const canStart = currentCount >= 2; startGameBtn.disabled = !canStart;
             startGameBtn.title = canStart ? "Iniciar el juego" : "Se necesitan al menos 2 jugadores";
             if (!canStart && startGameBtn.classList.contains('loading')) { setLoadingState(startGameBtn, false); }
        }
    }
});

// El juego ha comenzado
socket.on('gameStarted', ({ gameState: receivedGameState }) => {
    // (Misma lógica que antes)
    console.log("CLIENT LOG: Recibido 'gameStarted'.");
    if (isHost && startGameBtn && startGameBtn.classList.contains('loading')) { setLoadingState(startGameBtn, false); }
    if (receivedGameState) {
        gameId = receivedGameState.gameId; playerId = receivedGameState.myPlayerId;
        gameState = receivedGameState; // Guardar estado ANTES de mostrar pantalla
        showScreen(screens.game); // updateGameUI se llama dentro
    } else {
        showNotification("Error al recibir estado inicial.", "Error al Iniciar");
        if(isHost && startGameBtn) { startGameBtn.disabled = (parseInt(waitPlayerCount?.textContent || '0') < 2); }
    }
});

// Actualización del estado del juego
socket.on('gameStateUpdated', ({ gameState: receivedGameState }) => {
    console.log('--- Received gameStateUpdated ---');
    if (!receivedGameState) {
        console.error("CLIENT ERROR: Estado nulo en gameStateUpdated!");
        showNotification("Error: Actualización inválida recibida.", "Error Sincro");
        return;
    }
     // console.log('Updated State:', JSON.stringify(receivedGameState, null, 2)); // Debug

    // Resetear botones de carga
    if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
    const guessSubmitBtn = guessForm?.querySelector('button[type="submit"]');
    if (guessSubmitBtn?.classList.contains('loading')) setLoadingState(guessSubmitBtn, false);

    // Ocultar modal de adivinanza si falló y ya no es mi turno
     if (guessModal.style.display !== 'none' &&
         !receivedGameState.myTurn &&
         gameState?.lastGuessResult?.playerId === playerId && // ¿Mi intento anterior?
         !gameState?.lastGuessResult?.correct) // ¿Fue incorrecto?
     {
          console.log("CLIENT LOG: Ocultando modal de adivinanza tras fallo y cambio de turno.");
          hideModal(guessModal);
     }

    // Limpiar selección si ya no es mi turno o no puedo colocar
     if (!receivedGameState.myTurn || !receivedGameState.iCanPlaceMinerals) {
        if (selectedMineralInstanceIds.length > 0) {
             console.log("CLIENT LOG: Limpiando selección porque no es mi turno / no puedo colocar.");
             selectedMineralInstanceIds = [];
             // Deseleccionar visualmente (se hará en renderPlayerInventory)
        }
     }


    // Actualizar UI si estamos en la pantalla correcta
     if ((currentScreen === screens.game || currentScreen === screens.waiting) && receivedGameState.status === 'playing') {
        if (currentScreen === screens.waiting) {
            console.log("CLIENT LOG: gameStateUpdated en 'waiting', cambiando a 'game'.");
            gameState = receivedGameState; // Guardar estado antes de cambiar
            showScreen(screens.game); // Llama a updateGameUI
        } else {
            updateGameUI(receivedGameState);
        }
     } else if (currentScreen === screens.game && receivedGameState.status !== 'playing') {
         console.log(`CLIENT LOG: gameStateUpdated en 'game', pero estado es ${receivedGameState.status}. Actualizando UI final.`);
         updateGameUI(receivedGameState); // Actualizar UI para mostrar estado final antes de gameOver
     } else if (receivedGameState.status === 'waiting' && currentScreen === screens.waiting) {
          console.log("CLIENT LOG: gameStateUpdated en 'waiting'. Podría ser redundante.");
          // playerListUpdated debería manejar esto. Guardar estado por si acaso.
          gameState = receivedGameState;
     } else {
         console.log(`CLIENT LOG: gameStateUpdated ignorado (Pantalla: ${currentScreen?.id}, Estado: ${receivedGameState?.status}). Estado guardado.`);
         gameState = receivedGameState; // Guardar aunque no actualice UI principal
     }
});

// Fin del juego
socket.on('gameOver', ({ gameState: finalGameState, actualWeights }) => {
    console.log("CLIENT LOG: Recibido 'gameOver'.", finalGameState, actualWeights);

    // Limpiar estados/modales
    if (guessModal && guessModal.style.display !== 'none') {
        hideModal(guessModal);
        const guessSubmitBtn = guessForm?.querySelector('button[type="submit"]');
        if(guessSubmitBtn?.classList.contains('loading')) setLoadingState(guessSubmitBtn, false);
    }
    if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
    if (startGameBtn?.classList.contains('loading')) setLoadingState(startGameBtn, false);


    if (finalGameState) {
        gameState = finalGameState;

        const titleEl = document.getElementById('final-result-title');
        const messageEl = document.getElementById('final-result-message');
        const winnersEl = document.getElementById('final-winners');
        const weightsEl = document.getElementById('final-actual-weights');

        const isSuccess = finalGameState.status === 'finished_success';
        const winner = finalGameState.successfulGuesser; // Objeto { id, name }

        if (titleEl) titleEl.innerHTML = `<i class="fas ${isSuccess ? 'fa-trophy' : 'fa-times-circle'}"></i> ${isSuccess ? '¡Adivinanza Correcta!' : 'Fin del Juego'}`;
        if (messageEl) messageEl.textContent = isSuccess && winner
            ? `¡${winner.name} adivinó correctamente los pesos!`
            : (finalGameState.status === 'finished_failure' ? 'Nadie adivinó los pesos.' : 'Juego terminado.');
        if (winnersEl) winnersEl.textContent = isSuccess && winner
            ? `🏆 Ganador: ${winner.name}`
            : 'Ganadores: Ninguno';

        // Mostrar pesos reales
        if (weightsEl && actualWeights) {
            weightsEl.innerHTML = '';
            const weightItems = [];
            MINERAL_TYPES.sort().forEach(type => { // Ordenar alfabéticamente
                 if (actualWeights.hasOwnProperty(type)) {
                     const li = document.createElement('li');
                     const typeClass = type.toLowerCase();
                     li.innerHTML = `<span class="mineral-color-indicator ${typeClass}" title="${type}"></span> <strong>${type}:</strong> ${actualWeights[type]}g`;
                     li.style.opacity = 0;
                     weightsEl.appendChild(li);
                     weightItems.push(li);
                 }
            });
             anime({ targets: weightItems, opacity: [0, 1], translateY: [5, 0], delay: anime.stagger(80), duration: 400, easing: 'easeOutQuad' });
        } else if (weightsEl) {
             weightsEl.innerHTML = '<li>Error al mostrar pesos finales.</li>';
        }

        showScreen(screens.finalResults);
    } else {
         console.error("CLIENT ERROR: gameOver recibido sin gameState válido.");
         showNotification("Error al recibir resultados finales.", "Error Final");
    }
});

// Evento para activar animación de jackpot (del servidor)
socket.on('jackpotWin', () => {
    console.log("CLIENT LOG: Recibido evento 'jackpotWin'.");
    showJackpotAnimation();
});


// Notificación de jugador desconectado
socket.on('playerDisconnected', ({ playerId: disconnectedPlayerId, playerName }) => {
    console.log(`CLIENT LOG: ${playerName} se desconectó.`);
    // Podrías mostrar un toast/notificación temporal aquí si quieres
    // showNotification(`${playerName} se ha desconectado.`, "Jugador Desconectado");
    // La UI se actualizará con el próximo gameStateUpdated reflejando la inactividad.
});


// --- Inicialización al Cargar la Página ---
window.addEventListener('load', () => {
    console.log("CLIENT LOG: Página cargada. Inicializando.");
    Object.values(screens).forEach(s => {
        if (s !== screens.welcome) { s.classList.remove('active'); s.style.display = 'none'; s.style.opacity = 0; }
    });

    if (screens.welcome) {
        screens.welcome.style.opacity = 0;
        screens.welcome.style.display = 'flex';
        screens.welcome.classList.add('active');
        currentScreen = screens.welcome;
        anime({ targets: screens.welcome, opacity: [0, 1], translateY: [10, 0], duration: 500, easing: 'easeOutQuad' });
        anime({ targets: '#welcome-screen .animatable-on-load', opacity: [0, 1], translateY: [10, 0], delay: anime.stagger(100, {start: 200}) });
    } else {
        console.error("CLIENT CRITICAL: Pantalla de bienvenida no encontrada.");
        document.body.innerHTML = '<h1 style="color: red;">Error Crítico: No se cargó la interfaz.</h1>';
    }
});