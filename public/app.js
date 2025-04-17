// --- Conexión Socket.IO ---
const socket = io();

// --- Selectores DOM (Actualizados según HTML) ---
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

// Balanzas
const mainScaleArm = document.getElementById('main-scale-arm');
const mainLeftPlatformVisual = document.getElementById('main-left-platform-visual'); // Para animar plataforma
const mainRightPlatformVisual = document.getElementById('main-right-platform-visual'); // Para animar plataforma
const mainLeftMaterials = document.getElementById('main-left-materials');
const mainRightMaterials = document.getElementById('main-right-materials');
const mainLeftWeight = document.getElementById('main-left-weight');
const mainRightWeight = document.getElementById('main-right-weight');
const mainBalanceStatus = document.getElementById('main-balance-status');

const secondaryScaleArm = document.getElementById('secondary-scale-arm');
const secondaryLeftPlatformVisual = document.getElementById('secondary-left-platform-visual');
const secondaryRightPlatformVisual = document.getElementById('secondary-right-platform-visual');
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
let playerId = null; // Tu propio ID de jugador
let isHost = false;
let gameState = null; // Estado completo del juego recibido
let currentScreen = screens.welcome;
let selectedMineralInstanceIds = [];
let turnTimerInterval = null;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 20;
const MINERAL_TYPES = ['Rojo', 'Amarillo', 'Verde', 'Azul', 'Purpura'];
let lastKnownPlayerId = null; // Para detectar cambio de turno

// --- Funciones de Utilidad y UI ---

/**
 * Muestra una pantalla con animación de transición.
 * @param {HTMLElement} screenElement - El elemento de la pantalla a mostrar.
 */
function showScreen(screenElement) {
    if (!screenElement || currentScreen === screenElement) return;
    console.log(`CLIENT LOG: Switching screen to: ${screenElement.id}`);

    const outgoingScreen = currentScreen;
    currentScreen = screenElement;

    // Ocultar pantalla saliente con animación
    const outgoingAnimation = anime({
        targets: outgoingScreen,
        opacity: [1, 0],
        translateY: [0, 20], // Sutil movimiento hacia abajo
        duration: 300,
        easing: 'easeInOutQuad', // Suavizar entrada y salida
        complete: () => {
            outgoingScreen.classList.remove('active');
            outgoingScreen.style.display = 'none';
            outgoingScreen.style.transform = 'translateY(0px)'; // Resetear posición
        }
    }).finished; // Usar la promesa para coordinar

    // Mostrar pantalla entrante después de que la otra termine
    outgoingAnimation.then(() => {
        screenElement.style.opacity = 0;
        screenElement.style.transform = 'translateY(20px)'; // Empezar desde abajo
        screenElement.classList.add('active');
        screenElement.style.display = 'flex'; // O 'block' si es necesario

        anime({
            targets: screenElement,
            opacity: [0, 1],
            translateY: [20, 0], // Mover hacia arriba a su posición
            duration: 400,
            easing: 'easeOutQuad', // Salida más rápida
            begin: () => {
                // Si es la pantalla de juego, actualizarla ANTES de que sea visible
                 if (screenElement === screens.game && gameState) {
                     console.log("CLIENT LOG: showScreen - Updating game UI before animating entry.");
                     updateGameUI(gameState); // Asegura que la UI esté lista antes de animar la entrada
                 }
                 // Animar elementos internos al entrar la pantalla (ejemplo)
                 const animatableElements = screenElement.querySelectorAll('.animatable-on-load');
                 if (animatableElements.length > 0) {
                     anime({
                         targets: animatableElements,
                         opacity: [0, 1],
                         translateY: [10, 0],
                         delay: anime.stagger(100, { start: 200 }) // Retraso escalonado después de la pantalla
                     });
                 }
            },
            complete: () => {
                console.log(`CLIENT LOG: showScreen - Transition to ${screenElement.id} complete.`);
            }
        });
    });
}


/**
 * Muestra un modal con animación.
 * @param {HTMLElement} modalElement - El elemento del modal a mostrar.
 */
function showModal(modalElement) {
    if (!modalElement) return;
    const modalContent = modalElement.querySelector('.modal-content');
    // Asegurar estado inicial correcto
    anime.set(modalElement, { display: 'flex', opacity: 0 }); // Usar flex para centrar overlay
    anime.set(modalContent, { opacity: 0, scale: 0.8, translateY: -20 });

    // Animación del fondo oscuro
    anime({ targets: modalElement, opacity: [0, 1], duration: 300, easing: 'linear' });

    // Animación del contenido
    anime({
        targets: modalContent,
        opacity: [0, 1],
        scale: [0.8, 1],
        translateY: [-20, 0],
        duration: 400,
        delay: 50, // Pequeño retraso
        easing: 'easeOutElastic(1, .8)' // Efecto elástico
    });
}

/**
 * Oculta un modal con animación.
 * @param {HTMLElement} modalElement - El elemento del modal a ocultar.
 */
function hideModal(modalElement) {
    if (!modalElement) return;
    const modalContent = modalElement.querySelector('.modal-content');

    // Animar contenido hacia afuera
    anime({
        targets: modalContent,
        opacity: 0,
        scale: 0.8,
        translateY: -20, // Mover hacia arriba al salir
        duration: 300,
        easing: 'easeInQuad'
    });

    // Animar fondo oscuro y ocultar al final
    anime({
        targets: modalElement,
        opacity: 0,
        duration: 350,
        delay: 100, // Esperar un poco a que el contenido se anime
        easing: 'linear',
        complete: () => modalElement.style.display = 'none'
    });
}

/**
 * Muestra una notificación usando el modal de notificación.
 * @param {string} message - El mensaje a mostrar.
 * @param {string} [title='Notificación'] - Título opcional.
 */
function showNotification(message, title = 'Notificación') {
    const notificationTitleEl = document.getElementById('notification-title');
    if(notificationTitleEl) notificationTitleEl.innerHTML = `<i class="fas fa-info-circle"></i> ${title}`; // Usar innerHTML para el icono
    if(notificationMessage) notificationMessage.textContent = message;
    showModal(notificationModal);
}

/**
 * Formatea un peso (asumiendo enteros).
 * @param {number|string|null} weight - El peso a formatear.
 * @returns {string} - El peso formateado como string.
 */
function formatWeight(weight) {
    return (typeof weight === 'number') ? weight.toFixed(0) : '0';
}

/**
 * Actualiza la visualización de UNA balanza (principal o secundaria).
 * @param {string} scalePrefix - 'main' o 'secondary'.
 * @param {object} scaleData - Los datos de la balanza (left/right Materials/Weight).
 */
