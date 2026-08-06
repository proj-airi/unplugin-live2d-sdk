import { Cubism2Core } from '@proj-airi/unplugin-live2d-sdk/vite'
import { cubism2Core } from 'virtual:live2d-sdk/cores'

Cubism2Core()

if (cubism2Core.available)
  void cubism2Core.expectedGlobal
