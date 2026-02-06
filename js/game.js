/* global THREE */
// Cube Game – WebAssembly core with Three.js rendering

const CAMERA_DISTANCE = 4;
const CAMERA_HEIGHT = 1.5;
const RUN_CYCLE_DURATION = 0.4;
const PROJECTILE_RADIUS = 0.15;

// Input state (for WASM)
const keys = {};
let mouseDeltaX = 0, mouseDeltaY = 0;
let shootThisFrame = false;
let isPointerLocked = false;

// WASM module and wrappers (set after load)
let game_update, game_get_player_position, game_get_player_rotation, game_get_front;
let game_get_projectile_count, game_get_projectile;
let game_get_is_moving, game_get_is_in_air, game_get_run_time;
let game_get_obstacle_count, getObstacleX, getObstacleY, getObstacleZ, getObstacleRotation, getObstacleColor;

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.2, 0.3, 0.4);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Floor (500x500 to match WASM FLOOR_HALF_SIZE 250)
const floorGeom = new THREE.BoxGeometry(500, 0.5, 500);
const floorMat = new THREE.MeshLambertMaterial({ color: 0x2d4a2e });
const floor = new THREE.Mesh(floorGeom, floorMat);
floor.position.set(0, -0.25, 0);
floor.receiveShadow = true;
scene.add(floor);

// Obstacles (instanced rendering for performance with 100k cubes)
const obstacleGeom = new THREE.BoxGeometry(1, 1, 1);
const obstacleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
let obstacleInstances = null;
let obstacleCount = 0; // Set in runWithModule, used in gameLoop
function ensureObstacles(count) {
  if (obstacleInstances && obstacleCount >= count) return;
  if (obstacleInstances) {
    scene.remove(obstacleInstances);
    obstacleInstances.geometry.dispose();
    obstacleInstances.material.dispose();
  }
  obstacleCount = count;
  obstacleInstances = new THREE.InstancedMesh(obstacleGeom, obstacleMat, count);
  obstacleInstances.castShadow = true;
  obstacleInstances.receiveShadow = false;
  scene.add(obstacleInstances);
}

// Character (blocky humanoid)
const charMat = new THREE.MeshLambertMaterial({ color: 0x5999ff });
const skinMat = new THREE.MeshLambertMaterial({ color: 0xf2d9c4 });
function makeBox(w, h, d) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), charMat);
}
const character = new THREE.Group();
const torso = makeBox(0.35, 0.4, 0.2);
torso.position.set(0, 0.9, 0);
character.add(torso);
const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), skinMat);
head.position.set(0, 0.25, 0);
torso.add(head);
const lUpperLeg = makeBox(0.1, 0.35, 0.1);
lUpperLeg.position.set(-0.12, 0.35, 0);
character.add(lUpperLeg);
const lLowerLeg = makeBox(0.08, 0.35, 0.08);
lLowerLeg.position.set(0, -0.35, 0);
lUpperLeg.add(lLowerLeg);
const rUpperLeg = makeBox(0.1, 0.35, 0.1);
rUpperLeg.position.set(0.12, 0.35, 0);
character.add(rUpperLeg);
const rLowerLeg = makeBox(0.08, 0.35, 0.08);
rLowerLeg.position.set(0, -0.35, 0);
rUpperLeg.add(rLowerLeg);
const lUpperArm = makeBox(0.06, 0.25, 0.06);
lUpperArm.position.set(-0.2, 0.2, 0);
torso.add(lUpperArm);
const lLowerArm = makeBox(0.05, 0.25, 0.05);
lLowerArm.position.set(0, -0.25, 0);
lUpperArm.add(lLowerArm);
const rUpperArm = makeBox(0.06, 0.25, 0.06);
rUpperArm.position.set(0.2, 0.2, 0);
torso.add(rUpperArm);
const rLowerArm = makeBox(0.05, 0.25, 0.05);
rLowerArm.position.set(0, -0.25, 0);
rUpperArm.add(rLowerArm);
scene.add(character);

// Lights
const ambient = new THREE.AmbientLight(0x404060);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -280;
dirLight.shadow.camera.right = 280;
dirLight.shadow.camera.top = 280;
dirLight.shadow.camera.bottom = -280;
dirLight.shadow.camera.far = 500;
scene.add(dirLight);

