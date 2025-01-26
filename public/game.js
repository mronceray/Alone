/* =========  VARIABLES ET INITIALISATION  ========= */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const apiStatus = document.getElementById('apiStatus');
const statusText = apiStatus.querySelector('.status-text');

let apiAvailable = false;
let apiInitialized = false;
let lastApiCheck = 0;
const API_CHECK_INTERVAL = 5000; // Vérifier toutes les 5 secondes si l'API est hors ligne

const SPRITE_WIDTH = 138;
const SPRITE_HEIGHT = 138;
const ANIMATION_FRAMES = 8;
const FRAME_SPEED = 100;

const DIRECTIONS = {
    RIGHT: 0,
    UP: 1,
    UP_RIGHT: 2,
    UP_LEFT: 3,
    DOWN: 4,
    DOWN_RIGHT: 5,
    DOWN_LEFT: 6,
    LEFT: 7
};

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* =========  TTS : FILE D'ATTENTE ET FONCTIONS  ========= */

// Liste des phrases à prononcer
const ttsQueue = [];

// Flag pour savoir si le TTS est en cours
let isTTSRunning = false;

// La voix sélectionnée
let selectedVoice = null;

// Quand on reçoit un nouveau texte (pensée), on le découpe éventuellement en phrases
// puis on ajoute chaque phrase dans la file d'attente.
function addThoughtToQueue(text) {
    if (!text) return;
    const sentences = splitIntoSentences(text);
    sentences.forEach(sentence => {
        ttsQueue.push(sentence);
    });
}

/**
 * Découpe un texte en phrases sur les . ! ? (simples).
 * Adapte si besoin à tes besoins.
 */
function splitIntoSentences(text) {
    if (!text) return [];
    return text
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

/**
 * Fonction de parole simple : renvoie une Promise
 * qui se résout uniquement quand la phrase est terminée.
 */
function speak(text) {
    return new Promise((resolve) => {
        if (!selectedVoice || !text) {
            resolve();
            return;
        }

        // On annule toute lecture en cours pour être sûr d'éviter les chevauchements
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = selectedVoice;
        utterance.rate = 0.9;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            resolve();
        };
        utterance.onerror = () => {
            resolve();
        };

        window.speechSynthesis.speak(utterance);
    });
}

/**
 * Charge les voix disponibles et sélectionne une voix française.
 */
function loadVoices() {
    const allVoices = speechSynthesis.getVoices();
    selectedVoice = allVoices.find(voice => voice.name === "Thomas" && voice.lang === "fr-FR")
                    || allVoices.find(voice => voice.lang.startsWith('fr'));

    if (selectedVoice) {
        console.log('Voix sélectionnée:', selectedVoice.name);
    } else if (allVoices.length > 0) {
        // fallback quelconque
        selectedVoice = allVoices[0];
        console.log('Aucune voix fr trouvée, utilisation de:', selectedVoice.name);
    }
}

/**
 * Cette fonction est appelée en boucle (ex: dans la gameLoop)
 * et gère la lecture séquentielle.
 * - Si aucune lecture en cours et qu'il y a du texte en file d'attente,
 *   on lit la première phrase.
 * - On attend la fin de la lecture, on enlève la phrase, puis on passe à la suivante.
 */
async function processTTSQueue() {
    // Si on est déjà en train de parler, ou s'il n'y a rien à dire, on ne fait rien
    if (isTTSRunning || ttsQueue.length === 0) {
        return;
    }

    // On récupère la première phrase à lire
    const textToSpeak = ttsQueue[0];
    isTTSRunning = true;

    // Affiche la bulle
    character.currentThought = textToSpeak;

    // On attend la fin de la parole
    await speak(textToSpeak);

    // On supprime la phrase de la liste
    ttsQueue.shift();

    // On efface la bulle
    character.currentThought = null;
    isTTSRunning = false;
}

/* =========  API / PENSÉES  ========= */

let lastThoughtTime = 0;
const THOUGHT_INTERVAL = 8000; // 8s entre deux nouvelles pensées

async function requestNewThought() {
    const now = Date.now();
    if (now - lastThoughtTime < THOUGHT_INTERVAL) {
        return; // trop tôt pour une nouvelle pensée
    }

    try {
        const response = await fetch('/think', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error('Erreur réseau');
        }
        
        const data = await response.json();
        if (!data.thought) {
            throw new Error('Réponse invalide');
        }

        // On ajoute la pensée dans la queue TTS
        addThoughtToQueue(data.thought);

        // On met à jour le temps de la dernière pensée
        lastThoughtTime = Date.now();
    } catch (error) {
        console.error('Erreur lors de la récupération de la pensée:', error);
    }
}

