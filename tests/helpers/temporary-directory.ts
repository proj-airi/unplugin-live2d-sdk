import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function withTemporaryDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'live2d-sdk-'))
  try {
    return await run(directory)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}
