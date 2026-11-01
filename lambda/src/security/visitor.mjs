import { BlockList, isIPv4, isIPv6 } from "node:net";

/**
 * WHO IS THE VISITOR?
 *
 * Behind the Cloudflare proxy, the address that connects to API Gateway is a Cloudflare
 * server, not the visitor. Cloudflare passes the real visitor in the `cf-connecting-ip` header.
 *
 * Anyone can send a header with any value, so we only believe it when the connection
 * itself comes from a real Cloudflare address. A direct hit that skips Cloudflare cannot
 * forge its way around the rate limits: its own address is used and the header is ignored.
 *
 * Cloudflare's published ranges: https://www.cloudflare.com/ips (unchanged since Sep 2023).
 * Worth a look once a year in case a range was added.
 */
const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_IPV6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_IPV4) {
  const [base, bits] = range.split("/");
  cloudflare.addSubnet(base, Number(bits), "ipv4");
}
for (const range of CLOUDFLARE_IPV6) {
  const [base, bits] = range.split("/");
  cloudflare.addSubnet(base, Number(bits), "ipv6");
}

/** "::ffff:1.2.3.4" is plain IPv4 1.2.3.4 written the long way. Also drops any "%zone". */
function plain(ip) {
  const addr = String(ip).trim().split("%")[0];
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1] : addr;
}

const isValidIp = (ip) => isIPv4(ip) || isIPv6(ip);

/** Is this address one of Cloudflare's? */
export function isCloudflareAddress(ip) {
  if (typeof ip !== "string") return false;
  const addr = plain(ip);
  if (isIPv4(addr)) return cloudflare.check(addr, "ipv4");
  if (isIPv6(addr)) return cloudflare.check(addr, "ipv6");
  return false;
}

/** The visitor's address, as far as we can trust it. */
export function visitorIp(event) {
  const connection = event.requestContext?.http?.sourceIp; // who connected to API Gateway
  const claimed = event.headers?.["cf-connecting-ip"]; // who Cloudflare says the visitor is

  if (isCloudflareAddress(connection) && typeof claimed === "string" && isValidIp(claimed.trim())) {
    return claimed.trim();
  }
  return connection;
}

/**
 * Which "network" a visitor belongs to, for rate limits:
 *  - IPv4: the address itself.
 *  - IPv6: the /64 (first 4 groups). One home or phone gets a whole /64 and can hop between
 *    billions of addresses inside it, so counting single addresses would mean nothing.
 */
export function networkOf(ip) {
  if (typeof ip !== "string" || ip === "") return "unknown";
  const addr = plain(ip);
  if (isIPv4(addr)) return addr;
  if (isIPv6(addr)) {
    const groups = expandV6(addr);
    return groups ? `v6:${groups.slice(0, 4).join(":")}` : `v6:${addr.toLowerCase()}`;
  }
  return "unknown";
}

/** Fill in the "::" shorthand so we have all 8 groups. Returns null for forms we do not parse. */
function expandV6(ip) {
  if (ip.includes(".")) return null;
  const [head, tail] = ip.split("::");
  const before = head ? head.split(":") : [];
  const after = tail === undefined ? [] : tail ? tail.split(":") : [];
  const filler = ip.includes("::") ? Array(Math.max(0, 8 - before.length - after.length)).fill("0") : [];
  return [...before, ...filler, ...after].map((group) => group.padStart(4, "0").toLowerCase());
}
