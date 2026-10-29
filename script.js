// Define the questions
const questions = [
    { id: 'q1', text: "Q1: Write the name of your favorite fruit." },
    { id: 'q2', text: "Q2: What is the capital city of your country?" },
    { id: 'q3', text: "Q3: Write a short welcome message." }
];
let currentQuestionIndex = 0;

// Secure Storage Configuration
const SECRET_KEY = "exam_secure_key_123"; 
let examData = { q1: [], q2: [], q3: [] }; 
let currentStrokes = []; 

// UI Elements
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const questionText = document.getElementById('question-text');
const statusOverlay = document.getElementById('status-overlay');
const nextBtn = document.getElementById('next-btn');
const prevBtn = document.getElementById('prev-btn');
const clearBtn = document.getElementById('clear-btn');
const submitBtn = document.getElementById('submit-btn');
const canvasContainer = document.getElementById('canvas-container');
const tamperAlert = document.getElementById('tamper-alert');
const dismissTamperBtn = document.getElementById('dismiss-tamper-btn');

// New UI Elements
const eraserBtn = document.getElementById('eraser-btn');
const saveBtn = document.getElementById('save-btn');
const readQBtn = document.getElementById('read-q-btn');
const readABtn = document.getElementById('read-a-btn');
const roundKey = document.getElementById('round-key');

// State variables
let isDrawing = false;
let isProcessingOCR = false;
let lastKnownPoint = null; 
let isEraserMode = false;

// Audio Context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playTone(freq, duration, vol = 0.1, type = 'sine') {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// Exam Integrity
document.addEventListener('visibilitychange', () => {
    if (document.visibilitychange === 'hidden' || document.hidden) {
        logSecurityEvent("App lost focus / Tab switched");
        tamperAlert.classList.remove('hidden');
    }
});
window.addEventListener('blur', () => {
    logSecurityEvent("Window blurred");
    tamperAlert.classList.remove('hidden');
});
dismissTamperBtn.addEventListener('click', () => { tamperAlert.classList.add('hidden'); });
function logSecurityEvent(msg) { console.warn(`SECURITY EVENT: ${msg} at ${new Date().toISOString()}`); }

// Setup canvas
function resizeCanvas() {
    // clientWidth/Height exclude the 15px border, so the bitmap matches the
    // displayed canvas 1:1 (touch coordinates line up with the OCR word boxes)
    canvas.width = canvasContainer.clientWidth;
    canvas.height = canvasContainer.clientHeight;
    ocrDirty = true;
    redrawStrokes();
}
window.addEventListener('resize', resizeCanvas);

function init() {
    loadExamData();
    resizeCanvas();
    updateQuestion();
}

function updateQuestion() {
    const qId = questions[currentQuestionIndex].id;
    questionText.textContent = questions[currentQuestionIndex].text;
    currentStrokes = examData[qId] || [];
    ocrDirty = true;
    redrawStrokes();
}

