import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SHAPES, getCrossSectionData } from './shapes.js';

export class SceneManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.transformControls = null;
        
        this.objectMesh = null;
        this.cuttingPlane = null;
        this.currentShapeType = 'cylinder';
        
        this.pieceA = null;
        this.pieceB = null;
        this.cutSurfaceUpper = null;
        this.cutSurfaceLower = null;
        
        this.isSliced = false;
        this.currentY = 0;
        this.currentRoll = 0; // Added for smoothing
        this.onAnimate = null;
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x1e3c72, 5, 20);

        this.camera = new THREE.PerspectiveCamera(50, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 6, 9);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.localClippingEnabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 15;

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.controls.enabled = !event.value; 
        });
        this.scene.add(this.transformControls);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.scene.add(mainLight);
        mainLight.position.set(5, 10, 7);
        mainLight.castShadow = true;
        
        const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.4);
        fillLight.position.set(-5, 3, -5);
        this.scene.add(fillLight);

        const gridHelper = new THREE.GridHelper(20, 20, 0x60a5fa, 0x2a5298);
        gridHelper.position.y = -3;
        gridHelper.material.opacity = 0.3;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);

        this.createCuttingPlane();
        this.loadShape('cylinder');

        window.addEventListener('resize', () => this.onWindowResize());
        
        this.animate();
    }

    createCuttingPlane() {
        if (this.cuttingPlane) {
            this.scene.remove(this.cuttingPlane);
            if (this.transformControls) this.transformControls.detach();
        }
        const group = new THREE.Group();
        // Plane
        const geometry = new THREE.PlaneGeometry(7, 7);
        const material = new THREE.MeshStandardMaterial({
            color: 0x60a5fa, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
            emissive: 0x60a5fa, emissiveIntensity: 0.2
        });
        // IMPORTANT: Rotate the mesh, not the group initially, so local Z axis is Up
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2; 
        group.add(mesh);
        
        // Edges
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 3 });
        const line = new THREE.LineSegments(edges, lineMaterial);
        line.rotation.x = -Math.PI / 2;
        group.add(line);
        
        this.scene.add(group);
        this.cuttingPlane = group;
        
        if (this.transformControls) {
            this.transformControls.attach(this.cuttingPlane);
            this.transformControls.setMode('translate');
            this.transformControls.showX = true; 
            this.transformControls.showZ = false;
        }
    }

    setTransformMode(mode) {
        if (!this.transformControls) return;
        if (mode === 'none') {
            this.transformControls.visible = false;
            this.transformControls.enabled = false;
        } else {
            this.transformControls.visible = true;
            this.transformControls.enabled = true;
            this.transformControls.setMode(mode);
            if (mode === 'translate') {
                this.transformControls.showX = true;
                this.transformControls.showZ = false;
                this.transformControls.showY = true;
            } else {
                this.transformControls.showX = true;
                this.transformControls.showZ = true;
                this.transformControls.showY = false; 
            }
        }
    }

    loadShape(shapeType) {
        if (this.isSliced) this.reset();
        this.currentShapeType = shapeType;
        
        if (this.objectMesh) {
            this.scene.remove(this.objectMesh);
            this.objectMesh.geometry.dispose();
            this.objectMesh.material.dispose();
        }

        const shape = SHAPES[shapeType];
        const geometry = shape.geometry();
        const material = new THREE.MeshStandardMaterial({
            color: 0x60a5fa, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide
        });

        this.objectMesh = new THREE.Mesh(geometry, material);
        this.objectMesh.castShadow = true;
        this.objectMesh.receiveShadow = true;
        this.scene.add(this.objectMesh);
    }

    updateCutPosition(x, y) {
        if (this.isSliced) return;
        this.currentY = y;
        if (this.cuttingPlane) {
            this.cuttingPlane.position.y = y;
            this.cuttingPlane.position.x = x;
        }
    }

    updateCutRotation(roll) {
        if (this.isSliced || !this.cuttingPlane) return;
        
        // Increase smoothing (lower factor = more smoothing/lag)
        // Increased to 0.65 for high sensitivity
        const smoothFactor = 0.65; 
        this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, roll, smoothFactor);
        
        this.cuttingPlane.rotation.z = this.currentRoll;
    }

    performCut() {
        if (this.isSliced) return;
        this.isSliced = true;
        
        if (this.objectMesh) this.objectMesh.visible = false;

        const position = this.cuttingPlane.position.clone();
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cuttingPlane.quaternion).normalize();

        this.createCutPieces(position, normal);
    }

    createCutPieces(position, normal) {
        const shape = SHAPES[this.currentShapeType];
        const baseGeometry = shape.geometry();

        // 1. Create Clipping Planes
        const planeA = new THREE.Plane();
        planeA.setFromNormalAndCoplanarPoint(normal, position);
        const planeB = planeA.clone().negate();

        // 2. Setup Piece A (Upper)
        const materialA = new THREE.MeshStandardMaterial({
            color: 0x60a5fa, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide,
            clippingPlanes: [planeA], clipShadows: true
        });
        this.pieceA = new THREE.Mesh(baseGeometry.clone(), materialA);
        this.scene.add(this.pieceA);

        // 3. Setup Piece B (Lower)
        const materialB = new THREE.MeshStandardMaterial({
            color: 0xa78bfa, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide,
            clippingPlanes: [planeB], clipShadows: true
        });
        this.pieceB = new THREE.Mesh(baseGeometry.clone(), materialB);
        this.scene.add(this.pieceB);

        // 4. Create Stencil Caps
        const createStencilLogic = (mesh, plane, color, renderOrderBase) => {
            const group = new THREE.Group();
            this.scene.add(group);

            const matBack = new THREE.MeshBasicMaterial({
                colorWrite: false, depthWrite: false, side: THREE.BackSide,
                clippingPlanes: [plane],
                stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, 
                stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp
            });
            const meshBack = new THREE.Mesh(mesh.geometry.clone(), matBack);
            meshBack.renderOrder = renderOrderBase;
            group.add(meshBack);

            const matFront = new THREE.MeshBasicMaterial({
                colorWrite: false, depthWrite: false, side: THREE.FrontSide,
                clippingPlanes: [plane],
                stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc,
                stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp
            });
            const meshFront = new THREE.Mesh(mesh.geometry.clone(), matFront);
            meshFront.renderOrder = renderOrderBase + 1;
            group.add(meshFront);

            const planeGeom = new THREE.PlaneGeometry(100, 100);
            const matPlane = new THREE.MeshStandardMaterial({
                color: color, side: THREE.DoubleSide, 
                metalness: 0.1, roughness: 0.1,
                clippingPlanes: [plane],
                stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 0,
            });
            const capMesh = new THREE.Mesh(planeGeom, matPlane);
            capMesh.renderOrder = renderOrderBase + 2;
            capMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
            capMesh.position.copy(new THREE.Vector3().copy(plane.normal).multiplyScalar(-plane.constant));
            this.scene.add(capMesh);

            return { group, capMesh, meshBack, meshFront };
        };

        const createStencilClearer = (renderOrder) => {
            const planeGeom = new THREE.PlaneGeometry(100, 100);
            const mat = new THREE.MeshBasicMaterial({
                colorWrite: false, depthWrite: false, depthTest: false,
                stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilOp: THREE.ReplaceStencilOp, stencilRef: 0
            });
            const mesh = new THREE.Mesh(planeGeom, mat);
            mesh.renderOrder = renderOrder;
            this.scene.add(mesh);
            return mesh;
        };

        this.stencilCapA = createStencilLogic(this.pieceA, planeA, 0xfbbf24, 1);
        // Clear stencil after A and before B to prevent B's cap from drawing on A's stencil
        this.stencilClearer = createStencilClearer(5); 
        this.stencilCapB = createStencilLogic(this.pieceB, planeB, 0xfbbf24, 10);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        
        if (this.onAnimate) this.onAnimate();

        if (this.isSliced) {
            const separationSpeed = 0.05;
            const maxSeparation = 1.5;

            if (this.transformControls) this.transformControls.visible = false;
            
            const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cuttingPlane.quaternion).normalize();
            const initialPos = this.cuttingPlane.position;

            if (this.pieceA) {
                this.pieceA.position.y = THREE.MathUtils.lerp(this.pieceA.position.y, maxSeparation, separationSpeed);
                
                const posA = initialPos.clone().add(this.pieceA.position);
                const planeA = this.pieceA.material.clippingPlanes[0];
                if (planeA) planeA.constant = -normal.dot(posA);

                if (this.stencilCapA) {
                    this.stencilCapA.group.position.copy(this.pieceA.position);
                    const coplanarPoint = new THREE.Vector3().copy(normal).multiplyScalar(-planeA.constant);
                    this.stencilCapA.capMesh.position.copy(coplanarPoint);
                }
            }
            
            if (this.pieceB) {
                this.pieceB.position.y = THREE.MathUtils.lerp(this.pieceB.position.y, -maxSeparation, separationSpeed);
                
                const posB = initialPos.clone().add(this.pieceB.position);
                const planeB = this.pieceB.material.clippingPlanes[0];
                if (planeB) planeB.constant = normal.dot(posB);

                if (this.stencilCapB) {
                    this.stencilCapB.group.position.copy(this.pieceB.position);
                    const coplanarPointB = new THREE.Vector3().copy(planeB.normal).multiplyScalar(-planeB.constant);
                    this.stencilCapB.capMesh.position.copy(coplanarPointB);
                }
            }
        } else {
            if (this.cuttingPlane) {
                this.currentY = this.cuttingPlane.position.y;
            }
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    reset() {
        this.isSliced = false;
        this.currentRoll = 0;
        this.currentY = 0;
        
        if (this.pieceA) { this.scene.remove(this.pieceA); this.pieceA = null; }
        if (this.pieceB) { this.scene.remove(this.pieceB); this.pieceB = null; }
        
        // Cleanup Stencil Caps
        if (this.stencilCapA) {
            this.scene.remove(this.stencilCapA.group); // Remove helper group
            this.stencilCapA.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
            this.scene.remove(this.stencilCapA.capMesh);
            this.stencilCapA.capMesh.geometry.dispose();
            this.stencilCapA.capMesh.material.dispose();
            this.stencilCapA = null;
        }
        if (this.stencilCapB) {
            this.scene.remove(this.stencilCapB.group);
            this.stencilCapB.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
            this.scene.remove(this.stencilCapB.capMesh);
            this.stencilCapB.capMesh.geometry.dispose();
            this.stencilCapB.capMesh.material.dispose();
            this.stencilCapB = null;
        }
        
        if (this.objectMesh) {
            this.objectMesh.visible = true;
            this.objectMesh.position.set(0,0,0);
        }
        if (this.cuttingPlane) {
            this.cuttingPlane.visible = true;
            this.cuttingPlane.position.set(0, 0, 0);
            this.cuttingPlane.quaternion.set(0,0,0,1);
            this.cuttingPlane.rotation.z = 0;
        }
        if (this.transformControls) {
            this.transformControls.attach(this.cuttingPlane);
            this.transformControls.visible = true;
            this.transformControls.enabled = true;
        }
    }

    // ========== Geometric Helpers (Intersection Logic for UI Only) ==========
    calculateMeshPlaneIntersection(mesh, plane, planeObj = null) {
        const geometry = mesh.geometry;
        const posAttr = geometry.attributes.position;
        const indexAttr = geometry.index;
        
        mesh.updateMatrixWorld();
        const matrix = mesh.matrixWorld;
        
        const intersections = [];
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const v3 = new THREE.Vector3();
        
        const checkEdge = (va, vb) => {
            const da = plane.distanceToPoint(va);
            const db = plane.distanceToPoint(vb);
            
            if (Math.abs(da) < 1e-5) {
                intersections.push(va.clone());
                return;
            }
    
            if (da * db < 0) {
                const t = da / (da - db);
                const p = new THREE.Vector3().copy(va).lerp(vb, t);
                intersections.push(p);
            }
        };
    
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
            planeObj.updateMatrixWorld(true);
            const mw = planeObj.matrixWorld;
            const te = mw.elements;
    
            origin = new THREE.Vector3().setFromMatrixPosition(mw);
            
            // Column 0 is X axis
            basisX = new THREE.Vector3(te[0], te[1], te[2]).normalize();
            // Column 2 is Z axis
            // IMPORTANT: Use -Z for basisY to match the coordinate system 
            // when we map ShapeGeometry(XY) -> rotateX(-90) -> Local(X, -Z)
            // We want +Y in Shape to map to -Z in Local.
            // So we project world points onto -Z axis to get Y coordinate.
            basisY = new THREE.Vector3(-te[8], -te[9], -te[10]).normalize();
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
            points2D = this.clipPolygonToRect(points2D, -limit, -limit, limit, limit);
        }
    
        return points2D;
    }
    
    clipPolygonToRect(points, minX, minY, maxX, maxY) {
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

    calculatePolygonArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return Math.abs(area / 2);
    }
    
    calculatePolygonPerimeter(points) {
        let perimeter = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            perimeter += Math.sqrt(dx*dx + dy*dy);
        }
        return perimeter;
    }
    
    calculatePolygonSize(points) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for(let p of points) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return Math.max(maxX - minX, maxY - minY);
    }

    reset() {
        this.isSliced = false;
        this.currentRoll = 0;
        this.currentY = 0;
        
        if (this.pieceA) { this.scene.remove(this.pieceA); this.pieceA = null; }
        if (this.pieceB) { this.scene.remove(this.pieceB); this.pieceB = null; }
        if (this.cutSurfaceUpper) { this.scene.remove(this.cutSurfaceUpper); this.cutSurfaceUpper = null; }
        if (this.cutSurfaceLower) { this.scene.remove(this.cutSurfaceLower); this.cutSurfaceLower = null; }
        
        if (this.objectMesh) {
            this.objectMesh.visible = true;
            this.objectMesh.position.set(0,0,0);
        }
        if (this.cuttingPlane) {
            this.cuttingPlane.visible = true;
            this.cuttingPlane.position.set(0, 0, 0);
            this.cuttingPlane.quaternion.set(0,0,0,1);
            this.cuttingPlane.rotation.z = 0;
        }
        if (this.transformControls) {
            this.transformControls.attach(this.cuttingPlane);
            this.transformControls.visible = true;
            this.transformControls.enabled = true;
        }
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        
        if (this.onAnimate) this.onAnimate();

        if (this.isSliced) {
            const separationSpeed = 0.05;
            const maxSeparation = 1.5;

            if (this.transformControls) this.transformControls.visible = false;
            
            // Recalculate normal and initial position from the frozen cutting plane
            const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cuttingPlane.quaternion).normalize();
            const initialPos = this.cuttingPlane.position;

            if (this.pieceA) {
                this.pieceA.position.y = THREE.MathUtils.lerp(this.pieceA.position.y, maxSeparation, separationSpeed);
                
                // Update Clipping Plane Constant
                const posA = initialPos.clone().add(this.pieceA.position);
                const planeA = this.pieceA.material.clippingPlanes[0];
                if (planeA) planeA.constant = -normal.dot(posA);
                
                // Update Stencil Meshes Position
                if (this.stencilCapA) {
                    this.stencilCapA.group.position.copy(this.pieceA.position);
                    this.stencilCapA.group.quaternion.copy(this.pieceA.quaternion);
                    
                    // Cap Plane must match the clipping plane exactly
                    const coplanarPoint = new THREE.Vector3().copy(normal).multiplyScalar(-planeA.constant);
                    this.stencilCapA.capMesh.position.copy(coplanarPoint);
                    this.stencilCapA.capMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
                }
            }
            
            if (this.pieceB) {
                this.pieceB.position.y = THREE.MathUtils.lerp(this.pieceB.position.y, -maxSeparation, separationSpeed);
                
                // Update Clipping Plane Constant
                const posB = initialPos.clone().add(this.pieceB.position);
                const planeB = this.pieceB.material.clippingPlanes[0];
                if (planeB) planeB.constant = normal.dot(posB);
                
                // Update Stencil Meshes Position
                if (this.stencilCapB) {
                    this.stencilCapB.group.position.copy(this.pieceB.position);
                    this.stencilCapB.group.quaternion.copy(this.pieceB.quaternion);
                    
                    const coplanarPointB = new THREE.Vector3().copy(planeB.normal).multiplyScalar(-planeB.constant);
                    this.stencilCapB.capMesh.position.copy(coplanarPointB);
                    // For Plane B, normal is inverted relative to A, but capMesh normal (0,0,1) should face camera or follow planeB normal.
                    // planeB.normal is correct.
                    this.stencilCapB.capMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), planeB.normal);
                }
            }
        } else {
            if (this.cuttingPlane) {
                this.currentY = this.cuttingPlane.position.y;
            }
        }

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}
