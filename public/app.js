// Conexión a Socket.IO
const socket = io();

// Elementos DOM (sin cambios, los mantenemos igual)
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
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');
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
const waitingPlaceholder = document.querySelector('.waiting-placeholder'); // Added selector

// Variables del estado del juego (sin cambios)
let gameId = null;
let playerId = null;
let playerName = '';
let isHost = false;
let gameState = null;
let materials = [];
let selectedMaterial = null;
let timerInterval = null;
let eliminated = false;
let currentScreen = screens.welcome; // Track current screen

// --- Funciones de Utilidad con Anime.js ---

// Función showScreen mejorada con Anime.js para transiciones
function showScreen(screenElement) {
    if (currentScreen === screenElement) return; // No animar si ya está visible

    const outgoingScreen = currentScreen;
    currentScreen = screenElement;

    // 1. Animar la pantalla saliente para que desaparezca
    anime({
        targets: outgoingScreen,
        opacity: [1, 0],
        translateY: [0, -20], // Sube ligeramente al desaparecer
        scale: [1, 0.95],
        duration: 300,
        easing: 'easeInQuad',
        complete: () => {
            outgoingScreen.classList.remove('active'); // Ocultar después de animar

            // 2. Preparar y mostrar la pantalla entrante (inicialmente invisible)
            screenElement.classList.add('active');
            screenElement.style.opacity = 0; // Asegurar que está invisible antes de animar

            // 3. Animar la pantalla entrante para que aparezca
            anime({
                targets: screenElement,
                opacity: [0, 1],
                translateY: [20, 0], // Baja ligeramente al aparecer
                scale: [0.95, 1],
                duration: 400,
                easing: 'easeOutQuad',
                delay: 50 // Pequeña pausa antes de entrar
            });

            // Animar elementos internos si es necesario (ej: listas en pantallas de resultado)
            if (screenElement === screens.turnResult) {
                anime({
                    targets: '#turn-summary-list li',
                    opacity: [0, 1],
                    translateY: [10, 0],
                    delay: anime.stagger(80, { start: 200 })
                });
            } else if (screenElement === screens.finalResults) {
                 anime({
                    targets: ['.winners-container', '.final-scale-status', '.eliminated-players', '#play-again-btn'],
                    opacity: [0, 1],
                    translateY: [20, 0],
                    delay: anime.stagger(100, { start: 300 })
                });
                 anime({
                    targets: ['#winners-list li', '#eliminated-list li'],
                    opacity: [0, 1],
                    translateX: [-20, 0],
                    delay: anime.stagger(60, { start: 500 })
                });
            }
        }
    });
}


// Función para mostrar modales con animación
function showModal(modalElement) {
    modalElement.classList.add('active'); // Usa la clase CSS para transición
    const modalContent = modalElement.querySelector('.modal-content');

    // Reiniciar estado antes de animar (por si se cerró bruscamente)
    anime.set(modalElement, { opacity: 0 });
    anime.set(modalContent, { opacity: 0, scale: 0.9, translateY: -20 });

    modalElement.style.display = 'block'; // Hacer visible

    // Animar el fondo del modal
    anime({
        targets: modalElement,
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutQuad'
    });

    // Animar el contenido del modal
    anime({
        targets: modalContent,
        opacity: [0, 1],
        scale: [0.9, 1],
        translateY: [-20, 0],
        duration: 400,
        easing: 'easeOutBack', // Efecto rebote suave
        delay: 100
    });
}

// Función para ocultar modales con animación
function hideModal(modalElement) {
    const modalContent = modalElement.querySelector('.modal-content');

    // Animar el contenido hacia afuera
    anime({
        targets: modalContent,
        opacity: [1, 0],
        scale: [1, 0.9],
        translateY: [0, -20],
        duration: 300,
        easing: 'easeInQuad'
    });

    // Animar el fondo hacia afuera y ocultar al final
    anime({
        targets: modalElement,
        opacity: [1, 0],
        duration: 350,
        easing: 'easeInQuad',
        delay: 50, // Esperar un poco a que el contenido empiece a salir
        complete: () => {
            modalElement.style.display = 'none';
            modalElement.classList.remove('active');
        }
    });
}