function redrawStrokes() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentStrokes.forEach(strokeData => {
        let pts, isE = false;
        // Migrate old arrays dynamically
        if (Array.isArray(strokeData)) { pts = strokeData; }
        else if (strokeData.points) { pts = strokeData.points; isE = strokeData.isEraser; }
        
        if (!pts || pts.length === 0) return;
        
        ctx.globalCompositeOperation = isE ? 'destination-out' : 'source-over';
        ctx.lineWidth = isE ? 20 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over'; // reset
}

function clearCanvas() {
    currentStrokes = [];
    ocrDirty = true;
    saveExamData();
    redrawStrokes();
}

// --- SECURE STORAGE ---
function saveExamData() {
    examData[questions[currentQuestionIndex].id] = currentStrokes;
    const jsonStr = JSON.stringify(examData);
    const encrypted = CryptoJS.AES.encrypt(jsonStr, SECRET_KEY).toString();
    localStorage.setItem('exam_secure_data', encrypted);
}
function loadExamData() {
    const encrypted = localStorage.getItem('exam_secure_data');
    if (encrypted) {
        try {
            const bytes = CryptoJS.AES.decrypt(encrypted, SECRET_KEY);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            if(decrypted) examData = JSON.parse(decrypted);
        } catch(e) { console.error("Failed to decrypt exam data", e); }
    }
}

// --- BUTTON LISTENERS ---
eraserBtn.addEventListener('click', () => {
    isEraserMode = !isEraserMode;
    eraserBtn.textContent = isEraserMode ? '🧹 Eraser: ON' : '✏️ Eraser: OFF';
    eraserBtn.style.backgroundColor = isEraserMode ? '#f39c12' : '';
});

clearBtn.addEventListener('click', clearCanvas);

saveBtn.addEventListener('click', () => {
    saveExamData();
    alert("Draft saved securely.");
});

readQBtn.addEventListener('click', () => {
    speak(questions[currentQuestionIndex].text);
});

readABtn.addEventListener('click', () => {
    readCanvasText('all');
});

// --- ROUND KEY (FAB) LOGIC ---
let roundKeyTapCount = 0;
let roundKeyTapTimer = null;
let roundKeyLongPressTimer = null;
let roundKeyFiredLongPress = false;

roundKey.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    roundKeyFiredLongPress = false;
    roundKeyLongPressTimer = setTimeout(() => {
        roundKeyFiredLongPress = true;
        roundKeyTapCount = 0;
        readCanvasText('all'); // Long press -> entire answer
    }, 600);
});

roundKey.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clearTimeout(roundKeyLongPressTimer);
    
    if (!roundKeyFiredLongPress) {
        roundKeyTapCount++;
        if (roundKeyTapCount === 1) {
            roundKeyTapTimer = setTimeout(() => {
                if (roundKeyTapCount === 1) {
                    readCanvasText('sentence'); // One tap -> last sentence
                }
                roundKeyTapCount = 0;
            }, 300);
        } else if (roundKeyTapCount === 2) {
            clearTimeout(roundKeyTapTimer);
            readCanvasText('line'); // Double tap -> current line
            roundKeyTapCount = 0;
        }
    }
});


// --- POINTER EVENTS (Stylus = write, Finger = read aloud up to touched word) ---
let currentStrokeObj = null;
let lastPenTime = 0;              // palm rejection: time of last pen activity
let activeTouchId = null;         // only one finger is tracked at a time
let touchMoved = false;
let touchStartX = 0, touchStartY = 0;
const PALM_GUARD_MS = 700;

function isPen(e) { return e.pointerType === 'pen'; }
function isFinger(e) { return e.pointerType === 'touch' || e.pointerType === 'mouse'; }
function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width),
             y: (e.clientY - r.top) * (canvas.height / r.height) };
}

canvas.addEventListener('pointerdown', (e) => {
    const p = canvasPos(e);
    if (isPen(e)) {
        lastPenTime = Date.now();
        activeTouchId = null;                       // a pen always wins over a finger/palm
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        // Pen eraser tip (buttons bit 32) also erases
        const erasing = isEraserMode || (e.buttons & 32) === 32;
        isDrawing = true;
        currentStrokeObj = { isEraser: erasing, points: [{x: p.x, y: p.y}] };
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
    } else if (isFinger(e)) {
        // Ignore fingers/palms while the pen is writing or just wrote
        if (isDrawing || Date.now() - lastPenTime < PALM_GUARD_MS) return;
        if (activeTouchId !== null) return;         // ignore extra fingers
        activeTouchId = e.pointerId;
        touchMoved = false;
        touchStartX = p.x;
        touchStartY = p.y;
        e.preventDefault();
    }
});

