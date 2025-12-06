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
        // Was 0.05, increased to 0.2 for better sensitivity
        const smoothFactor = 0.2; 
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
        const geometry = shape.geometry();

        const planeA = new THREE.Plane();
        planeA.setFromNormalAndCoplanarPoint(normal, position);
        const materialA = new THREE.MeshStandardMaterial({
            color: 0x60a5fa, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide,
            clippingPlanes: [planeA], clipShadows: true
        });
        this.pieceA = new THREE.Mesh(geometry.clone(), materialA);
        this.scene.add(this.pieceA);

        const planeB = planeA.clone().negate();
        const materialB = new THREE.MeshStandardMaterial({
            color: 0xa78bfa, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide,
            clippingPlanes: [planeB], clipShadows: true
        });
        this.pieceB = new THREE.Mesh(geometry.clone(), materialB);
        this.scene.add(this.pieceB);

        // Generate Caps for ANY angle using the intersection logic
        const mathPlane = new THREE.Plane(normal, -normal.dot(position));
        const polygon = this.calculateMeshPlaneIntersection(this.objectMesh, mathPlane, this.cuttingPlane);

        if (polygon && polygon.length >= 3) {
            const shape2D = new THREE.Shape();
            shape2D.moveTo(polygon[0].x, polygon[0].y);
            for (let i = 1; i < polygon.length; i++) {
                shape2D.lineTo(polygon[i].x, polygon[i].y);
            }
            
            const capGeometry = new THREE.ShapeGeometry(shape2D);
            
            // ShapeGeometry is created on XY plane.
            // Our 2D points are in the Local Plane Basis (X, Z of the group).
            // We need to align this geometry to the cutting plane.
            
            const capMaterial = new THREE.MeshStandardMaterial({
                color: 0xfbbf24, side: THREE.DoubleSide, emissive: 0xfbbf24, emissiveIntensity: 0.4
            });

            // Create meshes
            this.cutSurfaceUpper = new THREE.Mesh(capGeometry, capMaterial);
            this.cutSurfaceLower = new THREE.Mesh(capGeometry.clone(), capMaterial);

            // Align caps to the cutting plane
            // 1. Move to plane position
            this.cutSurfaceUpper.position.copy(position);
            this.cutSurfaceLower.position.copy(position);
            
            // 2. Rotate to match plane orientation
            this.cutSurfaceUpper.quaternion.copy(this.cuttingPlane.quaternion);
            this.cutSurfaceLower.quaternion.copy(this.cuttingPlane.quaternion);

            // 3. Rotate -90 around X to map XY geometry to XZ plane (which is the visual plane's basis)
            this.cutSurfaceUpper.rotateX(-Math.PI / 2);
            this.cutSurfaceLower.rotateX(-Math.PI / 2);
            
            // 4. Offset slightly along normal to prevent z-fighting
            // Normal is local Y (0,1,0) after rotation? 
            // No, normal in world space is 'normal'.
            // In local space of the rotated mesh, the normal is Y.
            
            // We can just translate along the World Normal.
            this.cutSurfaceUpper.translateOnAxis(new THREE.Vector3(0, 0, 1), 0.01); // Local Z is World Y (Normal) after rotateX(-90)?
            // Wait, rotateX(-90): Y -> Z, Z -> -Y. 
            // Original Normal is Z (0,0,1) for ShapeGeometry? 
            // ShapeGeometry is in XY plane, normal is Z (0,0,1).
            // After rotateX(-90), normal becomes Y (0,1,0).
            // This matches the plane group's local Y, which is the cut normal.
            // So translateZ(0.01) on the original geometry moves it along Y in local space?
            
            // Simplest: Just move in world space along 'normal'.
            // Reset positions first to be safe, then apply offsets.
            // Actually, since they are children of Scene, we operate in World Space.
            // They have the quaternion of the cuttingPlane.
            // The cuttingPlane's "up" is determined by its rotation.
            // Let's try translating in World Space.
            
            this.cutSurfaceUpper.position.addScaledVector(normal, -0.01);
            this.cutSurfaceLower.position.addScaledVector(normal, 0.01);

            this.scene.add(this.cutSurfaceUpper);
            this.scene.add(this.cutSurfaceLower);
        }
    }

    // ========== Geometric Helpers ==========
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
            // Force update to ensure matrix is fresh
            planeObj.updateMatrixWorld(true);
            const mw = planeObj.matrixWorld;
            const te = mw.elements;
    
            // Use planeObj's local system for accurate clipping
            origin = new THREE.Vector3().setFromMatrixPosition(mw);
            
            // Extract basis vectors directly from matrix columns
            // Column 0 (X) and Column 2 (Z) corresponds to the plane size 7x7 axes
            // (Visual plane is rotated X -90 inside the group, effectively lying on Group XZ plane)
            basisX = new THREE.Vector3(te[0], te[1], te[2]).normalize();
            basisY = new THREE.Vector3(te[8], te[9], te[10]).normalize();
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

            if (this.pieceA) {
                this.pieceA.position.y = THREE.MathUtils.lerp(this.pieceA.position.y, maxSeparation, separationSpeed);
                if (this.cutSurfaceUpper) this.cutSurfaceUpper.position.y = this.cuttingPlane.position.y + this.pieceA.position.y;
            }
            if (this.pieceB) {
                this.pieceB.position.y = THREE.MathUtils.lerp(this.pieceB.position.y, -maxSeparation, separationSpeed);
                if (this.cutSurfaceLower) this.cutSurfaceLower.position.y = this.cuttingPlane.position.y + this.pieceB.position.y;
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
