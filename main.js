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

        window.showHelp = () => {
            alert(`📖 使用說明\n\n1. 選擇左側圖形\n2. 操作模式：\n   - 滑鼠拖曳背景：旋轉視角\n   - 滑鼠控制平面：使用紅綠藍軸移動或旋轉切割面\n   - 手勢控制：張手移動、握拳切割\n3. 觀察物體上下分離與截面形狀`);
        };

        ui.setLoading(false);

        scene.onAnimate = () => {
            if (!scene.isSliced && scene.cuttingPlane && scene.objectMesh) {
                const planeObj = scene.cuttingPlane;
                const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(planeObj.quaternion).normalize();
                
                const angle = Math.acos(Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))));
                const angleDeg = Math.round(THREE.MathUtils.radToDeg(angle));
                const angleEl = document.getElementById('cut-angle');
                if (angleEl) angleEl.textContent = `${angleDeg}°`;

                const constant = -normal.dot(planeObj.position);
                const mathPlane = new THREE.Plane(normal, constant);

                const polygon = calculateMeshPlaneIntersection(scene.objectMesh, mathPlane);
                
                let data = null;
                if (polygon && polygon.length > 2) {
                    const area = calculatePolygonArea(polygon);
                    const perimeter = calculatePolygonPerimeter(polygon);
                    const size = calculatePolygonSize(polygon);

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
        scene.updateCutHeight(data.y);
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

// ========== Geometric Helpers ==========
function calculateMeshPlaneIntersection(mesh, plane) {
    const geometry = mesh.geometry;
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;
    
    mesh.updateMatrixWorld();
    const matrix = mesh.matrixWorld;
    
    const intersections = [];
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const v3 = new THREE.Vector3();
    
    function checkEdge(va, vb) {
        const da = plane.distanceToPoint(va);
        const db = plane.distanceToPoint(vb);
        if (da * db < 0) {
            const t = da / (da - db);
            const p = new THREE.Vector3().copy(va).lerp(vb, t);
            intersections.push(p);
        }
    }

    if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
            v1.fromBufferAttribute(posAttr, indexAttr.getX(i)).applyMatrix4(matrix);
            v2.fromBufferAttribute(posAttr, indexAttr.getX(i+1)).applyMatrix4(matrix);
            v3.fromBufferAttribute(posAttr, indexAttr.getX(i+2)).applyMatrix4(matrix);
            checkEdge(v1, v2); checkEdge(v2, v3); checkEdge(v3, v1);
        }
    } else {
        for (let i = 0; i < posAttr.count; i += 3) {
            v1.fromBufferAttribute(posAttr, i).applyMatrix4(matrix);
            v2.fromBufferAttribute(posAttr, i+1).applyMatrix4(matrix);
            v3.fromBufferAttribute(posAttr, i+2).applyMatrix4(matrix);
            checkEdge(v1, v2); checkEdge(v2, v3); checkEdge(v3, v1);
        }
    }

    if (intersections.length < 3) return null;

    const unique = [];
    for (let p of intersections) {
        let isDup = false;
        for (let u of unique) {
            if (p.distanceToSquared(u) < 0.0001) { isDup = true; break; }
        }
        if (!isDup) unique.push(p);
    }

    if (unique.length < 3) return null;

    const n = plane.normal;
    const basisX = new THREE.Vector3();
    if (Math.abs(n.y) > 0.9) basisX.set(1, 0, 0); else basisX.set(0, 1, 0);
    const basisY = new THREE.Vector3().crossVectors(n, basisX).normalize();
    basisX.crossVectors(basisY, n).normalize();

    const centroid = new THREE.Vector3();
    for (let p of unique) centroid.add(p);
    centroid.divideScalar(unique.length);

    const points2D = unique.map(p => {
        const diff = new THREE.Vector3().subVectors(p, centroid);
        return {
            x: diff.dot(basisX),
            y: diff.dot(basisY)
        };
    });

    points2D.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    
    return points2D;
}

function calculatePolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
}

function calculatePolygonPerimeter(points) {
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        perimeter += Math.sqrt(dx*dx + dy*dy);
    }
    return perimeter;
}

function calculatePolygonSize(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for(let p of points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return Math.max(maxX - minX, maxY - minY);
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
