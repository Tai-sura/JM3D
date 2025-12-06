import { SceneManager } from './scene.js';
import { HandTracker } from './hand-tracking.js';
import { UIManager } from './ui.js';
import { SHAPES, getCrossSectionData } from './shapes.js';

console.log('🚀 立體截面探索器啟動 (模組化版)');

const ui = new UIManager();
const scene = new SceneManager('canvas-container');
const tracker = new HandTracker(document.getElementById('camera'), onHandUpdate);

async function init() {
    scene.init();
    ui.updateTeachingContent(SHAPES['cylinder']);
    
    // Expose global functions for HTML onclick handlers
    window.selectShape = (type) => {
        scene.loadShape(type);
        ui.setActiveShapeCard(type);
        ui.updateTeachingContent(SHAPES[type]);
        if (scene.isSliced) {
            scene.reset();
            ui.reset();
        }
    };

    window.resetScene = () => {
        scene.reset();
        ui.reset();
    };

    window.showHelp = () => {
        alert(`📖 使用說明\n\n1. 選擇左側圖形\n2. 張開手掌：上下移動控制切割線\n3. 握緊拳頭：執行切割\n4. 觀察物體上下分離與截面形狀`);
    };

    try {
        await tracker.start();
        ui.setLoading(false);
    } catch (e) {
        console.error(e);
        ui.setLoading(false); // Still hide loading so user sees UI (maybe allow manual control?)
        alert('無法啟動攝像頭，請檢查權限。');
    }
}

function onHandUpdate(data) {
    if (!data.hasHand) {
        ui.updateHandStatus(false, '等待手部偵測...');
        ui.updateGestureUI('none');
        return;
    }

    if (data.gesture === 'open') {
        ui.updateHandStatus(true, '✋ 正在控制高度');
        ui.updateGestureUI('open');
        scene.updateCutHeight(data.y);
        ui.updateCutInfo(data.y);
    } else if (data.gesture === 'fist') {
        ui.updateHandStatus(true, '✊ 握拳切割');
        ui.updateGestureUI('fist');
        if (!scene.isSliced) {
            scene.performCut();
            ui.showCutComplete();
            if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
        }
    } else {
        ui.updateHandStatus(true, '手部已偵測');
        ui.updateGestureUI('none');
    }
}

scene.onAnimate = () => {
    if (!scene.isSliced) {
        const data = getCrossSectionData(scene.currentShapeType, scene.currentY);
        ui.updateSectionData(data);
    }
};

init();