// Projectiles: list of Three.js meshes (count/layout driven by WASM)
const projectileGeom = new THREE.SphereGeometry(PROJECTILE_RADIUS, 8, 6);
const projectileMat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
const projectileMeshes = [];

function updateCharacterAnimation(isMoving, isInAir, runTime) {
  const phase = ((runTime % RUN_CYCLE_DURATION) / RUN_CYCLE_DURATION) * Math.PI * 2;
  const s = Math.sin(phase);

  lUpperLeg.rotation.x = 0;
  lLowerLeg.rotation.x = 0;
  rUpperLeg.rotation.x = 0;
  rLowerLeg.rotation.x = 0;
  lUpperArm.rotation.x = 0;
  rUpperArm.rotation.x = 0;

  if (isInAir) {
    lUpperArm.rotation.x = -1;
    rUpperArm.rotation.x = -1;
    lUpperLeg.rotation.x = 0.4;
    rUpperLeg.rotation.x = 0.4;
    lLowerLeg.rotation.x = 0.9;
    rLowerLeg.rotation.x = 0.9;
  } else if (isMoving) {
    lUpperLeg.rotation.x = 0.6 * s;
    lLowerLeg.rotation.x = -1.2 * s;
    rUpperLeg.rotation.x = -0.6 * s;
    rLowerLeg.rotation.x = 1.2 * s;
    lUpperArm.rotation.x = -0.5 * s;
    rUpperArm.rotation.x = 0.5 * s;
  }
}

// Input
const canvas = document.getElementById('canvas');
const instructions = document.getElementById('instructions');

// Mobile touch controls
const ENABLE_JOYSTICK_ON_PC = true; // Set to true to show joystick on PC for testing
let touchControlsActive = false;
let lastTouchX = 0, lastTouchY = 0;
let isDraggingCamera = false;
let joystickActive = false;
let joystickTouchId = null;
let joystickCenterX = 0, joystickCenterY = 0;
let joystickRadius = 0;
let joystickX = 0, joystickY = 0;

function isMobile() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function shouldShowJoystick() {
  return isMobile() || ENABLE_JOYSTICK_ON_PC;
}

