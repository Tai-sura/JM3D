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
                // The visual plane mesh is rotated -90 deg on X, so its local normal is (0, 1, 0)
                const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(planeObj.quaternion).normalize();
                
                const angle = Math.acos(Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))));
                const angleDeg = Math.round(THREE.MathUtils.radToDeg(angle));
                const angleEl = document.getElementById('cut-angle');
                if (angleEl) angleEl.textContent = `${angleDeg}°`;

                const constant = -normal.dot(planeObj.position);
                const mathPlane = new THREE.Plane(normal, constant);

                const polygon = calculateMeshPlaneIntersection(scene.objectMesh, mathPlane, scene.cuttingPlane);
                
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

// ========== Geometric Helpers ==========
function calculateMeshPlaneIntersection(mesh, plane, planeObj = null) {
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
        
        // Check if point A is exactly on plane
        if (Math.abs(da) < 1e-5) {
            intersections.push(va.clone());
            return;
        }

        // Check intersection
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

    let basisX, basisY, origin;

    if (planeObj) {
        // Use planeObj's local system for accurate clipping
        origin = planeObj.position;
        const q = planeObj.quaternion;
        
        // Visual plane is defined as XZ plane in the group local space
        // (PlaneGeometry is XY, rotated -90 on X -> XZ)
        basisX = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
        basisY = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    } else {
        // Fallback to robust arbitrary basis
        const n = plane.normal;
        if (Math.abs(n.y) > 0.99) {
            basisX = new THREE.Vector3(1, 0, 0); 
        } else {
            basisX = new THREE.Vector3(0, 1, 0).cross(n).normalize();
        }
        basisY = new THREE.Vector3().crossVectors(n, basisX).normalize();
        basisX.crossVectors(basisY, n).normalize(); // Re-orthogonalize
        
        // Calculate centroid for origin
        origin = new THREE.Vector3();
        for (let p of unique) origin.add(p);
        origin.divideScalar(unique.length);
    }

    // Project points to 2D
    let points2D = unique.map(p => {
        const diff = new THREE.Vector3().subVectors(p, origin);
        return {
            x: diff.dot(basisX),
            y: diff.dot(basisY)
        };
    });

    // Calculate 2D centroid for sorting
    const center = { x: 0, y: 0 };
    for (let p of points2D) { center.x += p.x; center.y += p.y; }
    center.x /= points2D.length;
    center.y /= points2D.length;

    // Sort angularly around centroid
    points2D.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    
    // Clip polygon if plane object is provided (visual bounds)
    if (planeObj) {
        // The plane geometry is 7x7, so bounds are +/- 3.5
        const limit = 3.5;
        points2D = clipPolygonToRect(points2D, -limit, -limit, limit, limit);
    }

    return points2D;
}

function clipPolygonToRect(points, minX, minY, maxX, maxY) {
    if (!points || points.length < 3) return points;

    let outputList = points;

    const clipEdge = (inputList, isInside, intersection) => {
        const output = [];
        if (inputList.length === 0) return output;

        let s = inputList[inputList.length - 1];
        for (const e of inputList) {
            if (isInside(e)) {
                if (!isInside(s)) {
                    output.push(intersection(s, e));
                }
                output.push(e);
            } else if (isInside(s)) {
                output.push(intersection(s, e));
            }
            s = e;
        }
        return output;
    };

    // Left
    outputList = clipEdge(outputList, p => p.x >= minX, (p1, p2) => ({ 
        x: minX, y: p1.y + (p2.y - p1.y) * (minX - p1.x) / (p2.x - p1.x) 
    }));
    // Right
    outputList = clipEdge(outputList, p => p.x <= maxX, (p1, p2) => ({ 
        x: maxX, y: p1.y + (p2.y - p1.y) * (maxX - p1.x) / (p2.x - p1.x) 
    }));
    // Bottom
    outputList = clipEdge(outputList, p => p.y >= minY, (p1, p2) => ({ 
        x: p1.x + (p2.x - p1.x) * (minY - p1.y) / (p2.y - p1.y), y: minY 
    }));
    // Top
    outputList = clipEdge(outputList, p => p.y <= maxY, (p1, p2) => ({ 
        x: p1.x + (p2.x - p1.x) * (maxY - p1.y) / (p2.y - p1.y), y: maxY 
    }));

    return outputList;
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
