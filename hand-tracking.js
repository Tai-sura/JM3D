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
        
        // DEBUG: Create overlay
        this.createDebugOverlay();
    }

    createDebugOverlay() {
        this.debugEl = document.createElement('div');
        Object.assign(this.debugEl.style, {
            position: 'fixed', top: '10px', left: '10px',
            background: 'rgba(0,0,0,0.8)', color: '#0f0',
            fontSize: '12px', fontFamily: 'monospace',
            padding: '8px', zIndex: '99999', pointerEvents: 'none'
        });
        document.body.appendChild(this.debugEl);
    }

    updateDebugInfo(msg) {
        if (this.debugEl) {
            const v = this.video;
            let trackInfo = 'No Stream';
            if (v.srcObject && v.srcObject.getVideoTracks().length > 0) {
                const track = v.srcObject.getVideoTracks()[0];
                trackInfo = `Track: ${track.label} | Enabled: ${track.enabled} | Muted: ${track.muted} | State: ${track.readyState}`;
            }

            const info = `
                [DEBUG MODE]<br>
                Status: ${msg}<br>
                Video: ${v.videoWidth}x${v.videoHeight}<br>
                ReadyState: ${v.readyState}<br>
                Stream: ${trackInfo}<br>
                Error: ${v.error ? v.error.code + '-' + v.error.message : 'None'}
            `;
            this.debugEl.innerHTML = info;
        }
    }

    async initLandmarker() {
        // Skip AI for now to isolate camera issue
        // this.updateDebugInfo('Skipping AI for camera test');
        // return true; 
        
        // Actually, let's load it but not run detect loop immediately
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
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    async start() {
        if (this.isRunning) {
            // Reload page to stop cleanly
            window.location.reload(); 
            return;
        }

        const btn = document.getElementById('start-camera-btn');
        if (btn) btn.style.display = 'none'; // Hide button to prevent double click

        if (window.location.protocol === 'file:') {
            alert('Local file access blocked.'); return;
        }
        
        try {
            this.updateDebugInfo('Getting UserMedia...');
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 1280, height: 720 } 
            });
            
            // NUCLEAR OPTION: Re-create video element in root body
            // This bypasses ANY CSS issues in the original container
            const oldVideo = this.video;
            const newVideo = document.createElement('video');
            newVideo.autoplay = true;
            newVideo.playsInline = true;
            newVideo.muted = true;
            Object.assign(newVideo.style, {
                position: 'fixed', bottom: '20px', left: '20px',
                width: '320px', height: '240px',
                border: '4px solid red', zIndex: '99999',
                background: 'black', objectFit: 'cover'
            });
            document.body.appendChild(newVideo);
            this.video = newVideo; // Swap reference
            oldVideo.style.display = 'none'; // Hide old one

            this.video.srcObject = stream;
            
            this.updateDebugInfo('Waiting for play...');
            await this.video.play();
            this.updateDebugInfo('Playing!');

            this.isRunning = true;
            
            // Update debug loop
            setInterval(() => {
                this.updateDebugInfo('Running');
            }, 500);

            // Init AI in background
            if (!this.handLandmarker) {
                this.initLandmarker().then(() => {
                    console.log('AI Loaded');
                    this.loop(); // Start detecting only after AI loads
                });
            }

        } catch (err) {
            console.error(err);
            this.updateDebugInfo('Error: ' + err.message);
            alert('Camera Error: ' + err.message);
        }
    }

    async loop() {
        if (!this.isRunning || !this.handLandmarker) return;

        if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
            try {
                const results = await this.handLandmarker.detectForVideo(this.video, performance.now());
                this.processResults(results);
            } catch (e) {
                console.error(e);
            }
        }
        requestAnimationFrame(() => this.loop());
    }

    processResults(results) {
        let gesture = 'none';
        if (results.landmarks && results.landmarks.length > 0) {
            const hand = results.landmarks[0];
            const rawGesture = this.detectGesture(hand);
            if (rawGesture === this.lastGesture) this.gestureStableCount++;
            else {
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
        const fingerIndices = [{ tip: 8, pip: 6 }, { tip: 12, pip: 10 }, { tip: 16, pip: 14 }, { tip: 20, pip: 18 }];
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