// Initialize mobile controls
if (shouldShowJoystick()) {
  touchControlsActive = isMobile(); // Only set to true on actual mobile devices
  const mobileControls = document.getElementById('mobileControls');
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    mobileControls.classList.add('force-show');
  }
  const joystick = document.getElementById('joystick');
  const joystickStick = document.getElementById('joystickStick');
  const jumpButton = document.getElementById('jumpButton');
  const shootButton = document.getElementById('shootButton');
  
  function handleTouchStart(e, key) {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = true;
    e.target.classList.add('active');
  }
  
  function handleTouchEnd(e, key) {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = false;
    e.target.classList.remove('active');
  }
  
  // Calculate joystick center and radius
  function updateJoystickBounds() {
    const rect = joystick.getBoundingClientRect();
    joystickCenterX = rect.left + rect.width / 2;
    joystickCenterY = rect.top + rect.height / 2;
    joystickRadius = rect.width / 2 - 25; // Half width minus stick radius
  }
  updateJoystickBounds();
  window.addEventListener('resize', updateJoystickBounds);
  
  // Joystick touch handlers
  function updateJoystickPosition(clientX, clientY) {
    const dx = clientX - joystickCenterX;
    const dy = clientY - joystickCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > joystickRadius) {
      joystickX = (dx / distance) * joystickRadius;
      joystickY = (dy / distance) * joystickRadius;
    } else {
      joystickX = dx;
      joystickY = dy;
    }
    
    joystickStick.style.transform = `translate(calc(-50% + ${joystickX}px), calc(-50% + ${joystickY}px))`;
    
    // Map joystick position to movement keys
    const threshold = 0.3; // Dead zone threshold
    const normalizedX = joystickX / joystickRadius;
    const normalizedY = joystickY / joystickRadius;
    
    keys['KeyW'] = normalizedY < -threshold;
    keys['KeyS'] = normalizedY > threshold;
    keys['KeyA'] = normalizedX < -threshold;
    keys['KeyD'] = normalizedX > threshold;
  }
  
  function resetJoystick() {
    joystickX = 0;
    joystickY = 0;
    joystickStick.style.transform = 'translate(-50%, -50%)';
    joystickStick.classList.remove('active');
    keys['KeyW'] = false;
    keys['KeyS'] = false;
    keys['KeyA'] = false;
    keys['KeyD'] = false;
    joystickActive = false;
    joystickTouchId = null;
  }
  
  joystick.addEventListener('touchstart', (e) => {
    if (joystickTouchId === null) {
      e.preventDefault();
      e.stopPropagation();
      joystickTouchId = e.touches[0].identifier;
      joystickActive = true;
      joystickStick.classList.add('active');
      updateJoystickBounds();
      updateJoystickPosition(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  
  joystick.addEventListener('touchmove', (e) => {
    if (joystickActive && joystickTouchId !== null) {
      const touch = Array.from(e.touches).find(t => t.identifier === joystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        updateJoystickPosition(touch.clientX, touch.clientY);
      }
    }
  }, { passive: false });
  
  joystick.addEventListener('touchend', (e) => {
    if (joystickTouchId !== null) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === joystickTouchId);
      if (touch) {
        e.preventDefault();
        e.stopPropagation();
        resetJoystick();
      }
    }
  }, { passive: false });
  
  joystick.addEventListener('touchcancel', (e) => {
    if (joystickTouchId !== null) {
      e.preventDefault();
      e.stopPropagation();
      resetJoystick();
    }
  }, { passive: false });
  
  // Mouse handlers for PC testing
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    joystick.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left mouse button
        e.preventDefault();
        e.stopPropagation();
        joystickActive = true;
        joystickStick.classList.add('active');
        updateJoystickBounds();
        updateJoystickPosition(e.clientX, e.clientY);
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (joystickActive) {
        e.preventDefault();
        updateJoystickPosition(e.clientX, e.clientY);
      }
    });
    
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && joystickActive) {
        e.preventDefault();
        resetJoystick();
      }
    });
  }
  
  jumpButton.addEventListener('touchstart', (e) => handleTouchStart(e, 'Space'));
  jumpButton.addEventListener('touchend', (e) => handleTouchEnd(e, 'Space'));
  jumpButton.addEventListener('touchcancel', (e) => handleTouchEnd(e, 'Space'));
  
  shootButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    shootThisFrame = true;
    e.target.classList.add('active');
  });
  shootButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.remove('active');
  });
  shootButton.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.classList.remove('active');
  });
  
  // Mouse handlers for jump and shoot buttons on PC
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    jumpButton.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        keys['Space'] = true;
        e.target.classList.add('active');
      }
    });
    jumpButton.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        keys['Space'] = false;
        e.target.classList.remove('active');
      }
    });
    jumpButton.addEventListener('mouseleave', (e) => {
      keys['Space'] = false;
      e.target.classList.remove('active');
    });
    
    shootButton.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        shootThisFrame = true;
        e.target.classList.add('active');
      }
    });
    shootButton.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        e.preventDefault();
        e.target.classList.remove('active');
      }
    });
    shootButton.addEventListener('mouseleave', (e) => {
      e.target.classList.remove('active');
    });
  }
  
  // Camera rotation with touch drag on canvas (only if not touching joystick)
  canvas.addEventListener('touchstart', (e) => {
    // Check if touch is on joystick area
    const joystickRect = joystick.getBoundingClientRect();
    const touch = e.touches[0];
    const isOnJoystick = touch.clientX >= joystickRect.left && touch.clientX <= joystickRect.right &&
                         touch.clientY >= joystickRect.top && touch.clientY <= joystickRect.bottom;
    
    if (!isOnJoystick && e.touches.length === 1) {
      isDraggingCamera = true;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      e.preventDefault();
    }
  }, { passive: false });
  
  // Mouse camera drag for PC (only if not using joystick)
  if (ENABLE_JOYSTICK_ON_PC && !isMobile()) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !joystickActive) { // Left mouse button, not dragging joystick
        const joystickRect = joystick.getBoundingClientRect();
        const isOnJoystick = e.clientX >= joystickRect.left && e.clientX <= joystickRect.right &&
                             e.clientY >= joystickRect.top && e.clientY <= joystickRect.bottom;
        
        if (!isOnJoystick) {
          isDraggingCamera = true;
          lastTouchX = e.clientX;
          lastTouchY = e.clientY;
          canvas.requestPointerLock();
        }
      }
    });
  }
  
  canvas.addEventListener('touchmove', (e) => {
    if (isDraggingCamera && e.touches.length === 1) {
      const touch = e.touches[0];
      mouseDeltaX += (touch.clientX - lastTouchX) * 1.5; // Increased sensitivity from 0.5 to 1.5
      mouseDeltaY += (touch.clientY - lastTouchY) * 1.5; // Increased sensitivity from 0.5 to 1.5
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      e.preventDefault();
    }
  }, { passive: false });
  
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      isDraggingCamera = false;
    }
    e.preventDefault();
  }, { passive: false });
  
  canvas.addEventListener('touchcancel', (e) => {
    isDraggingCamera = false;
    e.preventDefault();
  }, { passive: false });
  
  // Hide instructions on mobile
  instructions.classList.add('hidden');
}

