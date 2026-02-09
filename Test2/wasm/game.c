#include "game.h"
#include <math.h>
#include <string.h>

/* Constants */
#define PLAYER_SPEED 5.f
#define BULLET_SPEED 10.f
#define BULLET_RADIUS 5.f
#define BULLET_LIFETIME 2.f
#define ENEMY_MIN_SIZE 15.f
#define ENEMY_MAX_SIZE 45.f
#define ENEMY_MIN_SPEED 2.f
#define ENEMY_MAX_SPEED 4.f
#define ENEMY_SPAWN_DISTANCE 50000.f
#define PARTICLE_LIFETIME 0.5f
#define SHOOT_COOLDOWN_TIME 0.1f

/* Structures */
typedef struct {
  float x, y;
  float vx, vy;
  float life;
} Bullet;

typedef struct {
  float x, y;
  float width, height;
  float speed;
  float rotation;
  float rotationSpeed;
  unsigned int color; /* RGB packed as 0xRRGGBB */
  int active;
} Enemy;

typedef struct {
  float x, y;
  float vx, vy;
  float life;
  float size;
  unsigned int color;
} Particle;

/* Game state */
static float player_x = 100.f;
static float player_y = 400.f;
static float player_width = 40.f;
static float player_height = 40.f;
static float player_angle = 0.f;

static Bullet bullets[MAX_BULLETS];
static int bullet_count = 0;
static float shoot_cooldown = 0.f;

static Enemy enemies[MAX_ENEMIES];
static int enemy_count = 0;

static Particle particles[MAX_PARTICLES];
static int particle_count = 0;

static float canvas_width = 800.f;
static float canvas_height = 600.f;

/* RNG */
static unsigned int rng_state = 12345u;

static unsigned int rng_next(void) {
  unsigned int x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rng_state = x;
  return x;
}

static float rng_float(float min_val, float max_val) {
  return min_val + (max_val - min_val) * ((float)(rng_next() % 65536u) / 65536.f);
}

/* HSL to RGB conversion */
static unsigned int hsl_to_rgb(float h, float s, float l) {
  /* Normalize hue to 0-360 */
  while (h < 0.f) h += 360.f;
  while (h >= 360.f) h -= 360.f;
  
  float c = (1.f - fabsf(2.f * l - 1.f)) * s;
  float h_norm = h / 60.f;
  int sector = (int)h_norm;
  float x = c * (1.f - fabsf((h_norm - (float)sector) * 2.f - 1.f));
  float m = l - c / 2.f;
  float r, g, b;
  
  if (sector == 0) { r = c; g = x; b = 0.f; }
  else if (sector == 1) { r = x; g = c; b = 0.f; }
  else if (sector == 2) { r = 0.f; g = c; b = x; }
  else if (sector == 3) { r = 0.f; g = x; b = c; }
  else if (sector == 4) { r = x; g = 0.f; b = c; }
  else { r = c; g = 0.f; b = x; }
  
  unsigned int ur = (unsigned int)((r + m) * 255.f);
  unsigned int ug = (unsigned int)((g + m) * 255.f);
  unsigned int ub = (unsigned int)((b + m) * 255.f);
  if (ur > 255) ur = 255;
  if (ug > 255) ug = 255;
  if (ub > 255) ub = 255;
  return (ur << 16) | (ug << 8) | ub;
}

static void spawn_enemy(void) {
  if (enemy_count >= MAX_ENEMIES) return;
  
  Enemy* e = &enemies[enemy_count++];
  e->x = canvas_width + rng_float(0.f, ENEMY_SPAWN_DISTANCE);
  e->y = rng_float(0.f, canvas_height);
  e->width = rng_float(ENEMY_MIN_SIZE, ENEMY_MAX_SIZE);
  e->height = e->width; /* Square enemies */
  e->speed = rng_float(ENEMY_MIN_SPEED, ENEMY_MAX_SPEED);
  e->rotation = rng_float(0.f, 6.28318530718f);
  e->rotationSpeed = rng_float(-0.05f, 0.05f);
  float hue = rng_float(0.f, 360.f);
  e->color = hsl_to_rgb(hue, 0.7f, 0.5f);
  e->active = 1;
}

