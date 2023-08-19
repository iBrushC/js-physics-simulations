// Canvas
const canvas = document.getElementById("nbody-canvas");
const context = canvas.getContext('2d');

// Diagnostics
let previousTime = Date.now();
let dt = 10; // Random starting value so that logic doesn't break

// Status HTML Elements
const fpsMonitor = document.getElementById("fps-text");
const fpsStream = new Array(25).fill(0);

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

updateLoop(() => {});