canvas.addEventListener('click', () => {
  if (!touchControlsActive) {
    canvas.requestPointerLock();
  }
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === canvas;
  if (isPointerLocked) instructions.classList.add('hidden');
  else instructions.classList.remove('hidden');
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') document.exitPointerLock();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.addEventListener('mousemove', (e) => {
  if (!isPointerLocked) return;
  // Only block mouse movement if actually on mobile, not when joystick is enabled for testing on PC
  if (touchControlsActive && isMobile()) return;
  mouseDeltaX += e.movementX;
  mouseDeltaY += e.movementY;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && isPointerLocked) {
    // Only block mouse shooting if actually on mobile
    if (touchControlsActive && isMobile()) return;
    e.preventDefault();
    shootThisFrame = true;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Build keys mask: W=1, S=2, A=4, D=8, Space=16
function getKeysMask() {
  let m = 0;
  if (keys['KeyW']) m |= 1;
  if (keys['KeyS']) m |= 2;
  if (keys['KeyA']) m |= 4;
  if (keys['KeyD']) m |= 8;
  if (keys['Space']) m |= 16;
  return m;
}

const clock = new THREE.Clock();

function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!game_update) return;

  const dt = Math.min(clock.getDelta(), 0.1);
  const keysMask = getKeysMask();
  game_update(dt, keysMask, mouseDeltaX, mouseDeltaY, shootThisFrame ? 1 : 0);
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  shootThisFrame = false;

  const px = game_get_player_position(0);
  const py = game_get_player_position(1);
  const pz = game_get_player_position(2);
  const yaw = game_get_player_rotation(0);
  const pitch = game_get_player_rotation(1);
  const isMoving = game_get_is_moving();
  const isInAir = game_get_is_in_air();
  const runTime = game_get_run_time();

  const rootY = py - 0.5;
  character.position.set(px, rootY, pz);
  character.rotation.y = yaw;
  updateCharacterAnimation(!!isMoving, !!isInAir, runTime);

  const projCount = game_get_projectile_count();
  while (projectileMeshes.length < projCount) {
    const mesh = new THREE.Mesh(projectileGeom, projectileMat);
    scene.add(mesh);
    projectileMeshes.push(mesh);
  }
  while (projectileMeshes.length > projCount) {
    const mesh = projectileMeshes.pop();
    scene.remove(mesh);
  }
  for (let i = 0; i < projCount; i++) {
    const mesh = projectileMeshes[i];
    mesh.position.set(
      game_get_projectile(i, 0),
      game_get_projectile(i, 1),
      game_get_projectile(i, 2)
    );
  }

  const frontX = game_get_front(0);
  const frontY = game_get_front(1);
  const frontZ = game_get_front(2);
  camera.position.set(
    px - frontX * CAMERA_DISTANCE,
    py + CAMERA_HEIGHT - frontY * CAMERA_DISTANCE,
    pz - frontZ * CAMERA_DISTANCE
  );
  camera.lookAt(px, py, pz);

  // Update obstacle rotations (colors set once at init)
  if (obstacleInstances && obstacleCount > 0 && getObstacleRotation) {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < obstacleCount; i++) {
      const rot = getObstacleRotation(i);
      matrix.makeRotationZ(rot);
      matrix.setPosition(getObstacleX(i), getObstacleY(i), getObstacleZ(i));
      obstacleInstances.setMatrixAt(i, matrix);
    }
    obstacleInstances.instanceMatrix.needsUpdate = true;
  }

  renderer.render(scene, camera);
}