void game_init(void) {
  player_x = 100.f;
  player_y = 400.f;
  player_angle = 0.f;
  bullet_count = 0;
  enemy_count = 0;
  particle_count = 0;
  shoot_cooldown = 0.f;
  rng_state = 12345u;
  
  /* Spawn initial enemies */
  for (int i = 0; i < 100000 && i < MAX_ENEMIES; i++) {
    spawn_enemy();
  }
}

void game_update(float dt, unsigned int keys_mask, float mouse_x, float mouse_y, int shoot, float cw, float ch) {
  canvas_width = cw;
  canvas_height = ch;
  
  if (dt > 0.1f) dt = 0.1f;
  
  /* Player movement */
  if (keys_mask & 1) { /* W */
    player_y = fmaxf(0.f, player_y - PLAYER_SPEED);
  }
  if (keys_mask & 2) { /* S */
    player_y = fminf(canvas_height - player_height, player_y + PLAYER_SPEED);
  }
  if (keys_mask & 4) { /* A */
    player_x = fmaxf(0.f, player_x - PLAYER_SPEED);
  }
  if (keys_mask & 8) { /* D */
    player_x = fminf(canvas_width - player_width, player_x + PLAYER_SPEED);
  }
  
  /* Calculate angle to mouse */
  float dx = mouse_x - (player_x + player_width / 2.f);
  float dy = mouse_y - (player_y + player_height / 2.f);
  player_angle = atan2f(dy, dx);
  
  /* Shooting */
  shoot_cooldown -= dt;
  if (shoot && shoot_cooldown <= 0.f && bullet_count < MAX_BULLETS) {
    shoot_cooldown = SHOOT_COOLDOWN_TIME;
    Bullet* b = &bullets[bullet_count++];
    b->x = player_x + player_width / 2.f;
    b->y = player_y + player_height / 2.f;
    b->vx = cosf(player_angle) * BULLET_SPEED;
    b->vy = sinf(player_angle) * BULLET_SPEED;
    b->life = BULLET_LIFETIME;
  }
  
  /* Update bullets */
  for (int i = bullet_count - 1; i >= 0; i--) {
    Bullet* b = &bullets[i];
    b->x += b->vx * dt;
    b->y += b->vy * dt;
    b->life -= dt;
    
    int remove = 0;
    if (b->life <= 0.f || b->x < 0.f || b->x > canvas_width || b->y < 0.f || b->y > canvas_height) {
      remove = 1;
    }
    
    /* Check collision with enemies */
    if (!remove) {
      for (int j = enemy_count - 1; j >= 0; j--) {
        Enemy* e = &enemies[j];
        if (!e->active) continue;
        
        float ex = e->x + e->width / 2.f;
        float ey = e->y + e->height / 2.f;
        float dist = sqrtf((b->x - ex) * (b->x - ex) + (b->y - ey) * (b->y - ey));
        float enemy_radius = fmaxf(e->width, e->height) / 2.f;
        
        if (dist < BULLET_RADIUS + enemy_radius) {
          /* Hit! */
          e->active = 0;
          remove = 1;
          
          /* Create explosion particles */
          for (int k = 0; k < 8 && particle_count < MAX_PARTICLES; k++) {
            Particle* p = &particles[particle_count++];
            p->x = ex;
            p->y = ey;
            p->vx = rng_float(-2.f, 2.f);
            p->vy = rng_float(-2.f, 2.f);
            p->life = PARTICLE_LIFETIME;
            p->size = rng_float(3.f, 6.f);
            p->color = e->color;
          }
          
          /* Spawn new enemy */
          if (enemy_count < MAX_ENEMIES) {
            spawn_enemy();
          }
          break;
        }
      }
    }
    
    if (remove) {
      bullets[i] = bullets[--bullet_count];
    }
  }
  
  /* Update enemies */
  for (int i = enemy_count - 1; i >= 0; i--) {
    Enemy* e = &enemies[i];
    if (!e->active) continue;
    
    e->x -= e->speed;
    e->rotation += e->rotationSpeed;
    
    /* Remove enemies that are off screen */
    if (e->x + e->width < 0.f) {
      e->active = 0;
      if (enemy_count < MAX_ENEMIES) {
        spawn_enemy();
      }
    }
  }
  
  /* Update particles */
  for (int i = particle_count - 1; i >= 0; i--) {
    Particle* p = &particles[i];
    p->x += p->vx * dt;
    p->y += p->vy * dt;
    p->life -= dt;
    p->vx *= 0.98f;
    p->vy *= 0.98f;
    
    if (p->life <= 0.f) {
      particles[i] = particles[--particle_count];
    }
  }
}