// Modificar las funciones de notificación para usar los modales animados
function showNotification(message) {
    notificationMessage.textContent = message;
    showModal(notificationModal);
}

function showEliminationModal() {
    showModal(eliminationModal);
}


function formatWeight(weight) {
    return Math.abs(weight).toFixed(1);
}

// Función de la balanza mejorada con Anime.js
function updateScaleDisplay(leftWeightValue, rightWeightValue) {
    // Actualizar los textos (se puede animar el número si se desea con Anime.js)
    leftWeight.textContent = formatWeight(leftWeightValue);
    rightWeight.textContent = formatWeight(rightWeightValue);

    const difference = leftWeightValue - rightWeightValue;
    const maxAngle = 20; // Reducir ángulo máximo para sutileza
    const sensitivityFactor = 0.4; // Ajustar sensibilidad

    let angle = 0;
    const absDifference = Math.abs(difference);

    // Solo inclinar si la diferencia es significativa (mayor que el umbral de equilibrio)
    if (absDifference > 10) { // Umbral de 10g para equilibrio visual
         // Aplicar una curva para que pequeñas diferencias muevan poco y grandes diferencias más
         // Usamos Math.tanh para una curva sigmoide suave
         const normalizedDiff = Math.tanh(difference * sensitivityFactor / 50) * maxAngle; // Dividir por un valor (ej. 50) para escalar
         angle = normalizedDiff;
    } else {
        // Pequeña inclinación proporcional dentro de la zona de equilibrio
        angle = difference * sensitivityFactor * (maxAngle / 50); // Mantener la misma escala
    }

    // Limitar el ángulo máximo
    angle = Math.min(Math.max(-maxAngle, angle), maxAngle);


    // Animar la rotación del brazo de la balanza
    anime({
        targets: scaleArm,
        rotate: [parseFloat(scaleArm.style.transform.replace(/[^0-9.-]/g, '') || 0), angle], // Animar desde ángulo actual
        duration: 1200, // Duración más larga para suavidad
        easing: 'easeOutElastic(1, .7)', // Efecto elástico agradable
    });
}