function updateSingleScaleDisplay(scalePrefix, scaleData) {
    if (!scaleData) {
        console.warn(`updateSingleScaleDisplay: No scaleData provided for ${scalePrefix}`);
        return;
    }
    const scaleArm = document.getElementById(`${scalePrefix}-scale-arm`);
    const leftPlatform = document.getElementById(`${scalePrefix}-left-platform-visual`);
    const rightPlatform = document.getElementById(`${scalePrefix}-right-platform-visual`);
    const leftWeightEl = document.getElementById(`${scalePrefix}-left-weight`);
    const rightWeightEl = document.getElementById(`${scalePrefix}-right-weight`);
    const leftMaterialsEl = document.getElementById(`${scalePrefix}-left-materials`);
    const rightMaterialsEl = document.getElementById(`${scalePrefix}-right-materials`);

    const leftWeight = scaleData.leftWeight || 0;
    const rightWeight = scaleData.rightWeight || 0;

    const threshold = 1; // Umbral de equilibrio (ej: 1g o menos)

    if (leftWeightEl) leftWeightEl.textContent = formatWeight(leftWeight);
    if (rightWeightEl) rightWeightEl.textContent = formatWeight(rightWeight);

    renderScaleMaterialsStack(leftMaterialsEl, scaleData.leftMaterials || []);
    renderScaleMaterialsStack(rightMaterialsEl, scaleData.rightMaterials || []);

    if (scaleArm) {
        const difference = leftWeight - rightWeight;
        const maxAngle = 15; // Ángulo máximo de inclinación
        const maxPlatformOffset = 15; // Desplazamiento vertical máximo de plataformas
        const sensitivity = 0.15; // Sensibilidad (ajustar para más/menos inclinación)

        let angle = 0;
        let platformOffsetY = 0;

        if (Math.abs(difference) > threshold) {
            // Calcular ángulo basado en la diferencia, limitado por maxAngle
            angle = Math.sign(difference) * Math.min(maxAngle, Math.log1p(Math.abs(difference)) * maxAngle * sensitivity); // Log para suavizar grandes diferencias
            platformOffsetY = Math.sign(difference) * Math.min(maxPlatformOffset, Math.abs(difference) * 0.5); // Desplazamiento proporcional limitado
        }

        // Animación del brazo
        anime({
            targets: scaleArm,
            rotate: angle, // Animar rotación
            duration: 1200, // Duración más larga para suavidad
            easing: 'easeOutElastic(1, .7)' // Efecto elástico
        });

        // Animación de las plataformas (sincronizada pero con transform diferente)
        if (leftPlatform && rightPlatform) {
             anime({
                targets: [leftPlatform, rightPlatform],
                translateY: (el) => {
                    // La plataforma izquierda sube si el peso izquierdo es mayor (ángulo positivo)
                    // La plataforma derecha baja si el peso izquierdo es mayor (ángulo positivo)
                    return el.classList.contains('left') ? -platformOffsetY : platformOffsetY;
                },
                duration: 1200,
                easing: 'easeOutElastic(1, .7)'
             });
        }
    }

    // Lógica específica para balanza principal y botón de adivinar
    if (scalePrefix === 'main') {
        const isBalanced = Math.abs(leftWeight - rightWeight) <= threshold;
        if (mainBalanceStatus) {
             mainBalanceStatus.textContent = isBalanced ? '(Equilibrada)' : '(Desequilibrada)';
             mainBalanceStatus.classList.toggle('balanced', isBalanced);
             mainBalanceStatus.classList.toggle('unbalanced', !isBalanced);
        }

        // Habilitar/deshabilitar botón de adivinar basado en el gameState global
        if (guessWeightsBtn && gameState) {
             // Usar el flag 'iCanGuess' que ya considera turno, piezas, estado, etc.
             const canGuessNow = gameState.iCanGuess; // Simplificado
             guessWeightsBtn.disabled = !canGuessNow;
             guessWeightsBtn.title = canGuessNow ? "Adivinar pesos de todos los minerales (cuesta 1 pieza)" : (
                !gameState.isMainScaleBalanced ? "La balanza principal debe estar equilibrada" : // Usar estado directo
                !gameState.myTurn ? "No es tu turno" :
                !(gameState.myPieces >= 1) ? "No tienes suficientes piezas (1)" : // Ser más específico
                !(gameState.myInventory && gameState.myInventory.length >= 1) ? "Necesitas al menos 1 mineral" :
                "No se puede adivinar ahora"
             );
        }
    }
}


/**
 * Renderiza los divs de materiales en una pila de la balanza con animación.
 * @param {HTMLElement} container - El contenedor de la pila (ej. #main-left-materials).
 * @param {Array<object>} materialsList - Lista de objetos de material { instanceId, type, weight }.
 */
function renderScaleMaterialsStack(container, materialsList) {
    if (!container) return;

    const fragment = document.createDocumentFragment();
    const itemsToAnimateEnter = []; // Elementos que entran
    const existingElementsMap = new Map(); // Para rastrear elementos actuales

    // Marcar elementos existentes
    container.childNodes.forEach(node => {
        if (node.nodeType === 1 && node.dataset.instanceId) {
            existingElementsMap.set(node.dataset.instanceId, node);
        }
    });

    // Crear/Actualizar elementos para la nueva lista
    materialsList.forEach(mat => {
        let div;
        const instanceId = mat.instanceId;

        if (existingElementsMap.has(instanceId)) {
            // Si ya existe, lo reutilizamos y lo quitamos del mapa
            div = existingElementsMap.get(instanceId);
            existingElementsMap.delete(instanceId);
        } else {
            // Si es nuevo, lo creamos
            div = document.createElement('div');
            const typeClass = mat.type ? mat.type.toLowerCase() : 'desconocido';
            div.className = `material-item ${typeClass}`;
            div.dataset.instanceId = instanceId;
            // Estado inicial para animación de entrada
            div.style.opacity = 0;
            div.style.transform = 'translateY(10px) scale(0.9)';
            itemsToAnimateEnter.push(div); // Añadir a la lista de animación de entrada
        }
        // Siempre actualizar el texto (por si cambia algo, aunque aquí no debería)
        // Mostrar solo tipo aquí para simplicidad en balanza
        div.textContent = `${mat.type || '?'}`;
        // Podrías añadir un title con el peso si quieres: div.title = `${mat.type} (${formatWeight(mat.weight)}g)`;
        fragment.appendChild(div);
    });

    // Los elementos que quedan en existingElementsMap son los que deben salir
    const itemsToAnimateExit = Array.from(existingElementsMap.values());

    // 1. Animar salida de elementos viejos (si los hay)
    if (itemsToAnimateExit.length > 0) {
        anime({
            targets: itemsToAnimateExit,
            opacity: 0,
            translateY: -10, // Mover hacia arriba al salir
            scale: 0.9,
            duration: 300,
            easing: 'easeInQuad',
            complete: () => {
                // Eliminar del DOM DESPUÉS de la animación
                itemsToAnimateExit.forEach(el => el.remove());
            }
        });
    }

    // 2. Añadir los nuevos elementos al DOM (inicialmente invisibles)
    // Limpiar eficientemente antes de añadir fragmento
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    container.appendChild(fragment);


    // 3. Animar entrada de elementos nuevos (si los hay)
    if (itemsToAnimateEnter.length > 0) {
        anime({
            targets: itemsToAnimateEnter,
            opacity: 1,
            translateY: 0,
            scale: 1,
            delay: anime.stagger(60, { start: itemsToAnimateExit.length > 0 ? 150 : 0 }), // Retraso escalonado, mayor si hubo salidas
            duration: 400,
            easing: 'easeOutExpo'
        });
    }
}


/**
 * Renderiza el inventario del jugador con selección múltiple y feedback inmediato.
 * @param {Array<object>} inventory - Lista de minerales del jugador.
 */