/* Player getters */
void game_get_player_position(float* x, float* y) {
  *x = player_x;
  *y = player_y;
}

float game_get_player_x(void) { return player_x; }
float game_get_player_y(void) { return player_y; }
float game_get_player_angle(void) { return player_angle; }

/* Bullet getters */
int game_get_bullet_count(void) { return bullet_count; }

void game_get_bullet(int i, float* x, float* y, float* vx, float* vy) {
  if (i < 0 || i >= bullet_count) return;
  Bullet* b = &bullets[i];
  *x = b->x;
  *y = b->y;
  *vx = b->vx;
  *vy = b->vy;
}

float game_get_bullet_x(int i) { return (i >= 0 && i < bullet_count) ? bullets[i].x : 0.f; }
float game_get_bullet_y(int i) { return (i >= 0 && i < bullet_count) ? bullets[i].y : 0.f; }
float game_get_bullet_vx(int i) { return (i >= 0 && i < bullet_count) ? bullets[i].vx : 0.f; }
float game_get_bullet_vy(int i) { return (i >= 0 && i < bullet_count) ? bullets[i].vy : 0.f; }

/* Enemy getters */
int game_get_enemy_count(void) { return enemy_count; }

void game_get_enemy(int i, float* x, float* y, float* width, float* height, float* rotation, unsigned int* color) {
  if (i < 0 || i >= enemy_count) return;
  Enemy* e = &enemies[i];
  *x = e->x;
  *y = e->y;
  *width = e->width;
  *height = e->height;
  *rotation = e->rotation;
  *color = e->color;
}

float game_get_enemy_x(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].x : 0.f; }
float game_get_enemy_y(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].y : 0.f; }
float game_get_enemy_width(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].width : 0.f; }
float game_get_enemy_height(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].height : 0.f; }
float game_get_enemy_rotation(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].rotation : 0.f; }
unsigned int game_get_enemy_color(int i) { return (i >= 0 && i < enemy_count) ? enemies[i].color : 0x808080; }

/* Particle getters */
int game_get_particle_count(void) { return particle_count; }

void game_get_particle(int i, float* x, float* y, float* vx, float* vy, float* life, float* size, unsigned int* color) {
  if (i < 0 || i >= particle_count) return;
  Particle* p = &particles[i];
  *x = p->x;
  *y = p->y;
  *vx = p->vx;
  *vy = p->vy;
  *life = p->life;
  *size = p->size;
  *color = p->color;
}

float game_get_particle_x(int i) { return (i >= 0 && i < particle_count) ? particles[i].x : 0.f; }
float game_get_particle_y(int i) { return (i >= 0 && i < particle_count) ? particles[i].y : 0.f; }
float game_get_particle_vx(int i) { return (i >= 0 && i < particle_count) ? particles[i].vx : 0.f; }
float game_get_particle_vy(int i) { return (i >= 0 && i < particle_count) ? particles[i].vy : 0.f; }
float game_get_particle_life(int i) { return (i >= 0 && i < particle_count) ? particles[i].life : 0.f; }
float game_get_particle_size(int i) { return (i >= 0 && i < particle_count) ? particles[i].size : 0.f; }
unsigned int game_get_particle_color(int i) { return (i >= 0 && i < particle_count) ? particles[i].color : 0x808080; }
