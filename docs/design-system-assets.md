# Design System And Asset Register

## Visual Direction

- Direction: modern board-game club with restrained walnut, green baize and brass accents.
- UI chrome stays flat and dark. Texture, depth and shadows belong to physical game objects, tables and pieces.
- Game covers are navigation thumbnails, not rules panels or reproductions of publisher packaging.
- Motion must communicate state: pick up, drag, dock, deal, flip, roll or win. Decorative looping motion is avoided.

## Runtime Libraries

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `motion` | 12.42.2 | MIT | Lazy-loaded shared layout transition from a game box to the selection tray. |
| `lucide-react` | 0.562.0 | ISC | Consistent command and status icons. |
| `@radix-ui/themes` | 3.3.0 | MIT | Accessible buttons, inputs and theme primitives. |
| `three` | 0.185.1 | MIT | Existing 3D board and piece rendering where a spatial view is part of play. |
| `matter-js` | 0.20.0 | MIT | Existing Alkkagi collision and flick physics. |

Motion uses `LazyMotion` and a dynamically imported `domMax` feature bundle. The animation engine is not loaded on the home screen. Reduced-motion preferences are respected.

Official references:

- Motion layout animations: https://motion.dev/docs/react-layout-animations
- Motion bundle-size guidance: https://motion.dev/docs/react-reduce-bundle-size
- Lucide: https://lucide.dev/
- Radix styling: https://www.radix-ui.com/themes/docs/overview/styling

## Project Images

| Path | Purpose | Origin |
| --- | --- | --- |
| `public/assets/materials/walnut.webp` | Table rails and physical wooden surfaces | Generated specifically for this project; 512px WebP. |
| `public/assets/materials/felt.webp` | Table baize and lobby play surface | Generated specifically for this project; 512px WebP. |
| `public/board-assets/game-covers/*` | Game-selection cover art | Project-local preview art; do not present it as official publisher packaging. |
| `public/board-assets/game-markers/*` | Kkukkkuki player pieces | Project-local generated markers. |
| `public/board-assets/masterpieces/*` | Masterpiece Copy reference paintings | Public-domain Van Gogh subjects; keep source provenance documented when replacing files. |

The new material textures were exported at roughly 8 KB and 28 KB. They are used under dark overlays so text contrast does not depend on the image.

## External Asset Policy

External board-game product photography is not copied into the application. When a new neutral material is required, use a project-generated asset or a clearly licensed source. Poly Haven is an acceptable fallback because its published assets are CC0: https://polyhaven.com/license

Before adding an asset:

1. Confirm redistribution and commercial-use rights.
2. Convert raster assets to WebP or AVIF at the rendered size.
3. Keep text out of cover artwork; render labels as accessible HTML.
4. Provide a fallback for failed image loading.
5. Verify contrast at 360px and 1280px.
