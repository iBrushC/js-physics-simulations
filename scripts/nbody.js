/*
==========
SETUP CODE
==========
*/

// Canvas
const canvas = document.getElementById("nbody-canvas");
const context = canvas.getContext('2d');

// Diagnostics
let previousTime = Date.now();
let dt = 10; // Random starting value so that logic doesn't break

// Status HTML Elements
const fpsMonitor = document.getElementById("fps-text");
const fpsStream = new Array(50).fill(0);

// Controller HTML Elements
const solverModeDropdown = document.getElementById("input-solver-mode");
const numberOfBodiesSlider = document.getElementById("input-number-of-particles");
const timestepSizeSlider = document.getElementById("input-timestep-size");
const quadtreeSplitSlider = document.getElementById("input-quadtree-split");

const showParticlesCheckbox = document.getElementById("input-show-particles");
const colorVelocityCheckbox = document.getElementById("input-color-by-velocity");
const quadtreeCheckbox = document.getElementById("input-show-quadtree");
const quadtreeCOMCheckbox = document.getElementById("input-show-com");

// Time handling
const updateTime = () => {
    const nowTime = Date.now(); // Redundancy to make sure two calls don't give different results;
    dt = nowTime - previousTime;
    previousTime = nowTime;
    
    fpsStream.unshift(1000 / (dt + 0.001));
    fpsStream.pop();

    let smoothFPS = 0;
    for (const fps of fpsStream) {
        smoothFPS += fps;
    }
    smoothFPS /= fpsStream.length;

    fpsMonitor.innerHTML = `FPS: ${Math.round(smoothFPS)}`
}

// Main loop
const updateLoop = (callback) => {
    callback();

    updateTime();

    window.requestAnimationFrame(() => updateLoop(callback));
}

/*
===============
SIMULATION CODE
===============
*/

// Should be changable in interface later
let MAX_BODIES = 500;
const G = 1; //6.67430e-11;
const PAD = 50;
let TIMESTEP_MULTIPLIER = 0.1;
let QUADTREE_BATCH = 25;
let THETA = 0.7;
const DAMPEN = 0.002;
const MAX_DEPTH = 10;

let maxVX = 0;
let maxVY = 0;

const bodies = {
    x: new Float32Array(MAX_BODIES),
    y: new Float32Array(MAX_BODIES),
    vx: new Float32Array(MAX_BODIES),
    vy: new Float32Array(MAX_BODIES),
    m: new Float32Array(MAX_BODIES),
}

// External "forces" (invisible objects)
const forces = {
    // center: {
    //     x: canvas.width / 2,
    //     y: canvas.height / 2,
    //     m: 1
    // },
}

// Random assignments
const initializeBodies = () => {
    for (let i = 0; i < MAX_BODIES; i++) {
        const x = Math.random();
        const y = Math.random();

        const r = Math.sqrt(Math.pow((x - 0.5), 2) + Math.pow((y - 0.5), 2));
        const theta = Math.atan((y - 0.5) / (x - 0.5)) + 0.01;
        const sx = x > 0.5 ? Math.sin(theta) : -Math.sin(theta);
        const sy = x > 0.5 ? -Math.cos(theta) : Math.cos(theta);

        bodies.x[i] = (x * 0.8 + 0.1) * canvas.width;
        bodies.y[i] = (y * 0.8 + 0.1) * canvas.height;
        bodies.vx[i] = r * 1250 * sx;
        bodies.vy[i] = r * 1250 * sy;
        bodies.m[i] = 3 * Math.pow(Math.random(), 3) + 1.5 * Math.pow((x - 0.5) + (y - 0.5), 4) + 2;
    }
}

// Draws bodies according to mass
const drawBodies = () => {
    context.fillStyle = `rgba(255, 255, 255, 0.5)`;
    for (let i = 0; i < MAX_BODIES; i++) {
        if (colorVelocityCheckbox.checked) {
            context.fillStyle = `rgba(${(Math.abs(bodies.vx[i]) / maxVX) * 215 + 40}, ${(Math.abs(bodies.vy[i]) / maxVY) * 215 + 40}, 255, 0.5)`;
        }
        context.fillRect(Math.round(bodies.x[i]), Math.round(bodies.y[i]), bodies.m[i], bodies.m[i]);
    }
}

