import { NativeModules, Platform } from "react-native";
import type { DohProvider, NetworkMode } from "../store/settingsStore";

export const DOH_PROVIDERS: Record<
  Exclude<DohProvider, "custom">,
  { label: string; url: string }
> = {
  cloudflare: { label: "Cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  google: { label: "Google", url: "https://dns.google/dns-query" },
  adguard: { label: "AdGuard", url: "https://dns.adguard-dns.com/dns-query" },
};

export interface NetworkConfig {
  networkMode: NetworkMode;
  dohProvider: DohProvider;
  dohCustomUrl: string;
  proxyUrl: string;
}

const PROXY_RE = /^((https?|socks[45]?):\/\/)?[^\s:/]+:\d{1,5}$/i;

export function isValidProxyUrl(url: string): boolean {
  return PROXY_RE.test(url.trim());
}

export function isValidDohUrl(url: string): boolean {
  return /^https:\/\/[^\s/]+\/\S*$/i.test(url.trim());
}

function resolveDohUrl(config: NetworkConfig): string {
  if (config.dohProvider === "custom") return config.dohCustomUrl.trim();
  return DOH_PROVIDERS[config.dohProvider].url;
}

/**
 * Routes all WebViews and native HTTP (fetch, downloads) through Secure DNS or
 * a user proxy. An invalid or empty address falls back to "off".
 */
export async function applyNetworkConfig(config: NetworkConfig): Promise<void> {
  const native = NativeModules.NetworkProxy;
  if (Platform.OS !== "android" || !native) return;

  let mode: NetworkMode = config.networkMode;
  const dohUrl = resolveDohUrl(config);
  if (mode === "secureDns" && !isValidDohUrl(dohUrl)) mode = "off";
  if (mode === "proxy" && !isValidProxyUrl(config.proxyUrl)) mode = "off";

  await native.apply({ mode, dohUrl, proxyUrl: config.proxyUrl.trim() });
}