canvas.addEventListener('pointermove', (e) => {
    const p = canvasPos(e);
    const margin = 30;
    if (p.x < margin || p.x > canvas.width - margin ||
        p.y < margin || p.y > canvas.height - margin) {
        canvasContainer.classList.add('boundary-warning');
        if (isDrawing && navigator.vibrate) navigator.vibrate(50);
        if (isDrawing && currentStrokeObj && currentStrokeObj.points.length % 10 === 0) playTone(150, 0.2, 0.05, 'square');
    } else {
        canvasContainer.classList.remove('boundary-warning');
    }

    if (isPen(e)) {
        lastPenTime = Date.now();
        if (!isDrawing && lastKnownPoint) {
            const dist = Math.hypot(p.x - lastKnownPoint.x, p.y - lastKnownPoint.y);
            if (dist < 50) {
                const freq = 400 + (50 - dist) * 10;
                playTone(freq, 0.05, 0.02, 'sine');
            }
        }
        if (!isDrawing || !currentStrokeObj) return;

        // Use coalesced events so fast strokes stay smooth
        const evts = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
        ctx.globalCompositeOperation = currentStrokeObj.isEraser ? 'destination-out' : 'source-over';
        ctx.lineWidth = currentStrokeObj.isEraser ? 20 : 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#000000';
        evts.forEach(ev => {
            const q = canvasPos(ev);
            ctx.lineTo(q.x, q.y);
            currentStrokeObj.points.push({x: q.x, y: q.y});
        });
        ctx.stroke();
        e.preventDefault();
    } else if (isFinger(e) && e.pointerId === activeTouchId) {
        if (Date.now() - lastPenTime < PALM_GUARD_MS) { activeTouchId = null; return; }
        if (Math.hypot(p.x - touchStartX, p.y - touchStartY) > 8) touchMoved = true;
        e.preventDefault();
    }
});

canvas.addEventListener('pointerup', (e) => {
    const p = canvasPos(e);
    if (isPen(e)) {
        lastPenTime = Date.now();
        isDrawing = false;
        ctx.closePath();
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        if (currentStrokeObj && currentStrokeObj.points.length > 0) {
            currentStrokes.push(currentStrokeObj);
            lastKnownPoint = currentStrokeObj.points[currentStrokeObj.points.length - 1];
            ocrDirty = true;
            saveExamData();
        }
        currentStrokeObj = null;
        ctx.globalCompositeOperation = 'source-over';
    } else if (isFinger(e) && e.pointerId === activeTouchId) {
        activeTouchId = null;
        // Palm touched right as the pen came down? ignore.
        if (isDrawing || Date.now() - lastPenTime < PALM_GUARD_MS) return;
        // Finger touch (tap, or slide then lift) -> read from the start up to
        // the END of the word under the finger's final position.
        if (!isProcessingOCR) readUpToPoint(p.x, p.y);
    }
});

canvas.addEventListener('pointercancel', (e) => {
    if (isPen(e)) {
        isDrawing = false;
        if (currentStrokeObj && currentStrokeObj.points.length > 1) {
            currentStrokes.push(currentStrokeObj);
            ocrDirty = true;
            saveExamData();
        }
        currentStrokeObj = null;
    }
    if (e.pointerId === activeTouchId) activeTouchId = null;
});

// Stop the long-press / context menu that stylus & touch can trigger
canvas.addEventListener('contextmenu', (e) => e.preventDefault());


// --- NAVIGATION CONTROLS ---
nextBtn.addEventListener('click', () => {
    currentQuestionIndex = (currentQuestionIndex + 1) % questions.length;
    updateQuestion();
});
prevBtn.addEventListener('click', () => {
    currentQuestionIndex = (currentQuestionIndex - 1 + questions.length) % questions.length;
    updateQuestion();
});
submitBtn.addEventListener('click', () => {
    saveExamData();
    alert("Exam encrypted and submitted securely!");
    localStorage.removeItem('exam_secure_data');
    location.reload();
});


// --- OCR (Handwriting to Text) AND TTS (Text to Speech) ---

// --- OCR cache: only re-run Tesseract when the writing has changed ---
let ocrDirty = true;
let ocrCache = null;

