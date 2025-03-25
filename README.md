# QuizMaster - Juego de Preguntas en Tiempo Real con Socket.IO

Un juego de preguntas y respuestas en tiempo real similar a Kahoot, implementado con Node.js, Express y Socket.IO.

## Características

- Creación de salas de juego con código único
- Interfaz para anfitrión y jugadores
- Creación de preguntas personalizadas
- Contador de tiempo para cada pregunta
- Sistema de puntuación en tiempo real
- Clasificación en vivo y podio final
- Diseño responsivo para dispositivos móviles

## Requisitos

- Node.js (v14 o superior)
- npm (v6 o superior)

## Instalación

1. Clona o descarga este repositorio
2. Abre una terminal en la carpeta del proyecto
3. Instala las dependencias:

```bash
npm install
```

## Cómo jugar

1. Inicia el servidor:

```bash
npm start
```

2. Abre un navegador y ve a `http://localhost:3000`

### Para el anfitrión:

1. Selecciona "Crear nuevo juego"
2. Introduce el nombre del juego
3. Crea las preguntas, opciones, respuestas correctas y tiempo para cada pregunta
4. Comparte el código del juego con los jugadores
5. Cuando todos los jugadores se hayan unido, presiona "Iniciar juego"
6. Controla el flujo del juego y visualiza los resultados

### Para los jugadores:

1. Selecciona "Unirse a un juego"
2. Introduce el código del juego y tu nombre
3. Espera a que el anfitrión inicie el juego
4. Responde las preguntas lo más rápido posible para obtener más puntos
5. ¡Compite por el primer lugar en el podio!

## Estructura del proyecto

- `server.js` - Servidor principal y lógica de Socket.IO
- `public/index.html` - Interfaz de usuario HTML
- `public/styles.css` - Estilos CSS
- `public/app.js` - Lógica del cliente y comunicación con Socket.IO

## Tecnologías utilizadas

- Node.js
- Express
- Socket.IO
- HTML5
- CSS3
- JavaScript ES6+

## Personalización

Puedes personalizar el juego modificando:

- Los colores y estilos en `styles.css`
- El formato de las preguntas en `app.js`
- El sistema de puntuación en `server.js`

## Licencia

Este proyecto es de código abierto y está disponible para cualquier uso.
