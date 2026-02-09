#ifndef GAME_H
#define GAME_H

#ifdef __cplusplus
extern "C" {
#endif

#define MAX_BULLETS 1000
#define MAX_ENEMIES 100000
#define MAX_PARTICLES 1000

void game_init(void);
void game_update(float dt, unsigned int keys_mask, float mouse_x, float mouse_y, int shoot, float canvas_width, float canvas_height);
void game_get_player_position(float* x, float* y);
float game_get_player_x(void);
float game_get_player_y(void);
float game_get_player_angle(void);
int game_get_bullet_count(void);
void game_get_bullet(int i, float* x, float* y, float* vx, float* vy);
float game_get_bullet_x(int i);
float game_get_bullet_y(int i);
float game_get_bullet_vx(int i);
float game_get_bullet_vy(int i);
int game_get_enemy_count(void);
void game_get_enemy(int i, float* x, float* y, float* width, float* height, float* rotation, unsigned int* color);
float game_get_enemy_x(int i);
float game_get_enemy_y(int i);
float game_get_enemy_width(int i);
float game_get_enemy_height(int i);
float game_get_enemy_rotation(int i);
unsigned int game_get_enemy_color(int i);
int game_get_particle_count(void);
void game_get_particle(int i, float* x, float* y, float* vx, float* vy, float* life, float* size, unsigned int* color);
float game_get_particle_x(int i);
float game_get_particle_y(int i);
float game_get_particle_vx(int i);
float game_get_particle_vy(int i);
float game_get_particle_life(int i);
float game_get_particle_size(int i);
unsigned int game_get_particle_color(int i);

#ifdef __cplusplus
}
#endif

#endif /* GAME_H */