/**
 * Gère la logique pour demander une nouvelle pensée si besoin,
 * puis appelle `processTTSQueue()` pour lancer la lecture des bulles.
 */
function updateThoughts() {
    // Si on n'a rien à lire et qu'on dépasse l'intervalle, on va chercher une nouvelle pensée
    if (ttsQueue.length === 0 && !isTTSRunning && (Date.now() - lastThoughtTime >= THOUGHT_INTERVAL)) {
        requestNewThought();
    }
    // Ensuite on tente de parler la phrase suivante dans la queue
    processTTSQueue();
}

/* =========  PERSONNAGE ET ANIM  ========= */

const character = {
    x: 0,
    y: 0,
    speed: 3,
    currentFrame: 3,
    currentDirection: DIRECTIONS.RIGHT,
    lastFrameTime: 0,
    isMoving: false,
    currentThought: null,
    targetX: null,
    targetY: null,
    lastTargetTime: 0,
    aiEnabled: true
};

const spriteSheet = new Image();
spriteSheet.src = 'Spritesheet Walk.png';

function drawSpeechBubble(text, x, y) {
    if (!text) return;

    const maxWidth = 300; // Largeur maximale de la bulle
    const padding = 15;
    const borderRadius = 10;
    const verticalOffset = 50; // Distance supplémentaire au-dessus du personnage

    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    
    // Découpage du texte en lignes selon la largeur maximale
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth - (padding * 2)) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);

    // Calcul des dimensions de la bulle
    const lineHeight = 20;
    const bubbleWidth = Math.min(maxWidth, Math.max(...lines.map(line => ctx.measureText(line).width)) + (padding * 2));
    const bubbleHeight = (lines.length * lineHeight) + (padding * 2);
    
    // Position de la bulle au-dessus du personnage
    const bubbleX = x - bubbleWidth / 2;
    const bubbleY = y - bubbleHeight - verticalOffset;

    // Dessin de la bulle
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;

    // Bulle principale
    ctx.beginPath();
    ctx.moveTo(bubbleX + borderRadius, bubbleY);
    ctx.lineTo(bubbleX + bubbleWidth - borderRadius, bubbleY);
    ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY, bubbleX + bubbleWidth, bubbleY + borderRadius);
    ctx.lineTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight - borderRadius);
    ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight, bubbleX + bubbleWidth - borderRadius, bubbleY + bubbleHeight);
    ctx.lineTo(bubbleX + borderRadius, bubbleY + bubbleHeight);
    ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleHeight, bubbleX, bubbleY + bubbleHeight - borderRadius);
    ctx.lineTo(bubbleX, bubbleY + borderRadius);
    ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + borderRadius, bubbleY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pointe de la bulle
    ctx.beginPath();
    ctx.moveTo(x - 10, bubbleY + bubbleHeight);
    ctx.lineTo(x, bubbleY + bubbleHeight + 10);
    ctx.lineTo(x + 10, bubbleY + bubbleHeight);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Texte
    ctx.fillStyle = '#000';
    lines.forEach((line, index) => {
        const textY = bubbleY + padding + (lineHeight * (index + 0.8)); // Ajustement du facteur vertical pour centrer
        ctx.fillText(line, bubbleX + padding, textY);
    });
}

function drawCharacter() {
    const now = Date.now();
    if (character.isMoving && now - character.lastFrameTime > FRAME_SPEED) {
        character.currentFrame = (character.currentFrame + 1) % ANIMATION_FRAMES;
        character.lastFrameTime = now;
    } else if (!character.isMoving) {
        character.currentFrame = 3; // Frame idle
    }

    ctx.drawImage(
        spriteSheet,
        character.currentFrame * SPRITE_WIDTH,
        character.currentDirection * SPRITE_HEIGHT,
        SPRITE_WIDTH,
        SPRITE_HEIGHT,
        character.x - SPRITE_WIDTH/2,
        character.y - SPRITE_HEIGHT/2,
        SPRITE_WIDTH,
        SPRITE_HEIGHT
    );

    if (character.currentThought) {
        drawSpeechBubble(character.currentThought, character.x, character.y);
    }
}

/* =========  DEPLACEMENTS  ========= */

const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = true;
    }
    if (e.key === ' ') {
        character.aiEnabled = !character.aiEnabled;
        character.targetX = null;
        character.targetY = null;
    }
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) {
        keys[e.key] = false;
    }
});

