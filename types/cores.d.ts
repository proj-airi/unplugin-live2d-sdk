declare module 'virtual:live2d-sdk/cores' {
  export const cubism2Core:
    | {
      available: true
      url: string
      sha256: string
      sri: string
      expectedGlobal: 'Live2D'
      distribution: 'development' | 'bundle'
    }
    | {
      available: false
      reason: 'not-configured' | 'not-found' | 'build-emission-disabled' | 'provisioning-failed'
    }
}
