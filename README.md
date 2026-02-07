# Cube Game – Web (WebAssembly)

A 3D browser game with **core logic in WebAssembly** (C, compiled via Emscripten) and **Three.js** for rendering. Move around, jump, and shoot in a simple blocky world.

## Build (required)

The game logic runs in WebAssembly. You must build the WASM module once before running the game.

**Option A – Emscripten already installed:**  
From the project root run `wasm\build.bat` (Windows) or `./wasm/build.sh` (Linux/macOS).

**Option B – Install Emscripten in this project (one-time):**

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
emsdk install latest
emsdk activate latest
```

Then either run `wasm\build.bat` from a shell where you’ve run `emsdk_env.bat` (Windows), or use the full path to `emsdk\upstream\emscripten\emcc.bat` when building.

Build output: `wasm/game.js` and `wasm/game.wasm`. Keep these in the repo (or build in CI) so the game loads.

**Obstacle shapes (cubes, spheres, triangles):** The game can show a mix of shapes only if the WASM module was built with the current build script (which exports `game_get_obstacle_type`). If you only see cubes, rebuild: from the project root, open a terminal, run `emsdk\emsdk_env.bat` (Windows) or `source emsdk/emsdk_env.sh` (Linux/macOS), then run `wasm\build.bat` or `./wasm/build.sh`. Refresh the game to see triangles and spheres.

## Run locally

Use a local HTTP server (browsers block `file://` for scripts and WASM):

```bash
npx serve .
```

Then open http://localhost:3000 (or the URL shown).

Or: `python -m http.server 8080` and open http://localhost:8080.

## GitHub Pages

1. Build the WASM module (see above) and commit `wasm/game.js` and `wasm/game.wasm`.
2. Push the repo to GitHub → **Settings** → **Pages**.
3. Set **Source** to **Deploy from a branch**, branch e.g. `main`, folder **/ (root)**.
4. The site will be at **https://\<your-username\>.github.io/\<repo-name\>/**.

Ensure `wasm/game.js` and `wasm/game.wasm` are deployed (not in `.gitignore`).

## Controls

- **Click** the canvas to lock the pointer and start.
- **W / A / S / D** – Move  
- **Shift** – Run (hold to move faster)  
- **Mouse** – Look  
- **Space** – Jump  
- **Left-click** – Shoot  
- **ESC** – Unlock pointer  

## Tech

- **WebAssembly** – Game logic (movement, physics, collision, projectiles) in C, built with Emscripten.
- **Three.js** (WebGL) – 3D scene, camera, character and projectile meshes, rendering.
- **JavaScript** – Loads the WASM module, handles input, and syncs WASM state to Three.js each frame.
