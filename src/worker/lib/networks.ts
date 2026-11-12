/**
 * Cloud and hosting networks (by ASN). People rarely browse from these; scrapers, headless browsers and AI agents usually do.
 * Left out on purpose: Cloudflare, Akamai and Fastly (iCloud Private Relay and WARP exit through them), Google's main
 * network (offices, Google Fi) and hosts that mostly carry consumer VPNs (M247, Datacamp).
 */
const DATACENTER_ASNS = new Set([
  16509, 14618, // Amazon AWS
  8075, // Microsoft Azure
  396982, // Google Cloud
  31898, // Oracle Cloud
  45102, // Alibaba Cloud
  132203, // Tencent Cloud
  136907, // Huawei Cloud
  14061, // DigitalOcean
  63949, // Linode / Akamai Cloud
  20473, // Vultr
  24940, 213230, // Hetzner
  16276, // OVH
  12876, // Scaleway
  51167, 40021, // Contabo
  60781, 16265, // Leaseweb
  8560, // IONOS
  47583, // Hostinger
  197540, // netcup
  36007, // Kamatera
  202053, // UpCloud
  40509, // Fly.io
]);

export function isDatacenter(asn: number | undefined): boolean {
  return !!asn && DATACENTER_ASNS.has(asn);
}
