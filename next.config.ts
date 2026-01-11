import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ignorer le répertoire app/ à la racine pour éviter les conflits
  // Next.js utilisera automatiquement src/app/ comme répertoire source
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
};

export default nextConfig;