function getRandomColor() {
    // Paleta de colores más vibrante y consistente
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FED766', '#9B5DE5', '#F15BB5', '#00F5D4', '#00BBF9', '#FEE440', '#F7B801'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Función para renderizar materiales con animación de entrada
function renderMaterials(availableMaterials) {
    materialsContainer.innerHTML = ''; // Limpiar contenedor

    availableMaterials.forEach(material => {
        const materialButton = document.createElement('button');
        materialButton.className = `material-button ${material.type.toLowerCase()}`;
        materialButton.textContent = `${material.type} (${material.weight}g)`;
        materialButton.dataset.id = material.id;
        materialButton.dataset.type = material.type;
        materialButton.dataset.weight = material.weight;
        materialButton.style.opacity = 0; // Estilo inicial para animación

        materialButton.addEventListener('click', () => {
            // Deseleccionar anterior
             const currentlySelected = document.querySelector(`.material-button.selected-material`);
             if (currentlySelected && currentlySelected !== materialButton) {
                 currentlySelected.classList.remove('selected-material');
                 // Animar deselección
                 anime({ targets: currentlySelected, scale: 1, borderColor: 'transparent', duration: 200, easing: 'easeOutQuad' });
             }

            // Seleccionar nuevo
            selectedMaterial = {
                id: material.id,
                type: material.type,
                weight: material.weight
            };
            materialButton.classList.add('selected-material');
            sideSelection.classList.remove('hidden');

             // Animar selección
             anime({ targets: materialButton, scale: 1.08, borderColor: 'var(--accent-color)', duration: 300, easing: 'easeOutBack' });

            // Animar la aparición del panel de selección de lado
            anime({
                targets: sideSelection,
                opacity: [0, 1],
                translateY: [10, 0],
                duration: 300,
                easing: 'easeOutQuad'
            });
             document.getElementById('selected-material-name').textContent = `${material.type} (${material.weight}g)`;
        });

        materialsContainer.appendChild(materialButton);
    });

    // Animar la entrada de todos los botones de material
    anime({
        targets: '.material-button',
        opacity: [0, 1],
        scale: [0.7, 1],
        translateY: [10, 0],
        delay: anime.stagger(40), // Aparecen escalonados
        duration: 500,
        easing: 'easeOutExpo'
    });
}


function renderTeams(teams) {
    teamsContainer.innerHTML = '';
    teams.forEach(team => {
        const teamBox = document.createElement('div');
        teamBox.className = 'team-box';
        teamBox.textContent = `Equipo ${team.id}: ${team.players.join(', ')}`;
        const teamColor = getRandomColor(); // Obtener un color
        teamBox.style.borderLeft = `5px solid ${teamColor}`;
        teamBox.style.setProperty('--team-color', teamColor); // Guardar color para posible hover
        teamBox.style.opacity = 0; // Inicial para animación
        teamsContainer.appendChild(teamBox);
    });

     // Animar entrada de equipos
    anime({
        targets: '.team-box',
        opacity: [0, 1],
        translateX: [-15, 0],
        delay: anime.stagger(60),
        duration: 400,
        easing: 'easeOutQuad'
    });
}

// Renderiza materiales en la balanza con animación
function renderScaleMaterials(side, materialsList) {
    const container = side === 'left' ? leftMaterials : rightMaterials;
    const existingMaterialElements = container.querySelectorAll('.material-item');
    const existingMaterialIds = Array.from(existingMaterialElements).map(el => el.dataset.id);
    const newMaterials = [];

    // Crear elementos para materiales nuevos y marcar existentes
    materialsList.forEach(material => {
        if (!existingMaterialIds.includes(material.id)) {
            const materialItem = document.createElement('div');
            materialItem.className = `material-item ${material.type.toLowerCase()}`;
            materialItem.textContent = material.type; // Solo tipo para simplicidad visual
            materialItem.dataset.id = material.id; // Añadir ID para seguimiento
            materialItem.style.opacity = 0; // Inicial para animación
            materialItem.style.transform = 'translateY(15px)'; // Empieza desde abajo
            container.appendChild(materialItem);
            newMaterials.push(materialItem);
        }
    });

    // Animar solo los nuevos materiales
    if (newMaterials.length > 0) {
        anime({
            targets: newMaterials,
            opacity: [0, 1],
            translateY: [15, 0],
            duration: 600,
            delay: anime.stagger(50), // Escalonar si hay varios (poco probable aquí)
            easing: 'easeOutExpo'
        });
    }
}


function updateGameUI(gameState) {
    // Actualizar información del turno
    currentTurn.textContent = gameState.currentTurn;
    currentPlayer.textContent = gameState.currentPlayer?.name || '-';
    waitingPlayer.textContent = gameState.currentPlayer?.name || '-';

    // Actualizar balanza (pesos y animación del brazo)
    updateScaleDisplay(gameState.leftWeight, gameState.rightWeight);
    // Renderizar materiales en la balanza (con animación para nuevos)
    renderScaleMaterials('left', gameState.leftMaterials);
    renderScaleMaterials('right', gameState.rightMaterials);

    // Actualizar equipos (con animación si es la primera vez)
    if (gameState.teams && gameState.teams.length > 0 && teamsContainer.children.length === 0) {
        renderTeams(gameState.teams);
    }

     // Control de visibilidad y animación para "Es tu turno" / "Esperando"
    const isMyTurnNow = gameState.currentPlayer && gameState.currentPlayer.id === playerId && !eliminated;
    const turnNotification = document.getElementById('is-your-turn');
    const waitingNotification = document.getElementById('waiting-turn');

    if (isMyTurnNow) {
        if (waitingNotification.classList.contains('active-notification')) {
             anime({
                 targets: waitingNotification,
                 opacity: 0,
                 duration: 200,
                 easing: 'linear',
                 complete: () => {
                     waitingNotification.classList.add('hidden');
                     waitingNotification.classList.remove('active-notification');
                     turnNotification.classList.remove('hidden');
                     turnNotification.classList.add('active-notification');
                     anime({ targets: turnNotification, opacity: [0, 1], scale: [0.9, 1], duration: 400, easing: 'easeOutBack' });
                 }
             });
        } else if (!turnNotification.classList.contains('active-notification')) {
            turnNotification.classList.remove('hidden');
            turnNotification.classList.add('active-notification');
            anime({ targets: turnNotification, opacity: [0, 1], scale: [0.9, 1], duration: 400, easing: 'easeOutBack' });
        }
        skipTurnBtn.classList.remove('hidden');
        renderMaterials(gameState.availableMaterials || []); // Renderizar materiales con animación
    } else {
         if (turnNotification.classList.contains('active-notification')) {
              anime({
                 targets: turnNotification,
                 opacity: 0,
                 duration: 200,
                 easing: 'linear',
                 complete: () => {
                     turnNotification.classList.add('hidden');
                     turnNotification.classList.remove('active-notification');
                     waitingNotification.classList.remove('hidden');
                     waitingNotification.classList.add('active-notification');
                     anime({ targets: waitingNotification, opacity: [0, 1], duration: 400, easing: 'easeOutQuad' });
                 }
             });
         } else if (!waitingNotification.classList.contains('active-notification')) {
             waitingNotification.classList.remove('hidden');
             waitingNotification.classList.add('active-notification');
             anime({ targets: waitingNotification, opacity: [0, 1], duration: 400, easing: 'easeOutQuad' });
         }
        skipTurnBtn.classList.add('hidden');
        sideSelection.classList.add('hidden');
        materialsContainer.innerHTML = ''; // Limpiar materiales si no es tu turno
    }


    // Reiniciar timer (sin cambios en la lógica, solo visual)
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    if (gameState.turnActive) {
        let timeLeft = 30;
        timer.textContent = timeLeft;
        anime({ // Animar el contenedor del timer para llamar la atención
            targets: '.timer-container',
            scale: [1, 1.1, 1],
            duration: 500,
            easing: 'easeInOutSine'
        });

        timerInterval = setInterval(() => {
            timeLeft--;
            timer.textContent = timeLeft;
             // Animar cambio de número
            anime({ targets: timer, scale: [1.2, 1], duration: 300, easing: 'easeOutQuad' });

            if (timeLeft <= 5 && timeLeft > 0) { // Parpadeo en los últimos segundos
                 anime({ targets: timer, color: ['#FF6B6B', '#E6E6E6'], duration: 500, direction: 'alternate', loop: true, easing: 'linear'});
            } else if (timeLeft === 0) {
                 anime.remove(timer); // Detener animación de parpadeo
                 timer.style.color = ''; // Resetear color
            }

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                // El servidor maneja el timeout
            }
        }, 1000);
    } else {
         timer.textContent = '-';
         anime.remove(timer); // Detener animación si el turno no está activo
         timer.style.color = ''; // Resetear color
    }
}