function renderPlayerInventory(inventory) {
    if (!myInventoryContainer) return;

    const fragment = document.createDocumentFragment();
    const currentInventoryMap = new Map(); // Para rastrear elementos actuales
    myInventoryContainer.childNodes.forEach(node => {
        if (node.nodeType === 1 && node.dataset.instanceId) {
            currentInventoryMap.set(node.dataset.instanceId, node);
        }
    });

    const newInventorySet = new Set(inventory?.map(m => m.instanceId) ?? []); // Manejar inventario nulo/vacío
    const itemsToAnimateEnter = [];
    const itemsToKeep = [];

    const canInteract = gameState?.myTurn && gameState?.iCanPlaceMinerals; // Determinar si se puede interactuar

    if (!Array.isArray(inventory) || inventory.length === 0) {
        myInventoryContainer.innerHTML = '<p class="info-text">No te quedan minerales.</p>';
        if (myMineralCount) myMineralCount.textContent = '0';
        if (cannotPlaceMessage) cannotPlaceMessage.classList.remove('hidden');
        selectedMineralInstanceIds = []; // Limpiar selección
        updatePlacementControls(); // Actualizar controles
        return;
    }

    // Si hay inventario, ocultar mensaje "no puedes colocar" si el motivo era falta de minerales
     if (cannotPlaceMessage && inventory.length >= 2) cannotPlaceMessage.classList.add('hidden');
    if (myMineralCount) myMineralCount.textContent = inventory.length;

    inventory.forEach(mineral => {
        let button;
        const instanceId = mineral.instanceId;
        const typeClass = mineral.type ? mineral.type.toLowerCase() : 'desconocido';

        if (currentInventoryMap.has(instanceId)) {
            // Reutilizar elemento existente
            button = currentInventoryMap.get(instanceId);
            currentInventoryMap.delete(instanceId); // Marcar como procesado
            // Actualizar estado disabled
            button.disabled = !canInteract;
             // Asegurar que la clase 'selected' sea correcta
             button.classList.toggle('selected-material', selectedMineralInstanceIds.includes(instanceId) && canInteract);
             itemsToKeep.push(button);
        } else {
            // Crear nuevo botón
            button = document.createElement('button');
            button.className = `material-button inventory-item ${typeClass}`;
             // Mostrar tipo y peso en inventario
             button.textContent = `${mineral.type || '?'} (${formatWeight(mineral.weight)}g)`;
             button.title = `Mineral ${mineral.type} (${formatWeight(mineral.weight)}g)`; // Tooltip
            button.dataset.instanceId = instanceId;
            button.disabled = !canInteract;
             button.style.opacity = 0; // Estado inicial para animación
             button.style.transform = 'scale(0.8)';

             // Mantener seleccionado si estaba antes Y sigue siendo válido
             if (selectedMineralInstanceIds.includes(instanceId) && canInteract) {
                 button.classList.add('selected-material');
             } else if (selectedMineralInstanceIds.includes(instanceId) && !canInteract) {
                 // Si estaba seleccionado pero ahora no se puede interactuar, quitar selección lógica
                 selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => id !== instanceId);
             }

            button.addEventListener('click', handleInventoryItemClick);
            itemsToAnimateEnter.push(button);
        }
        fragment.appendChild(button); // Añadir al fragmento para reordenar si es necesario
    });

    // Eliminar elementos que ya no están en el inventario
    const itemsToRemove = Array.from(currentInventoryMap.values());
    if (itemsToRemove.length > 0) {
        anime({
            targets: itemsToRemove,
            opacity: 0,
            scale: 0.8,
            duration: 300,
            easing: 'easeInQuad',
            complete: () => itemsToRemove.forEach(el => el.remove())
        });
         // Limpiar selección si algún item seleccionado fue removido
         selectedMineralInstanceIds = selectedMineralInstanceIds.filter(id => !itemsToRemove.some(btn => btn.dataset.instanceId === id));
    }

    // Re-insertar elementos en el contenedor
    myInventoryContainer.innerHTML = ''; // Limpiar antes de añadir
    myInventoryContainer.appendChild(fragment);

    // Animar entrada de nuevos elementos
    if (itemsToAnimateEnter.length > 0) {
        anime({
            targets: itemsToAnimateEnter,
            opacity: 1,
            scale: 1,
            delay: anime.stagger(50),
            duration: 300,
            easing: 'easeOutBack'
        });
    }

    updatePlacementControls(); // Actualizar controles basado en nueva selección/estado
}

/**
 * Manejador de clic para un item del inventario.
 */
function handleInventoryItemClick(event) {
    const button = event.currentTarget;
    if (button.disabled) return; // No hacer nada si está deshabilitado

    const id = button.dataset.instanceId;
    const isSelected = button.classList.toggle('selected-material'); // Cambia clase y devuelve nuevo estado

    // Actualizar array de selección INMEDIATAMENTE
    if (isSelected) {
        if (!selectedMineralInstanceIds.includes(id)) selectedMineralInstanceIds.push(id);
    } else {
        selectedMineralInstanceIds = selectedMineralInstanceIds.filter(selId => selId !== id);
    }

    // Animar la selección/deselección
    anime({
        targets: button,
        scale: isSelected ? [1, 1.08, 1] : [1.08, 1], // Efecto pop
        duration: 300,
        easing: 'easeOutElastic(1, .8)'
    });


    updatePlacementControls(); // Actualizar controles dependientes
}


/**
 * Actualiza la sección de controles de colocación basado en la selección y estado del juego.
 */
function updatePlacementControls() {
    if (!placementControlsSection || !gameState) return; // Asegurarse que gameState existe

    const count = selectedMineralInstanceIds.length;
    // Un jugador puede colocar si es su turno Y tiene el estado 'iCanPlaceMinerals' Y ha seleccionado al menos 2
    const canPlaceSelection = gameState.myTurn && gameState.iCanPlaceMinerals && count >= 2;

     // Mostrar controles si tiene algo seleccionado Y es su turno Y puede colocar minerales en general
     const shouldShowControls = count > 0 && gameState.myTurn && gameState.iCanPlaceMinerals;

    // Mostrar/ocultar sección de controles con animación
    if (shouldShowControls) {
         if (placementControlsSection.classList.contains('hidden')) {
              placementControlsSection.classList.remove('hidden');
              // Asegurar que la altura sea correcta después de quitar 'hidden'
              const targetHeight = placementControlsSection.scrollHeight;
               placementControlsSection.style.height = '0px'; // Start from 0 for animation
               placementControlsSection.style.opacity = '0';
              anime({ targets: placementControlsSection, height: targetHeight + 'px', opacity: 1, duration: 350, easing: 'easeOutQuad'});
         }
    } else {
         if (!placementControlsSection.classList.contains('hidden')) {
             anime({
                 targets: placementControlsSection,
                 height: '0px',
                 opacity: 0,
                 duration: 300,
                 easing: 'easeInQuad',
                 complete: () => {
                     placementControlsSection.classList.add('hidden');
                      // Resetear altura para futuro cálculo de scrollHeight
                      placementControlsSection.style.height = '';
                 }
            });
         }
    }


    if (selectedCountSpan) selectedCountSpan.textContent = count;
    if (placeSelectedBtn) placeSelectedBtn.disabled = !canPlaceSelection; // Habilitar solo si cumple todas las condiciones
    // Mostrar error si tiene algo seleccionado pero no llega a 2
    if (placementError) placementError.classList.toggle('hidden', count === 0 || count >= 2);


    // Habilitar selects solo si hay algo seleccionado
    if(targetScaleSelect) targetScaleSelect.disabled = count === 0;
    if(targetSideSelect) targetSideSelect.disabled = count === 0;
}


/**
 * Función PRINCIPAL para actualizar TODA la UI del juego.
 * @param {object} newState - El objeto gameState completo recibido del servidor.
 */
