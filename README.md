# Food Desert Simulator

Food Desert Simulator is an interactive community analysis tool that helps people understand food access barriers and evaluate practical interventions.

## Why This Project Exists

Many communities face complex food-access problems that are hard to see with a single metric. This project brings key public datasets together and turns them into a transparent, explainable view of local conditions.

## Project Goals

1. Make food-access risk understandable for non-technical audiences.
2. Show clearly how classification decisions are made.
3. Provide practical impact estimates for intervention planning.
4. Keep data provenance visible so people can trust and challenge results.
5. Support scenario thinking, not just static reporting.

## Core Features

### 1) Location-based Community Analysis

Pick a US location and the app resolves tract context, demographics, health metrics, and food-access indicators.

### 2) Transparent Food Access Classification

The app reports a final designation and also shows the evidence behind it, including source agreement/disagreement and rule trace details.

### 3) Community-Average Distance Modeling

Instead of relying on a single point distance, the app estimates a sampled community-average grocery distance and keeps center-point nearest distance as a reference.

### 4) Health and Economic Impact Projection

The projection engine estimates:

1. Residents gaining access.
2. Diabetes/obesity directional impact.
3. Local economic impact and job range.
4. Per-trip true-cost before/after changes.

### 5) Scenario and Sensitivity Tools

Users can preview threshold sensitivity, compare baseline vs current scenarios, and inspect how assumptions change outcomes.

### 6) Explainability-First Interface

The product includes:

1. Source confidence badges.
2. Evaluation trace drawer.
3. Policy diagnostics logs.
4. Clear Unknown states when data is missing.

### 7) Nutritional Health Education Tab

The landing page includes a Nutritional Health feature with tabbed content that explains:

1. The benefits of proper nutrition, including stronger immunity, better cognitive performance, and reduced chronic disease risk.
2. The harsh effects of malnutrition, including developmental harm, higher hospitalization burden, and long-term economic stress.

## Intended Audience

1. Community advocates and organizers.
2. Public health and planning teams.
3. Students and civic-tech participants.
4. Nonprofit and policy stakeholders.

## Data Sources

1. USDA Food Access Research Atlas
2. CDC PLACES
3. US Census ACS
4. OpenStreetMap via Overpass

## Important Notes

1. Distance values are model estimates, not guaranteed road-network travel distances.
2. Data coverage quality can vary by geography.
3. Unknown outcomes are intentional when required evidence is unavailable.

## Local Development

Install dependencies and run:

1. npm install
2. npm run dev

Validation:

1. npm test -- --runInBand
2. npm run build

## Vision

The long-term vision is a community planning companion that is both analytically rigorous and understandable by everyday users, so local action can be based on evidence rather than guesswork.