function startGame() {
    if (isHost) {
        // Añadir pequeña animación al botón al hacer clic
        anime({ targets: startGameBtn, scale: [1, 0.95, 1], duration: 300, easing: 'easeInOutQuad' });
        socket.emit('startGame', { gameId });
    }
}

function placeMaterial(side) {
    if (!selectedMaterial) return;

    // Animación de feedback al seleccionar lado
    const targetButton = side === 'left' ? selectLeftBtn : selectRightBtn;
    anime({ targets: targetButton, scale: [1, 0.9, 1], duration: 250, easing: 'easeInOutQuad' });

    socket.emit('placeMaterial', {
        gameId,
        playerId,
        materialId: selectedMaterial.id,
        side: side
    });

     // Deseleccionar visualmente el material elegido
    const selectedButton = document.querySelector(`.material-button[data-id="${selectedMaterial.id}"]`);
    if (selectedButton) {
        selectedButton.classList.remove('selected-material');
        anime({ targets: selectedButton, scale: 1, borderColor: 'transparent', duration: 200, easing: 'easeOutQuad' });
        // Opcional: Animar el botón desapareciendo
        // anime({ targets: selectedButton, opacity: 0, scale: 0.8, duration: 300, easing: 'easeInQuad' });
    }


    selectedMaterial = null;
     // Ocultar panel de selección de lado con animación
     anime({
        targets: sideSelection,
        opacity: 0,
        translateY: -10,
        duration: 200,
        easing: 'easeInQuad',
        complete: () => sideSelection.classList.add('hidden')
    });
    // Opcional: Podríamos deshabilitar los controles aquí hasta recibir 'turnResult'
}