function updateGameUI(newState) {
    // ***** LOG DETALLADO AÑADIDO *****
    console.log(`--- Updating UI for Player ${playerId} ---`);
    if (!newState) {
        console.error("CLIENT ERROR: updateGameUI llamado sin estado válido!");
        showNotification("Error: Se recibió un estado de juego inválido del servidor.", "Error de Sincronización");
        // Podrías intentar deshabilitar todo o mostrar un mensaje de error persistente
        return;
    }
    console.log(`   My Turn Flag: ${newState.myTurn}`);
    console.log(`   I Can Place Minerals Flag (General): ${newState.iCanPlaceMinerals}`);
    console.log(`   I Can Guess Flag (Specific): ${newState.iCanGuess}`);
    console.log(`   Current Player in State: ${newState.currentPlayer?.id} (Name: ${newState.currentPlayer?.name}, Turn: ${newState.currentPlayer?.turnOrder})`);
    console.log(`   My Inventory Length: ${newState.myInventory?.length}`);
    console.log(`   Game Status: ${newState.status}`);
    // ***** FIN LOG DETALLADO *****


    const oldPlayerId = gameState?.currentPlayer?.id; // ID del jugador anterior
    const wasMyTurnBefore = gameState?.myTurn; // ¿Era mi turno antes de esta actualización?
    gameState = newState; // Actualizar estado global del cliente

    const currentPlayer = gameState.currentPlayer;
    const isNewTurn = currentPlayer?.id !== oldPlayerId; // ¿Cambió el jugador actual?

    // --- Actualizar Indicadores Superiores ---
    if (currentPlayerIndicator) {
        const newText = currentPlayer
            ? `${currentPlayer.name} (Turno ${currentPlayer.turnOrder})`
            : (gameState.status.startsWith('finished') ? 'Juego Terminado' : 'Esperando...');

        // Solo animar si el texto cambia
        if (currentPlayerIndicator.textContent !== newText) {
            anime({
                 targets: currentPlayerIndicator,
                 opacity: [1, 0],
                 duration: 200,
                 easing: 'linear',
                 complete: () => {
                     currentPlayerIndicator.textContent = newText;
                     anime({
                         targets: currentPlayerIndicator,
                         opacity: [0, 1],
                         translateX: isNewTurn ? [-10, 0] : 0, // Pequeño slide si es nuevo turno
                         scale: isNewTurn ? [1.1, 1] : 1, // Efecto pop si es nuevo turno
                         color: isNewTurn ? ['#FFF', '#f0c040', '#e8e8ea'] : '#e8e8ea', // Destacar brevemente si es nuevo turno
                         duration: 400,
                         easing: 'easeOutQuad'
                     });
                 }
             });
        }
    } else { console.warn("Elemento 'currentPlayerIndicator' no encontrado."); }

    if (knownInfoText) {
         knownInfoText.textContent = gameState.knownMineralInfo?.description || '-';
    } else { console.warn("Elemento 'knownInfoText' no encontrado."); }

    // Mostrar información de la última adivinanza (si fue incorrecta)
    if (lastGuessInfoCard && lastGuessText) {
        const lastGuess = gameState.lastGuessResult;
        // Buscar info del jugador que adivinó en la lista pública
        const guesserInfo = lastGuess ? gameState.playersPublicInfo?.find(p => p.id === lastGuess.playerId) : null;
        // Mostrar solo si hubo una adivinanza, fue incorrecta, y encontramos al jugador
        const shouldShow = lastGuess && !lastGuess.correct && guesserInfo;

        if (shouldShow) {
            lastGuessText.textContent = `El intento de ${guesserInfo.name} fue incorrecto.`;
            if (lastGuessInfoCard.classList.contains('hidden')) {
                lastGuessInfoCard.classList.remove('hidden');
                anime({ targets: lastGuessInfoCard, opacity: [0, 1], duration: 300, easing: 'easeOutQuad' });
            }
        } else {
             // Ocultar si no hay adivinanza incorrecta o si fue correcta
            if (!lastGuessInfoCard.classList.contains('hidden')) {
                anime({ targets: lastGuessInfoCard, opacity: [1, 0], duration: 300, easing: 'easeInQuad', complete: () => lastGuessInfoCard.classList.add('hidden') });
            }
        }
    }

    // --- Actualizar Balanzas ---
    updateSingleScaleDisplay('main', gameState.mainScale);
    updateSingleScaleDisplay('secondary', gameState.secondaryScale);

    // --- Actualizar Estado del Jugador (Indicadores de Turno) ---
    const isMyTurnNow = gameState.myTurn;
    if (myTurnIndicator) myTurnIndicator.classList.toggle('hidden', !isMyTurnNow);
    if (waitingTurnIndicator) waitingTurnIndicator.classList.toggle('hidden', isMyTurnNow || gameState.status !== 'playing');

     // Animar cambio de estado de turno (si cambió)
     if (isMyTurnNow && !wasMyTurnBefore && !myTurnIndicator.classList.contains('hidden')) {
          console.log("CLIENT LOG: Animating 'My Turn' indicator IN");
          anime({
              targets: myTurnIndicator,
              opacity: [0, 1],
              translateY: [-10, 0],
              duration: 400,
              easing: 'easeOutQuad'
          });
          // Opcional: Pequeña vibración o sonido para alertar al jugador
          // navigator.vibrate?.(100);
     } else if (!isMyTurnNow && wasMyTurnBefore && !waitingTurnIndicator.classList.contains('hidden')) {
          console.log("CLIENT LOG: Animating 'Waiting Turn' indicator IN");
         anime({
             targets: waitingTurnIndicator,
             opacity: [0, 1],
             duration: 400,
             easing: 'easeOutQuad'
         });
     }


    // --- Actualizar Inventario y Controles ---
    // Esto debe hacerse DESPUÉS de actualizar gameState global
    renderPlayerInventory(gameState.myInventory || []); // Renderiza botones y aplica disabled/selected
    // Mensaje "no puedes colocar" se maneja dentro de renderPlayerInventory ahora
    updatePlacementControls(); // Actualiza la visibilidad/estado de los controles de abajo


    // --- Actualizar Lista de Jugadores (Sidebar) ---
    if (gamePlayersList) {
        const fragment = document.createDocumentFragment();
        const playerElementsMap = new Map(); // Guardar elementos por ID para animación
        gamePlayersList.childNodes.forEach(node => {
             if (node.nodeType === 1 && node.dataset.playerId) {
                 playerElementsMap.set(node.dataset.playerId, node);
             }
        });
        const itemsToAnimateEnter = [];
        const itemsToAnimateUpdate = []; // Para cambios sutiles (ej. estrella)

        gameState.playersPublicInfo?.forEach(p => {
            const isCurrent = p.id === gameState.currentPlayer?.id;
            const isMe = p.id === playerId;
            const mineralCountDisplay = (typeof p.mineralCount === 'number') ? p.mineralCount : '?';

             let li;
             if (playerElementsMap.has(p.id)) {
                 li = playerElementsMap.get(p.id);
                 playerElementsMap.delete(p.id); // Marcar como procesado
                 itemsToAnimateUpdate.push(li);
             } else {
                 li = document.createElement('li');
                 li.dataset.playerId = p.id;
                 li.style.opacity = 0; // Estado inicial para entrada
                  itemsToAnimateEnter.push(li);
             }


            li.className = 'player-row'; // Clase base
            if (!p.isActive) li.classList.add('player-inactive');
            if (isMe) li.classList.add('my-player-row');
            if (isCurrent) li.classList.add('current-player-row');


            li.innerHTML = `
                <span class="player-order">${p.turnOrder || '?'}</span>.
                <span class="player-name">${p.name || '??'} ${isMe ? '<span class="you-tag">(Tú)</span>' : ''}</span>
                <span class="player-minerals">(<i class="fas fa-gem"></i> ${mineralCountDisplay})</span>
                <span class="player-status">
                    ${!p.isActive ? '<span class="status-tag inactive-tag" title="Desconectado">Desc.</span>' : ''}
                    ${p.isActive && !(p.canPlaceMinerals ?? true) ? '<span class="status-tag cannot-play-tag" title="No puede colocar más minerales">No Juega</span>' : ''}
                </span>
                ${isCurrent ? '<i class="fas fa-star player-turn-star" title="Turno actual"></i>' : ''}
            `;
            fragment.appendChild(li);
        });

         // Eliminar jugadores que ya no están (animado)
         const itemsToRemove = Array.from(playerElementsMap.values());
         if (itemsToRemove.length > 0) {
             anime({ targets: itemsToRemove, opacity: 0, height: 0, padding: 0, margin: 0, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) });
         }

        // Añadir/Actualizar en el DOM
        gamePlayersList.innerHTML = ''; // Limpiar antes de re-añadir
        gamePlayersList.appendChild(fragment);

        // Animar entrada
         if (itemsToAnimateEnter.length > 0) {
             anime({ targets: itemsToAnimateEnter, opacity: [0, 1], translateX: [-5, 0], delay: anime.stagger(40), duration: 300, easing: 'easeOutQuad' });
         }
         // Podrías añadir una animación sutil para updates si quieres (ej. flash de fondo)


    } else { console.warn("Elemento 'gamePlayersList' no encontrado."); }

    // --- Temporizador ---
    if (turnTimerInterval) clearInterval(turnTimerInterval); // Limpiar anterior siempre
    turnTimerInterval = null;
    if (gameState.status === 'playing') {
        // Iniciar timer si es mi turno, mostrar '--:--' si no.
        if (isMyTurnNow) {
             startTurnTimer(5 * 60); // 5 minutos (o obtener de gameState si es variable)
        } else {
             if (gameTimer) gameTimer.textContent = '--:--';
             if (gameTimer) gameTimer.classList.remove('timer-alert', 'shake-animation'); // Quitar clases de alerta
        }
    } else {
        // Si el juego no está 'playing' (espera, finalizado)
        if (gameTimer) gameTimer.textContent = '--:--';
        if (gameTimer) gameTimer.classList.remove('timer-alert', 'shake-animation');
    }

    lastKnownPlayerId = currentPlayer?.id; // Guardar ID para la próxima actualización (detección de cambio)
}