// Load WASM and start (wasm/game.js must be loaded via a normal <script> tag so Emscripten can set scriptDirectory)
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
    game_update = Module.cwrap('game_update', null, ['number', 'number', 'number', 'number', 'number']);
    const getPlayerX = Module.cwrap('game_get_player_x', 'number', []);
    const getPlayerY = Module.cwrap('game_get_player_y', 'number', []);
    const getPlayerZ = Module.cwrap('game_get_player_z', 'number', []);
    game_get_player_position = (axis) => (axis === 0 ? getPlayerX() : axis === 1 ? getPlayerY() : getPlayerZ());
    const getPlayerYaw = Module.cwrap('game_get_player_yaw', 'number', []);
    const getPlayerPitch = Module.cwrap('game_get_player_pitch', 'number', []);
    game_get_player_rotation = (axis) => (axis === 0 ? getPlayerYaw() : getPlayerPitch());
    const getFrontX = Module.cwrap('game_get_front_x', 'number', []);
    const getFrontY = Module.cwrap('game_get_front_y', 'number', []);
    const getFrontZ = Module.cwrap('game_get_front_z', 'number', []);
    game_get_front = (axis) => (axis === 0 ? getFrontX() : axis === 1 ? getFrontY() : getFrontZ());
    game_get_projectile_count = Module.cwrap('game_get_projectile_count', 'number', []);
    const getProjectileX = Module.cwrap('game_get_projectile_x', 'number', ['number']);
    const getProjectileY = Module.cwrap('game_get_projectile_y', 'number', ['number']);
    const getProjectileZ = Module.cwrap('game_get_projectile_z', 'number', ['number']);
    game_get_projectile = (i, axis) => (axis === 0 ? getProjectileX(i) : axis === 1 ? getProjectileY(i) : getProjectileZ(i));
    game_get_is_moving = Module.cwrap('game_get_is_moving', 'number', []);
    game_get_is_in_air = Module.cwrap('game_get_is_in_air', 'number', []);
    game_get_run_time = Module.cwrap('game_get_run_time', 'number', []);
    game_get_obstacle_count = Module.cwrap('game_get_obstacle_count', 'number', []);
    getObstacleX = Module.cwrap('game_get_obstacle_x', 'number', ['number']);
    getObstacleY = Module.cwrap('game_get_obstacle_y', 'number', ['number']);
    getObstacleZ = Module.cwrap('game_get_obstacle_z', 'number', ['number']);
    getObstacleRotation = Module.cwrap('game_get_obstacle_rotation', 'number', ['number']);
    getObstacleColor = Module.cwrap('game_get_obstacle_color', 'number', ['number']);

    Module.ccall('game_init', null, [], []);
    obstacleCount = game_get_obstacle_count();
    ensureObstacles(obstacleCount);
    // Set initial colors
    if (obstacleInstances && getObstacleColor) {
      const color = new THREE.Color();
      let sampleColor = null;
      for (let i = 0; i < obstacleCount; i++) {
        const colorValue = getObstacleColor(i);
        // WASM returns unsigned int as 0xRRGGBB, ensure it's treated as unsigned
        const hexValue = (colorValue >>> 0) & 0xFFFFFF; // Mask to 24-bit RGB
        color.setHex(hexValue);
        obstacleInstances.setColorAt(i, color);
        if (i === 0) sampleColor = hexValue; // Debug: log first color
      }
      if (obstacleInstances.instanceColor) {
        obstacleInstances.instanceColor.needsUpdate = true;
      }
      console.log('Set colors for', obstacleCount, 'cubes. Sample color:', '0x' + sampleColor.toString(16));
    }
    gameLoop();
  }
})();
