// 2D Side-Scrolling Shooter Game

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Set canvas size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Game state
const player = {
  x: 100,
  y: canvas.height / 2,
  width: 40,
  height: 40,
  speed: 5,
  angle: 0
};

const bullets = [];
const enemies = [];
const particles = [];

// Input state
const keys = {};
let mouseX = 0;
let mouseY = 0;
let isShooting = false;
let shootCooldown = 0;
const SHOOT_COOLDOWN = 0.1; // seconds between shots

// Background scroll
let backgroundX = 0;
const BACKGROUND_SPEED = 1;

// Initialize
function init() {
  // Create initial enemies
  for (let i = 0; i < 100000; i++) {
    spawnEnemy();
  }
}

function spawnEnemy() {
  const size = 15 + Math.random() * 30; // Random size between 15 and 45
  const hue = Math.random() * 360; // Random hue for color
  enemies.push({
    x: canvas.width + Math.random() * 50000, // Spread across a much wider area
    y: Math.random() * canvas.height,
    width: size,
    height: size,
    speed: 2 + Math.random() * 2,
    health: 1,
    color: `hsl(${hue}, 70%, 50%)`, // Random color using HSL
    rotation: Math.random() * Math.PI * 2, // Random initial rotation
    rotationSpeed: (Math.random() - 0.5) * 0.1 // Random rotation speed
  });
}

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
  player.y = Math.min(player.y, canvas.height - player.height);
});

// Update game state
function update(deltaTime) {
  // Player movement
  if (keys['KeyW'] || keys['Keyw']) {
    player.y = Math.max(0, player.y - player.speed);
  }
  if (keys['KeyS'] || keys['Keys']) {
    player.y = Math.min(canvas.height - player.height, player.y + player.speed);
  }
  if (keys['KeyA'] || keys['Keya']) {
    player.x = Math.max(0, player.x - player.speed);
  }
  if (keys['KeyD'] || keys['Keyd']) {
    player.x = Math.min(canvas.width - player.width, player.x + player.speed);
  }

  // Calculate angle to mouse
  const dx = mouseX - (player.x + player.width / 2);
  const dy = mouseY - (player.y + player.height / 2);
  player.angle = Math.atan2(dy, dx);

  // Shooting
  shootCooldown -= deltaTime;
  if (isShooting && shootCooldown <= 0) {
    shootCooldown = SHOOT_COOLDOWN;
    const bulletSpeed = 10;
    bullets.push({
      x: player.x + player.width / 2,
      y: player.y + player.height / 2,
      vx: Math.cos(player.angle) * bulletSpeed,
      vy: Math.sin(player.angle) * bulletSpeed,
      radius: 5,
      life: 2 // seconds
    });
  }

  // Update bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    bullet.life -= deltaTime;

    // Remove bullets that are off screen or expired
    if (bullet.life <= 0 || 
        bullet.x < 0 || bullet.x > canvas.width ||
        bullet.y < 0 || bullet.y > canvas.height) {
      bullets.splice(i, 1);
      continue;
    }

    // Check collision with enemies
    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];
      const dist = Math.sqrt(
        Math.pow(bullet.x - (enemy.x + enemy.width / 2), 2) +
        Math.pow(bullet.y - (enemy.y + enemy.height / 2), 2)
      );
      
      if (dist < bullet.radius + Math.max(enemy.width, enemy.height) / 2) {
        // Hit!
        enemies.splice(j, 1);
        bullets.splice(i, 1);
        
        // Create explosion particles
        for (let k = 0; k < 8; k++) {
          particles.push({
            x: enemy.x + enemy.width / 2,
            y: enemy.y + enemy.height / 2,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 0.5,
            size: 3 + Math.random() * 3,
            color: enemy.color // Use enemy's color for particles
          });
        }
        
        // Spawn new enemy
        spawnEnemy();
        break;
      }
    }
  }

  // Update enemies
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    enemy.x -= enemy.speed;
    enemy.rotation += enemy.rotationSpeed; // Rotate enemy
    
    // Remove enemies that are off screen
    if (enemy.x + enemy.width < 0) {
      enemies.splice(i, 1);
      spawnEnemy();
    }
  }

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life -= deltaTime;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    
    if (particle.life <= 0) {
      particles.splice(i, 1);
    }
  }

  // Scroll background
  backgroundX -= BACKGROUND_SPEED;
  if (backgroundX <= -canvas.width) {
    backgroundX = 0;
  }
}

// Render game
function render() {
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

  // Draw enemies
  for (const enemy of enemies) {
    ctx.save();
    // Move to enemy center for rotation
    const centerX = enemy.x + enemy.width / 2;
    const centerY = enemy.y + enemy.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(enemy.rotation);
    
    // Draw enemy body with random color
    ctx.fillStyle = enemy.color;
    ctx.fillRect(-enemy.width / 2, -enemy.height / 2, enemy.width, enemy.height);
    
    // Draw enemy "eyes" (scaled to enemy size)
    const eyeSize = Math.max(3, enemy.width / 8);
    const eyeOffsetX = enemy.width / 4;
    const eyeOffsetY = -enemy.height / 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-eyeOffsetX - eyeSize / 2, eyeOffsetY - eyeSize / 2, eyeSize, eyeSize);
    ctx.fillRect(eyeOffsetX - eyeSize / 2, eyeOffsetY - eyeSize / 2, eyeSize, eyeSize);
    
    ctx.restore();
  }

  // Draw bullets
  ctx.fillStyle = '#ffff00';
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw particles
  for (const particle of particles) {
    const alpha = particle.life / 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (particle.color) {
      ctx.fillStyle = particle.color;
    } else {
      ctx.fillStyle = '#ffc800'; // Default yellow
    }
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw player
  ctx.save();
  ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
  ctx.rotate(player.angle);
  ctx.fillStyle = '#5999ff';
  ctx.fillRect(-player.width / 2, -player.height / 2, player.width, player.height);
  
  // Draw gun barrel
  ctx.fillStyle = '#333333';
  ctx.fillRect(player.width / 2 - 5, -3, 15, 6);
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

// Start game
init();
gameLoop(0);