/**
 * Inicia el temporizador de turno en la UI.
 * @param {number} durationSeconds - Duración total del turno en segundos.
 */
function startTurnTimer(durationSeconds) {
    let remaining = durationSeconds;
    if (!gameTimer) return;

    const updateDisplay = () => {
        if(!gameTimer || !gameState || !gameState.myTurn) { // Doble check por si el estado cambió mientras corría el intervalo
             if(turnTimerInterval) clearInterval(turnTimerInterval);
             turnTimerInterval = null;
             if(gameTimer) gameTimer.textContent = '--:--'; // Resetear si ya no es mi turno
             return;
        }
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        gameTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Alerta visual cuando quede poco tiempo
         const isAlert = remaining <= 30 && remaining > 0;
         gameTimer.classList.toggle('timer-alert', isAlert);
         // Añadir temblor solo al final
         gameTimer.classList.toggle('shake-animation', remaining <= 10 && remaining > 0 && remaining % 2 === 0); // Temblor intermitente

        if (remaining <= 0) {
             clearInterval(turnTimerInterval);
             turnTimerInterval = null;
             console.log("¡Tiempo de turno agotado!");
              gameTimer.textContent = '00:00';
              gameTimer.classList.add('timer-alert'); // Mantener rojo
             // Aquí podrías FORZAR una acción por defecto o notificar al servidor
             // showNotification("¡Se acabó el tiempo!", "Turno Terminado");
             // Podría ser necesario deshabilitar controles aquí también
             // socket.emit('turnTimeout', { gameId, playerId }); // Si el servidor maneja timeouts
        }
    };

    updateDisplay(); // Mostrar tiempo inicial
    turnTimerInterval = setInterval(() => {
        remaining--;
        updateDisplay();
    }, 1000);
}


/**
 * Establece el estado de carga visual para un botón.
 * @param {HTMLButtonElement} button - El botón a modificar.
 * @param {boolean} isLoading - True para mostrar carga, false para quitarla.
 * @param {string} [loadingText=''] - Texto opcional mientras carga.
 */
function setLoadingState(button, isLoading, loadingText = '') {
    if (!button) return;
    if (isLoading) {
        button.disabled = true;
        // Guardar solo el textContent si no hay iconos complejos
        button.dataset.originalContent = button.textContent;
        button.innerHTML = `<span class="spinner" role="status" aria-hidden="true"><i class="fas fa-spinner fa-spin"></i></span> ${loadingText || ''}`;
        button.classList.add('loading'); // Añadir clase para estilos CSS
    } else {
        button.disabled = false;
         // Restaurar contenido basado en lo guardado o un default
         if (button.dataset.originalContent) {
             button.textContent = button.dataset.originalContent;
             // Si el botón originalmente tenía un icono, necesitas reconstruir el HTML
             // Ejemplo simple (ajustar si es necesario):
             // const iconClass = button.dataset.originalIconClass; // Necesitarías guardar esto también
             // if (iconClass) button.innerHTML = `<i class="${iconClass}"></i> ${button.dataset.originalContent}`;
             // else button.innerHTML = button.dataset.originalContent;
         } else {
             // Fallback si no se guardó (ej. texto genérico)
             // button.textContent = "Acción"; // O intentar deducir del ID
         }
        button.classList.remove('loading');
         // Limpiar data attribute
         delete button.dataset.originalContent;
         // delete button.dataset.originalIconClass;
    }
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
            .then(() => {
                // Feedback visual sutil
                copyCodeBtn.innerHTML = '<i class="fas fa-check"></i>';
                 copyCodeBtn.style.borderColor = 'var(--success-color)';
                 setTimeout(() => {
                    copyCodeBtn.innerHTML = '<i class="fas fa-copy"></i>';
                    copyCodeBtn.style.borderColor = ''; // Resetear borde
                 }, 1500);
            })
            .catch(err => {
                 console.error("Error al copiar código:", err);
                 showNotification('Error al copiar el código.', 'Error');
            });
    } else if (code && code !== '------') {
         // Fallback para navegadores sin clipboard API (raro hoy en día)
         showNotification('No se pudo copiar automáticamente. Código: ' + code, 'Copia Manual');
    }
});

// Crear Juego
createForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostNameInput = document.getElementById('host-name');
    const hostName = hostNameInput?.value.trim();
    const submitBtn = document.getElementById('create-form-submit');

    if (!hostName) {
         showNotification("Por favor, ingresa tu nombre para ser el Host.", "Nombre Requerido");
         hostNameInput?.classList.add('input-error');
         setTimeout(() => hostNameInput?.classList.remove('input-error'), 2500);
         hostNameInput?.focus();
         return;
    }

    if (submitBtn) {
        setLoadingState(submitBtn, true, 'Creando...');
        console.log("CLIENT LOG: Emitiendo 'createGame' con nombre:", hostName);
        socket.emit('createGame', { hostName }, (response) => {
            setLoadingState(submitBtn, false);
            console.log("CLIENT LOG: Respuesta de 'createGame':", response);
            if (response?.success) {
                gameId = response.gameId;
                playerId = response.playerId; // Guardar MI ID
                isHost = true;
                if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = response.gameCode;
                if(waitPlayerCount) waitPlayerCount.textContent = '1'; // Inicia con 1 jugador
                if(waitPlayersList) { // Limpiar placeholder y añadir host
                     waitPlayersList.innerHTML = ''; // Limpiar
                     const li = document.createElement('li');
                     li.innerHTML = `<span class="player-order">1</span>. ${hostName} <span class="host-tag">(Host)</span> <span class="you-tag">(Tú)</span>`;
                     waitPlayersList.appendChild(li);
                }
                if(hostInstructions) hostInstructions.classList.remove('hidden');
                if(startGameBtn) {
                     startGameBtn.classList.remove('hidden');
                     startGameBtn.disabled = true; // Deshabilitado hasta que haya 2+ jugadores
                     startGameBtn.title = "Se necesitan al menos 2 jugadores";
                }
                if(playerWaitMessage) playerWaitMessage.classList.add('hidden');
                showScreen(screens.waiting);
            } else {
                showNotification(response?.message || 'Error desconocido al crear juego.', 'Error al Crear');
            }
        });
    }
});

