#ifndef GAME_H
#define GAME_H

#ifdef __cplusplus
extern "C" {
#endif

#define MAX_PROJECTILES 64
#define NUM_OBSTACLES 8000

void game_init(void);
void game_update(float dt, unsigned int keys_mask, float mouse_dx, float mouse_dy, int shoot);
void game_get_player_position(float* x, float* y, float* z);
float game_get_player_x(void);
float game_get_player_y(void);
float game_get_player_z(void);
void game_get_player_rotation(float* yaw, float* pitch);
float game_get_player_yaw(void);
float game_get_player_pitch(void);
void game_get_front(float* x, float* y, float* z);
float game_get_front_x(void);
float game_get_front_y(void);
float game_get_front_z(void);
int game_get_projectile_count(void);
void game_get_projectile(int i, float* x, float* y, float* z, float* vx, float* vy, float* vz);
float game_get_projectile_x(int i);
float game_get_projectile_y(int i);
float game_get_projectile_z(int i);
int game_get_obstacle_count(void);
void game_get_obstacle(int i, float* x, float* y, float* z);
float game_get_obstacle_x(int i);
float game_get_obstacle_y(int i);
float game_get_obstacle_z(int i);
float game_get_obstacle_rotation(int i);
unsigned int game_get_obstacle_color(int i);
int game_get_obstacle_type(int i);
int game_get_is_moving(void);
int game_get_is_in_air(void);
float game_get_run_time(void);

#ifdef __cplusplus
}
#endif

#endif /* GAME_H */