function skipTurn() {
    // Animación de feedback
    anime({ targets: skipTurnBtn, scale: [1, 0.95, 1], duration: 300, easing: 'easeInOutQuad' });
    socket.emit('skipTurn', {
        gameId,
        playerId
    });
    // Opcional: Deshabilitar controles
}

// --- Eventos de Navegación (sin cambios en la lógica, solo llamadas a showScreen) ---
createGameBtn.addEventListener('click', () => showScreen(screens.create));
joinGameBtn.addEventListener('click', () => showScreen(screens.join));
backFromCreateBtn.addEventListener('click', () => showScreen(screens.welcome));
backFromJoinBtn.addEventListener('click', () => showScreen(screens.welcome)); // Corregido para volver a welcome

copyCodeBtn.addEventListener('click', () => {
    const code = gameCodeDisplay.textContent;
    navigator.clipboard.writeText(code)
        .then(() => {
             anime({ targets: copyCodeBtn, color: ['#E6E6E6', '#33FF57', '#E6E6E6'], duration: 1000}); // Feedback visual
            showNotification('¡Código copiado!');
        })
        .catch(() => showNotification('No se pudo copiar el código'));
});

startGameBtn.addEventListener('click', startGame);
selectLeftBtn.addEventListener('click', () => placeMaterial('left'));
selectRightBtn.addEventListener('click', () => placeMaterial('right'));

cancelSelectionBtn.addEventListener('click', () => {
    // Deseleccionar material visualmente con animación
    const currentlySelected = document.querySelector(`.material-button.selected-material`);
    if (currentlySelected) {
        currentlySelected.classList.remove('selected-material');
        anime({ targets: currentlySelected, scale: 1, borderColor: 'transparent', duration: 200, easing: 'easeOutQuad' });
    }
    selectedMaterial = null;

    // Ocultar panel de selección con animación
    anime({
        targets: sideSelection,
        opacity: 0,
        translateY: -10,
        duration: 200,
        easing: 'easeInQuad',
        complete: () => sideSelection.classList.add('hidden')
    });
});

skipTurnBtn.addEventListener('click', skipTurn);

nextTurnBtn.addEventListener('click', () => {
    // Animar botón antes de cambiar de pantalla
    anime({ targets: nextTurnBtn, scale: [1, 0.95, 1], duration: 250, easing: 'easeInOutQuad' }).finished.then(() => {
        if (gameState.gameEnded) {
            showScreen(screens.finalResults);
        } else {
            showScreen(screens.game);
            // Avisar al servidor que estamos listos para el estado actualizado
            socket.emit('readyForNextTurn', { gameId, playerId });
        }
    });
});

playAgainBtn.addEventListener('click', () => {
     // Animar antes de recargar
    anime({
        targets: 'body',
        opacity: 0,
        duration: 500,
        easing: 'easeInQuad',
        complete: () => location.reload()
    });
});

// Eventos para cerrar modales (usando la función animada)
notificationOkBtn.addEventListener('click', () => hideModal(notificationModal));
eliminationOkBtn.addEventListener('click', () => hideModal(eliminationModal));
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
        hideModal(event.target.closest('.modal'));
    });
});