// Draws the quadtree
const drawQuadtree = (node) => {
    if (quadtreeCheckbox.checked) {
        context.strokeStyle = `rgba(255, 170, 170, ${0.1 + 0.14 * node.depth})`;
        context.lineWidth = 0.2;
        context.beginPath();
        context.rect(node.x, node.y, node.w, node.h);
        context.stroke();
    }

    // Draws center of mass
    if (quadtreeCOMCheckbox.checked) {
        context.fillStyle = "rgba(150, 255, 150, 0.8)";
        context.fillRect(node.comX / node.particleCount, node.comY / node.particleCount, Math.pow(node.mass, 0.25), Math.pow(node.mass, 0.25));
    }
    
    for (child of node.children) {
        if (child != null) drawQuadtree(child);
    }
}

// Applys interparticle forces using the naive O(n^2) approach
const applyNaiveForces = () => {

    for (let i = 0; i < MAX_BODIES; i++) {

        // Global forces
        for (const force of Object.keys(forces)) {
            const dx = forces[force].x - bodies.x[i];
            const dy = forces[force].y - bodies.y[i];
            const r2 = Math.pow(dx, 2) + Math.pow(dy, 2);
            const a = (G * forces[force].m) / Math.max(r2, PAD);

            
            const r = Math.max(Math.sqrt(r2), PAD);
            bodies.vx[i] += (dx / r) * a * dt;
            bodies.vy[i] += (dy / r) * a * dt;
        }

        for (let j = 0; j < MAX_BODIES; j++) {
            // bodies[i] is the body being acted upon

            // Interparticular forces
            if (i == j) continue;

            const dx = bodies.x[j] - bodies.x[i];
            const dy = bodies.y[j] - bodies.y[i];
            const r2 = Math.pow(dx, 2) + Math.pow(dy, 2);
            const a = (G * bodies.m[j]) / Math.max(r2, PAD);
            
            const r = Math.max(Math.sqrt(r2), PAD);
            bodies.vx[i] += (dx / r) * a * dt;
            bodies.vy[i] += (dy / r) * a * dt;
        }
    }
}

const newQuadtreeNode = (x, y, w, h, depth, parent) => {
    const quadtree = {
        // Box specifications
        x: x,
        y: y,
        w: w,
        h: h,
    
        // Parent
        parent: parent,
        depth: depth,
    
        // Northwest, northeast, southwest, and southeast
        hasChildren: false,
        children: [null, null, null, null],

        // Indexes of all the particles within the node
        particles: [],
        particleCount: 0,

        // Center of mass of the node
        comX: 0,
        comY: 0,
        mass: 0,
    };
    return quadtree;
}

const qtNorthWest = (node) => node.children[0]
const qtNorthEast = (node) => node.children[1]
const qtSouthWest = (node) => node.children[2]
const qtSouthEast = (node) => node.children[3]

// Subdivides a quadtree node
const subdivideQuadtree = (node) => {
    node.hasChildren = true;
    node.children[0] = newQuadtreeNode(node.x, node.y, node.w / 2, node.h / 2, node.depth + 1, node);
    node.children[1] = newQuadtreeNode(node.x + node.w / 2, node.y, node.w / 2, node.h / 2, node.depth + 1, node);
    node.children[2] = newQuadtreeNode(node.x, node.y + node.h / 2, node.w / 2, node.h / 2, node.depth + 1, node);
    node.children[3] = newQuadtreeNode(node.x + node.w / 2, node.y + node.h / 2, node.w / 2, node.h / 2, node.depth + 1, node);
}

// Inserts particles into a quadtree
const quadtreeInsert = (node, x, y, index, maxParticles) => {
    const cutoffX = node.w / 2;
    const cutoffY = node.h / 2;

    if (node.hasChildren) {
        // Indexing scheme (marginally faster than if statements)
        const uniqueID = ((x - node.x) >= cutoffX) + 2 * ((y - node.y) >= cutoffY);
        quadtreeInsert(node.children[uniqueID], x, y, index, maxParticles);

        node.particleCount++;
        node.comX += bodies.x[index];
        node.comY += bodies.y[index];
        node.mass += bodies.m[index];

    } else {
        if (node.particles.length >= maxParticles && node.depth < MAX_DEPTH) {
            subdivideQuadtree(node);
            quadtreeInsert(node, x, y, index, maxParticles);
            for (const particleIndex of node.particles) {
                quadtreeInsert(node, bodies.x[particleIndex], bodies.y[particleIndex], particleIndex, maxParticles);

                // Subtract since they will be added back later
                node.particleCount--;
                node.comX -= bodies.x[particleIndex];
                node.comY -= bodies.y[particleIndex];
                node.mass -= bodies.m[particleIndex];
            }
            node.particles = []
        } else {
            node.particles.push(index);
            node.particleCount++;
            node.comX += bodies.x[index];
            node.comY += bodies.y[index];
            node.mass += bodies.m[index];
        }
    }
}