async function getOcrResult() {
    if (ocrCache && !ocrDirty) return ocrCache;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);
    const result = await Tesseract.recognize(tempCanvas.toDataURL('image/png'), 'eng');
    ocrCache = result;
    ocrDirty = false;
    return result;
}

// Words in reading order (line by line, left to right)
function wordsInReadingOrder(result) {
    let words = [];
    if (result.data.lines && result.data.lines.length > 0) {
        const lines = [...result.data.lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
        lines.forEach(line => {
            const lw = (line.words || []).filter(w => w.text && w.text.trim().length > 0);
            lw.sort((a, b) => a.bbox.x0 - b.bbox.x0);
            words = words.concat(lw);
        });
    }
    if (words.length === 0 && result.data.words) {
        words = result.data.words.filter(w => w.text && w.text.trim().length > 0);
        words.sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
    }
    return words;
}

// Finger touch: read aloud from the beginning UP TO THE END of the touched word.
async function readUpToPoint(x, y) {
    isProcessingOCR = true;
    statusOverlay.textContent = "Analyzing touched area...";
    statusOverlay.classList.remove('hidden');

    try {
        const result = await getOcrResult();
        const words = wordsInReadingOrder(result);

        if (words.length === 0) {
            statusOverlay.textContent = "No text found at touched area.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
            return;
        }

        // Find the word under the finger; otherwise the nearest word
        let hit = -1, bestDist = Infinity;
        words.forEach((w, i) => {
            const r = w.bbox;
            if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
                hit = i; bestDist = -1;
            } else if (bestDist !== -1) {
                const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
                const d = Math.hypot(cx - x, cy - y);
                if (d < bestDist) { bestDist = d; hit = i; }
            }
        });

        if (hit < 0 || bestDist > 150) {
            statusOverlay.textContent = "No text found at touched area.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
            return;
        }

        // Everything from the first word through the END of the touched word
        const textToRead = words.slice(0, hit + 1).map(w => w.text).join(' ').trim();
        statusOverlay.textContent = "Speaking...";
        speak(textToRead);
    } catch (error) {
        console.error("OCR Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
    } finally {
        isProcessingOCR = false;
    }
}

// Read whole canvas for Round Key modes
async function readCanvasText(mode) {
    isProcessingOCR = true;
    statusOverlay.textContent = "Analyzing canvas...";
    statusOverlay.classList.remove('hidden');
    
    try {
        const result = await getOcrResult();
        
        let textToRead = "";
        const fullText = result.data.text.trim();

        if (mode === 'all') {
            textToRead = fullText;
        } else if (mode === 'line') {
            if (result.data.lines && result.data.lines.length > 0) {
                textToRead = result.data.lines[result.data.lines.length - 1].text.trim();
            }
        } else if (mode === 'sentence') {
            const sentences = fullText.split(/(?<=[.!?])\s+/);
            if (sentences.length > 0) {
                textToRead = sentences[sentences.length - 1].trim();
                if (!textToRead && result.data.lines) {
                    textToRead = result.data.lines[result.data.lines.length - 1].text.trim();
                }
            }
        }
        
        if (textToRead.length > 0) {
            statusOverlay.textContent = "Speaking...";
            speak(textToRead);
        } else {
            statusOverlay.textContent = "No writing detected.";
            setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
        }
    } catch (error) {
        console.error("OCR Error:", error);
        statusOverlay.textContent = "Error reading text.";
        setTimeout(() => { statusOverlay.classList.add('hidden'); }, 2000);
    } finally {
        isProcessingOCR = false;
    }
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); 
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => { statusOverlay.classList.add('hidden'); };
        utterance.onerror = () => { statusOverlay.classList.add('hidden'); };
        window.speechSynthesis.speak(utterance);
    } else {
        alert("Text-to-speech is not supported in your browser.");
        statusOverlay.classList.add('hidden');
    }
}

init();
