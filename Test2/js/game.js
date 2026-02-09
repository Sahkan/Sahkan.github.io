// 2D Side-Scrolling Shooter Game - WebAssembly Interface

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Set canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Input state
const keys = {};
let mouseX = 0;
let mouseY = 0;
let isShooting = false;

// WASM module and wrappers (set after load)
let game_init, game_update;
let game_get_player_x, game_get_player_y, game_get_player_angle;
let game_get_bullet_count, game_get_bullet_x, game_get_bullet_y;
let game_get_enemy_count, game_get_enemy_x, game_get_enemy_y, game_get_enemy_width, game_get_enemy_height, game_get_enemy_rotation, game_get_enemy_color;
let game_get_particle_count, game_get_particle_x, game_get_particle_y, game_get_particle_vx, game_get_particle_vy, game_get_particle_life, game_get_particle_size, game_get_particle_color;

// Background scroll
let backgroundX = 0;
const BACKGROUND_SPEED = 1;

// Input handlers
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    isShooting = true;
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    isShooting = false;
  }
});

window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

// Build keys mask: W=1, S=2, A=4, D=8
function getKeysMask() {
  let m = 0;
  if (keys['KeyW'] || keys['Keyw']) m |= 1;
  if (keys['KeyS'] || keys['Keys']) m |= 2;
  if (keys['KeyA'] || keys['Keya']) m |= 4;
  if (keys['KeyD'] || keys['Keyd']) m |= 8;
  return m;
}

// Convert RGB color (0xRRGGBB) to CSS color string
function rgbToColor(rgb) {
  const r = (rgb >> 16) & 0xFF;
  const g = (rgb >> 8) & 0xFF;
  const b = rgb & 0xFF;
  return `rgb(${r}, ${g}, ${b})`;
}

// Update game state (calls WASM)
function update(deltaTime) {
  if (!game_update) return;
  
  const keysMask = getKeysMask();
  game_update(deltaTime, keysMask, mouseX, mouseY, isShooting ? 1 : 0, canvas.width, canvas.height);
  
  // Scroll background
  backgroundX -= BACKGROUND_SPEED;
  if (backgroundX <= -canvas.width) {
    backgroundX = 0;
  }
}

