// Global setup file - runs before all tests
export default async function globalSetup() {
  // This runs in a separate context, so we can't directly set window properties
  // But we can configure vitest options
  return {} as Record<string, unknown>
}
