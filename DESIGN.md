<!-- SEED — re-run $impeccable document once there's code to capture the actual tokens and components. -->
---
name: Sitbench
description: A disciplined tactical instrument for comparing EVE Online PvE site runs.
---

# Design System: Sitbench

## Overview

**Creative North Star: "The Fleet Debrief Console"**

Sitbench is a dense analytical instrument used after a fleet session, not a decorative gaming dashboard. Its hierarchy should resemble an experienced operator's debrief surface: current timing and deltas are immediate, detailed evidence remains close, and controls stay familiar under repeated use.

The visual direction combines EVE Online's Overview, Bloomberg Terminal's information density, and Grafana's readable data visualization. It must not copy EVE chrome literally. It rejects generic SaaS card grids, oversized decorative metrics, neon gaming aesthetics, glassmorphism, and synthetic scores.

**Key Characteristics:**
- Dense and deliberately ordered
- Restrained color with tactical emphasis
- Tabular timing and comparison data
- Flat, responsive controls
- Visible uncertainty and parser coverage

## Colors

Use cool graphite neutrals with one sparse amber tactical accent. Exact values will be resolved during implementation.

### Primary
- **Tactical Amber** ([to be resolved during implementation]): Primary selection, focus, and the most important comparison emphasis only.

### Neutral
- **Console Graphite** ([to be resolved during implementation]): Main background.
- **Instrument Panel** ([to be resolved during implementation]): Secondary surface and control background.
- **Signal Text** ([to be resolved during implementation]): Primary text and critical values.
- **Muted Telemetry** ([to be resolved during implementation]): Labels, metadata, and secondary values.

**The Sparse Signal Rule.** Amber remains below ten percent of the surface. Its rarity carries meaning.

## Typography

**Display Font:** [technical sans family to be chosen during implementation]
**Body Font:** [technical sans family to be chosen during implementation]
**Label/Mono Font:** [tabular or monospaced numeric family to be chosen during implementation]

**Character:** One compact technical sans-serif carries the interface. Timings, DPS, percentages, and deltas use tabular or monospaced numerals so columns compare without visual jitter.

### Hierarchy
- **Display:** Used only for the selected run's primary elapsed time.
- **Headline:** Section names and the most important comparison label.
- **Title:** Table groups and selected-run identity.
- **Body:** Dense supporting content with prose capped near 70 characters.
- **Label:** Compact metadata and control labels, never decorative filler.

**The Numbers Hold Position Rule.** Comparable metrics always use tabular numerals and stable alignment.

## Elevation

The interface is flat by default. Depth comes from tonal surface changes and fine full borders, not decorative shadows. Temporary interaction states may use a restrained ambient shadow only when needed to separate an active control.

**The Flat Instrument Rule.** If a panel needs a large shadow to read as distinct, its hierarchy or surface tone is wrong.

## Do's and Don'ts

### Do:
- **Do** lead with elapsed time and meaningful deltas.
- **Do** keep parser coverage and uncertainty visible near affected metrics.
- **Do** use dense tables, stable numeric alignment, and familiar controls.
- **Do** use restrained motion only for state feedback and respect reduced motion.
- **Do** preserve keyboard focus, readable contrast, labels, and non-color-only status cues.

### Don't:
- **Don't** build a generic SaaS dashboard from large identical cards.
- **Don't** use oversized decorative metrics or a synthetic performance score.
- **Don't** use neon gaming aesthetics, glassmorphism, or literal imitation of EVE's interface.
- **Don't** use colored side-stripe borders, gradient text, or decorative page-load motion.
- **Don't** let tactical flavor obscure standard controls or data hierarchy.