// Render game
function render() {
  if (!game_get_player_x) return;
  
  // Clear canvas
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw background pattern (scrolling)
  ctx.fillStyle = '#2a2a3e';
  ctx.fillRect(backgroundX, 0, canvas.width, canvas.height);
  ctx.fillRect(backgroundX + canvas.width, 0, canvas.width, canvas.height);
  
  // Draw grid pattern
  ctx.strokeStyle = '#3a3a4e';
  ctx.lineWidth = 1;
  const gridSize = 50;
  for (let x = backgroundX % gridSize; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw enemies (only those visible on screen for performance)
  const enemyCount = game_get_enemy_count();
  const margin = 100; // Extra margin for enemies slightly off-screen
  for (let i = 0; i < enemyCount; i++) {
    const x = game_get_enemy_x(i);
    const y = game_get_enemy_y(i);
    const width = game_get_enemy_width(i);
    const height = game_get_enemy_height(i);
    
    // Viewport culling - skip enemies outside visible area
    if (x + width < -margin || x > canvas.width + margin ||
        y + height < -margin || y > canvas.height + margin) {
      continue;
    }
    
    const rotation = game_get_enemy_rotation(i);
    const color = game_get_enemy_color(i);
    
    ctx.save();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    
    // Draw enemy body
    ctx.fillStyle = rgbToColor(color);
    ctx.fillRect(-width / 2, -height / 2, width, height);
    
    // Draw enemy "eyes"
    const eyeSize = Math.max(3, width / 8);
    const eyeOffsetX = width / 4;
    const eyeOffsetY = -height / 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-eyeOffsetX - eyeSize / 2, eyeOffsetY - eyeSize / 2, eyeSize, eyeSize);
    ctx.fillRect(eyeOffsetX - eyeSize / 2, eyeOffsetY - eyeSize / 2, eyeSize, eyeSize);
    
    ctx.restore();
  }

  // Draw bullets
  ctx.fillStyle = '#ffff00';
  const bulletCount = game_get_bullet_count();
  for (let i = 0; i < bulletCount; i++) {
    const x = game_get_bullet_x(i);
    const y = game_get_bullet_y(i);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw particles
  const particleCount = game_get_particle_count();
  for (let i = 0; i < particleCount; i++) {
    const x = game_get_particle_x(i);
    const y = game_get_particle_y(i);
    const life = game_get_particle_life(i);
    const size = game_get_particle_size(i);
    const color = game_get_particle_color(i);
    
    const alpha = life / 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgbToColor(color);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw player
  const playerX = game_get_player_x();
  const playerY = game_get_player_y();
  const playerAngle = game_get_player_angle();
  const playerWidth = 40;
  const playerHeight = 40;
  
  ctx.save();
  ctx.translate(playerX + playerWidth / 2, playerY + playerHeight / 2);
  ctx.rotate(playerAngle);
  ctx.fillStyle = '#5999ff';
  ctx.fillRect(-playerWidth / 2, -playerHeight / 2, playerWidth, playerHeight);
  
  // Draw gun barrel
  ctx.fillStyle = '#333333';
  ctx.fillRect(playerWidth / 2 - 5, -3, 15, 6);
  ctx.restore();

  // Draw crosshair at mouse position
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mouseX - 10, mouseY);
  ctx.lineTo(mouseX + 10, mouseY);
  ctx.moveTo(mouseX, mouseY - 10);
  ctx.lineTo(mouseX, mouseY + 10);
  ctx.stroke();
}

// Game loop
let lastTime = 0;
function gameLoop(currentTime) {
  const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  update(deltaTime);
  render();

  requestAnimationFrame(gameLoop);
}

// Load WASM and start
(function () {
  const wasmDir = 'wasm/';
  const createGameModuleFn = typeof globalThis.createGameModule !== 'undefined' ? globalThis.createGameModule : null;

  if (!createGameModuleFn) {
    document.getElementById('instructions').textContent =
      'WASM build not loaded. Run wasm/build.bat or build.sh first, then refresh.';
    return;
  }

  createGameModuleFn({ locateFile: (path) => wasmDir + path })
    .then(runWithModule)
    .catch((err) => {
      console.error('WASM init failed:', err);
      document.getElementById('instructions').textContent =
        'Failed to load game (WebAssembly). Build wasm first: run wasm/build.bat or wasm/build.sh.';
    });

  function runWithModule(Module) {
    game_init = Module.cwrap('game_init', null, []);
    game_update = Module.cwrap('game_update', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number']);
    
    game_get_player_x = Module.cwrap('game_get_player_x', 'number', []);
    game_get_player_y = Module.cwrap('game_get_player_y', 'number', []);
    game_get_player_angle = Module.cwrap('game_get_player_angle', 'number', []);
    
    game_get_bullet_count = Module.cwrap('game_get_bullet_count', 'number', []);
    game_get_bullet_x = Module.cwrap('game_get_bullet_x', 'number', ['number']);
    game_get_bullet_y = Module.cwrap('game_get_bullet_y', 'number', ['number']);
    
    game_get_enemy_count = Module.cwrap('game_get_enemy_count', 'number', []);
    game_get_enemy_x = Module.cwrap('game_get_enemy_x', 'number', ['number']);
    game_get_enemy_y = Module.cwrap('game_get_enemy_y', 'number', ['number']);
    game_get_enemy_width = Module.cwrap('game_get_enemy_width', 'number', ['number']);
    game_get_enemy_height = Module.cwrap('game_get_enemy_height', 'number', ['number']);
    game_get_enemy_rotation = Module.cwrap('game_get_enemy_rotation', 'number', ['number']);
    game_get_enemy_color = Module.cwrap('game_get_enemy_color', 'number', ['number']);
    
    game_get_particle_count = Module.cwrap('game_get_particle_count', 'number', []);
    game_get_particle_x = Module.cwrap('game_get_particle_x', 'number', ['number']);
    game_get_particle_y = Module.cwrap('game_get_particle_y', 'number', ['number']);
    game_get_particle_vx = Module.cwrap('game_get_particle_vx', 'number', ['number']);
    game_get_particle_vy = Module.cwrap('game_get_particle_vy', 'number', ['number']);
    game_get_particle_life = Module.cwrap('game_get_particle_life', 'number', ['number']);
    game_get_particle_size = Module.cwrap('game_get_particle_size', 'number', ['number']);
    game_get_particle_color = Module.cwrap('game_get_particle_color', 'number', ['number']);

    game_init();
    gameLoop(0);
  }
})();
