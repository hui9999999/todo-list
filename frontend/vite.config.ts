import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { foodImageAssets } from './src/food-image-assets';
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
const componentStyles = [
  "alert",
  "base",
  "button",
  "checkbox",
  "config-provider",
  "date-picker",
  "drawer",
  "dialog",
  "dropdown",
  "dropdown-item",
  "dropdown-menu",
  "form",
  "form-item",
  "icon",
  "input",
  "message",
  "message-box",
  "option",
  "radio-button",
  "radio",
  "radio-group",
  "segmented",
  "select",
  "table",
  "table-column",
  "time-picker",
  "tag",
].map((name) => `element-plus/es/components/${name}/style/css`);
export default defineConfig(({mode, command}) => ({
  // APKs contain only the compressed images used by the catalog, not the source PNG collection.
  publicDir: mode === 'android' && command === 'build' ? false : 'public',
  build: mode === 'android' ? { target: 'chrome111' } : {},
  plugins: [
    ...(mode === 'android' ? [{
      name: 'android-public-assets',
      closeBundle() {
        const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
        const outputRoot = fileURLToPath(new URL('./dist-android/', import.meta.url));
        mkdirSync(outputRoot, {recursive: true});
        for (const entry of readdirSync(publicRoot)) {
          if (entry !== 'food') cpSync(join(publicRoot, entry), join(outputRoot, entry), {recursive: true});
        }
        for (const assets of Object.values(foodImageAssets)) {
          for (const asset of [assets.image, assets.thumbnail]) {
            const relative = asset.replace(/^\//, '');
            mkdirSync(join(outputRoot, 'food/optimized'), {recursive: true});
            cpSync(join(publicRoot, relative), join(outputRoot, relative));
          }
        }
      },
    }] : []),
    vue(),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: "src/components.d.ts",
    }),
  ],
  // Prebundle lazy-page styles as well, avoiding optimizer reloads during login.
  optimizeDeps: { include: ["element-plus/es", ...componentStyles] },
  server: {
    port: 5174,
    strictPort: true,
    // Shared pet renderers resolve their image atlases from desktop/assets.
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../desktop", import.meta.url)),
      ],
    },
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
}));
