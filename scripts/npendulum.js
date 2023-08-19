// Canvas
const canvas = document.getElementById("npendulum-canvas");
const context = canvas.getContext('2d');

// Diagnostics
let previousTime = Date.now();
let dt = 10; // Random starting value so that logic doesn't break

// Status HTML Elements
const fpsMonitor = document.getElementById("fps-text");
const fpsStream = new Array(25).fill(10);

// Constants
const G = 0.01;
const TIMESTEP_MULTIPLIER = 0.3;
let SUBSTEPS = 100;

// Maybe constants?

const pendulumCount = 20;
const pendulumSegments = 4;
const pendulumLength = 500;

const pendulums = {
    x:  new Float64Array(pendulumCount * pendulumSegments), // Stored as [p1.x1 p1.x2 p1.x3 ... pn.x1 pn.x2, pn.x3 ...]
    y:  new Float64Array(pendulumCount * pendulumSegments),
    px: new Float64Array(pendulumSegments),
    py: new Float64Array(pendulumSegments),
    vx: new Float64Array(pendulumCount * pendulumSegments),
    vy: new Float64Array(pendulumCount * pendulumSegments),
    m:  new Float64Array(pendulumCount * pendulumSegments),
}

const constraints = {
    p1: new Float64Array(pendulumCount * (pendulumSegments - 1)), // Constraints per every two points
    p2: new Float64Array(pendulumCount * (pendulumSegments - 1)),
    d:  new Float64Array(pendulumCount * (pendulumSegments - 1))
}

// Time handling
const updateTime = () => {
    const nowTime = Date.now(); // Redundancy to make sure two calls don't give different results;
    dt = Math.max(nowTime - previousTime, 2);
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

// Stolen from https://stackoverflow.com/questions/17242144 because I don't really care enough to learn it myself (sorry)
function HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
        s = h.s, v = h.v, h = h.h;
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v, g = t, b = p; break;
        case 1: r = q, g = v, b = p; break;
        case 2: r = p, g = v, b = t; break;
        case 3: r = p, g = q, b = v; break;
        case 4: r = t, g = p, b = v; break;
        case 5: r = v, g = p, b = q; break;
    }
    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

// Draws a pendulum
const drawPendulum = (index, style="white") => {
    const pIndex = index*pendulumSegments;
    
    context.fillStyle = style;
    context.strokeStyle = style;

    context.fillRect(pendulums.x[pIndex] - 3, pendulums.y[pIndex] - 3, 6, 6);

    for (let i = 1; i < pendulumSegments; i++) {
        context.fillRect(pendulums.x[pIndex + i] - 3, pendulums.y[pIndex + i] - 3, 6, 6);

        context.beginPath();
        context.moveTo(pendulums.x[pIndex - 1 + i], pendulums.y[pIndex - 1 + i]);
        context.lineTo(pendulums.x[pIndex + i], pendulums.y[pIndex + i]);
        context.stroke();
    }
}

const initializePendulums = (initialX, initialY, curve, phase, initialM, mFalloff, randomness) => {
    const segmentLength = pendulumLength / pendulumSegments;
    for (let i = 0; i < pendulumCount; i++) {
        const stride = i * pendulumSegments;

        pendulums.x[stride] = initialX;
        pendulums.y[stride] = initialY;
        pendulums.vx[stride] = 0;
        pendulums.vy[stride] = 0;
        pendulums.m[stride] = 0;

        for (let j = 1; j < pendulumSegments; j++) {
            // Not totally accurate circle but who cares
            pendulums.x[stride + j] = initialX + (j * segmentLength) * Math.cos(curve * i / pendulumCount + phase) + (Math.random() * randomness);
            pendulums.y[stride + j] = initialY - (j * segmentLength) * Math.sin(curve * i / pendulumCount + phase) + (Math.random() * randomness);
            pendulums.vx[stride + j] = 0;
            pendulums.vy[stride + j] = 0;
            pendulums.m[stride + j] = initialM - ((j - 1) * mFalloff);
        }
    }
}

