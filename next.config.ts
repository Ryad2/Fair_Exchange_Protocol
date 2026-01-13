import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ignorer le répertoire app/ à la racine pour éviter les conflits
  // Next.js utilisera automatiquement src/app/ comme répertoire source
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  
  // Permettre l'import de fichiers JSON depuis la racine et src/
  webpack: (config, { isServer }) => {
    // Permettre l'import de JSON depuis la racine du projet
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

export default nextConfig;
