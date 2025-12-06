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
    }

    async init() {
        try {
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
            return true;
        } catch (error) {
            console.error('MediaPipe Init Error:', error);
            return false;
        }
    }

    async start() {
        // If running, assume this is a stop request
        if (this.isRunning) {
            this.stop();
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.textContent = '開啟鏡頭';
                btn.style.background = '#22c55e';
                // Re-binding is handled by main.js logic or permanent listener
            }
            this.hideError();
            return;
        }

        // Check for File Protocol immediately to save user frustration
        if (window.location.protocol === 'file:') {
            this.showError(`
                <div style="font-weight:bold; font-size:1.1rem; margin-bottom:10px;">瀏覽器安全性限制</div>
                無法直接從檔案 (file://) 存取攝像頭。<br><br>
                請使用 <strong>Local Server</strong> 運行此網頁。
            `);
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.style.display = 'block';
                btn.textContent = '開啟鏡頭 (受限模式)';
                btn.style.background = '#64748b';
            }
            return;
        }

        if (!this.handLandmarker) {
            const success = await this.init();
            if (!success) {
                this.showError("MediaPipe 初始化失敗<br>請檢查網絡連線");
                return;
            }
        }
        
        try {
            const constraints = { 
                video: { 
                    width: { ideal: 1280 }, 
                    height: { ideal: 720 }, 
                    facingMode: "user" 
                } 
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = stream;
            
            // Wait for video to be ready
            this.video.onloadeddata = () => {
                this.isRunning = true;
                this.video.play();
                this.hideError();
                this.loop();
                const btn = document.getElementById('start-camera-btn');
                if (btn) {
                    btn.textContent = '關閉鏡頭';
                    btn.style.background = '#ef4444';
                }
            };
        } catch (err) {
            console.error("Camera Error:", err);
            let msg = '無法啟動鏡頭';
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                msg = '請允許瀏覽器存取鏡頭權限';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                msg = '找不到鏡頭裝置';
            } else {
                msg = `錯誤: ${err.message}`;
            }
            
            this.showError(msg);
            const btn = document.getElementById('start-camera-btn');
            if (btn) {
                btn.textContent = '重試開啟';
                btn.style.background = '#eab308'; // Yellow for retry
                btn.style.display = 'block';
            }
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
        if (this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(track => track.stop());
            this.video.srcObject = null;
        }
    }

    async loop() {
        if (!this.isRunning) return;

        if (this.video.readyState >= 2) {
            const results = await this.handLandmarker.detectForVideo(this.video, performance.now());
            this.processResults(results);
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

            if (this.gestureStableCount > 3) {
                gesture = rawGesture;
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
