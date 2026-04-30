# Food Desert Simulator

Food Desert Simulator is an explainability-first React app for exploring US food access conditions, classifying designation status, and modeling intervention impact.

## Purpose

This project combines USDA, CDC, Census, and OSM-derived signals to help users answer three questions:

1. What is the current food access designation in this community?
2. Why did the system make that designation?
3. What changes are likely if we apply an intervention scenario?

## Current Feature Set

1. Location-driven tract analysis with merged public datasets.
2. Transparent designation output with evidence trace and confidence context.
3. Community-average supermarket distance model with center-point reference value.
4. Impact projections for access, health directionality, local economics, and trip true-cost.
5. Scenario save/compare and threshold sensitivity workflows.
6. Nationwide US designation map mode with zoom-aware in-view summaries.
7. Landing experience with animated intro and educational content.

## Quick Start (Any IDE)

This repository is IDE-agnostic and runs from terminal commands only.

### Prerequisites

1. Node.js 20+ (recommended) and npm.
2. Network access for public API/data providers.

### Setup

1. Install dependencies:
	- `npm install`
2. Provide environment values in `.env`:
	- `VITE_CENSUS_KEY`
	- `VITE_ANTHROPIC_KEY`

The template file `.env.example` is included.

### Run Local Dev Server

- `npm run dev -- --host 127.0.0.1 --port 5173`

### Build/Lint/Test

1. Lint: `npm run lint`
2. Unit tests: `npm test`
3. Production build: `npm run build`
4. Local preview of built app: `npm run preview`

## IDE Migration Notes

Use this checklist when switching from VS Code to another IDE (Cursor, WebStorm, Zed, etc.).

1. Open the repository root (`food-desert-simulator`) as the project root.
2. Confirm Node interpreter points to Node 20+.
3. Ensure `.env` is loaded for run configurations.
4. Set run command to `npm run dev -- --host 127.0.0.1 --port 5173`.
5. Set validation commands to `npm run lint`, `npm test`, and `npm run build`.
6. If your IDE has import alias settings, keep `@` mapped to `src` to match Vite config.

## Project Structure (High Level)

1. App shell and tracker routing:
	- `src/App.jsx`
	- `src/TrackerApp.jsx`
2. Data pipeline:
	- `src/pipeline/*.js`
3. Simulation and classification engines:
	- `src/engine/*.js`
4. Main UI surfaces:
	- `src/components/*.jsx`
	- `src/ui/landing/LandingPage.tsx`
5. Unit tests:
	- `tests/*.test.js`

## Data Sources

1. USDA Food Access Research Atlas
2. CDC PLACES
3. US Census ACS
4. OpenStreetMap / Overpass

## Caveats

1. Distance metrics are model estimates (not guaranteed road-network travel distance/time).
2. Upstream coverage and quality vary by geography.
3. Unknown outputs are intentional when required evidence is missing.

## Technical Handoff

For implementation-level transfer details, see `PROJECT_HANDOFF.md`.
