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
        this.onUpdate = onUpdate; // Callback(gesture, smoothedY)
        this.handLandmarker = null;
        this.isRunning = false;
        this.lastGesture = 'none';
        this.gestureStableCount = 0;
        
        // Smoothing for Y position
        this.smoothedY = new LerpValue(0, 0.15); // 0.15 speed for responsiveness/smoothness balance
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
        if (!this.handLandmarker) await this.init();
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: {ideal: 1280}, height: {ideal: 720}, facingMode: "user" } 
            });
            this.video.srcObject = stream;
            this.video.addEventListener('loadeddata', () => {
                this.isRunning = true;
                this.loop();
            });
        } catch (err) {
            console.error("Camera Error:", err);
            throw err;
        }
    }

    stop() {
        this.isRunning = false;
        if (this.video.srcObject) {
            this.video.srcObject.getTracks().forEach(track => track.stop());
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
        let targetY = null; // Normalized -1 to 1 or similar logic

        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];
            const rawGesture = this.detectGesture(hand);

            // Debounce gesture
            if (rawGesture === this.lastGesture) {
                this.gestureStableCount++;
            } else {
                this.gestureStableCount = 0;
                this.lastGesture = rawGesture;
            }

            if (this.gestureStableCount > 3) {
                gesture = rawGesture;
            }

            // Calculate Position (Y)
            if (gesture === 'open') {
                const p0 = hand[0];
                const p9 = hand[9];
                const cy = (p0.y + p9.y) / 2;
                // Original logic: let targetY = (0.5 - cy) * 8; clamp(-2, 2)
                // We pass the raw target to the smoother
                const rawTargetY = (0.5 - cy) * 8;
                const clampedTargetY = Math.max(-2, Math.min(2, rawTargetY));
                this.smoothedY.update(clampedTargetY);
            }
        } else {
            gesture = 'none';
        }

        // Step the smoother every frame regardless of detection to drift gently or stay put
        // If no detection, maybe we don't update target, just stay
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

