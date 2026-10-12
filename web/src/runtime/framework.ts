/** The .NET runtime's entry point under the site's base path (Vite's `BASE_URL`, from `VB_BASE` at build time). */
export const frameworkUrl = (base: string, origin: string) => new URL(`${base}_framework/dotnet.js`, origin).href
