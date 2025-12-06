import * as THREE from 'three';

export const SHAPES = {
    cylinder: {
        name: '圓柱體',
        geometry: () => new THREE.CylinderGeometry(1.5, 1.5, 4, 32),
        height: 4, 
        radius: 1.5,
        teaching: '圓柱體的水平截面都是圓形，且大小相同。',
        calculateSection: (yPos, shape) => {
            const normalizedPos = (yPos + shape.height / 2) / shape.height;
            if (normalizedPos >= 0 && normalizedPos <= 1) {
                return {
                    points: createCircle(166, 140, 90),
                    shapeName: '圓形',
                    actualSize: shape.radius * 2,
                    area: Math.PI * shape.radius * shape.radius,
                    perimeter: 2 * Math.PI * shape.radius
                };
            }
            return null;
        }
    },
    cone: {
        name: '圓錐體',
        geometry: () => new THREE.ConeGeometry(1.8, 4, 32),
        height: 4, 
        radius: 1.8,
        teaching: '圓錐體從頂部到底部，截面圓形會逐漸變大。',
        calculateSection: (yPos, shape) => {
            const normalizedPos = (yPos + shape.height / 2) / shape.height;
            if (normalizedPos >= 0 && normalizedPos <= 1) {
                const ratio = 1 - normalizedPos;
                const radius = shape.radius * ratio;
                return {
                    points: createCircle(166, 140, 90 * ratio),
                    shapeName: radius < 0.1 ? '點' : '圓形',
                    actualSize: radius * 2,
                    area: Math.PI * radius * radius,
                    perimeter: 2 * Math.PI * radius
                };
            }
            return null;
        }
    },
    sphere: {
        name: '球體',
        geometry: () => new THREE.SphereGeometry(1.8, 32, 32),
        height: 3.6, 
        radius: 1.8,
        teaching: '球體的截面都是圓形，越靠近中心越大。',
        calculateSection: (yPos, shape) => {
            if (Math.abs(yPos) <= shape.radius) {
                const radius = Math.sqrt(shape.radius * shape.radius - yPos * yPos);
                return {
                    points: createCircle(166, 140, 90 * (radius / shape.radius)),
                    shapeName: '圓形',
                    actualSize: radius * 2,
                    area: Math.PI * radius * radius,
                    perimeter: 2 * Math.PI * radius
                };
            }
            return null;
        }
    },
    cube: {
        name: '立方體',
        geometry: () => new THREE.BoxGeometry(3, 3, 3),
        height: 3, 
        radius: 1.5, // half side
        teaching: '立方體的水平截面都是大小相同的正方形。',
        calculateSection: (yPos, shape) => {
            const normalizedPos = (yPos + shape.height / 2) / shape.height;
            if (normalizedPos >= 0 && normalizedPos <= 1) {
                return {
                    points: createSquare(166, 140, 80),
                    shapeName: '正方形',
                    actualSize: shape.height,
                    area: shape.height * shape.height,
                    perimeter: 4 * shape.height
                };
            }
            return null;
        }
    },
    pyramid: {
        name: '四角錐',
        geometry: () => new THREE.ConeGeometry(2.5, 4, 4),
        height: 4, 
        radius: 2.5,
        teaching: '四角錐的水平截面是正方形，越往下越大。',
        calculateSection: (yPos, shape) => {
            const normalizedPos = (yPos + shape.height / 2) / shape.height;
            if (normalizedPos >= 0 && normalizedPos <= 1) {
                const ratio = 1 - normalizedPos;
                const sideLength = shape.radius * 2 * ratio; // radius here is approx half side at base for ConeGeometry(r, h, 4) rotated 45deg? 
                // Actually ConeGeometry with 4 segments is a pyramid. radius is the circumradius of the base square.
                // Side length of inscribed square in circle radius r: side = r * sqrt(2).
                // But let's stick to previous logic which seemed to approximate visuals.
                // Previous logic: actualSize = sideLength.
                return {
                    points: createSquare(166, 140, 80 * ratio),
                    shapeName: sideLength < 0.1 ? '點' : '正方形',
                    actualSize: sideLength,
                    area: sideLength * sideLength,
                    perimeter: 4 * sideLength
                };
            }
            return null;
        }
    }
};

function createCircle(cx, cy, radius) {
    const points = [];
    for (let i = 0; i < 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
    return points;
}

function createSquare(cx, cy, size) {
    // size is half-width in previous logic context?
    // Previous: createSquare(166, 140, 80). 
    // [{x: cx-size...}] means size is half-width.
    return [
        { x: cx - size, y: cy - size }, 
        { x: cx + size, y: cy - size }, 
        { x: cx + size, y: cy + size }, 
        { x: cx - size, y: cy + size }
    ];
}

export function getCrossSectionData(shapeType, yPos) {
    const shape = SHAPES[shapeType];
    if (!shape) return null;

    const result = shape.calculateSection(yPos, shape);
    
    if (result) {
        return {
            ...result,
            area: result.area.toFixed(2),
            perimeter: result.perimeter.toFixed(2),
            diameter: result.actualSize.toFixed(2)
        };
    }
    
    // Fallback or empty
    return {
        points: [],
        shapeName: '',
        actualSize: 0,
        area: '0.00',
        perimeter: '0.00',
        diameter: '0.00'
    };
}