// --- Manejadores de Formularios ---
createForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostName = document.getElementById('host-name').value;
    if (hostName) {
        playerName = hostName;
        isHost = true;
        // Feedback visual en botón
        const submitBtn = createForm.querySelector('button[type="submit"]');
        anime({ targets: submitBtn, scale: [1, 0.9, 1], duration: 200 });

        socket.emit('createGame', { hostName }, (response) => {
            if (response.success) {
                gameId = response.gameId;
                playerId = response.playerId;
                gameCodeDisplay.textContent = response.gameCode;
                showScreen(screens.hostWaiting); // Animará la entrada
                // Animar el código apareciendo
                anime({ targets: gameCodeDisplay, opacity: [0, 1], scale: [0.8, 1], duration: 500, delay: 400, easing: 'easeOutExpo' });
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
        const submitBtn = joinForm.querySelector('button[type="submit"]');
        anime({ targets: submitBtn, scale: [1, 0.9, 1], duration: 200 });

        socket.emit('joinGame', { gameCode, playerName: name }, (response) => {
            if (response.success) {
                gameId = response.gameId;
                playerId = response.playerId;
                showScreen(screens.playerWaiting); // Animará la entrada
            } else {
                showNotification(response.message || 'Error al unirse al juego');
            }
        });
    }
});

// --- Eventos de Socket.IO ---
socket.on('playerJoined', (data) => {
    const { players, count } = data;

    if (waitingPlaceholder) {
        waitingPlaceholder.remove(); // Quitar el placeholder si existe
    }

    // Crear nuevos LIs y animarlos
    const currentDisplayedPlayers = Array.from(playersList.querySelectorAll('li')).map(li => li.dataset.playerName);
    const newPlayerItems = [];

    players.forEach(player => {
        // Solo añadir si no está ya en la lista visualmente
        if (!currentDisplayedPlayers.includes(player.name)) {
            const li = document.createElement('li');
            li.textContent = player.name;
            li.dataset.playerName = player.name; // Añadir data attribute para seguimiento
            li.style.opacity = 0; // Inicial para animación
            li.style.transform = 'translateX(-20px)';
            playersList.appendChild(li);
            newPlayerItems.push(li);
        }
    });

    // Animar solo los nuevos jugadores
    if (newPlayerItems.length > 0) {
         anime({
            targets: newPlayerItems,
            opacity: [0, 1],
            translateX: [-20, 0],
            duration: 400,
            delay: anime.stagger(60),
            easing: 'easeOutQuad'
        });
    }

    // Actualizar contadores
    playerCount.textContent = count;
    joinedCount.textContent = count;

    // Habilitar botón de inicio si es host y se alcanza el mínimo
    if (isHost) {
        const neededPlayers = 10; // O el número que necesites
        if (count >= neededPlayers) {
            if (startGameBtn.disabled) { // Solo animar si estaba deshabilitado
                 startGameBtn.disabled = false;
                 anime({ targets: startGameBtn, scale: [0.9, 1], opacity: [0.5, 1], duration: 400, easing: 'easeOutBack' });
            }
            document.getElementById('waiting-message').innerHTML =
                '<p><i class="fas fa-check-circle" style="color: var(--success-color);"></i> ¡Listos para empezar!</p>';
        } else {
            startGameBtn.disabled = true;
             document.getElementById('waiting-message').innerHTML =
                `<p>Esperando a que se unan ${neededPlayers - count} jugadores más...</p>`;
             anime({ targets: startGameBtn, scale: [1, 0.9], opacity: [1, 0.6], duration: 300, easing: 'easeInQuad' });
        }
    }
});


socket.on('gameStarted', (data) => {
    gameState = data.gameState;
    materials = data.materials || []; // Asegurar que 'materials' global se actualice si se envía desde el servidor

    // Llamar a showScreen para la transición animada
    showScreen(screens.game);

    // Dejar que updateGameUI se encargue de renderizar y animar elementos internos
    // ya que showScreen lo llamará implícitamente a través de la lógica de estado
    // o se llamará después si es necesario
    updateGameUI(gameState); // Llamada inicial para asegurar la UI
});


socket.on('gameStateUpdated', (data) => {
    gameState = data.gameState;
    // Solo actualizar la UI, no cambiar de pantalla
    updateGameUI(gameState);
});


socket.on('turnResult', (data) => {
    gameState = data.gameState; // Actualizar estado global

    // Configurar textos de resultado
    let resultText = '';
    if (data.balanced) {
        resultTitle.textContent = '¡Balanza Equilibrada!';
        resultText = 'La balanza se mantiene estable. ¡Buen trabajo!';
        // Animar ícono de balanza equilibrada
        anime({ targets: '#result-title i', rotate: [ -10, 10, -5, 5, 0 ], duration: 800, easing: 'easeInOutSine' });
    } else {
        resultTitle.textContent = '¡Balanza Desequilibrada!';
        const eliminatedNames = data.eliminatedPlayers.map(p => p.name).join(', ');
        resultText = `La balanza se ha inclinado. ${eliminatedNames ? `¡${eliminatedNames} ${data.eliminatedPlayers.length > 1 ? 'han sido eliminados' : 'ha sido eliminado'}!` : ''}`;
        // Animar ícono de balanza desequilibrada
         anime({ targets: '#result-title i', rotate: [0, data.leftWeight > data.rightWeight ? -15 : 15], duration: 600, easing: 'easeOutElastic(1, .8)' });
    }

    // Mostrar modal de eliminación si es el caso
    if (data.eliminatedPlayers.some(p => p.id === playerId)) {
        eliminated = true;
        showEliminationModal();
    }

    resultMessage.textContent = resultText;

    // Renderizar resumen del turno (elementos se animarán en showScreen)
    turnSummaryList.innerHTML = ''; // Limpiar lista
    const summaryItems = [
        `Turno: ${gameState.currentTurn -1}`, // Turno que acaba de pasar
        `Jugador: ${data.currentPlayerName}`,
        `Acción: ${data.material ? 'Colocó Material' : 'Pasó Turno'}`,
         ...(data.material ? [ // Añadir detalles del material si existe
             `Material: ${data.material.type} (${data.material.weight}g)`,
             `Lado: ${data.side === 'left' ? 'Izquierdo' : 'Derecho'}`
         ] : []), // Array vacío si no hay material
        `Peso Izquierdo: ${formatWeight(data.leftWeight)}g`,
        `Peso Derecho: ${formatWeight(data.rightWeight)}g`,
        `Diferencia: ${formatWeight(Math.abs(data.leftWeight - data.rightWeight))}g`,
        `Estado: ${data.balanced ? 'Equilibrada ✅' : 'Desequilibrada ❌'}`
    ];

    summaryItems.forEach(itemText => {
        const li = document.createElement('li');
        li.textContent = itemText;
        li.style.opacity = 0; // Inicial para animación
        turnSummaryList.appendChild(li);
    });

    // Mostrar la pantalla de resultados del turno (con animación)
    showScreen(screens.turnResult);
});


socket.on('gameOver', (data) => {
    gameState = data.gameState;

    // Limpiar y llenar listas (los elementos se animarán en showScreen)
    winnersList.innerHTML = '';
    data.winners.forEach(winner => {
        const li = document.createElement('li');
        li.innerHTML = `<i class="fas fa-crown" style="color: gold;"></i> ${winner.name} ${winner.isTeam ? '(Equipo)' : '(Individual)'}`;
        li.style.opacity = 0;
        winnersList.appendChild(li);
    });

    finalScaleInfo.innerHTML = `
        <p>Peso Izquierdo: ${formatWeight(data.leftWeight)}g</p>
        <p>Peso Derecho: ${formatWeight(data.rightWeight)}g</p>
        <p>Diferencia Final: ${formatWeight(Math.abs(data.leftWeight - data.rightWeight))}g</p>
        <p>Estado Final: ${isGameBalanced(data.leftWeight, data.rightWeight) ? 'Equilibrada' : 'Desequilibrada'}</p>
    `;

    eliminatedList.innerHTML = '';
    data.eliminatedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.innerHTML = `<i class="fas fa-user-slash" style="color: var(--grey-medium);"></i> ${player.name}`;
         li.style.opacity = 0;
        eliminatedList.appendChild(li);
    });

     // Mostrar pantalla final con animación
    showScreen(screens.finalResults);
});


socket.on('error', (data) => {
    showNotification(`Error: ${data.message}`);
     // Animar el modal de error
    anime({ targets: '#notification-modal .modal-content', translateX: [-5, 5, -5, 5, 0], duration: 400, easing: 'easeInOutSine' });
});

// --- Inicializar la Aplicación ---
// showScreen(screens.welcome); // Se muestra por defecto con la clase 'active' en HTML
// Animar la pantalla inicial al cargar la página
window.addEventListener('load', () => {
    anime({
        targets: '#welcome-screen',
        opacity: [0, 1],
        translateY: [20, 0],
        scale: [0.98, 1],
        duration: 500,
        easing: 'easeOutQuad'
    });
    anime({
        targets: '#welcome-screen .animatable-button',
        opacity: [0, 1],
        translateY: [15, 0],
        delay: anime.stagger(100, {start: 200})
    });
});