// Unirse a Juego
joinForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const gameCodeInput = document.getElementById('join-game-code');
    const playerNameInput = document.getElementById('join-player-name');
    const gameCode = gameCodeInput?.value.trim(); // No necesita UpperCase si es numérico
    const playerName = playerNameInput?.value.trim();
    const submitBtn = document.getElementById('join-form-submit');

    let hasError = false;
    gameCodeInput?.classList.remove('input-error'); // Limpiar errores previos
    playerNameInput?.classList.remove('input-error');

    if (!gameCode || !/^[0-9]{6}$/.test(gameCode)) {
        gameCodeInput?.classList.add('input-error'); hasError = true;
    }
    if (!playerName) {
        playerNameInput?.classList.add('input-error'); hasError = true;
    }

    if (hasError) {
        showNotification("Ingresa un código de juego válido (6 dígitos) y tu nombre.", "Datos Inválidos");
        // No poner timeout para quitar error, dejar que el usuario corrija
        if (!gameCode || !/^[0-9]{6}$/.test(gameCode)) gameCodeInput?.focus();
        else if (!playerName) playerNameInput?.focus();
        return;
    }

    if (submitBtn) {
        setLoadingState(submitBtn, true, 'Uniéndose...');
         console.log("CLIENT LOG: Emitiendo 'joinGame' con código:", gameCode, "nombre:", playerName);
        socket.emit('joinGame', { gameCode, playerName }, (response) => {
             setLoadingState(submitBtn, false);
             console.log("CLIENT LOG: Respuesta de 'joinGame':", response);
             if (response?.success) {
                 gameId = response.gameId;
                 playerId = response.playerId; // Guardar MI ID
                 isHost = false; // No soy el host si me uno
                 if(waitGameCodeDisplay) waitGameCodeDisplay.textContent = gameCode; // Mostrar código al que me uní
                 if(hostInstructions) hostInstructions.classList.add('hidden');
                 if(startGameBtn) startGameBtn.classList.add('hidden');
                 if(playerWaitMessage) playerWaitMessage.classList.remove('hidden');
                  // La lista de jugadores se actualizará con 'playerListUpdated' que enviará el servidor
                 showScreen(screens.waiting);
             } else {
                 showNotification(response?.message || 'Error desconocido al unirse al juego.', 'Error al Unirse');
                 // Si el error es de nombre o código, enfocar el input correspondiente
                 if (response?.message?.includes("nombre")) playerNameInput?.focus();
                 else if (response?.message?.includes("Juego no encontrado")) gameCodeInput?.focus();
             }
        });
    }
});

// Iniciar Juego (Host)
startGameBtn?.addEventListener('click', () => {
    if (isHost && gameId && !startGameBtn.disabled) {
        console.log("CLIENT LOG: Host presionó 'Iniciar Juego'. Emitiendo 'startGame'");
        setLoadingState(startGameBtn, true, 'Iniciando...');
        socket.emit('startGame', { gameId });
        // El servidor responderá con 'gameStarted' o 'error'.
        // El estado de carga se quitará en los handlers correspondientes.
    } else if (startGameBtn.disabled) {
         showNotification("Se necesitan al menos 2 jugadores para iniciar.", "Faltan Jugadores");
    }
});

// Colocar Minerales Seleccionados
placeSelectedBtn?.addEventListener('click', () => {
    if (placeSelectedBtn.disabled || selectedMineralInstanceIds.length < 2) {
         console.warn("CLIENT LOG: Intento de colocar minerales pero el botón está deshabilitado o no hay suficientes seleccionados.");
         return; // Doble chequeo
    }

    // Construir el array de objetos placement
    const placements = selectedMineralInstanceIds.map(instanceId => ({
        mineralInstanceId: instanceId,
        targetScale: targetScaleSelect?.value || 'main', // Default a main si falla
        targetSide: targetSideSelect?.value || 'left'   // Default a left si falla
    }));

    console.log("CLIENT LOG: Emitiendo 'placeMinerals':", placements);
    setLoadingState(placeSelectedBtn, true); // Mostrar carga

    // Deshabilitar otros controles mientras se espera respuesta
    if (cancelPlacementBtn) cancelPlacementBtn.disabled = true;
    myInventoryContainer?.querySelectorAll('.inventory-item').forEach(btn => btn.disabled = true); // Deshabilitar inventario

    socket.emit('placeMinerals', { gameId, playerId, placements });
     // El servidor responderá con 'gameStateUpdated' o 'error'.
     // El estado de carga se quitará en el handler de 'gameStateUpdated' o 'error'.
     // La selección se limpiará cuando llegue el nuevo estado con inventario actualizado.
});

// Limpiar Selección de Minerales
cancelPlacementBtn?.addEventListener('click', () => {
    const itemsToDeselect = [];
    myInventoryContainer?.querySelectorAll('.selected-material').forEach(btn => {
        btn.classList.remove('selected-material');
        itemsToDeselect.push(btn);
    });

    if (itemsToDeselect.length > 0) {
         // Animar deselección
         anime({
             targets: itemsToDeselect,
             scale: [1.08, 1], // Volver a tamaño normal
             duration: 200,
             easing: 'easeOutQuad'
         });
    }

    selectedMineralInstanceIds = []; // Limpiar array de selección
    updatePlacementControls(); // Ocultará los controles y actualizará contador
});

// Abrir Modal de Adivinanza
guessWeightsBtn?.addEventListener('click', () => {
    if (guessWeightsBtn.disabled) return;
    guessForm?.reset(); // Limpiar valores anteriores
    // Limpiar errores visuales previos
    guessForm?.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    showModal(guessModal);
     // Enfocar el primer input
     document.getElementById('guess-rojo')?.focus();
});

// Enviar Adivinanza
guessForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const guesses = {};
    let formIsValid = true;
    const submitBtn = guessForm.querySelector('button[type="submit"]');

    MINERAL_TYPES.forEach(type => {
        const input = guessForm.elements[type]; // Acceder por name
        input?.classList.remove('input-error'); // Limpiar error previo

        if (!input) {
            console.error(`Input para ${type} no encontrado en guessForm`);
            formIsValid = false;
            return;
        }
        const value = parseInt(input.value);
        if (isNaN(value) || value < MIN_WEIGHT || value > MAX_WEIGHT) {
             formIsValid = false;
             input.classList.add('input-error');
        } else {
            guesses[type] = value; // Guardar como número
        }
    });

    if (!formIsValid) {
        showNotification(`Ingresa pesos válidos (${MIN_WEIGHT}-${MAX_WEIGHT}g) para todos los minerales.`, "Adivinanza Incompleta");
        // Agitar el modal para feedback visual
        anime({ targets: guessModal.querySelector('.modal-content'), translateX: [-5, 5, -3, 3, 0], duration: 400, easing: 'easeInOutSine'});
         // Enfocar el primer input con error
         guessForm.querySelector('.input-error')?.focus();
        return;
    }

    console.log("CLIENT LOG: Emitiendo 'guessWeights':", guesses);
    if (submitBtn) setLoadingState(submitBtn, true, 'Enviando...');
    socket.emit('guessWeights', { gameId, playerId, guesses });
    // No ocultar modal aquí. El servidor responderá con:
    // - 'gameOver' si es correcta.
    // - 'gameStateUpdated' si es incorrecta (y el juego sigue).
    // - 'error' si hay un problema.
    // El estado de carga se quitará en esos handlers.
});

// Jugar Otra Vez (Recargar Página)
playAgainBtn?.addEventListener('click', () => {
     // Animación de salida suave
     anime({
        targets: 'body',
        opacity: 0,
        duration: 400,
        easing: 'easeInQuad',
        complete: () => window.location.reload() // Recargar después de la animación
    });
});

// Cerrar Modales (Genérico para todos los botones de cerrar/cancelar/ok)
document.querySelectorAll('.modal .close-btn, .modal .modal-cancel-btn, #notification-ok').forEach(btn => {
    btn.addEventListener('click', (event) => {
        const modal = event.target.closest('.modal'); // Encuentra el modal padre
        if (modal) hideModal(modal);
    });
});


// --- Event Listeners de Socket.IO ---

socket.on('connect', () => {
    console.log('CLIENT LOG: Conectado al servidor WebSocket con ID:', socket.id);
    // Podrías intentar re-unirte automáticamente si tienes gameId y playerId guardados (más complejo)
    // if (gameId && playerId) {
    //   console.log("Intentando re-conectar a la partida...");
    //   socket.emit('reconnectGame', { gameId, playerId }, (response) => { ... });
    // }
});