function updateAIMovement() {
    const now = Date.now();
    
    if (!character.targetX || !character.targetY ||
        now - character.lastTargetTime > Math.random() * 3000 + 3000) {
        
        const margin = SPRITE_WIDTH;
        character.targetX = Math.random() * (canvas.width - 2*margin) + margin;
        character.targetY = Math.random() * (canvas.height - 2*margin) + margin;
        character.lastTargetTime = now;
    }

    const dx = character.targetX - character.x;
    const dy = character.targetY - character.y;
    const distance = Math.sqrt(dx*dx + dy*dy);

    if (distance < 5) {
        character.isMoving = false;
        return;
    }

    character.isMoving = true;
    const moveX = (dx / distance) * character.speed;
    const moveY = (dy / distance) * character.speed;
    character.x += moveX;
    character.y += moveY;

    // Gestion de la direction...
    // (Même logique qu’avant, gardé simplifié.)
    const angle = Math.atan2(dy, dx);
    const deg = angle * 180 / Math.PI;
    if (deg >= -22.5 && deg < 22.5) character.currentDirection = DIRECTIONS.RIGHT;
    else if (deg >= 22.5 && deg < 67.5) character.currentDirection = DIRECTIONS.DOWN_RIGHT;
    else if (deg >= 67.5 && deg < 112.5) character.currentDirection = DIRECTIONS.DOWN;
    else if (deg >= 112.5 && deg < 157.5) character.currentDirection = DIRECTIONS.DOWN_LEFT;
    else if (deg >= 157.5 || deg < -157.5) character.currentDirection = DIRECTIONS.LEFT;
    else if (deg >= -157.5 && deg < -112.5) character.currentDirection = DIRECTIONS.UP_LEFT;
    else if (deg >= -112.5 && deg < -67.5) character.currentDirection = DIRECTIONS.UP;
    else if (deg >= -67.5 && deg < -22.5) character.currentDirection = DIRECTIONS.UP_RIGHT;
}

function updateCharacter() {
    if (character.aiEnabled) {
        updateAIMovement();
    } else {
        let dx = 0, dy = 0;
        if (keys.ArrowUp) dy -= character.speed;
        if (keys.ArrowDown) dy += character.speed;
        if (keys.ArrowLeft) dx -= character.speed;
        if (keys.ArrowRight) dx += character.speed;

        character.isMoving = (dx !== 0 || dy !== 0);

        // Directions manuelles...
        if (dx > 0 && dy < 0) character.currentDirection = DIRECTIONS.UP_RIGHT;
        else if (dx < 0 && dy < 0) character.currentDirection = DIRECTIONS.UP_LEFT;
        else if (dx > 0 && dy > 0) character.currentDirection = DIRECTIONS.DOWN_RIGHT;
        else if (dx < 0 && dy > 0) character.currentDirection = DIRECTIONS.DOWN_LEFT;
        else if (dx > 0) character.currentDirection = DIRECTIONS.RIGHT;
        else if (dx < 0) character.currentDirection = DIRECTIONS.LEFT;
        else if (dy < 0) character.currentDirection = DIRECTIONS.UP;
        else if (dy > 0) character.currentDirection = DIRECTIONS.DOWN;

        // Collision bords
        character.x = Math.max(SPRITE_WIDTH/2, Math.min(canvas.width - SPRITE_WIDTH/2, character.x + dx));
        character.y = Math.max(SPRITE_HEIGHT/2, Math.min(canvas.height - SPRITE_HEIGHT/2, character.y + dy));
    }
}

/* =========  BOUCLE DU JEU  ========= */

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mise à jour du perso + dessin
    updateCharacter();
    drawCharacter();
    
    // Gestion des pensées & TTS
    updateThoughts();

    requestAnimationFrame(gameLoop);
}

/* =========  INIT  ========= */

async function init() {
    console.log('Initialisation du jeu...');
    
    // Chargement de la voix
    loadVoices();
    if ('onvoiceschanged' in speechSynthesis) {
        speechSynthesis.onvoiceschanged = loadVoices;
    }
    
    // Vérification API initiale
    await checkApiStatus();
    
    // On lance la boucle de jeu
    gameLoop();

    // Vérifications périodiques de l’API
    setInterval(checkApiStatus, API_CHECK_INTERVAL);
}

window.onload = init;

/* =========  STATUS API  ========= */

async function checkApiStatus() {
    try {
        apiStatus.className = 'checking';
        statusText.textContent = 'Vérification...';

        const response = await fetch('/test');
        const data = await response.json();
        
        if (data.status === 'ok') {
            apiAvailable = true;
            apiInitialized = data.initialized;
            apiStatus.className = 'online';
            statusText.textContent = apiInitialized ? 'API connectée' : 'Initialisation...';
        } else {
            throw new Error('API status not ok');
        }
        
        lastApiCheck = Date.now();
        return true;
    } catch (error) {
        console.error('API check failed:', error);
        apiAvailable = false;
        apiInitialized = false;
        apiStatus.className = 'offline';
        statusText.textContent = 'API déconnectée';
        lastApiCheck = Date.now();
        return false;
    }
}
