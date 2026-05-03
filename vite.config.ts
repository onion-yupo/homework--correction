import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import { unheadComposablesImports } from 'unhead'
import AutoImportPlugin from 'unplugin-auto-import/vite'
import Icons from 'unplugin-icons/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import IconsResolver from 'unplugin-icons/resolver'
import Components from 'unplugin-vue-components/vite'
import macrosPlugin from 'unplugin-vue-macros/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { VueRouterAutoImports } from 'unplugin-vue-router'
import Layouts from 'vite-plugin-vue-layouts'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/homework/',
  envDir: './env',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssTarget: 'chrome56',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '~/': `${path.resolve(__dirname, 'src')}/`,
    },
  },
  plugins: [
    macrosPlugin({
      betterDefine: false,
      plugins: {
        vue: Vue({ include: [/.vue$/] }),
        vueJsx: VueJsx(),
        vueRouter: VueRouter({
          extensions: ['.vue'],
          dts: 'src/typed-router.d.ts',
        }),
      },
    }),

    Components({
      directoryAsNamespace: true,
      collapseSamePrefixes: true,
      extensions: ['vue'],
      resolvers: [
        IconsResolver({ customCollections: 'onion' }),
      ],
      include: [/.vue$/, /.vue\?vue/],
      dts: 'src/components.d.ts',
    }),

    Icons({
      compiler: 'vue3',
      customCollections: {
        onion: FileSystemIconLoader('./src/assets/icons'),
      },
    }),

    AutoImportPlugin({
      imports: [
        'vue',
        '@vueuse/core',
        VueRouterAutoImports,
        { 'vue-router/auto': ['useLink'] },
        unheadComposablesImports[0],
        'pinia',
      ],
      dts: 'src/auto-imports.d.ts',
      dirs: ['src/composables', 'src/stores'],
      vueTemplate: true,
    }),

    Layouts(),
  ],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3300',
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
})
