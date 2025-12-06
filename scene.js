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
            this.transformControls.showX = false; 
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
                this.transformControls.showX = false;
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

    updateCutHeight(y) {
        if (this.isSliced) return;
        this.currentY = y;
        if (this.cuttingPlane) {
            this.cuttingPlane.position.y = y;
        }
    }

    updateCutRotation(roll) {
        if (this.isSliced || !this.cuttingPlane) return;
        
        // Smooth interpolation for rotation
        const smoothFactor = 0.1; 
        this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, roll, smoothFactor);
        
        // Apply rotation to the Z axis of the group
        // Since the plane is horizontal, rotating around Z (world) or Y (local?)
        // Our plane group is at (0,y,0). 
        // Rolling the hand means rotating around the depth axis (Z) from the camera's perspective.
        this.cuttingPlane.rotation.z = this.currentRoll;
        // Also clamp X rotation if needed, but for now just Z (Roll) is enough for 2D tilting
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

        const isHorizontal = Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))) > 0.99;

        if (isHorizontal) {
            const sectionData = getCrossSectionData(this.currentShapeType, position.y);
            if (sectionData && sectionData.points.length >= 3) {
                const shape2D = new THREE.Shape();
                const points = sectionData.points;
                
                const cx = 166;
                const cy = 140;
                const magicScale = 0.015 * (sectionData.actualSize / 100);

                shape2D.moveTo((points[0].x - cx) * magicScale, (points[0].y - cy) * magicScale);
                for (let i = 1; i < points.length; i++) {
                    shape2D.lineTo((points[i].x - cx) * magicScale, (points[i].y - cy) * magicScale);
                }

                const capGeometry = new THREE.ShapeGeometry(shape2D);
                capGeometry.rotateX(-Math.PI / 2);
                
                const capMaterial = new THREE.MeshStandardMaterial({
                    color: 0xfbbf24, side: THREE.DoubleSide, emissive: 0xfbbf24, emissiveIntensity: 0.4
                });

                this.cutSurfaceUpper = new THREE.Mesh(capGeometry, capMaterial);
                this.cutSurfaceUpper.position.copy(position);
                this.cutSurfaceUpper.position.y -= 0.01;
                this.scene.add(this.cutSurfaceUpper);

                this.cutSurfaceLower = new THREE.Mesh(capGeometry.clone(), capMaterial);
                this.cutSurfaceLower.position.copy(position);
                this.cutSurfaceLower.position.y += 0.01;
                this.scene.add(this.cutSurfaceLower);
            }
        }
    }

    reset() {
        this.isSliced = false;
        this.currentRoll = 0;
        
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
        this.currentY = 0;
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
