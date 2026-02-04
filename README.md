# Cube Game – Web

A 3D browser game built with Three.js. Move around, jump, and shoot in a simple blocky world.

## GitHub Pages

This repo is set up to run on **GitHub Pages** as a static site.

1. Push this repository to GitHub.
2. Open the repo on GitHub → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose your default branch (e.g. `main`) and folder **/ (root)**.
5. Click **Save**. After a minute or two, the site will be at:
   - **https://\<your-username\>.github.io/\<repo-name\>/**  
   (e.g. `https://myuser.github.io/CursorProjectTest4/`)

No build step is required; the site is plain HTML and JS.

## Run locally

Use a local HTTP server (some browsers block `file://` for scripts):

```bash
npx serve .
```

Then open http://localhost:3000 (or the URL shown).

Or from the project root: `python -m http.server 8080` and open http://localhost:8080.

## Controls

- **Click** the canvas to lock the pointer and start.
- **W / A / S / D** – Move  
- **Mouse** – Look  
- **Space** – Jump  
- **Left-click** – Shoot  
- **ESC** – Unlock pointer  

## Tech

- **Three.js** (WebGL) for 3D
- Plain JavaScript, no build step
