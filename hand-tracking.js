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
        
        // Create Debug Overlay
        this.createDebugOverlay();
    }

    createDebugOverlay() {
        this.debugEl = document.createElement('div');
        this.debugEl.style.position = 'absolute';
        this.debugEl.style.top = '0';
        this.debugEl.style.left = '0';
        this.debugEl.style.background = 'rgba(0, 0, 0, 0.7)';
        this.debugEl.style.color = '#0f0';
        this.debugEl.style.fontSize = '12px';
        this.debugEl.style.fontFamily = 'monospace';
        this.debugEl.style.padding = '4px';
        this.debugEl.style.pointerEvents = 'none';
        this.debugEl.style.zIndex = '10005'; // Super high
        this.debugEl.style.display = 'none';
        
        if (this.video.parentElement) {
            this.video.parentElement.appendChild(this.debugEl);
        }
    }

    updateDebugInfo(msg) {
        if (this.debugEl) {
            this.debugEl.style.display = 'block';
            const v = this.video;
            const info = `
                [DEBUG]<br>
                Status: ${msg}<br>
                Source: ${v.videoWidth}x${v.videoHeight}<br>
                Render: ${v.clientWidth}x${v.clientHeight}<br>
                State: ${v.readyState}<br>
                Paused: ${v.paused}<br>
                Muted: ${v.muted}
            `;
            this.debugEl.innerHTML = info;
        }
    }

    async initLandmarker() {
        try {
            this.updateDebugInfo('Loading AI...');
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numHands: 1,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.6
            });
            this.updateDebugInfo('AI Ready');
            return true;
        } catch (error) {
            console.error('MediaPipe Init Error:', error);
            this.updateDebugInfo('AI Error: ' + error.message);
            return false;
        }
    }

    async start() {
        if (this.isRunning) {
            this.stop();
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.textContent = '開啟鏡頭';
                btn.style.background = '#22c55e';
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
            const constraints = { 
                video: { 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 }, 
                    facingMode: "user" 
                } 
            };

            this.updateDebugInfo('Req Stream...');
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            this.video.srcObject = stream;
            this.video.playsInline = true;
            this.video.autoplay = true;
            this.video.muted = true;
            
            // Force layout recalc
            this.video.style.display = 'none';
            this.video.offsetHeight; // trigger reflow
            this.video.style.display = 'block';

            // Wait for metadata
            await new Promise((resolve) => {
                if (this.video.readyState >= 1) resolve();
                else {
                    this.video.onloadedmetadata = () => resolve();
                    setTimeout(resolve, 1000);
                }
            });

            try {
                await this.video.play();
                this.updateDebugInfo('Playing...');
            } catch (e) {
                this.updateDebugInfo('Play Fail: ' + e.message);
                throw e;
            }

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
        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];
            const rawGesture = this.detectGesture(hand);
            if (rawGesture === this.lastGesture) {
                this.gestureStableCount++;
            } else {
                this.gestureStableCount = 0;
                this.lastGesture = rawGesture;
            }
            if (this.gestureStableCount > 3) gesture = rawGesture;
            if (gesture === 'open') {
                const p0 = hand[0];
                const p9 = hand[9];
                const cy = (p0.y + p9.y) / 2;
                const rawTargetY = (0.5 - cy) * 8;
                const clampedTargetY = Math.max(-2, Math.min(2, rawTargetY));
                this.smoothedY.update(clampedTargetY);
            }
        }
        const currentY = this.smoothedY.step();
        if (this.onUpdate) {
            this.onUpdate({
                gesture: gesture,
                y: currentY,
                hasHand: !!(results.landmarks && results.landmarks.length > 0)
            });
        }
    }

    detectGesture(hand) {
        const wrist = hand[0];
        let curledFingers = 0;
        const fingerIndices = [
            { tip: 8, pip: 6 }, { tip: 12, pip: 10 }, 
            { tip: 16, pip: 14 }, { tip: 20, pip: 18 }
        ];
        fingerIndices.forEach(({tip, pip}) => {
            const tipDist = Math.hypot(hand[tip].x - wrist.x, hand[tip].y - wrist.y, hand[tip].z - wrist.z);
            const pipDist = Math.hypot(hand[pip].x - wrist.x, hand[pip].y - wrist.y, hand[pip].z - wrist.z);
            if (tipDist < pipDist * 1.1) curledFingers++;
        });
        const thumbTip = hand[4];
        const pinkyBase = hand[17];
        if (Math.hypot(thumbTip.x - pinkyBase.x, thumbTip.y - pinkyBase.y) < 0.15) curledFingers++;
        if (curledFingers >= 4) return 'fist';
        if (curledFingers <= 1) return 'open';
        return 'none';
    }
}