// Assembles a quadtree from all particles
const assembleQuadtree = (baseNode, maxParticles) => {
    for (let i = 0; i < MAX_BODIES; i++) {
        quadtreeInsert(baseNode, bodies.x[i], bodies.y[i], i, maxParticles);
    }
}

const quadtreeForceSearch = (node, x, y, pi, ratio) => {
    if (node.mass == 0 || node.particleCount == 0) return;

    const comX = node.comX / node.particleCount;
    const comY = node.comY / node.particleCount;
    const dx = comX - x;
    const dy = comY - y;
    const d2 = Math.pow(dx, 2) + Math.pow(dy, 2);
    const sideLength = (node.w + node.h) / 2;

    // If the ratio is exceeded do a recursive search
    if ((sideLength / Math.sqrt(d2)) > ratio) {
        // If it's close enough and has particles
        if (node.particles.length > 0) {
            for (particleIndex of node.particles) {
                if (particleIndex == pi) continue;
    
                const pdx = bodies.x[particleIndex] - bodies.x[pi];
                const pdy = bodies.y[particleIndex] - bodies.y[pi];
                const r2 = Math.pow(pdx, 2) + Math.pow(pdy, 2);
                const a = (G * bodies.m[particleIndex]) / Math.max(r2, PAD);
                
                const r = Math.max(Math.sqrt(r2), PAD);
                if (dx == NaN || dy == NaN || r == NaN || a == NaN) {
                    console.log("NAN VALUE FOUND");
                }
                bodies.vx[pi] += (dx / r) * a * dt;
                bodies.vy[pi] += (dy / r) * a * dt;
            }
        }
        // Otherwise do a recursive search again
        else if (node.hasChildren) {
            quadtreeForceSearch(qtNorthWest(node), x, y, pi, ratio);
            quadtreeForceSearch(qtNorthEast(node), x, y, pi, ratio);
            quadtreeForceSearch(qtSouthEast(node), x, y, pi, ratio);
            quadtreeForceSearch(qtSouthWest(node), x, y, pi, ratio);
        }
    } 
    // Otherwise apply the force as a mass
    else {
        const a = (G * node.mass) / Math.max(d2, PAD);
        const d = Math.max(Math.sqrt(d2), PAD);
        bodies.vx[pi] += (dx / d) * a * dt;
        bodies.vy[pi] += (dy / d) * a * dt;
        return;
    }
}

const nodeContainsPoint = (node, x, y) => {
    return ((x - node.x) < node.w) && ((x - node.x) > 0) &&
           ((y - node.y) < node.h) && ((y - node.y) > 0);
}

const rectContainsPoint = (rect, x, y) => {
    return ((x - rect.x) < rect.w) && ((x - rect.x) > 0) &&
           ((y - rect.y) < rect.h) && ((y - rect.y) > 0);
}

const nodeRectOverlap = (node, rect) => {
    if (node.x > (rect.x + rect.w) || rect.x > (node.x + node.w)) {
        return false;
    }
    if (node.y > (rect.y + rect.h) || rect.y > (node.y + node.h)) {
        return false;
    }

    return true;
}

// First assembles an quadtree then applies forces based on that
const applyBarnesHuttForces = (quadtree, ratio) => {
    for (let i = 0; i < MAX_BODIES; i++) {
        quadtreeForceSearch(quadtree, bodies.x[i], bodies.y[i], i, ratio);

        // Global forces
        for (const force of Object.keys(forces)) {
            const dx = forces[force].x - bodies.x[i];
            const dy = forces[force].y - bodies.y[i];
            const r2 = Math.pow(dx, 2) + Math.pow(dy, 2);
            const a = (G * forces[force].m) / Math.max(r2, PAD);

            
            const r = Math.max(Math.sqrt(r2), PAD);
            bodies.vx[i] += (dx / r) * a * dt;
            bodies.vy[i] += (dy / r) * a * dt;
        }
    }
}