socket.on('disconnect', (reason) => {
    console.warn('CLIENT LOG: Desconectado del servidor:', reason);
    // Mostrar notificación persistente o un overlay indicando la desconexión
    showNotification(`Desconexión del servidor: ${reason}. Por favor, recarga la página para reconectar.`, "Desconectado");
    // Deshabilitar interacciones principales para evitar errores
     document.querySelectorAll('button, input, select').forEach(el => {
         // No deshabilitar el botón de recargar si existe
         if (el !== playAgainBtn) el.disabled = true;
     });
     // Detener temporizador si estaba activo
     if (turnTimerInterval) clearInterval(turnTimerInterval);
     turnTimerInterval = null;
     if(gameTimer) gameTimer.textContent = '--:--';
});

socket.on('error', (data) => {
    console.error('CLIENT ERROR: Error recibido del servidor:', data.message);
    showNotification(`Error del servidor: ${data.message || 'Error desconocido.'}`, 'Error');

    // Intentar reactivar botones que podrían haberse quedado en estado de carga
     const buttonsInLoading = document.querySelectorAll('button.loading');
     buttonsInLoading.forEach(btn => {
          // Comprobar si es alguno de los botones de acción principales
          if (btn === startGameBtn || btn === placeSelectedBtn || btn === guessForm?.querySelector('button[type="submit"]')) {
              setLoadingState(btn, false);
          }
     });

     // Reactivar controles si el error fue al colocar minerales
     if (placeSelectedBtn && !placeSelectedBtn.disabled) { // Si se reactivó
         if(cancelPlacementBtn) cancelPlacementBtn.disabled = false;
          // El inventario se reactivará con el próximo gameStateUpdate, o forzar aquí:
          // renderPlayerInventory(gameState?.myInventory || []); // Re-renderizar con estado actual
     }
     // Si el error fue al iniciar, asegurar que el botón esté habilitado si corresponde
     if (isHost && startGameBtn && gameState?.status === 'waiting') {
          startGameBtn.disabled = (parseInt(waitPlayerCount?.textContent || '0') < 2);
     }
});

// Actualiza lista de jugadores en sala de espera
socket.on('playerListUpdated', (data) => {
    console.log("CLIENT LOG: Recibido playerListUpdated:", data);
    if (currentScreen === screens.waiting && waitPlayersList && waitPlayerCount) {
        const listItems = [];
        const fragment = document.createDocumentFragment();
        const playerElementsMap = new Map(); // Para animación suave
         waitPlayersList.childNodes.forEach(node => {
             if (node.nodeType === 1 && node.dataset.playerId) {
                 playerElementsMap.set(node.dataset.playerId, node);
             }
         });
         const itemsToEnter = [];

        data.players?.forEach(p => {
             let li;
             if (playerElementsMap.has(p.id)) {
                  li = playerElementsMap.get(p.id);
                  playerElementsMap.delete(p.id); // Procesado
             } else {
                  li = document.createElement('li');
                  li.dataset.playerId = p.id;
                  li.style.opacity = 0; // Para animar entrada
                  itemsToEnter.push(li);
             }
             // Actualizar contenido siempre
            li.innerHTML = `<span class="player-order">${p.turnOrder}.</span> ${p.name} ${p.id === playerId ? '<span class="you-tag">(Tú)</span>' : ''} ${p.id === gameState?.hostId || (isHost && p.turnOrder === 1) ? '<span class="host-tag">(Host)</span>' : ''}`;
            li.classList.toggle('inactive', !p.isActive); // Mostrar si está inactivo
            fragment.appendChild(li);
        });

         // Eliminar jugadores que salieron (animado)
         const itemsToRemove = Array.from(playerElementsMap.values());
         if (itemsToRemove.length > 0) {
              anime({ targets: itemsToRemove, opacity: 0, height: 0, padding: 0, margin: 0, duration: 300, easing: 'easeInQuad', complete: () => itemsToRemove.forEach(el => el.remove()) });
         }

        // Añadir/Actualizar en el DOM
        waitPlayersList.innerHTML = ''; // Limpiar antes de re-añadir
        waitPlayersList.appendChild(fragment);

         // Animar entrada de nuevos
         if (itemsToEnter.length > 0) {
             anime({ targets: itemsToEnter, opacity: [0, 1], translateX: [-10, 0], delay: anime.stagger(50), duration: 300, easing: 'easeOutQuad' });
         }

        // Actualizar contador y botón de inicio para el host
        const currentCount = data.count ?? data.players?.length ?? 0;
        waitPlayerCount.textContent = currentCount;
        if (isHost && startGameBtn) {
             const canStart = currentCount >= 2;
             startGameBtn.disabled = !canStart;
             startGameBtn.title = canStart ? "Iniciar el juego para todos" : "Se necesitan al menos 2 jugadores";
             // Quitar estado de carga si estaba activo y falló por falta de jugadores
             if (!canStart && startGameBtn.classList.contains('loading')) {
                  setLoadingState(startGameBtn, false);
             }
        }
    } else {
         console.log("CLIENT LOG: playerListUpdated recibido pero no en pantalla de espera.");
    }
});

// El juego ha comenzado (recibido del servidor después de que el host inicia)
socket.on('gameStarted', ({ gameState: receivedGameState }) => {
    console.log("CLIENT LOG: Recibido 'gameStarted'. Estado inicial:", receivedGameState);
     // Quitar estado de carga del botón de inicio si soy el host
     if (isHost && startGameBtn && startGameBtn.classList.contains('loading')) {
         setLoadingState(startGameBtn, false);
     }

    if (receivedGameState) {
        gameId = receivedGameState.gameId; // Asegurar que tenemos el gameId correcto
        playerId = receivedGameState.myPlayerId; // Asegurar que tenemos nuestro ID correcto
        gameState = receivedGameState; // Guardar estado inicial
        showScreen(screens.game); // Cambiar pantalla (esto llamará a updateGameUI internamente)
        console.log("CLIENT LOG: gameStarted handler - Pantalla cambiada a 'game', UI debería actualizarse.");
    } else {
        showNotification("Error: No se recibió un estado válido al iniciar el juego.", "Error al Iniciar");
        // Habilitar botón de inicio si soy host y falla para reintentar?
        if(isHost && startGameBtn) {
             startGameBtn.disabled = (parseInt(waitPlayerCount?.textContent || '0') < 2);
        }
    }
});

