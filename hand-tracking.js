import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm';

class LerpValue {
    constructor(value, speed = 0.1) {
        this.value = value;
        this.target = value;
        this.speed = speed;
    }

    update(target) {
        this.target = target;
    }

    step() {
        this.value += (this.target - this.value) * this.speed;
        return this.value;
    }
}

export class HandTracker {
    constructor(videoElement, onUpdate) {
        this.video = videoElement;
        this.onUpdate = onUpdate; 
        this.handLandmarker = null;
        this.isRunning = false;
        this.lastGesture = 'none';
        this.gestureStableCount = 0;
        this.smoothedY = new LerpValue(0, 0.15);
        this.createDebugOverlay();
    }

    createDebugOverlay() {
        this.debugEl = document.createElement('div');
        this.debugEl.style.position = 'absolute';
        this.debugEl.style.top = '0';
        this.debugEl.style.left = '0';
        this.debugEl.style.background = 'rgba(0, 0, 0, 0.7)';
        this.debugEl.style.color = '#0f0';
        this.debugEl.style.fontSize = '10px';
        this.debugEl.style.padding = '4px';
        this.debugEl.style.pointerEvents = 'none';
        this.debugEl.style.zIndex = '2000'; 
        this.debugEl.style.display = 'none';
        
        if (this.video.parentElement) {
            this.video.parentElement.appendChild(this.debugEl);
        }
    }

    updateDebugInfo(msg, data = null) {
        if (this.debugEl) {
            this.debugEl.style.display = 'block';
            const v = this.video;
            let extra = '';
            if (data) {
                extra = `<br>Gesture: ${data.gesture}<br>Roll: ${data.roll}°`;
            }
            const info = `
                Status: ${msg}<br>
                Src: ${v.videoWidth}x${v.videoHeight}<br>
                State: ${v.readyState}
                ${extra}
            `;
            this.debugEl.innerHTML = info;
        }
    }

    async initLandmarker() {
        try {
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1
            });
            return true;
        } catch (error) {
            console.error('MediaPipe Init Error:', error);
            return false;
        }
    }

    async start() {
        if (this.isRunning) {
            this.stop();
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.textContent = '開啟鏡頭';
                btn.style.background = 'rgba(34, 197, 94, 0.9)';
            }
            this.hideError();
            if (this.debugEl) this.debugEl.style.display = 'none';
            return;
        }

        if (window.location.protocol === 'file:') {
            this.showError('Local file access blocked.');
            return;
        }
        
        try {
            // Standard Init
            const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.video.srcObject = stream;
            this.video.playsInline = true;
            this.video.autoplay = true;
            this.video.muted = true;
            this.video.style.display = 'block';

            await new Promise((resolve) => {
                if (this.video.readyState >= 1) resolve();
                else {
                    this.video.onloadedmetadata = () => resolve();
                    setTimeout(resolve, 1000);
                }
            });

            await this.video.play();
            this.isRunning = true;
            this.hideError();
            
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.textContent = '關閉鏡頭';
                btn.style.background = '#ef4444';
            }

            this.debugTimer = setInterval(() => {
                if (this.isRunning) this.updateDebugInfo('Running');
            }, 1000);

            if (!this.handLandmarker) {
                this.initLandmarker();
            }
            
            this.loop();

        } catch (err) {
            console.error("Camera Error:", err);
            this.showError('Error: ' + err.message);
            this.isRunning = false;
        }
    }

    showError(msg) {
        const errEl = document.getElementById('camera-error');
        const msgEl = document.getElementById('camera-error-msg');
        if (errEl && msgEl) {
            errEl.style.display = 'flex';
            msgEl.innerHTML = msg;
        }
    }

    hideError() {
        const errEl = document.getElementById('camera-error');
        if (errEl) errEl.style.display = 'none';
        const btn = document.getElementById('start-camera-btn');
        if (btn) btn.style.display = 'block';
    }

    stop() {
        this.isRunning = false;
        if (this.debugTimer) clearInterval(this.debugTimer);
        if (this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(track => track.stop());
            this.video.srcObject = null;
        }
    }

    async loop() {
        if (!this.isRunning) return;

        if (this.handLandmarker && this.video.readyState >= 2 && this.video.videoWidth > 0) {
            try {
                const results = await this.handLandmarker.detectForVideo(this.video, performance.now());
                this.processResults(results);
            } catch (e) {
                console.error('Detection error:', e);
            }
        }

        requestAnimationFrame(() => this.loop());
    }

    processResults(results) {
        let gesture = 'none';
        let roll = 0;

        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];
            const rawGesture = this.detectGesture(hand);

            const p1 = hand[1]; // Thumb Base
            const p17 = hand[17]; // Pinky Base
            const dx = p17.x - p1.x;
            const dy = p17.y - p1.y;
            
            // Calculate base angle
            roll = Math.atan2(dy, dx);
            
            // 修正邏輯：
            // 平放 (Flat Hand) -> dx > 0, dy ~ 0 -> 0度 -> 水平切面
            // 手刀 (Knife Hand) -> dx ~ 0, dy > 0 -> 90度 -> 垂直切面
            
            // Update Debug Info with Roll angle
            const rollDeg = (roll * 180 / Math.PI).toFixed(0);
            this.updateDebugInfo('Tracking', { roll: rollDeg, gesture: rawGesture });

            if (rawGesture === this.lastGesture) {
                this.gestureStableCount++;
            } else {
                this.gestureStableCount = 0;
                this.lastGesture = rawGesture;
            }

            if (this.gestureStableCount > 3) {
                // Dynamic threshold: require longer hold for fist to prevent accidental triggers
                const threshold = (rawGesture === 'fist') ? 10 : 3;
                if (this.gestureStableCount > threshold) {
                    gesture = rawGesture;
                }
            }

            if (gesture === 'open') {
                const p0 = hand[0];
                const p9 = hand[9];
                const cy = (p0.y + p9.y) / 2;
                const rawTargetY = (0.5 - cy) * 8;
                const clampedTargetY = Math.max(-2, Math.min(2, rawTargetY));
                this.smoothedY.update(clampedTargetY);
            }
        } else {
            gesture = 'none';
        }

        const currentY = this.smoothedY.step();
        
        if (this.onUpdate) {
            this.onUpdate({
                gesture: gesture,
                y: currentY,
                roll: roll, 
                hasHand: !!(results.landmarks && results.landmarks.length > 0)
            });
        }
    }

    detectGesture(hand) {
        const wrist = hand[0];
        let curledFingers = 0;
        const fingerIndices = [{ tip: 8, pip: 6 }, { tip: 12, pip: 10 }, { tip: 16, pip: 14 }, { tip: 20, pip: 18 }];
        fingerIndices.forEach(({tip, pip}) => {
            const tipDist = Math.hypot(hand[tip].x - wrist.x, hand[tip].y - wrist.y, hand[tip].z - wrist.z);
            const pipDist = Math.hypot(hand[pip].x - wrist.x, hand[pip].y - wrist.y, hand[pip].z - wrist.z);
            // Stricter check: tip must be significantly closer to wrist than PIP (bent inwards)
            if (tipDist < pipDist * 0.85) curledFingers++;
        });
        const thumbTip = hand[4];
        const pinkyBase = hand[17];
        // Stricter thumb check
        if (Math.hypot(thumbTip.x - pinkyBase.x, thumbTip.y - pinkyBase.y) < 0.12) curledFingers++;
        
        // Require ALL 5 fingers to be curled for a valid fist
        if (curledFingers >= 5) return 'fist';
        if (curledFingers <= 1) return 'open';
        return 'none';
    }
}
