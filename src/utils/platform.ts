export function getPlatform(): 'windows' | 'linux' | 'darwin' {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  return 'linux';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function isDarwin(): boolean {
  return process.platform === 'darwin';
}

export function getTempDir(): string {
  return process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? '/tmp';
}