// Creates a list of constraints (lengths of the different segments)
const initializeConstraints = () => {
    for (let i = 0; i < pendulumCount; i++) {
        const pStride = i * pendulumSegments;
        const cStride = i * (pendulumSegments - 1);

        for (let j = 0; j < pendulumSegments - 1; j++) {
            // Not totally accurate circle but who cares
            constraints.p1[cStride + j] = pStride + (j + 1);
            constraints.p2[cStride + j] = pStride + j;
            constraints.d[cStride + j] = Math.sqrt( 
                Math.pow(pendulums.x[j] - pendulums.x[j+1], 2) + 
                Math.pow(pendulums.y[j] - pendulums.y[j+1], 2)
            );
        }
    }
}

const solveConstraint = (index, segment) => {
    const cStride = index * (pendulumSegments - 1) + segment;
    const p1 = constraints.p1[cStride];
    const p2 = constraints.p2[cStride];

    const deltaX = pendulums.x[p1] - pendulums.x[p2];
    const deltaY = pendulums.y[p1] - pendulums.y[p2];

    const length = Math.sqrt(deltaX*deltaX + deltaY*deltaY);

    // console.log(length);

    const w1 = pendulums.m[p1] > 0 ? 1 / pendulums.m[p1] : 0;
    const w2 = pendulums.m[p2] > 0 ? 1 / pendulums.m[p2] : 0;

    const correctionFactor = ((constraints.d[cStride] - length) * (w1 + w2)) / length;

    pendulums.x[p1] += w1 * correctionFactor * deltaX;
    pendulums.y[p1] += w1 * correctionFactor * deltaY;

    pendulums.x[p2] -= w2 * correctionFactor * deltaX;
    pendulums.y[p2] -= w2 * correctionFactor * deltaY;
}

// Applies PBD to pendulum using n substeps
const updatePendulum = (index, timestep) => {
    const pIndex = index*pendulumSegments;

    for (let i = 0; i < pendulumSegments; i++) {
        // Apply gravity if the point isn't fixed
        if (pendulums.m[pIndex + i] != 0) pendulums.vy[pIndex + i] += G * timestep;

        // Pre-constraint positions
        pendulums.px[i] = pendulums.x[pIndex + i];
        pendulums.py[i] = pendulums.y[pIndex + i];

        // Apply velocity
        pendulums.x[pIndex + i] += pendulums.vx[pIndex + i] * timestep;
        pendulums.y[pIndex + i] += pendulums.vy[pIndex + i] * timestep;
    }

    for (let i = 0; i < pendulumSegments; i++) {
        solveConstraint(index, i);
    }

    for (let i = 0; i < pendulumSegments; i++) {
        // Apply corrections
        pendulums.vx[pIndex + i] = (pendulums.x[pIndex + i] - pendulums.px[i]) / timestep;
        pendulums.vy[pIndex + i] = (pendulums.y[pIndex + i] - pendulums.py[i]) / timestep;
    }
}

initializePendulums(canvas.width / 2, canvas.height / 5, 0.05, 0.2, 10, 1, 0.4);
initializeConstraints();
console.log(constraints);

// Main function
const updateCallback = () => {
    context.fillStyle = "black";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const sdt = dt / SUBSTEPS;
    for (let i = 0; i < pendulumCount; i++) {
        for (let s = 0; s < SUBSTEPS; s++) {
            updatePendulum(i, sdt * TIMESTEP_MULTIPLIER);
        }
        const pendulumColor = HSVtoRGB(i / pendulumCount, 0.7, 0.9);
        drawPendulum(i, `rgba(${pendulumColor.r}, ${pendulumColor.g}, ${pendulumColor.b}, 0.6)`);
    }
}

// Main loop
const updateLoop = (callback) => {
    callback();

    updateTime();

    window.requestAnimationFrame(() => updateLoop(callback));
}

updateLoop(updateCallback);