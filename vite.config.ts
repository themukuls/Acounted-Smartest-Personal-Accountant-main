import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import obfuscatorPlugin from 'rollup-plugin-javascript-obfuscator';

export default defineConfig(({ mode }) => ({
  base: '/',
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    mode === 'production' && obfuscatorPlugin({
      compact: true,
      controlFlowFlattening: true,
      deadCodeInjection: true,
      debugProtection: false,
      debugProtectionInterval: 0,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: true,
      simplify: true,
      splitStrings: true,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: true,
      stringArrayWrappersParametersMaxCount: 5,
      stringArrayWrappersCount: 2,
      stringArrayWrappersType: 'variable',
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayIndexesType: ['hexadecimal-number'],
      stringArrayCallsTransform: true,
      stringArrayCallsTransformThreshold: 0.75,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        footer: `/* Watermark: Acounted by themukuls - Build ID: ${new Date().toISOString()} */`,
      },
    },
  },
}));
