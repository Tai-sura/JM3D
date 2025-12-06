export class UIManager {
    constructor() {
        this.sectionCanvas = document.getElementById('section-canvas');
        this.sectionCtx = this.sectionCanvas.getContext('2d');
        // Set internal resolution to match the coordinate system used in shapes.js
        this.sectionCanvas.width = 332; 
        this.sectionCanvas.height = 280;
        
        this.loadingEl = document.getElementById('loading');
        this.cutCompleteEl = document.getElementById('cut-complete');
        this.handStatusEl = document.getElementById('hand-status');
        this.statusTextEl = document.getElementById('status-text');
        
        this.els = {
            cutPosition: document.getElementById('cut-position'),
            cutAngle: document.getElementById('cut-angle'),
            cutSize: document.getElementById('cut-size'),
            sectionShape: document.getElementById('section-shape'),
            sectionArea: document.getElementById('section-area'),
            sectionPerimeter: document.getElementById('section-perimeter'),
            sectionDiameter: document.getElementById('section-diameter'),
            teachingContent: document.getElementById('teaching-content'),
            resetBtn: document.getElementById('reset-btn'),
            floatingHint: document.getElementById('floating-hint')
        };
    }

    setLoading(visible) {
        this.loadingEl.style.display = visible ? 'flex' : 'none';
        document.getElementById('app').style.display = visible ? 'none' : 'grid';
    }

    updateHandStatus(active, text) {
        if (active) this.handStatusEl.classList.add('active');
        else this.handStatusEl.classList.remove('active');
        this.statusTextEl.textContent = text;
    }

    updateGestureUI(gesture) {
        document.querySelectorAll('.gesture-item').forEach(item => item.classList.remove('active'));
        if (gesture === 'open') document.getElementById('gesture-open').classList.add('active');
        else if (gesture === 'fist') document.getElementById('gesture-fist').classList.add('active');
    }

    updateCutInfo(yPos) {
        // yPos is -2 to 2 approx
        const normalizedPos = (yPos + 2) / 4;
        const percentage = Math.round(Math.max(0, Math.min(1, normalizedPos)) * 100);
        this.els.cutPosition.textContent = `${percentage}%`;
    }

    updateSectionData(data) {
        if (!data) return;
        this.els.sectionShape.textContent = data.shapeName;
        this.els.sectionArea.textContent = data.area;
        this.els.sectionPerimeter.textContent = data.perimeter;
        this.els.sectionDiameter.textContent = data.diameter;
        this.els.cutSize.textContent = data.diameter;
        
        this.renderCrossSection2D(data.points);
    }

    renderCrossSection2D(points) {
        const ctx = this.sectionCtx;
        const w = this.sectionCanvas.width;
        const h = this.sectionCanvas.height;

        ctx.clearRect(0, 0, w, h);
        
        // Background Gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(30, 60, 114, 0.3)');
        gradient.addColorStop(1, 'rgba(42, 82, 152, 0.3)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);

        if (!points || points.length < 3) return;

        ctx.save();
        ctx.shadowColor = 'rgba(96, 165, 250, 0.5)';
        ctx.shadowBlur = 20;
        
        // Fill Gradient
        const fillGradient = ctx.createRadialGradient(166, 140, 0, 166, 140, 100);
        fillGradient.addColorStop(0, 'rgba(96, 165, 250, 0.8)');
        fillGradient.addColorStop(1, 'rgba(167, 139, 250, 0.6)');
        ctx.fillStyle = fillGradient;
        
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }

    showCutComplete() {
        this.cutCompleteEl.classList.add('show');
        setTimeout(() => this.cutCompleteEl.classList.remove('show'), 2000);
        this.els.resetBtn.style.display = 'flex';
        this.els.floatingHint.innerHTML = `<span class="hint-icon">✂️</span><span>切割完成! 觀察截面</span>`;
    }

    reset() {
        this.els.resetBtn.style.display = 'none';
        this.els.floatingHint.innerHTML = `<span class="hint-icon">✋</span><span>張開手掌開始控制</span>`;
        this.updateGestureUI('none');
    }

    updateTeachingContent(shape) {
        this.els.teachingContent.innerHTML = `
            <p><strong>${shape.name}</strong></p>
            <p>${shape.teaching}</p>
            <ul>
                <li>張開手掌上下移動</li>
                <li>握拳切割分離</li>
            </ul>
        `;
    }

    setActiveShapeCard(type) {
        document.querySelectorAll('.shape-card').forEach(card => card.classList.remove('active'));
        const card = document.querySelector(`.shape-card[data-shape="${type}"]`);
        if (card) card.classList.add('active');
    }
}