// Actualización del estado del juego durante la partida
socket.on('gameStateUpdated', ({ gameState: receivedGameState }) => {
     // ***** LOG DETALLADO AÑADIDO *****
     console.log('--- Received gameStateUpdated ---');
     console.log('Player ID (Client):', playerId);
     console.log('Is Host (Client):', isHost);
     console.log('Received State:', JSON.stringify(receivedGameState, null, 2)); // Log completo del estado recibido
     if (!receivedGameState) {
          console.error("CLIENT ERROR: ¡Estado recibido en gameStateUpdated es nulo o indefinido!");
          showNotification("Error: Actualización de estado inválida recibida.", "Error de Sincronización");
          return;
     }
     // Comparación de IDs
     if (receivedGameState.myPlayerId && receivedGameState.myPlayerId !== playerId) {
          console.warn(`CLIENT WARN: El ID en el estado recibido (${receivedGameState.myPlayerId}) no coincide con mi ID (${playerId}).`);
          // Podría ser un estado para otro jugador si hay error en broadcast, o si mi ID cambió?
          // Por seguridad, podríamos ignorar este estado si no es para nosotros.
          // return; // Descomentar para ignorar estados que no sean para mí
     }
     if (receivedGameState.currentPlayer?.id === playerId) {
         console.log("CONFIRMACIÓN (gameStateUpdated): El currentPlayer ID del estado coincide con mi ID.");
     } else {
          console.log("INFO (gameStateUpdated): El currentPlayer ID del estado NO coincide con mi ID.");
     }
      // ***** FIN LOG DETALLADO *****

     // Quitar estado de carga de botones si estaban activos
     if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
     const guessSubmitBtn = guessForm?.querySelector('button[type="submit"]');
     if (guessSubmitBtn?.classList.contains('loading')) setLoadingState(guessSubmitBtn, false);
      // Si la adivinanza falló y el modal sigue abierto, ocultarlo aquí si ya no es mi turno
      if (guessModal.style.display !== 'none' && !receivedGameState.myTurn && gameState?.lastGuessResult?.playerId === playerId && !gameState?.lastGuessResult?.correct) {
           console.log("CLIENT LOG: Ocultando modal de adivinanza después de intento fallido y cambio de turno.");
           hideModal(guessModal);
      }


     // Si estamos en la pantalla de juego O en espera y el estado indica 'playing'
     if ((currentScreen === screens.game || currentScreen === screens.waiting) && receivedGameState.status === 'playing') {
        if (currentScreen === screens.waiting) {
            // Si estábamos esperando y ahora está jugando, cambiar de pantalla y actualizar
            console.log("CLIENT LOG: gameStateUpdated recibido en 'waiting', cambiando a 'game'.");
            gameState = receivedGameState; // Guardar antes de cambiar
            showScreen(screens.game); // Esto llamará a updateGameUI
        } else {
             // Si ya estábamos en juego, solo actualizar la UI
            updateGameUI(receivedGameState);
        }
     } else if (currentScreen === screens.game && receivedGameState.status !== 'playing') {
         // Si estábamos en juego pero el estado cambió a 'waiting' o 'finished' (raro aquí, usualmente va a gameOver)
         console.log(`CLIENT LOG: gameStateUpdated recibido en 'game', pero estado es ${receivedGameState.status}. Actualizando UI.`);
         updateGameUI(receivedGameState); // Actualizar UI de todas formas (ej. para mostrar inactividad)
     } else if (receivedGameState.status === 'waiting' && currentScreen === screens.waiting) {
          // Si estamos en espera y recibimos una actualización (ej. alguien se unió/desconectó)
          console.log("CLIENT LOG: gameStateUpdated recibido en 'waiting', actualizando UI de espera (podría ser redundante con playerListUpdated).");
          // Podríamos solo actualizar la lista de jugadores aquí si fuera necesario,
          // pero playerListUpdated debería manejarlo.
     } else {
         console.log(`CLIENT LOG: gameStateUpdated recibido pero no aplica a la pantalla actual (${currentScreen?.id}) o estado (${receivedGameState?.status}). Estado guardado.`);
         gameState = receivedGameState; // Guardar estado aunque no actualicemos UI principal
     }
});

// Fin del juego
socket.on('gameOver', ({ gameState: finalGameState, actualWeights }) => {
    console.log("CLIENT LOG: Recibido 'gameOver'. Estado Final:", finalGameState, "Pesos Reales:", actualWeights);

    // Asegurarse de quitar estados de carga y ocultar modales
    if (guessModal && guessModal.style.display !== 'none') {
        hideModal(guessModal);
        const guessSubmitBtn = guessForm?.querySelector('button[type="submit"]');
        if(guessSubmitBtn?.classList.contains('loading')) setLoadingState(guessSubmitBtn, false);
    }
    if (placeSelectedBtn?.classList.contains('loading')) setLoadingState(placeSelectedBtn, false);
    if (startGameBtn?.classList.contains('loading')) setLoadingState(startGameBtn, false); // Por si acaso


    if (finalGameState) {
        gameState = finalGameState; // Guardar estado final globalmente
        // Podríamos llamar a updateGameUI una última vez para reflejar el estado final antes de cambiar pantalla
        // updateGameUI(finalGameState); // Opcional

        const titleEl = document.getElementById('final-result-title');
        const messageEl = document.getElementById('final-result-message');
        const winnersEl = document.getElementById('final-winners');
        const weightsEl = document.getElementById('final-actual-weights');

        const isSuccess = finalGameState.status === 'finished_success';
        const winner = finalGameState.successfulGuesser; // Objeto { id, name } o null

        if (titleEl) titleEl.innerHTML = `<i class="fas ${isSuccess ? 'fa-trophy' : 'fa-times-circle'}"></i> ${isSuccess ? '¡Adivinanza Correcta!' : 'Fin del Juego'}`;
        if (messageEl) messageEl.textContent = isSuccess && winner
            ? `¡${winner.name} adivinó correctamente los pesos!`
            : (finalGameState.status === 'finished_failure' ? 'Nadie adivinó los pesos correctamente.' : 'Juego terminado.'); // Mensaje genérico si no es success/failure
        if (winnersEl) winnersEl.textContent = isSuccess && winner
            ? `🏆 Ganador: ${winner.name}`
            : 'Ganadores: Ninguno';

        // Mostrar pesos reales
        if (weightsEl && actualWeights) {
            weightsEl.innerHTML = ''; // Limpiar
            const weightItems = [];
            // Ordenar tipos para mostrar consistentemente
            MINERAL_TYPES.sort().forEach(type => {
                 if (actualWeights.hasOwnProperty(type)) {
                     const li = document.createElement('li');
                     const typeClass = type.toLowerCase();
                     li.innerHTML = `<span class="mineral-color-indicator ${typeClass}" title="${type}"></span> <strong>${type}:</strong> ${actualWeights[type]}g`;
                     li.style.opacity = 0; // Para animación
                     weightsEl.appendChild(li);
                     weightItems.push(li);
                 }
            });
            // Animar aparición de pesos
             anime({
                 targets: weightItems,
                 opacity: [0, 1],
                 translateY: [5, 0],
                 delay: anime.stagger(80),
                 duration: 400,
                 easing: 'easeOutQuad'
             });

        } else if (weightsEl) {
             weightsEl.innerHTML = '<li>No se pudieron obtener los pesos finales.</li>';
             console.error("CLIENT ERROR: Pesos reales no recibidos o elemento #final-actual-weights no encontrado.");
        }

        showScreen(screens.finalResults); // Mostrar pantalla final
    } else {
         console.error("CLIENT ERROR: gameOver recibido sin gameState válido.");
         showNotification("Error al recibir los resultados finales del juego.", "Error Final");
    }
});

// Notificación de jugador desconectado (informativo)
socket.on('playerDisconnected', ({ playerId: disconnectedPlayerId, playerName }) => {
    console.log(`CLIENT LOG: Notificación - Jugador ${playerName} (ID: ${disconnectedPlayerId}) se ha desconectado.`);
    // Mostrar una notificación temporal no modal (toast) sería ideal aquí
    // Ejemplo simple usando el modal existente:
    // showNotification(`${playerName} se ha desconectado de la partida.`, "Jugador Desconectado");
    // La lista de jugadores en `gameStateUpdated` ya reflejará el estado inactivo.
});


// --- Inicialización al Cargar la Página ---
window.addEventListener('load', () => {
    console.log("CLIENT LOG: Página cargada. Inicializando UI.");
    // Asegurar que todas las pantallas estén ocultas inicialmente, excepto bienvenida
    Object.values(screens).forEach(s => {
        if (s !== screens.welcome) {
            s.classList.remove('active');
            s.style.display = 'none';
            s.style.opacity = 0; // Resetear opacidad
        }
    });

    // Mostrar pantalla de bienvenida con animación
    if (screens.welcome) {
        screens.welcome.style.opacity = 0; // Empezar invisible
        screens.welcome.style.display = 'flex'; // Hacer visible para animar
        screens.welcome.classList.add('active');
        currentScreen = screens.welcome;
        // Animar entrada de pantalla bienvenida
        anime({
            targets: screens.welcome,
            opacity: [0, 1],
            translateY: [10, 0], // Sutil desde abajo
            duration: 500,
            easing: 'easeOutQuad'
        });
         // Animar elementos internos de bienvenida
         anime({
            targets: '#welcome-screen .animatable-on-load',
            opacity: [0, 1],
            translateY: [10, 0],
            delay: anime.stagger(100, {start: 200}) // Escalonado
        });
    } else {
        console.error("CLIENT CRITICAL: No se encontró la pantalla de bienvenida (#welcome-screen). La aplicación no puede iniciar.");
         document.body.innerHTML = '<h1 style="color: red;">Error Crítico: No se pudo cargar la interfaz inicial.</h1>';
    }
});