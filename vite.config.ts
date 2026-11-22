import { optimizeGLTF } from "@iwsdk/vite-plugin-gltf-optimizer";
import { injectIWER } from "@iwsdk/vite-plugin-iwer";

import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import path from "path";
import { networkInterfaces } from "os";
import {performanceBuildReport} from './scripts/performance-build-report';
import {spatialFontAssets} from './scripts/spatial-font-assets';
import {preserveAuthoredGLTF} from './scripts/preserve-authored-gltf';

const projectRoot = process.cwd();

function getNetworkUrl(port: number, protocol: string): string | null {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        return `${protocol}://${iface.address}:${port}`;
      }
    }
  }
  return null;
}

function qrTerminal(): Plugin {
  return {
    name: "qr-terminal",
    configureServer(server) {
      server.httpServer?.once("listening", async () => {
        const addr = server.httpServer?.address();
        if (!addr || typeof addr === "string") return;
        const protocol = server.config.server.https ? "https" : "http";
        const url = getNetworkUrl(addr.port, protocol);
        if (!url) return;

        try {
          const { default: QRCode } = await import("qrcode");
          const qr = await QRCode.toString(url, {
            type: "terminal",
            small: true,
          });
          console.log("\n📱 Scan to open on another device:\n");
          console.log(qr);
          console.log(`  → ${url}\n`);
        } catch {
          console.log(`\n📱 Network URL: ${url}\n`);
        }
      });
    },
  };
}

function studioXRDevEmulation():Plugin {
 const plugin=injectIWER({device:'metaQuest3',activation:'localhost',injectOnBuild:false,verbose:true,sem:{defaultScene:'living_room'}});
 const hook=plugin.transformIndexHtml as {order:'pre';handler:Function};
 return {...plugin,transformIndexHtml:{order:'pre',handler(html,context){
  // Learning and instrument pages do not need the emulator, even in this opt-in run.
  if(context.path!=='/'&&context.path!=='/index.html')return html;
  return hook.handler(html,context);
 }}};
}

export default defineConfig({
  plugins: [
    qrTerminal(),
    spatialFontAssets(),
    ...(process.env.RHODA_BUILD_REPORT==='1'?[performanceBuildReport()]:[]),
    // Emulation is a development aid; native XR works without this injected runtime.
    ...(process.env.RHODA_XR_EMULATION==='1'?[studioXRDevEmulation()]:[]),

    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
    optimizeGLTF({
      level: "medium",
      // This companion already has compressed textures and morph targets.
      // Reprocessing it inflates the authored 2.7 MB asset to about 5 MB.
      exclude: /(?:^|[\\/])lab-companion\.glb$/i,
    }),
    // 0.2.1 ignores exclude for public/gltf sources; restore and verify after it.
    preserveAuthoredGLTF(),
  ],
  server: {
    host: "0.0.0.0",
    port: 8081,
    open: true,
    // Test artifacts include browser profile files locked by Chromium on Windows.
    // They and the Python environment are not application sources to hot reload.
    watch: { ignored: ['**/.tmp/**', '**/.venv/**'] },
    // Same-origin browser requests also work from a phone/headset and over HTTPS.
    // Production hosts should route /api to the backend or set VITE_INSTRUMENT_API.
    proxy: { '/api': { target: 'http://127.0.0.1:5001', changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (outgoing, incoming) => {
          // The local proxy already provides the same-origin route. Preserve
          // unrelated origins so the backend still rejects cross-site requests.
          const origin=incoming.headers.origin;
          if(typeof origin==='string')try{if(new URL(origin).host===incoming.headers.host)outgoing.removeHeader('origin');}catch{}
        });
      },
    } },
    // Prefer local HTTPS certs when available (for WebXR on Quest),
    // otherwise fall back to plain HTTP for local development.
    https: (() => {
      const keyPath = path.resolve(__dirname, "localhost+3-key.pem");
      const certPath = path.resolve(__dirname, "localhost+3.pem");
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        return {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        };
      }
      console.warn("HTTPS certs not found; running dev server without HTTPS.");
      return undefined;
    })(),
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: {
      input: {
        desktop: path.resolve(projectRoot, "desktop.html"),
        main: path.resolve(projectRoot, "index.html"),
        chat: path.resolve(projectRoot, "chat.html"),
        library: path.resolve(projectRoot, "library.html"),
        practice: path.resolve(projectRoot, "practice.html"),
        spatialBench: path.resolve(projectRoot, "spatial-bench.html"),
        instruments: path.resolve(projectRoot, "instruments.html"),
        instructor: path.resolve(projectRoot, "instructor.html"),
      },
    },
  },
  resolve: {
    // Keep the junction path stable so Rollup emits workspace-relative entry names.
    preserveSymlinks: true,
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    // The XR dependency graph contains packages whose package metadata causes
    // Vite's automatic scanner to dereference an undefined import map on
    // Windows. Keep dev startup deterministic; Vite still transforms imports
    // on demand.
    noDiscovery: true,
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
  base: "./",
});