// Updates positions all at once. If it was done while calculating forces, weird behaviors might occur
const updatePositions = () => {
    maxVX = 0;
    maxVY = 0;

    const scaling = (dt / 1000) * TIMESTEP_MULTIPLIER;
    for (let i = 0; i < MAX_BODIES; i++) {
        bodies.x[i] += bodies.vx[i] * scaling;
        bodies.y[i] += bodies.vy[i] * scaling;
        bodies.vx[i] *= 1 - DAMPEN;
        bodies.vy[i] *= 1 - DAMPEN;

        maxVX = Math.max(Math.abs(maxVX), bodies.vx[i]);
        maxVY = Math.max(Math.abs(maxVY), bodies.vy[i]);

        if (bodies.x[i] <= 0 || bodies.x[i] >= canvas.width) bodies.vx[i] *= -1;
        if (bodies.y[i] <= 0 || bodies.y[i] >= canvas.height) bodies.vy[i] *= -1;
    }
}

initializeBodies();

let quadtree = newQuadtreeNode(0, 0, canvas.width, canvas.height, null);

const mouse = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0
}
const interactionSize = 40;

const applyRectForces = (node, rect, vx, vy) => {
    if (node.particleCount == 0) return;

    if (nodeRectOverlap(node, rect)) {
        if (node.particles.length > 0) {
            // Need to add checking to see if each particle is in the bounding box
            for (const particleIndex of node.particles) {
                if (rectContainsPoint(rect, bodies.x[particleIndex], bodies.y[particleIndex])) {
                    bodies.vx[particleIndex] += vx * 150 / dt;
                    bodies.vy[particleIndex] += vy * 150 / dt;
                }
            }
        } else if (node.hasChildren) {
            applyRectForces(qtNorthWest(node), rect, vx, vy);
            applyRectForces(qtNorthEast(node), rect, vx, vy);
            applyRectForces(qtSouthEast(node), rect, vx, vy);
            applyRectForces(qtSouthWest(node), rect, vx, vy);
        }
    }
    
}

const updateCallback = () => {
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Reset the quadtree
    quadtree.children = [null, null, null, null];
    quadtree.hasChildren = false;
    quadtree.particles = [];
    quadtree.particleCount = 0;
    quadtree.comX = 0;
    quadtree.comY = 0;
    quadtree.mass = 0;
    assembleQuadtree(quadtree, QUADTREE_BATCH);
    
    if (solverModeDropdown.value == "naive") {
        applyNaiveForces();
    } else {
        applyBarnesHuttForces(quadtree, 0.7);
    }
    const mouseRect = {
        x: mouse.x - interactionSize,
        y: mouse.y - interactionSize,
        w: 2*interactionSize,
        h: 2*interactionSize,
    };

    applyRectForces(quadtree, mouseRect, mouse.vx, mouse.vy);
    updatePositions();
    drawQuadtree(quadtree);

    if (showParticlesCheckbox.checked) {
        drawBodies();   
    }

    // context.fillRect(mouse.x - interactionSize, mouse.y - interactionSize, 2*interactionSize, 2*interactionSize);
}

// Callbacks
numberOfBodiesSlider.oninput = () => {
    MAX_BODIES = numberOfBodiesSlider.value;

    bodies.x = new Float32Array(MAX_BODIES);
    bodies.y = new Float32Array(MAX_BODIES);
    bodies.vx = new Float32Array(MAX_BODIES);
    bodies.vy = new Float32Array(MAX_BODIES);
    bodies.m = new Float32Array(MAX_BODIES);

    initializeBodies();

    numberOfBodiesSlider.previousElementSibling.innerHTML = `Number of Bodies: ${MAX_BODIES}`;
}

timestepSizeSlider.oninput = () => {
    TIMESTEP_MULTIPLIER = timestepSizeSlider.value;
    timestepSizeSlider.previousElementSibling.innerHTML = `Timestep Multiplier: ${TIMESTEP_MULTIPLIER}`;
}

quadtreeSplitSlider.oninput = () => {
    QUADTREE_BATCH = quadtreeSplitSlider.value;
    quadtreeSplitSlider.previousElementSibling.innerHTML = `Quadtree Split Value: ${QUADTREE_BATCH}`;
}

canvas.onmousemove = (e) => {
    const boundingRect = canvas.getBoundingClientRect();
    const adjX = (e.clientX - boundingRect.left) * (canvas.width / boundingRect.width);
    const adjY = (e.clientY - boundingRect.top) * (canvas.height / boundingRect.height);

    const canvasX = Math.round(Math.max(Math.min(adjX, canvas.width), 0));
    const canvasY = Math.round(Math.max(Math.min(adjY, canvas.width), 0));

    mouse.x = canvasX;
    mouse.y = canvasY;
    mouse.vx = e.movementX;
    mouse.vy = e.movementY;
}

canvas.onmouseleave = (e) => {
    mouse.vx = 0;
    mouse.vy = 0;
}

updateLoop(updateCallback);