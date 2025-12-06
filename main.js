import * as THREE from 'three';
import { SceneManager } from './scene.js';
import { HandTracker } from './hand-tracking.js';
import { UIManager } from './ui.js';
import { SHAPES } from './shapes.js';

window.onerror = function(msg, url, lineNo, columnNo, error) {
    const string = msg.toLowerCase();
    const substring = "script error";
    if (string.indexOf(substring) > -1){
        console.error('Script Error: See Browser Console for Detail');
    } else {
        // Only alert critical errors
        if (msg.includes('import') || msg.includes('Tracker') || msg.includes('Scene')) {
            // console.error(msg); 
        }
    }
    return false;
};

console.log('🚀 立體截面探索器啟動 (模組化版)');

let ui, scene, tracker;

async function main() {
    try {
        ui = new UIManager();
        scene = new SceneManager('canvas-container');
        
        const cameraEl = document.getElementById('camera');
        if (!cameraEl) throw new Error('Camera element not found');
        
        tracker = new HandTracker(cameraEl, onHandUpdate);

        const startBtn = document.getElementById('start-camera-btn');
        if (startBtn) {
            startBtn.style.display = 'block';
            startBtn.onclick = () => { 
                console.log('📸 Camera start button clicked');
                tracker.start().catch(err => {
                    console.error('Start failed:', err);
                    alert('無法啟動鏡頭: ' + err.message);
                });
            };
        }

        scene.init();
        ui.updateTeachingContent(SHAPES['cylinder']);
        
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

        window.setTransformMode = (mode) => {
            scene.setTransformMode(mode);
            const btnTranslate = document.getElementById('mode-translate');
            const btnRotate = document.getElementById('mode-rotate');
            if (btnTranslate) btnTranslate.style.background = mode === 'translate' ? 'rgba(96, 165, 250, 0.3)' : 'transparent';
            if (btnRotate) btnRotate.style.background = mode === 'rotate' ? 'rgba(96, 165, 250, 0.3)' : 'transparent';
        };

        window.manualCut = () => {
            if (!scene || !ui) return;
            if (!scene.isSliced) {
                ui.updateHandStatus(true, '✊ 握拳切割');
                ui.updateGestureUI('fist');
                scene.performCut();
                ui.showCutComplete();
                if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
            }
        };

        window.showHelp = () => {
            alert(`📖 使用說明\n\n1. 選擇左側圖形\n2. 操作模式：\n   - 滑鼠拖曳背景：旋轉視角\n   - 滑鼠控制平面：使用紅綠藍軸移動或旋轉切割面\n   - 手勢控制：張手移動、握拳切割\n3. 觀察物體上下分離與截面形狀`);
        };

        ui.setLoading(false);

        scene.onAnimate = () => {
            if (!scene.isSliced && scene.cuttingPlane && scene.objectMesh) {
                const planeObj = scene.cuttingPlane;
                // The visual plane mesh is rotated -90 deg on X, so its local normal is (0, 1, 0)
                const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(planeObj.quaternion).normalize();
                
                const angle = Math.acos(Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))));
                const angleDeg = Math.round(THREE.MathUtils.radToDeg(angle));
                const angleEl = document.getElementById('cut-angle');
                if (angleEl) angleEl.textContent = `${angleDeg}°`;

                const constant = -normal.dot(planeObj.position);
                const mathPlane = new THREE.Plane(normal, constant);

                const polygon = scene.calculateMeshPlaneIntersection(scene.objectMesh, mathPlane, scene.cuttingPlane);
                
                let data = null;
                if (polygon && polygon.length > 2) {
                    const area = scene.calculatePolygonArea(polygon);
                    const perimeter = scene.calculatePolygonPerimeter(polygon);
                    const size = scene.calculatePolygonSize(polygon);

                    const scale = 40; 
                    const canvasPoints = polygon.map(p => ({
                        x: 166 + p.x * scale,
                        y: 140 - p.y * scale 
                    }));

                    data = {
                        points: canvasPoints,
                        shapeName: getShapeName(scene.currentShapeType, angleDeg),
                        area: area.toFixed(2),
                        perimeter: perimeter.toFixed(2),
                        diameter: size.toFixed(2)
                    };
                } else {
                    data = {
                        points: [],
                        shapeName: '無截面',
                        area: '0.00',
                        perimeter: '0.00',
                        diameter: '0.00'
                    };
                }

                ui.updateSectionData(data);
            }
        };

    } catch (e) {
        console.error('Critical Init Error:', e);
        alert('初始化失敗: ' + e.message);
    }
}

function onHandUpdate(data) {
    if (!ui || !scene) return;

    if (!data.hasHand) {
        ui.updateHandStatus(false, '等待手部偵測...');
        ui.updateGestureUI('none');
        return;
    }

    if (data.gesture === 'open') {
        ui.updateHandStatus(true, '✋ 控制: 移動 & 旋轉');
        ui.updateGestureUI('open');
        
        // Update both Height and Rotation
        // Pass both X and Y to scene
        scene.updateCutPosition(data.x || 0, data.y);
        
        if (typeof data.roll === 'number') {
            // Apply Deadzone: if roll is small (< 5 deg ~ 0.08 rad), treat as 0
            let roll = data.roll;
            if (Math.abs(roll) < 0.08) roll = 0;
            
            // Direct mapping: 90 deg hand -> 90 deg cut
            // Multiply by -1 to match rotation direction (CW hand -> CW cut)
            scene.updateCutRotation(-roll);
        }
        
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

function getShapeName(baseType, angle) {
    if (angle < 5) {
        switch(baseType) {
            case 'cylinder': return '圓形';
            case 'cone': return '圓形';
            case 'sphere': return '圓形';
            case 'cube': return '正方形';
            case 'pyramid': return '正方形';
        }
    }
    if (baseType === 'sphere') return '圓形';
    if (baseType === 'cylinder') return '橢圓形';
    return '多邊形';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
}
